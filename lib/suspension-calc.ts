import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

interface CardCount {
  yellow: number;
  red: number;
  second_yellow: number;
}

export interface PointSource {
  match_id: string;
  matchday: number;
  points: number;
  reason: string;
  points_before: number;
  points_after: number;
}

export interface SuspendedMatchDetail {
  match_id: string;
  matchday: number;
  match_date: string;
  match_time: string | null;
  match_code: string;
  opponent_name: string;
  opponent_id: string;
  is_home: boolean;
  status: string;
}

export interface SuspensionDetails {
  trigger_match_id: string;
  trigger_matchday: number;
  trigger_event: string;
  points_before: number;
  points_added: number;
  points_after: number;
  threshold_crossed: number;
  ban_matches_count: number;
  suspended_matches: SuspendedMatchDetail[];
}

/**
 * Parse matchday number from any format:
 * "MatchDay 2" → 2, "MD2" → 2, 2 → 2, "2" → 2
 */
export function parseMatchdayNumber(val: string | number | null | undefined): number {
  if (val == null) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const str = String(val).trim();
  const m = str.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * CFYL Point Scoring per match:
 * - 1 yellow = 2 pts
 * - 2 yellows (or 1 second_yellow) = 4 pts
 * - 1 red (direct) = 6 pts
 * - 1 yellow + 1 red = 8 pts
 */
export function calculateMatchPoints(cards: CardCount): number {
  const { yellow, red, second_yellow } = cards;
  const hasSecondYellow = second_yellow >= 1;
  const hasRed = red >= 1;

  // Yellow or 2nd-yellow + Red in same match = 8 pts
  if (hasRed && (yellow >= 1 || hasSecondYellow)) return 8;
  // Direct Red = 6 pts
  if (hasRed) return 6;
  // second_yellow = standalone "2nd yellow in match" = 4 pts
  if (hasSecondYellow) return 4;
  // Backward compat: 2 separate yellow records in same match = 4 pts
  if (yellow >= 2) return 4;
  // 1 yellow = 2 pts
  if (yellow >= 1) return 2;
  return 0;
}

/**
 * Check if a match has second_yellow or 2+ yellows = ejection via yellow card rule
 */
export function isSecondYellowEjection(cards: CardCount): boolean {
  return cards.second_yellow >= 1 || cards.yellow >= 2;
}

/**
 * Check if a match has direct red ejection
 */
export function isDirectRedEjection(cards: CardCount): boolean {
  return cards.red >= 1;
}

/**
 * CFYL Suspension Thresholds:
 * - 6 pts = 1 match ban
 * - 12 pts = 2 match ban
 * - 18 pts = 2 match ban
 * - 24 pts = 2 match ban
 */
export function calculateBanMatches(totalPoints: number): number {
  if (totalPoints >= 12) return 2;
  if (totalPoints >= 6) return 1;
  return 0;
}

function getThresholdCrossed(totalPoints: number): number {
  if (totalPoints >= 24) return 24;
  if (totalPoints >= 18) return 18;
  if (totalPoints >= 12) return 12;
  if (totalPoints >= 6) return 6;
  return 0;
}

function getTriggerEventText(reason: string, points: number): string {
  if (reason.includes('R') && reason.includes('Y')) return `ใบเหลือง + ใบแดง (${points} คะแนน)`;
  if (reason.includes('R')) return `ใบแดงโดยตรง (${points} คะแนน)`;
  const yMatch = reason.match(/^(\d+)Y$/);
  if (yMatch && parseInt(yMatch[1]) >= 2) return `ใบเหลือง ${yMatch[1]} ใบ (${points} คะแนน)`;
  return `ใบเหลือง 1 ใบ (${points} คะแนน)`;
}

/**
 * Get all cards for a player in a season/age_group.
 * Sorted by match_date ASC → match_time ASC → matchday number ASC.
 * OPTIMIZED: 2 queries instead of N+1.
 */
export async function getSeasonCards(
  playerId: string,
  seasonId: string,
  ageGroupId: string
): Promise<Array<{
  match_id: string;
  matchday: number;
  match_date: string | null;
  match_time: string | null;
  points: number;
  cards: CardCount;
  reason: string;
  is_second_yellow_ejection: boolean;
  is_direct_red: boolean;
  is_ejection: boolean;
}>> {
  const timer = `[SUSPENSION_CALC] getSeasonCards`;
  console.time(timer);

  try {
    // Query 1: get all match IDs for this season+age_group
    const { data: matchRows } = await supabaseAdmin
      .from('matches')
      .select('id')
      .eq('season_id', seasonId)
      .eq('age_group_id', ageGroupId);

    if (!matchRows || matchRows.length === 0) {
      console.timeEnd(timer);
      return [];
    }

    // Query 2: get all cards for this player in those matches (including match_date/time for sorting)
    const { data: allCards, error } = await supabaseAdmin
      .from('cards')
      .select(`match_id, card_type, match:match_id(matchday, match_date, match_time)`)
      .eq('player_id', playerId)
      .in('match_id', matchRows.map((m) => m.id));

    if (error) {
      console.error('[SUSPENSION_CALC] Error fetching cards:', error);
      throw error;
    }

    // Group cards by match_id
    const matchCardMap: Record<string, {
      cards: Array<{ card_type: string }>;
      matchday: number;
      match_date: string | null;
      match_time: string | null;
    }> = {};

    (allCards || []).forEach((card: any) => {
      const matchId = card.match_id;
      if (!matchCardMap[matchId]) {
        matchCardMap[matchId] = {
          cards: [],
          matchday: parseMatchdayNumber(card.match?.matchday),
          match_date: card.match?.match_date || null,
          match_time: card.match?.match_time || null,
        };
      }
      matchCardMap[matchId].cards.push(card);
    });

    // Calculate points per match
    const result: Array<{
      match_id: string;
      matchday: number;
      match_date: string | null;
      match_time: string | null;
      points: number;
      cards: CardCount;
      reason: string;
      is_second_yellow_ejection: boolean;
      is_direct_red: boolean;
      is_ejection: boolean;
    }> = [];

    for (const [matchId, matchData] of Object.entries(matchCardMap)) {
      const count = { yellow: 0, red: 0, second_yellow: 0 };
      matchData.cards.forEach((card: any) => {
        if (card.card_type === 'yellow') count.yellow++;
        if (card.card_type === 'red') count.red++;
        if (card.card_type === 'second_yellow') count.second_yellow++;
      });

      const points = calculateMatchPoints(count);
      if (points > 0) {
        // second_yellow represents 2 yellows in same match for display purposes
        const effectiveYellows = count.yellow + (count.second_yellow >= 1 ? 2 : 0);
        const reason =
          count.red > 0
            ? effectiveYellows > 0 ? `${effectiveYellows}Y + ${count.red}R` : `${count.red}R`
            : effectiveYellows >= 2 ? `${effectiveYellows}Y` : '1Y';

        const isSecondYellow = isSecondYellowEjection(count);
        const isDirectRed = isDirectRedEjection(count);

        result.push({
          match_id: matchId,
          matchday: matchData.matchday,
          match_date: matchData.match_date,
          match_time: matchData.match_time,
          points,
          cards: count,
          reason,
          is_second_yellow_ejection: isSecondYellow,
          is_direct_red: isDirectRed,
          is_ejection: isSecondYellow || isDirectRed,
        });
      }
    }

    // CRITICAL: sort by match_date ASC → match_time ASC → matchday number ASC
    result.sort((a, b) => {
      if (a.match_date && b.match_date) {
        const dateCmp = a.match_date.localeCompare(b.match_date);
        if (dateCmp !== 0) return dateCmp;
        const aTime = a.match_time || '00:00:00';
        const bTime = b.match_time || '00:00:00';
        const timeCmp = aTime.localeCompare(bTime);
        if (timeCmp !== 0) return timeCmp;
      }
      return a.matchday - b.matchday;
    });

    console.timeEnd(timer);
    return result;
  } catch (error) {
    console.timeEnd(timer);
    throw error;
  }
}

/**
 * Find the next N matches for a team after a trigger match.
 * Uses date-based ordering (match_date ASC → match_time ASC → matchday ASC).
 * Falls back to matchday number comparison when dates are absent.
 */
export async function findNextMatchesForSuspension(
  teamId: string,
  seasonId: string,
  ageGroupId: string,
  triggerMatchId: string,
  count: number
): Promise<SuspendedMatchDetail[]> {
  console.log(
    `[SUSPENSION_CALC] findNextMatchesForSuspension: teamId=${teamId} triggerMatchId=${triggerMatchId} count=${count}`
  );

  // Step 1: Fetch trigger match date/time/matchday for comparison
  const { data: triggerMatch, error: triggerError } = await supabaseAdmin
    .from('matches')
    .select('id, matchday, match_date, match_time')
    .eq('id', triggerMatchId)
    .single();

  if (triggerError || !triggerMatch) {
    console.error('[SUSPENSION_CALC] Failed to fetch trigger match:', triggerError);
    return [];
  }

  const triggerMatchdayNum = parseMatchdayNumber(triggerMatch.matchday);
  const triggerDate = (triggerMatch.match_date as string | null) || null;
  const triggerTime = (triggerMatch.match_time as string | null) || '23:59:59';

  console.log(
    `[SUSPENSION_CALC] Trigger match: matchday_raw="${triggerMatch.matchday}" matchday_num=${triggerMatchdayNum} date=${triggerDate} time=${triggerTime}`
  );

  // Step 2: Fetch all team matches in this season/age_group (excluding trigger match)
  const { data: allMatches, error } = await supabaseAdmin
    .from('matches')
    .select(`
      id, matchday, match_date, match_time, match_code,
      home_team_id, away_team_id, status,
      home_team:home_team_id(name),
      away_team:away_team_id(name)
    `)
    .eq('season_id', seasonId)
    .eq('age_group_id', ageGroupId)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .neq('id', triggerMatchId);

  if (error) {
    console.error('[SUSPENSION_CALC] Error fetching team matches:', error);
    return [];
  }

  console.log(`[SUSPENSION_CALC] Total team matches found (excl. trigger): ${(allMatches || []).length}`);

  // Step 3: Filter matches that come after the trigger
  const candidates = (allMatches || []).filter((m: any) => {
    const mMatchdayNum = parseMatchdayNumber(m.matchday);
    const mDate = (m.match_date as string | null) || null;
    const mTime = (m.match_time as string | null) || '23:59:59';

    if (triggerDate && mDate) {
      // Both have dates — use date comparison
      if (mDate > triggerDate) return true;
      if (mDate === triggerDate) return mTime > triggerTime;
      return false;
    }
    // Fallback: matchday number comparison
    return mMatchdayNum > triggerMatchdayNum;
  });

  // Step 4: Sort by match_date ASC → match_time ASC → matchday number ASC
  candidates.sort((a: any, b: any) => {
    const aDate = (a.match_date as string | null) || '';
    const bDate = (b.match_date as string | null) || '';
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    const aTime = (a.match_time as string | null) || '00:00:00';
    const bTime = (b.match_time as string | null) || '00:00:00';
    if (aTime !== bTime) return aTime.localeCompare(bTime);
    return parseMatchdayNumber(a.matchday) - parseMatchdayNumber(b.matchday);
  });

  // Step 5: Take first `count` matches
  const result = candidates.slice(0, count).map((m: any) => ({
    match_id: m.id,
    matchday: parseMatchdayNumber(m.matchday),
    match_date: m.match_date,
    match_time: m.match_time,
    match_code: m.match_code,
    opponent_name:
      m.home_team_id === teamId
        ? (m.away_team?.name || 'ไม่ทราบทีม')
        : (m.home_team?.name || 'ไม่ทราบทีม'),
    opponent_id: m.home_team_id === teamId ? m.away_team_id : m.home_team_id,
    is_home: m.home_team_id === teamId,
    status: m.status,
  }));

  console.log(
    `[SUSPENSION_CALC] Next matches found (${result.length}):`,
    result.map((m) => `MD${m.matchday}(${m.match_date})`).join(', ') || 'none'
  );

  return result;
}

/**
 * Recalculate suspensions for a player.
 * Computes total points, finds trigger match, finds banned matches, and stores rich details.
 */
export async function recalculatePlayerSuspension(
  playerId: string,
  seasonId: string,
  ageGroupId: string,
  teamId: string
): Promise<any> {
  const timerTotal = `[SUSPENSION_CALC] recalculatePlayerSuspension`;
  console.time(timerTotal);

  try {
    console.log(
      `[SUSPENSION_CALC] Recalculating player=${playerId} team=${teamId} season=${seasonId} age_group=${ageGroupId}`
    );

    // Get all cards sorted by match_date → match_time → matchday
    const seasonCards = await getSeasonCards(playerId, seasonId, ageGroupId);

    // Calculate total points and build point_sources with cumulative tracking
    let cumulativePoints = 0;
    const pointSources: PointSource[] = seasonCards.map((item) => {
      const pointsBefore = cumulativePoints;
      cumulativePoints += item.points;
      return {
        match_id: item.match_id,
        matchday: item.matchday,
        points: item.points,
        reason: item.reason,
        points_before: pointsBefore,
        points_after: cumulativePoints,
      };
    });

    const totalPoints = cumulativePoints;
    const pointsBanMatches = calculateBanMatches(totalPoints);

    // Check for ejection-based ban (second yellow or direct red)
    const ejectionSource = [...seasonCards].reverse().find((item) => item.is_ejection);

    let banMatches = pointsBanMatches;
    let triggerSource: PointSource | null = null;
    let triggerEvent = '';

    if (ejectionSource) {
      // Ejection takes priority: ban at least 1 match
      banMatches = Math.max(pointsBanMatches, 1);
      triggerSource = pointSources.find((src) => src.match_id === ejectionSource.match_id) || null;

      if (ejectionSource.is_second_yellow_ejection) {
        triggerEvent = 'ใบเหลือง 2 ใบในนัดเดียว / ใบเหลืองที่ 2 (แบน 1 นัด)';
      } else if (ejectionSource.is_direct_red) {
        triggerEvent = 'ใบแดงโดยตรง (แบนอย่างน้อย 1 นัด)';
      }
    }

    console.log(
      `[SUSPENSION_CALC] totalPoints=${totalPoints} pointsBanMatches=${pointsBanMatches} banMatches=${banMatches} ` +
      `ejectionSource=${ejectionSource ? 'yes' : 'no'} pointSources=${pointSources.length}`
    );

    // Build suspension_details when there's a ban
    let suspensionDetails: SuspensionDetails | null = null;
    let suspendedFromMatchId: string | null = null;
    let suspensionReason: string | null = null;

    if (banMatches > 0 && pointSources.length > 0) {
      // If no ejection, use threshold-based trigger
      if (!triggerSource) {
        const thresholdCrossed = getThresholdCrossed(totalPoints);

        // Find trigger match: first match where cumulative crossed the threshold
        for (const src of pointSources) {
          if (src.points_before < thresholdCrossed && src.points_after >= thresholdCrossed) {
            triggerSource = src;
            break;
          }
        }
        // Fallback to last card
        if (!triggerSource) {
          triggerSource = pointSources[pointSources.length - 1];
        }

        const triggerCardData = seasonCards.find((c) => c.match_id === triggerSource!.match_id);
        triggerEvent = triggerCardData
          ? getTriggerEventText(triggerCardData.reason, triggerCardData.points)
          : 'สะสมคะแนนครบเกณฑ์';
      }

      console.log(
        `[SUSPENSION_CALC] Trigger source: match_id=${triggerSource?.match_id} matchday=${triggerSource?.matchday} ` +
        `triggerEvent=${triggerEvent}`
      );

      if (triggerSource) {
        // Find next banMatches matches for this team (date-based, pass triggerMatchId)
        const timerNextMatch = `[SUSPENSION_CALC] findNextMatches`;
        console.time(timerNextMatch);
        const suspendedMatches = await findNextMatchesForSuspension(
          teamId,
          seasonId,
          ageGroupId,
          triggerSource.match_id,
          banMatches
        );
        console.timeEnd(timerNextMatch);

        suspendedFromMatchId = suspendedMatches[0]?.match_id || null;

        const thresholdCrossed = ejectionSource ? 0 : getThresholdCrossed(totalPoints);

        suspensionDetails = {
          trigger_match_id: triggerSource.match_id,
          trigger_matchday: triggerSource.matchday,
          trigger_event: triggerEvent,
          points_before: triggerSource.points_before,
          points_added: triggerSource.points,
          points_after: triggerSource.points_after,
          threshold_crossed: thresholdCrossed,
          ban_matches_count: banMatches,
        suspended_matches: suspendedMatches,
      };

        if (suspendedMatches.length > 0) {
          const matchdays = suspendedMatches.map((m) => `MD${m.matchday}`).join(', ');
          suspensionReason = `ติดโทษแบน ${banMatches} นัด (${totalPoints} คะแนน) - ${matchdays}`;
        } else {
          suspensionReason = `ครบโทษแบน ${banMatches} นัด (${totalPoints} คะแนน) - ไม่พบโปรแกรมแข่งขันนัดถัดไป`;
        }
      }
    }

    // Upsert into suspensions table
    const { data: suspension, error } = await supabaseAdmin
      .from('suspensions')
      .upsert(
        {
          season_id: seasonId,
          age_group_id: ageGroupId,
          player_id: playerId,
          team_id: teamId,
          total_points: totalPoints,
          point_sources: pointSources,
          ban_matches: banMatches,
          suspended_from_match_id: suspendedFromMatchId,
          suspension_reason: suspensionReason,
          suspension_details: suspensionDetails,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'season_id,age_group_id,player_id,team_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('[SUSPENSION_CALC] Upsert error:', error);
      throw error;
    }

    console.log(`[SUSPENSION_CALC] Done: points=${totalPoints} ban=${banMatches}`);
    console.timeEnd(timerTotal);
    return suspension;
  } catch (error) {
    console.timeEnd(timerTotal);
    console.error('[SUSPENSION_CALC] Error:', error);
    throw error;
  }
}

/**
 * Recalculate all player suspensions for a season/age_group.
 * Finds all players with cards and re-runs recalculatePlayerSuspension for each.
 */
export async function recalculateSeasonSuspensions(
  seasonId: string,
  ageGroupId: string
): Promise<{ processed: number; success: number; failed: number }> {
  console.log(
    `[SUSPENSION_CALC] recalculateSeasonSuspensions season=${seasonId} age_group=${ageGroupId}`
  );

  // Get all match IDs for this season/age_group
  const { data: matchRows, error: matchError } = await supabaseAdmin
    .from('matches')
    .select('id')
    .eq('season_id', seasonId)
    .eq('age_group_id', ageGroupId);

  if (matchError) throw matchError;
  const matchIds = (matchRows || []).map((m: any) => m.id);

  if (matchIds.length === 0) {
    console.log('[SUSPENSION_CALC] No matches found for this season/age_group');
    return { processed: 0, success: 0, failed: 0 };
  }

  // Get distinct (player_id, team_id) from cards in those matches
  const { data: cardRows, error: cardError } = await supabaseAdmin
    .from('cards')
    .select('player_id, team_id')
    .in('match_id', matchIds);

  if (cardError) throw cardError;

  const playerTeamMap = new Map<string, { playerId: string; teamId: string }>();
  for (const row of cardRows || []) {
    if (!row.player_id || !row.team_id) continue;
    const key = `${row.player_id}:${row.team_id}`;
    if (!playerTeamMap.has(key)) {
      playerTeamMap.set(key, { playerId: row.player_id, teamId: row.team_id });
    }
  }

  const players = Array.from(playerTeamMap.values());
  console.log(`[SUSPENSION_CALC] Recalculating ${players.length} unique player+team combos`);

  let success = 0;
  let failed = 0;
  for (const { playerId, teamId } of players) {
    try {
      await recalculatePlayerSuspension(playerId, seasonId, ageGroupId, teamId);
      success++;
    } catch (err) {
      console.error(`[SUSPENSION_CALC] Failed player=${playerId} team=${teamId}:`, err);
      failed++;
    }
  }

  console.log(`[SUSPENSION_CALC] recalculateSeasonSuspensions done: ${success} success, ${failed} failed`);
  return { processed: players.length, success, failed };
}

/**
 * Get match details including season/age_group context
 */
export async function getMatchDetails(matchId: string): Promise<any> {
  const { data: match, error } = await supabaseAdmin
    .from('matches')
    .select('id, matchday, season_id, age_group_id, home_team_id, away_team_id')
    .eq('id', matchId)
    .single();

  if (error) {
    console.error('[SUSPENSION_CALC] Error fetching match:', error);
    throw error;
  }

  return match;
}

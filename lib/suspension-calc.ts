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
 * CFYL Point Scoring per match:
 * - 1 yellow = 2 pts
 * - 2 yellows (or 1 second_yellow) = 4 pts
 * - 1 red (direct) = 6 pts
 * - 1 yellow + 1 red = 8 pts
 */
export function calculateMatchPoints(cards: CardCount): number {
  const { yellow, red, second_yellow } = cards;
  const totalYellows = yellow + second_yellow;

  if (red >= 1 && totalYellows === 0) return 6;
  if (red >= 1 && totalYellows >= 1) return 8;
  if (totalYellows >= 2) return 4;
  if (totalYellows === 1) return 2;
  return 0;
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
 * Get all cards for a player in a season/age_group, sorted by matchday ascending.
 * OPTIMIZED: 2 queries instead of N+1
 */
export async function getSeasonCards(
  playerId: string,
  seasonId: string,
  ageGroupId: string
): Promise<Array<{
  match_id: string;
  matchday: number;
  points: number;
  cards: CardCount;
  reason: string;
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

    // Query 2: get all cards for this player in those matches
    const { data: allCards, error } = await supabaseAdmin
      .from('cards')
      .select(`match_id, card_type, match:match_id(matchday)`)
      .eq('player_id', playerId)
      .in('match_id', matchRows.map((m) => m.id));

    if (error) {
      console.error('[SUSPENSION_CALC] Error fetching cards:', error);
      throw error;
    }

    // Group cards by match_id
    const matchCardMap: Record<string, { cards: Array<{ card_type: string }>; matchday: number }> = {};

    (allCards || []).forEach((card: any) => {
      const matchId = card.match_id;
      if (!matchCardMap[matchId]) {
        matchCardMap[matchId] = { cards: [], matchday: Number(card.match?.matchday) || 0 };
      }
      matchCardMap[matchId].cards.push(card);
    });

    // Calculate points per match
    const result: Array<{ match_id: string; matchday: number; points: number; cards: CardCount; reason: string }> = [];

    for (const [matchId, matchData] of Object.entries(matchCardMap)) {
      const count = { yellow: 0, red: 0, second_yellow: 0 };
      matchData.cards.forEach((card: any) => {
        if (card.card_type === 'yellow') count.yellow++;
        if (card.card_type === 'red') count.red++;
        if (card.card_type === 'second_yellow') count.second_yellow++;
      });

      const points = calculateMatchPoints(count);
      if (points > 0) {
        const totalYellows = count.yellow + count.second_yellow;
        const reason =
          count.red > 0
            ? totalYellows > 0 ? `${totalYellows}Y + ${count.red}R` : `${count.red}R`
            : totalYellows >= 2 ? `${totalYellows}Y` : '1Y';

        result.push({ match_id: matchId, matchday: matchData.matchday, points, cards: count, reason });
      }
    }

    // CRITICAL: sort by matchday ascending for correct threshold detection
    result.sort((a, b) => a.matchday - b.matchday);

    console.timeEnd(timer);
    return result;
  } catch (error) {
    console.timeEnd(timer);
    throw error;
  }
}

/**
 * Find the next N matches for a team after a trigger matchday.
 * FIXED: Use .or() for home_team_id / away_team_id filter (was .in() which is wrong)
 */
export async function findNextMatchesForSuspension(
  teamId: string,
  seasonId: string,
  ageGroupId: string,
  triggerMatchday: number,
  count: number
): Promise<SuspendedMatchDetail[]> {
  const { data: matches, error } = await supabaseAdmin
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
    .gt('matchday', triggerMatchday)
    .order('matchday', { ascending: true })
    .limit(count);

  if (error) {
    console.error('[SUSPENSION_CALC] Error finding next matches:', error);
    return [];
  }

  return (matches || []).map((m: any) => ({
    match_id: m.id,
    matchday: Number(m.matchday),
    match_date: m.match_date,
    match_time: m.match_time,
    match_code: m.match_code,
    opponent_name: m.home_team_id === teamId
      ? (m.away_team?.name || 'ไม่ทราบทีม')
      : (m.home_team?.name || 'ไม่ทราบทีม'),
    opponent_id: m.home_team_id === teamId ? m.away_team_id : m.home_team_id,
    is_home: m.home_team_id === teamId,
    status: m.status,
  }));
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
    console.log(`[SUSPENSION_CALC] Recalculating player=${playerId} season=${seasonId} age_group=${ageGroupId}`);

    // Get all cards sorted by matchday ascending
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
    const banMatches = calculateBanMatches(totalPoints);

    // Build suspension_details when there's a ban
    let suspensionDetails: SuspensionDetails | null = null;
    let suspendedFromMatchId: string | null = null;
    let suspensionReason: string | null = null;

    if (banMatches > 0 && pointSources.length > 0) {
      const thresholdCrossed = getThresholdCrossed(totalPoints);

      // Find trigger match: first match that pushed cumulative over the current threshold
      let triggerSource: PointSource | null = null;
      for (const src of pointSources) {
        if (src.points_before < thresholdCrossed && src.points_after >= thresholdCrossed) {
          triggerSource = src;
          break;
        }
      }
      // Fallback to last card if threshold detection misses edge cases
      if (!triggerSource) {
        triggerSource = pointSources[pointSources.length - 1];
      }

      const triggerCardData = seasonCards.find((c) => c.match_id === triggerSource!.match_id);
      const triggerEvent = triggerCardData
        ? getTriggerEventText(triggerCardData.reason, triggerCardData.points)
        : 'สะสมคะแนนครบเกณฑ์';

      // Find next banMatches matches for this team
      const timerNextMatch = `[SUSPENSION_CALC] findNextMatches`;
      console.time(timerNextMatch);
      const suspendedMatches = await findNextMatchesForSuspension(
        teamId, seasonId, ageGroupId, triggerSource.matchday, banMatches
      );
      console.timeEnd(timerNextMatch);

      suspendedFromMatchId = suspendedMatches[0]?.match_id || null;

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

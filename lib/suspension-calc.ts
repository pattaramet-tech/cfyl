import { createClient } from '@supabase/supabase-js';
import type { CardCount, PointSource, SuspendedMatchDetail, SuspensionDetails, SuspensionType } from './suspension-shared';
import {
  parseMatchdayNumber,
  calculateMatchPoints,
  isSecondYellowEjection,
  isDirectRedEjection,
  classifyPlayerMatchDiscipline,
  buildNormalYellowPointHistory,
  calculateBanMatches,
  getThresholdCrossed,
  getHighestThresholdCrossed,
  computeStaleEventIds,
  getTriggerEventText,
  isEligibleSuspensionServingMatch,
  classifyServingMatchIds,
  servingArraysEqual,
} from './suspension-shared';

/**
 * Suspension Calculation Module — SERVER ONLY.
 *
 * This module creates a Supabase client using SUPABASE_SERVICE_ROLE_KEY at module-evaluation
 * time and throws if env vars are missing. It must only be imported by server code (API
 * routes, server actions). Client Components must import pure logic from
 * '@/lib/suspension-shared' instead — see that file's header comment for why.
 *
 * Pure logic lives in ./suspension-shared and is re-exported below so existing server-side
 * imports of `from '@/lib/suspension-calc'` keep working unchanged.
 *
 * REGRESSION TEST SCENARIO (P1 Fix):
 * When calculating suspension-serving matches, only scheduled matches should count.
 * Postponed/cancelled/finished matches must be skipped.
 *
 * Test case:
 * - Trigger: MD1 (finished, card triggered)
 * - Ban: 2 matches
 * - Future matches: MD2 (scheduled), MD3 (postponed), MD4 (cancelled), MD5 (scheduled)
 * - Expected serving: MD2, MD5
 * - Should skip: MD3 (postponed), MD4 (cancelled)
 */

export * from './suspension-shared';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

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
  card_ids: string[];
  yellow_card_ids: string[];
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
      .select(`id, match_id, card_type, match:match_id(matchday, match_date, match_time)`)
      .eq('player_id', playerId)
      .in('match_id', matchRows.map((m) => m.id));

    if (error) {
      console.error('[SUSPENSION_CALC] Error fetching cards:', error);
      throw error;
    }

    // Group cards by match_id
    const matchCardMap: Record<string, {
      cards: Array<{ id: string; card_type: string }>;
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
      matchCardMap[matchId].cards.push({ id: card.id, card_type: card.card_type });
    });

    // Calculate points per match
    const result: Array<{
      match_id: string;
      matchday: number;
      match_date: string | null;
      match_time: string | null;
      points: number;
      cards: CardCount;
      card_ids: string[];
      yellow_card_ids: string[];
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
          card_ids: matchData.cards.map((c) => c.id),
          yellow_card_ids: matchData.cards.filter((c) => c.card_type === 'yellow').map((c) => c.id),
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
 * Find the next N chronological serving slots for a team after a trigger match.
 * Uses date-based ordering (match_date ASC → match_time ASC → matchday ASC).
 * Falls back to matchday number comparison when dates are absent.
 *
 * Eligible slots: scheduled (remaining) OR finished (already served).
 * Skipped: postponed, cancelled.
 *
 * @param excludeMatchIds  Match IDs already accounted for as served — excluded from results
 *                         to prevent double-counting when refreshing existing suspensions.
 */
export async function findNextMatchesForSuspension(
  teamId: string,
  seasonId: string,
  ageGroupId: string,
  triggerMatchId: string,
  count: number,
  excludeMatchIds: string[] = []
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

  // Build exclusion set from already-served IDs
  const excludeSet = new Set(excludeMatchIds);

  // Step 3: Filter matches that come after the trigger and are eligible for suspension serving
  const candidates = (allMatches || []).filter((m: any) => {
    // Finished or scheduled — skip postponed/cancelled
    if (!isEligibleSuspensionServingMatch(m)) {
      return false;
    }
    // Skip already-accounted-for served matches
    if (excludeSet.has(m.id)) {
      return false;
    }

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
    `[SUSPENSION_CALC] Next serving slots found (${result.length}):`,
    result.map((m) => `MD${m.matchday}(${m.match_date},${m.status})`).join(', ') || 'none'
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
 * REFACTORED: Event-based suspension calculation (NEW)
 *
 * Creates SEPARATE suspension records for:
 * 1. Each ejection event (second_yellow, direct_red, yellow_red)
 * 2. Each accumulated points threshold crossing (6, 12, 18, 24)
 *
 * Does NOT create duplicate records for same trigger_match_id + suspension_type
 * Uses unique index: player_id + team_id + trigger_match_id + suspension_type + accumulated_threshold
 */
export async function recalculatePlayerSuspensionEventBased(
  playerId: string,
  seasonId: string,
  ageGroupId: string,
  teamId: string
): Promise<any[]> {
  const timerTotal = `[SUSPENSION_CALC] recalculatePlayerSuspensionEventBased`;
  console.time(timerTotal);

  try {
    console.log(
      `[SUSPENSION_CALC_V2] Recalculating (event-based) player=${playerId} team=${teamId} season=${seasonId} age_group=${ageGroupId}`
    );

    // Get all cards sorted by match_date → match_time → matchday
    const seasonCards = await getSeasonCards(playerId, seasonId, ageGroupId);

    // BUILD a map of card counts per match
    // getSeasonCards already aggregates cards, so just use the CardCount data
    const cardsByMatch = new Map<string, CardCount>();
    for (const card of seasonCards) {
      cardsByMatch.set(card.match_id, card.cards);
    }

    // Track all suspensions to upsert (separate by event)
    const suspensionsToCreate: Array<any> = [];

    // Complete chronological normal-yellow point history — the single source of truth
    // reused by every record (ejection or accumulated_points) created below, so the
    // "ประวัติคะแนนสะสม" history is never lost and always reflects the current total.
    const pointHistory = buildNormalYellowPointHistory(seasonCards);

    // Process each match's cards - iterate in chronological order
    let accumulatedPointsOnly = 0; // Tracks NORMAL yellow points only (no ejection points)

    for (const card of seasonCards) {
      const matchId = card.match_id;
      const cardCount = cardsByMatch.get(matchId);
      if (!cardCount) continue;

      // Classify this match's discipline event using aggregated card counts
      const eventClassification = classifyPlayerMatchDiscipline(cardCount);

      if (eventClassification.eventType === 'none') {
        continue; // No cards in this match
      }

      console.log(
        `[SUSPENSION_CALC_V2] Match ${matchId}: ${eventClassification.eventType}, accumulatedPts=${eventClassification.accumulatedPointsFromThisMatch}`
      );

      // **CRITICAL**: Only accumulate points from normal yellow cards
      // Ejection events contribute 0 points to accumulation
      accumulatedPointsOnly += eventClassification.accumulatedPointsFromThisMatch;

      // CASE 1: Ejection event (second_yellow, direct_red, yellow_red)
      if (eventClassification.suspensionType && eventClassification.ejectionBanMatches > 0) {
        const suspensionType = eventClassification.suspensionType as SuspensionType;

        // Create ejection suspension
        const suspendedMatches = await findNextMatchesForSuspension(
          teamId,
          seasonId,
          ageGroupId,
          card.match_id,
          eventClassification.ejectionBanMatches
        );

        const suspensionDetails: SuspensionDetails = {
          trigger_match_id: card.match_id,
          trigger_matchday: card.matchday,
          trigger_event: eventClassification.notes.join(' | '),
          points_before: 0,
          points_added: 0,
          points_after: 0,
          threshold_crossed: 0,
          ban_matches_count: eventClassification.ejectionBanMatches,
          suspended_matches: suspendedMatches,
        };

        const servingMatchIds = suspendedMatches.map((m) => m.match_id);
        // First remaining SCHEDULED match (null when fully served)
        const ejection_suspended_from = suspendedMatches.find((m) => m.status === 'scheduled')?.match_id ?? null;
        const ejection_served_slots = suspendedMatches.filter((m) => m.status === 'finished').length;
        const ejection_served_completed_at =
          ejection_served_slots >= eventClassification.ejectionBanMatches &&
          eventClassification.ejectionBanMatches > 0
            ? new Date().toISOString()
            : null;
        // Reason shows only remaining scheduled serving matches
        const ejection_scheduled = suspendedMatches.filter((m) => m.status === 'scheduled');
        const suspensionReason =
          ejection_scheduled.length > 0
            ? `${suspensionType} - แบน ${eventClassification.ejectionBanMatches} นัด (${ejection_scheduled.map((m) => `MD${m.matchday}`).join(', ')})`
            : ejection_served_completed_at
            ? `${suspensionType} - พ้นโทษแบน ${eventClassification.ejectionBanMatches} นัด แล้ว`
            : `${suspensionType} - แบน ${eventClassification.ejectionBanMatches} นัด (ไม่พบโปรแกรมนัดถัดไป)`;

        suspensionsToCreate.push({
          season_id: seasonId,
          age_group_id: ageGroupId,
          player_id: playerId,
          team_id: teamId,
          suspension_type: suspensionType,
          trigger_match_id: card.match_id,
          accumulated_threshold: null,
          source_card_ids: card.card_ids,
          serving_match_ids: servingMatchIds,
          ban_matches: eventClassification.ejectionBanMatches,
          suspended_from_match_id: ejection_suspended_from,
          total_points: 0,
          point_sources: pointHistory,
          suspension_reason: suspensionReason,
          suspension_details: suspensionDetails,
          updated_at: new Date().toISOString(),
          ...(ejection_served_completed_at ? { served_completed_at: ejection_served_completed_at } : {}),
        });
      }
    }

    // CASE 2: Accumulated points thresholds (only from normal yellows)
    let previousPoints = 0;
    for (const card of seasonCards) {
      const cardCount = cardsByMatch.get(card.match_id);
      if (!cardCount) continue;

      const eventClassification = classifyPlayerMatchDiscipline(cardCount);

      const pointsThisMatch = eventClassification.accumulatedPointsFromThisMatch;
      const pointsBefore = previousPoints;
      const pointsAfter = previousPoints + pointsThisMatch;

      // Check if any threshold was crossed
      const thresholdCrossed = getHighestThresholdCrossed(pointsBefore, pointsAfter);

      if (thresholdCrossed > 0) {
        const banMatches = calculateBanMatches(thresholdCrossed);

        const suspendedMatches = await findNextMatchesForSuspension(
          teamId,
          seasonId,
          ageGroupId,
          card.match_id,
          banMatches
        );

        const suspensionDetails: SuspensionDetails = {
          trigger_match_id: card.match_id,
          trigger_matchday: card.matchday,
          trigger_event: `สะสมคะแนนครบเกณฑ์ ${thresholdCrossed} คะแนน`,
          points_before: pointsBefore,
          points_added: pointsThisMatch,
          points_after: pointsAfter,
          threshold_crossed: thresholdCrossed,
          ban_matches_count: banMatches,
          suspended_matches: suspendedMatches,
        };

        const servingMatchIds = suspendedMatches.map((m) => m.match_id);
        // First remaining SCHEDULED match (null when fully served)
        const accum_suspended_from = suspendedMatches.find((m) => m.status === 'scheduled')?.match_id ?? null;
        const accum_served_slots = suspendedMatches.filter((m) => m.status === 'finished').length;
        const accum_served_completed_at =
          accum_served_slots >= banMatches && banMatches > 0
            ? new Date().toISOString()
            : null;
        // Reason shows only remaining scheduled serving matches
        const accum_scheduled = suspendedMatches.filter((m) => m.status === 'scheduled');
        const suspensionReason =
          accum_scheduled.length > 0
            ? `สะสมคะแนน ${thresholdCrossed} คะแนน - แบน ${banMatches} นัด (${accum_scheduled.map((m) => `MD${m.matchday}`).join(', ')})`
            : accum_served_completed_at
            ? `สะสมคะแนน ${thresholdCrossed} คะแนน - พ้นโทษแบน ${banMatches} นัด แล้ว`
            : `สะสมคะแนน ${thresholdCrossed} คะแนน - แบน ${banMatches} นัด (ไม่พบโปรแกรมนัดถัดไป)`;

        suspensionsToCreate.push({
          season_id: seasonId,
          age_group_id: ageGroupId,
          player_id: playerId,
          team_id: teamId,
          suspension_type: 'accumulated_points',
          trigger_match_id: card.match_id,
          accumulated_threshold: thresholdCrossed,
          source_card_ids: card.yellow_card_ids,
          serving_match_ids: servingMatchIds,
          ban_matches: banMatches,
          suspended_from_match_id: accum_suspended_from,
          total_points: pointsAfter,
          point_sources: pointHistory,
          suspension_reason: suspensionReason,
          suspension_details: suspensionDetails,
          updated_at: new Date().toISOString(),
          ...(accum_served_completed_at ? { served_completed_at: accum_served_completed_at } : {}),
        });
      }

      previousPoints = pointsAfter;
    }

    // Fetch existing system-generated events (excludes legacy and manual via suspension_type filter)
    const { data: existingSystemEvents } = await supabaseAdmin
      .from('suspensions')
      .select('id, trigger_match_id, suspension_type, accumulated_threshold')
      .eq('player_id', playerId)
      .eq('team_id', teamId)
      .eq('season_id', seasonId)
      .eq('age_group_id', ageGroupId)
      .in('suspension_type', ['accumulated_points', 'second_yellow', 'direct_red', 'yellow_red']);

    const desiredKeys = new Set(
      suspensionsToCreate.map(
        (s) => `${s.trigger_match_id}::${s.suspension_type}::${s.accumulated_threshold ?? 0}`
      )
    );
    const staleIds = computeStaleEventIds(existingSystemEvents || [], desiredKeys);

    // Upsert each desired event — explicit query-then-insert/update avoids expression index conflict
    const results: any[] = [];

    for (const s of suspensionsToCreate) {
      let findQuery = supabaseAdmin
        .from('suspensions')
        .select('id')
        .eq('player_id', s.player_id)
        .eq('team_id', s.team_id)
        .eq('season_id', s.season_id)
        .eq('age_group_id', s.age_group_id)
        .eq('trigger_match_id', s.trigger_match_id)
        .eq('suspension_type', s.suspension_type);

      if (s.accumulated_threshold == null) {
        findQuery = findQuery.is('accumulated_threshold', null);
      } else {
        findQuery = findQuery.eq('accumulated_threshold', s.accumulated_threshold);
      }

      const { data: existing } = await findQuery.maybeSingle();

      if (existing?.id) {
        const { error: updateError } = await supabaseAdmin
          .from('suspensions')
          .update(s)
          .eq('id', existing.id);
        if (updateError) throw updateError;
        results.push({ ...s, id: existing.id });
      } else {
        const { data: inserted, error: insertError } = await supabaseAdmin
          .from('suspensions')
          .insert(s)
          .select()
          .single();
        if (insertError) throw insertError;
        results.push(inserted);
      }
    }

    // Delete stale events after upsert to minimise gap in suspension coverage
    if (staleIds.length > 0) {
      const { error: deleteError } = await supabaseAdmin
        .from('suspensions')
        .delete()
        .in('id', staleIds);
      if (deleteError) {
        console.error('[SUSPENSION_CALC_V2] Failed to delete stale events:', deleteError);
      } else {
        console.log(`[SUSPENSION_CALC_V2] Deleted ${staleIds.length} stale event(s)`);
      }
    }

    console.log(`[SUSPENSION_CALC_V2] Done: ${results.length} upserted, ${staleIds.length} stale removed`);
    console.timeEnd(timerTotal);
    return results;
  } catch (error) {
    console.timeEnd(timerTotal);
    console.error('[SUSPENSION_CALC_V2] Error:', error);
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
      await recalculatePlayerSuspensionEventBased(playerId, seasonId, ageGroupId, teamId);
      success++;
    } catch (err) {
      console.error(`[SUSPENSION_CALC] Failed player=${playerId} team=${teamId}:`, err);
      failed++;
    }
  }

  console.log(`[SUSPENSION_CALC] recalculateSeasonSuspensions done: ${success} success, ${failed} failed`);
  return { processed: players.length, success, failed };
}

// ─── Serving Match Refresh ────────────────────────────────────────────────────

const SYSTEM_SUSPENSION_TYPES = [
  'accumulated_points',
  'second_yellow',
  'direct_red',
  'yellow_red',
] as const;

export interface RefreshServingResult {
  refreshed: number;
  skipped: number;
  failed: number;
}

/**
 * Refresh serving_match_ids for all active system-generated suspension events in a scope.
 *
 * Handles:
 *   - postponed/cancelled serving slots   → removed, next scheduled slot assigned
 *   - finished serving slots              → preserved as served, not replaced
 *   - match date/time changes             → re-sorted chronological serving order
 *   - all slots served                    → served_completed_at stamped
 *
 * Never touches: legacy (suspension_type IS NULL), manual, or records without ban_matches.
 * Idempotent: second run with no schedule changes produces zero DB writes.
 */
export async function refreshSuspensionServingMatches(params: {
  seasonId: string;
  ageGroupId: string;
  teamId?: string;
  changedMatchId?: string;
}): Promise<RefreshServingResult> {
  const { seasonId, ageGroupId, teamId, changedMatchId } = params;
  console.log(
    `[REFRESH_SERVING] season=${seasonId} ag=${ageGroupId} team=${teamId ?? 'all'} changedMatch=${changedMatchId ?? 'all'}`
  );

  // 1. Fetch system events that have active bans
  let q = supabaseAdmin
    .from('suspensions')
    .select(
      `id, player_id, team_id, trigger_match_id, suspension_type,
       accumulated_threshold, source_card_ids, serving_match_ids,
       ban_matches, suspended_from_match_id, suspension_details,
       suspension_reason, served_completed_at`
    )
    .eq('season_id', seasonId)
    .eq('age_group_id', ageGroupId)
    .in('suspension_type', [...SYSTEM_SUSPENSION_TYPES])
    .gt('ban_matches', 0);

  if (teamId) q = q.eq('team_id', teamId);

  const { data: events, error: eventsError } = await q;
  if (eventsError) throw eventsError;
  if (!events?.length) return { refreshed: 0, skipped: 0, failed: 0 };

  // 2. Filter to events referencing the changed match (if specified)
  let relevant = events as any[];
  if (changedMatchId) {
    relevant = events.filter(
      (e: any) =>
        e.trigger_match_id === changedMatchId ||
        (e.serving_match_ids || []).includes(changedMatchId)
    );
  }
  if (!relevant.length) return { refreshed: 0, skipped: 0, failed: 0 };
  console.log(`[REFRESH_SERVING] Processing ${relevant.length} event(s)`);

  // 3. Batch-fetch status for all currently-referenced serving matches
  const allCurrentServingIds = [
    ...new Set(relevant.flatMap((e: any) => e.serving_match_ids || [])),
  ];
  const matchMap = new Map<string, any>();

  if (allCurrentServingIds.length > 0) {
    const { data: matchRows } = await supabaseAdmin
      .from('matches')
      .select(
        'id, status, match_date, match_time, matchday, match_code, home_team_id, away_team_id, home_team:home_team_id(name), away_team:away_team_id(name)'
      )
      .in('id', allCurrentServingIds);
    for (const m of matchRows || []) matchMap.set(m.id, m);
  }

  let refreshed = 0, skipped = 0, failed = 0;

  for (const event of relevant) {
    try {
      const currentServingIds: string[] = event.serving_match_ids || [];

      // Split current serving matches into served (finished) and stale/invalid
      const { servedIds } = classifyServingMatchIds(currentServingIds, matchMap);
      const remainingNeeded = Math.max(0, event.ban_matches - servedIds.length);

      // Find replacement serving slots for remaining slots.
      // Exclude already-served IDs to prevent double-counting.
      let newServingMatches: SuspendedMatchDetail[] = [];
      if (remainingNeeded > 0 && event.trigger_match_id) {
        newServingMatches = await findNextMatchesForSuspension(
          event.team_id,
          seasonId,
          ageGroupId,
          event.trigger_match_id,
          remainingNeeded,
          servedIds  // exclude already-served match IDs
        );
      }

      const newServingMatchIds = newServingMatches.map((m) => m.match_id);
      const newServingIds = [...servedIds, ...newServingMatchIds];
      // suspended_from_match_id = first SCHEDULED (not yet served) slot
      const newSuspendedFrom = newServingMatches.find((m) => m.status === 'scheduled')?.match_id ?? null;
      // Stamp served_completed_at only when all slots are consumed
      const allServed = remainingNeeded === 0 && servedIds.length >= event.ban_matches;
      const newServedCompletedAt = allServed
        ? (event.served_completed_at ?? new Date().toISOString())
        : null;

      // Idempotency: skip if nothing changed
      if (
        servingArraysEqual(currentServingIds, newServingIds) &&
        event.suspended_from_match_id === newSuspendedFrom &&
        (event.served_completed_at ?? null) === newServedCompletedAt
      ) {
        skipped++;
        continue;
      }

      // Fetch details for newly-assigned match IDs not yet in map
      const needFetch = newServingMatchIds.filter((id) => !matchMap.has(id));
      if (needFetch.length > 0) {
        const { data: extra } = await supabaseAdmin
          .from('matches')
          .select(
            'id, status, match_date, match_time, matchday, match_code, home_team_id, away_team_id, home_team:home_team_id(name), away_team:away_team_id(name)'
          )
          .in('id', needFetch);
        for (const m of extra || []) matchMap.set(m.id, m);
      }

      // Rebuild suspension_details.suspended_matches from new serving list
      const suspendedMatches: SuspendedMatchDetail[] = newServingIds
        .filter((id) => matchMap.has(id))
        .map((id) => {
          const m = matchMap.get(id)!;
          return {
            match_id: id,
            matchday: parseMatchdayNumber(m.matchday),
            match_date: m.match_date,
            match_time: m.match_time,
            match_code: m.match_code,
            opponent_name:
              m.home_team_id === event.team_id
                ? (m.away_team as any)?.name ?? 'ไม่ทราบทีม'
                : (m.home_team as any)?.name ?? 'ไม่ทราบทีม',
            opponent_id:
              m.home_team_id === event.team_id ? m.away_team_id : m.home_team_id,
            is_home: m.home_team_id === event.team_id,
            status: m.status,
          };
        });

      // Reason shows only the remaining SCHEDULED serving slots
      const refreshScheduled = newServingMatches.filter((m) => m.status === 'scheduled');
      const suspensionReason =
        refreshScheduled.length > 0
          ? `${event.suspension_type} - แบน ${event.ban_matches} นัด (${refreshScheduled.map((m) => `MD${m.matchday}`).join(', ')})`
          : newServedCompletedAt
          ? `${event.suspension_type} - พ้นโทษแบน ${event.ban_matches} นัด แล้ว`
          : `${event.suspension_type} - แบน ${event.ban_matches} นัด (ไม่พบโปรแกรมนัดถัดไป)`;

      const existingDetails = (event.suspension_details as SuspensionDetails | null) ?? ({} as SuspensionDetails);
      const newDetails: SuspensionDetails = {
        ...existingDetails,
        suspended_matches: suspendedMatches,
        ban_matches_count: event.ban_matches,
      };

      const patch: Record<string, any> = {
        serving_match_ids: newServingIds,
        suspended_from_match_id: newSuspendedFrom,
        suspension_details: newDetails,
        suspension_reason: suspensionReason,
        updated_at: new Date().toISOString(),
      };
      if (newServedCompletedAt !== null) {
        patch.served_completed_at = newServedCompletedAt;
      } else if (event.served_completed_at) {
        // Clear previously-set completion timestamp (suspension reactivated)
        patch.served_completed_at = null;
      }

      const { error: updateError } = await supabaseAdmin
        .from('suspensions')
        .update(patch)
        .eq('id', event.id);

      if (updateError) {
        console.error('[REFRESH_SERVING] Update error for event', event.id, updateError);
        failed++;
      } else {
        refreshed++;
        console.log(
          `[REFRESH_SERVING] Refreshed ${event.id}: ${JSON.stringify(currentServingIds)} → ${JSON.stringify(newServingIds)}`
        );
      }
    } catch (err: any) {
      console.error('[REFRESH_SERVING] Error on event', event.id, err?.message ?? err);
      failed++;
    }
  }

  console.log(`[REFRESH_SERVING] Done: refreshed=${refreshed} skipped=${skipped} failed=${failed}`);
  return { refreshed, skipped, failed };
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

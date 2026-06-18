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

interface PointSource {
  match_id: string;
  points: number;
  reason: string;
}

/**
 * Calculate points for a single match based on card types
 * CFYL Custom Rule:
 * - 1 yellow = 2 pts
 * - 2 yellows (or 1 second_yellow) = 4 pts
 * - 1 red (direct) = 6 pts
 * - 1 yellow + 1 red = 8 pts
 */
export function calculateMatchPoints(cards: CardCount): number {
  const { yellow, red, second_yellow } = cards;

  // Combine second_yellow with regular yellows for calculation
  const totalYellows = yellow + second_yellow;

  // Direct red with no yellow
  if (red >= 1 && totalYellows === 0) {
    return 6;
  }

  // Yellow + Red combination
  if (red >= 1 && totalYellows >= 1) {
    return 8;
  }

  // 2 yellows (including second_yellow as 2 yellows)
  if (totalYellows >= 2) {
    return 4;
  }

  // Single yellow
  if (totalYellows === 1) {
    return 2;
  }

  return 0;
}

/**
 * Determine number of matches to ban based on total points
 * CFYL Custom Rule:
 * - 6 pts = 1 match
 * - 12+ pts = 2 matches
 */
export function calculateBanMatches(totalPoints: number): number {
  if (totalPoints >= 24) return 2;
  if (totalPoints >= 18) return 2;
  if (totalPoints >= 12) return 2;
  if (totalPoints >= 6) return 1;
  return 0;
}

/**
 * Get all cards for a specific match and player
 */
export async function getMatchCards(
  matchId: string,
  playerId: string
): Promise<CardCount & { allCards: any[] }> {
  const { data: cards, error } = await supabaseAdmin
    .from('cards')
    .select('*')
    .eq('match_id', matchId)
    .eq('player_id', playerId);

  if (error) {
    console.error('[SUSPENSION_CALC] Error fetching cards:', error);
    throw error;
  }

  const count = {
    yellow: 0,
    red: 0,
    second_yellow: 0,
    allCards: cards || [],
  };

  (cards || []).forEach((card) => {
    if (card.card_type === 'yellow') count.yellow++;
    if (card.card_type === 'red') count.red++;
    if (card.card_type === 'second_yellow') count.second_yellow++;
  });

  return count;
}

/**
 * Get all matches cards for a player in a season/age_group
 * Used for accumulating total points
 * OPTIMIZED: Single query for all cards instead of N+1 queries
 */
export async function getSeasonCards(
  playerId: string,
  seasonId: string,
  ageGroupId: string
): Promise<
  Array<{
    match_id: string;
    matchday: number;
    points: number;
    cards: CardCount;
    reason: string;
  }>
> {
  const timer = `[SUSPENSION_CALC] getSeasonCards for ${playerId}`;
  console.time(timer);

  try {
    // Get all cards for this player in season+age_group (single query)
    // Join with matches to get matchday
    const { data: allCards, error } = await supabaseAdmin
      .from('cards')
      .select(
        `
        match_id,
        card_type,
        match:match_id(matchday)
      `
      )
      .eq('player_id', playerId)
      .in(
        'match_id',
        // Subquery: get all match IDs for this season+age_group
        (
          await supabaseAdmin
            .from('matches')
            .select('id')
            .eq('season_id', seasonId)
            .eq('age_group_id', ageGroupId)
        ).data?.map((m) => m.id) || []
      );

    if (error) {
      console.error('[SUSPENSION_CALC] Error fetching cards:', error);
      throw error;
    }

    // Group cards by match_id
    const matchCardMap: Record<
      string,
      {
        cards: Array<{ card_type: string }>;
        matchday: number;
      }
    > = {};

    (allCards || []).forEach((card: any) => {
      const matchId = card.match_id;
      if (!matchCardMap[matchId]) {
        matchCardMap[matchId] = {
          cards: [],
          matchday: card.match?.matchday || 0,
        };
      }
      matchCardMap[matchId].cards.push(card);
    });

    // Calculate points per match
    const result = [];
    for (const [matchId, matchData] of Object.entries(matchCardMap)) {
      const count = {
        yellow: 0,
        red: 0,
        second_yellow: 0,
      };

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
            ? totalYellows > 0
              ? `${totalYellows}Y + ${count.red}R`
              : `${count.red}R`
            : totalYellows >= 2
              ? `${totalYellows}Y`
              : '1Y';

        result.push({
          match_id: matchId,
          matchday: matchData.matchday,
          points,
          cards: count,
          reason,
        });
      }
    }

    console.timeEnd(timer);
    return result;
  } catch (error) {
    console.timeEnd(timer);
    throw error;
  }
}

/**
 * Find the next match for a player's team to apply suspension
 */
export async function findNextMatchForSuspension(
  teamId: string,
  seasonId: string,
  ageGroupId: string,
  currentMatchday: number
): Promise<string | null> {
  const { data: match, error } = await supabaseAdmin
    .from('matches')
    .select('id')
    .eq('season_id', seasonId)
    .eq('age_group_id', ageGroupId)
    .in('home_team_id,away_team_id', [teamId])
    .gt('matchday', currentMatchday)
    .order('matchday', { ascending: true })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = no rows found (normal case)
    console.error('[SUSPENSION_CALC] Error finding next match:', error);
  }

  return match?.id || null;
}

/**
 * Recalculate suspensions for a player
 * Returns the updated suspension record
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
      `[SUSPENSION_CALC] Recalculating for player ${playerId}, season ${seasonId}, age_group ${ageGroupId}, team ${teamId}`
    );

    // Get all cards for this season/age_group
    const seasonCards = await getSeasonCards(playerId, seasonId, ageGroupId);

    // Calculate total points
    const totalPoints = seasonCards.reduce((sum, item) => sum + item.points, 0);

    // Calculate ban matches
    const banMatches = calculateBanMatches(totalPoints);

    // Find next match to apply suspension (only if ban > 0)
    let suspendedFromMatchId = null;
    if (banMatches > 0 && seasonCards.length > 0) {
      // Get the last card's match to find next match from there
      const lastCard = seasonCards[seasonCards.length - 1];
      const timerNextMatch = `[SUSPENSION_CALC] findNextMatch`;
      console.time(timerNextMatch);
      suspendedFromMatchId = await findNextMatchForSuspension(
        teamId,
        seasonId,
        ageGroupId,
        lastCard.matchday
      );
      console.timeEnd(timerNextMatch);
    }

    // Build point sources
    const pointSources: PointSource[] = seasonCards.map((item) => ({
      match_id: item.match_id,
      points: item.points,
      reason: item.reason,
    }));

    // Determine suspension reason
    let suspensionReason = null;
    if (banMatches > 0) {
      if (suspendedFromMatchId) {
        suspensionReason = `Banned for ${banMatches} match(es) - Total points: ${totalPoints}`;
      } else {
        suspensionReason = `Accumulates ${totalPoints} points (${banMatches} match ban) - No upcoming matches found`;
      }
    }

    // Upsert suspensions record
    const { data: suspension, error } = await supabaseAdmin
      .from('suspensions')
      .upsert({
        season_id: seasonId,
        age_group_id: ageGroupId,
        player_id: playerId,
        team_id: teamId,
        total_points: totalPoints,
        point_sources: pointSources,
        ban_matches: banMatches,
        suspended_from_match_id: suspendedFromMatchId,
        suspension_reason: suspensionReason,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[SUSPENSION_CALC] Error upserting suspension:', error);
      throw error;
    }

    console.log(
      `[SUSPENSION_CALC] Updated suspension: ${suspension.id}, points: ${totalPoints}, ban: ${banMatches} matches`
    );

    console.timeEnd(timerTotal);
    return suspension;
  } catch (error) {
    console.timeEnd(timerTotal);
    console.error('[SUSPENSION_CALC] Error in recalculation:', error);
    throw error;
  }
}

/**
 * Get match details (for finding current matchday)
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

import type { LeaguePhase, Match } from '@/types/db';

export const LEAGUE_PHASE_LABELS: Record<LeaguePhase, string> = {
  regular: 'รอบลีก',
  champion_league: 'แชมเปี้ยนส์ลีก',
  final: 'รอบชิงชนะเลิศ',
  third_place: 'ชิงอันดับที่ 3',
};

export interface ChampionLeagueQualifier {
  team_id: string;
  league_rank: number;
  team_name: string;
  team_short_name?: string | null;
  team_logo_url?: string | null;
}

export interface ChampionLeagueStanding extends ChampionLeagueQualifier {
  rank: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;
  points: number;
}

export interface ChampionLeagueProgress {
  expected_matches: number;
  fixture_matches: number;
  finished_unique_matches: number;
  duplicate_pairings: number;
  invalid_pairings: number;
  matches_played_by_team: Record<string, number>;
  complete: boolean;
}

export interface ChampionLeaguePlacementPairings {
  final: { home_team_id: string; away_team_id: string };
  third_place: { home_team_id: string; away_team_id: string };
}

export interface RegularLeagueActivationReadiness {
  ready: boolean;
  regular_match_count: number;
  unfinished_match_count: number;
  teams_without_regular_match: string[];
}

type PhaseAwareMatch = Pick<
  Match,
  'id' | 'home_team_id' | 'away_team_id' | 'home_score' | 'away_score' | 'status' | 'league_phase'
>;

export function normalizeLeaguePhase(value: unknown): LeaguePhase {
  if (
    value === 'champion_league' ||
    value === 'final' ||
    value === 'third_place' ||
    value === 'regular'
  ) {
    return value;
  }
  return 'regular';
}

export function getLeaguePhaseLabel(value: unknown): string {
  return LEAGUE_PHASE_LABELS[normalizeLeaguePhase(value)];
}

export function isRegularLeagueMatch(match: Pick<Match, 'league_phase'>): boolean {
  return match.league_phase == null || match.league_phase === 'regular';
}

export function isChampionLeagueMatch(match: Pick<Match, 'league_phase'>): boolean {
  return match.league_phase === 'champion_league';
}

function pairKey(teamA: string, teamB: string): string {
  return [teamA, teamB].sort().join('::');
}

export function isSameTeamPair(
  homeTeamId: string,
  awayTeamId: string,
  expectedHomeTeamId: string,
  expectedAwayTeamId: string
): boolean {
  return pairKey(homeTeamId, awayTeamId) === pairKey(expectedHomeTeamId, expectedAwayTeamId);
}

function expectedPairings(qualifiers: ChampionLeagueQualifier[]): Set<string> {
  const keys = new Set<string>();
  for (let i = 0; i < qualifiers.length; i += 1) {
    for (let j = i + 1; j < qualifiers.length; j += 1) {
      keys.add(pairKey(qualifiers[i].team_id, qualifiers[j].team_id));
    }
  }
  return keys;
}

function getTopFour(qualifiers: ChampionLeagueQualifier[]): ChampionLeagueQualifier[] {
  return [...qualifiers]
    .sort((a, b) => a.league_rank - b.league_rank)
    .slice(0, 4);
}

export function parseChampionLeagueQualifierSnapshot(value: unknown): ChampionLeagueQualifier[] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;

  const qualifiers: ChampionLeagueQualifier[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    if (
      typeof row.team_id !== 'string' ||
      !row.team_id ||
      typeof row.team_name !== 'string' ||
      !row.team_name ||
      typeof row.league_rank !== 'number' ||
      !Number.isInteger(row.league_rank) ||
      row.league_rank < 1 ||
      row.league_rank > 4
    ) {
      return null;
    }
    qualifiers.push({
      team_id: row.team_id,
      league_rank: row.league_rank,
      team_name: row.team_name,
      team_short_name: typeof row.team_short_name === 'string' ? row.team_short_name : null,
      team_logo_url: typeof row.team_logo_url === 'string' ? row.team_logo_url : null,
    });
  }

  const uniqueTeams = new Set(qualifiers.map((row) => row.team_id));
  const uniqueRanks = new Set(qualifiers.map((row) => row.league_rank));
  if (uniqueTeams.size !== 4 || uniqueRanks.size !== 4) return null;
  if (![1, 2, 3, 4].every((rank) => uniqueRanks.has(rank))) return null;

  return qualifiers.sort((a, b) => a.league_rank - b.league_rank);
}

export function getRegularLeagueActivationReadiness(
  matches: PhaseAwareMatch[],
  activeTeamIds: string[]
): RegularLeagueActivationReadiness {
  const regularMatches = matches.filter(isRegularLeagueMatch);
  const unfinishedMatches = regularMatches.filter(
    (match) =>
      match.status !== 'finished' || match.home_score == null || match.away_score == null
  );
  const teamsWithRegularMatch = new Set(
    regularMatches.flatMap((match) => [match.home_team_id, match.away_team_id])
  );
  const teamsWithoutRegularMatch = activeTeamIds.filter((teamId) => !teamsWithRegularMatch.has(teamId));

  return {
    ready:
      activeTeamIds.length >= 4 &&
      regularMatches.length > 0 &&
      unfinishedMatches.length === 0 &&
      teamsWithoutRegularMatch.length === 0,
    regular_match_count: regularMatches.length,
    unfinished_match_count: unfinishedMatches.length,
    teams_without_regular_match: teamsWithoutRegularMatch,
  };
}

interface FixtureAnalysis {
  progress: ChampionLeagueProgress;
  validFinishedResults: PhaseAwareMatch[];
}

function analyzeChampionLeagueFixtures(
  qualifiers: ChampionLeagueQualifier[],
  matches: PhaseAwareMatch[]
): FixtureAnalysis {
  const topFour = getTopFour(qualifiers);
  const qualifierIds = new Set(topFour.map((q) => q.team_id));
  const expected = expectedPairings(topFour);
  const championFixtures = matches.filter(isChampionLeagueMatch);
  const fixturesByPair = new Map<string, PhaseAwareMatch[]>();
  const matchesPlayedByTeam: Record<string, number> = Object.fromEntries(
    topFour.map((q) => [q.team_id, 0])
  );
  let invalidPairings = 0;

  for (const match of championFixtures) {
    if (
      !qualifierIds.has(match.home_team_id) ||
      !qualifierIds.has(match.away_team_id) ||
      match.home_team_id === match.away_team_id
    ) {
      invalidPairings += 1;
      continue;
    }

    const key = pairKey(match.home_team_id, match.away_team_id);
    if (!expected.has(key)) {
      invalidPairings += 1;
      continue;
    }
    const list = fixturesByPair.get(key) || [];
    list.push(match);
    fixturesByPair.set(key, list);
  }

  let duplicatePairings = 0;
  const validFinishedResults: PhaseAwareMatch[] = [];

  for (const key of expected) {
    const fixtures = fixturesByPair.get(key) || [];
    if (fixtures.length > 1) {
      duplicatePairings += fixtures.length - 1;
      continue;
    }
    if (fixtures.length !== 1) continue;

    const fixture = fixtures[0];
    if (
      fixture.status === 'finished' &&
      fixture.home_score != null &&
      fixture.away_score != null
    ) {
      validFinishedResults.push(fixture);
      const [a, b] = key.split('::');
      matchesPlayedByTeam[a] = (matchesPlayedByTeam[a] || 0) + 1;
      matchesPlayedByTeam[b] = (matchesPlayedByTeam[b] || 0) + 1;
    }
  }

  const expectedMatches = topFour.length === 4 ? 6 : expected.size;
  const everyExpectedPairHasExactlyOneFixture =
    topFour.length === 4 && [...expected].every((key) => (fixturesByPair.get(key) || []).length === 1);
  const everyTeamPlayedThree =
    topFour.length === 4 && topFour.every((q) => matchesPlayedByTeam[q.team_id] === 3);
  const complete =
    topFour.length === 4 &&
    championFixtures.length === 6 &&
    expectedMatches === 6 &&
    everyExpectedPairHasExactlyOneFixture &&
    validFinishedResults.length === 6 &&
    duplicatePairings === 0 &&
    invalidPairings === 0 &&
    everyTeamPlayedThree;

  return {
    validFinishedResults,
    progress: {
      expected_matches: expectedMatches,
      fixture_matches: championFixtures.length,
      finished_unique_matches: validFinishedResults.length,
      duplicate_pairings: duplicatePairings,
      invalid_pairings: invalidPairings,
      matches_played_by_team: matchesPlayedByTeam,
      complete,
    },
  };
}

export function calculateChampionLeagueStandings(
  qualifiers: ChampionLeagueQualifier[],
  matches: PhaseAwareMatch[]
): ChampionLeagueStanding[] {
  const topFour = getTopFour(qualifiers);
  const table = new Map<string, ChampionLeagueStanding>();

  for (const qualifier of topFour) {
    table.set(qualifier.team_id, {
      ...qualifier,
      rank: qualifier.league_rank,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goals_for: 0,
      goals_against: 0,
      goal_diff: 0,
      points: 0,
    });
  }

  const { validFinishedResults } = analyzeChampionLeagueFixtures(topFour, matches);
  for (const match of validFinishedResults) {
    const home = table.get(match.home_team_id)!;
    const away = table.get(match.away_team_id)!;

    home.played += 1;
    away.played += 1;
    home.goals_for += match.home_score!;
    home.goals_against += match.away_score!;
    away.goals_for += match.away_score!;
    away.goals_against += match.home_score!;

    if (match.home_score! > match.away_score!) {
      home.wins += 1;
      home.points += 3;
      away.losses += 1;
    } else if (match.home_score! < match.away_score!) {
      away.wins += 1;
      away.points += 3;
      home.losses += 1;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }
  }

  const standings = Array.from(table.values()).map((row) => ({
    ...row,
    goal_diff: row.goals_for - row.goals_against,
  }));

  // Competition rule: points first, then the FROZEN final regular-league rank immediately.
  // Champion League GD/GF are display statistics only and never precede league rank.
  standings.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (a.league_rank !== b.league_rank) return a.league_rank - b.league_rank;
    return a.team_id.localeCompare(b.team_id);
  });

  return standings.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function getChampionLeagueProgress(
  qualifiers: ChampionLeagueQualifier[],
  matches: PhaseAwareMatch[]
): ChampionLeagueProgress {
  return analyzeChampionLeagueFixtures(qualifiers, matches).progress;
}

export function getChampionLeaguePlacementPairings(
  standings: ChampionLeagueStanding[],
  progress: ChampionLeagueProgress
): ChampionLeaguePlacementPairings | null {
  if (!progress.complete || standings.length !== 4) return null;
  return {
    final: {
      home_team_id: standings[0].team_id,
      away_team_id: standings[1].team_id,
    },
    third_place: {
      home_team_id: standings[2].team_id,
      away_team_id: standings[3].team_id,
    },
  };
}

export interface ChampionLeaguePlacementIntegrity {
  valid: boolean;
  reason: string | null;
  expected_pairings: ChampionLeaguePlacementPairings | null;
}

export function validateChampionLeaguePlacementFixtures(
  qualifiers: ChampionLeagueQualifier[],
  matches: PhaseAwareMatch[]
): ChampionLeaguePlacementIntegrity {
  const finalFixtures = matches.filter((match) => match.league_phase === 'final');
  const thirdPlaceFixtures = matches.filter((match) => match.league_phase === 'third_place');
  const hasPlacementFixtures = finalFixtures.length > 0 || thirdPlaceFixtures.length > 0;

  const progress = getChampionLeagueProgress(qualifiers, matches);
  const standings = calculateChampionLeagueStandings(qualifiers, matches);
  const expectedPairings = getChampionLeaguePlacementPairings(standings, progress);

  if (!hasPlacementFixtures) {
    return { valid: true, reason: null, expected_pairings: expectedPairings };
  }

  if (!expectedPairings) {
    return {
      valid: false,
      reason: 'Existing placement fixtures require a complete valid Champion League round robin',
      expected_pairings: null,
    };
  }

  if (finalFixtures.length > 1 || thirdPlaceFixtures.length > 1) {
    return {
      valid: false,
      reason: 'Only one Final and one Third Place fixture are allowed per Champion League scope',
      expected_pairings: expectedPairings,
    };
  }

  const finalFixture = finalFixtures[0];
  if (
    finalFixture &&
    !isSameTeamPair(
      finalFixture.home_team_id,
      finalFixture.away_team_id,
      expectedPairings.final.home_team_id,
      expectedPairings.final.away_team_id
    )
  ) {
    return {
      valid: false,
      reason: 'Existing Final fixture no longer matches Champion League ranks 1 and 2',
      expected_pairings: expectedPairings,
    };
  }

  const thirdPlaceFixture = thirdPlaceFixtures[0];
  if (
    thirdPlaceFixture &&
    !isSameTeamPair(
      thirdPlaceFixture.home_team_id,
      thirdPlaceFixture.away_team_id,
      expectedPairings.third_place.home_team_id,
      expectedPairings.third_place.away_team_id
    )
  ) {
    return {
      valid: false,
      reason: 'Existing Third Place fixture no longer matches Champion League ranks 3 and 4',
      expected_pairings: expectedPairings,
    };
  }

  return { valid: true, reason: null, expected_pairings: expectedPairings };
}

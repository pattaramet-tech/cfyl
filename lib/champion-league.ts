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

function expectedPairings(qualifiers: ChampionLeagueQualifier[]): Set<string> {
  const keys = new Set<string>();
  for (let i = 0; i < qualifiers.length; i += 1) {
    for (let j = i + 1; j < qualifiers.length; j += 1) {
      keys.add(pairKey(qualifiers[i].team_id, qualifiers[j].team_id));
    }
  }
  return keys;
}

export function calculateChampionLeagueStandings(
  qualifiers: ChampionLeagueQualifier[],
  matches: PhaseAwareMatch[]
): ChampionLeagueStanding[] {
  const topFour = [...qualifiers]
    .sort((a, b) => a.league_rank - b.league_rank)
    .slice(0, 4);
  const qualifierIds = new Set(topFour.map((q) => q.team_id));
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

  for (const match of matches) {
    if (!isChampionLeagueMatch(match)) continue;
    if (match.status !== 'finished') continue;
    if (match.home_score == null || match.away_score == null) continue;
    if (!qualifierIds.has(match.home_team_id) || !qualifierIds.has(match.away_team_id)) continue;
    if (match.home_team_id === match.away_team_id) continue;

    const home = table.get(match.home_team_id)!;
    const away = table.get(match.away_team_id)!;

    home.played += 1;
    away.played += 1;
    home.goals_for += match.home_score;
    home.goals_against += match.away_score;
    away.goals_for += match.away_score;
    away.goals_against += match.home_score;

    if (match.home_score > match.away_score) {
      home.wins += 1;
      home.points += 3;
      away.losses += 1;
    } else if (match.home_score < match.away_score) {
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

  // Competition rule: points first, then the FINAL regular-league rank immediately.
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
  const topFour = [...qualifiers]
    .sort((a, b) => a.league_rank - b.league_rank)
    .slice(0, 4);
  const qualifierIds = new Set(topFour.map((q) => q.team_id));
  const expected = expectedPairings(topFour);
  const finishedPairs = new Set<string>();
  const seenFinishedCounts = new Map<string, number>();
  const matchesPlayedByTeam: Record<string, number> = Object.fromEntries(
    topFour.map((q) => [q.team_id, 0])
  );
  let invalidPairings = 0;

  for (const match of matches) {
    if (!isChampionLeagueMatch(match) || match.status !== 'finished') continue;
    if (match.home_score == null || match.away_score == null) continue;
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
    seenFinishedCounts.set(key, (seenFinishedCounts.get(key) || 0) + 1);
    finishedPairs.add(key);
  }

  let duplicatePairings = 0;
  for (const [key, count] of seenFinishedCounts.entries()) {
    if (count > 1) duplicatePairings += count - 1;
    if (count >= 1) {
      const [a, b] = key.split('::');
      matchesPlayedByTeam[a] = (matchesPlayedByTeam[a] || 0) + 1;
      matchesPlayedByTeam[b] = (matchesPlayedByTeam[b] || 0) + 1;
    }
  }

  const expectedMatches = topFour.length === 4 ? 6 : expected.size;
  const everyTeamPlayedThree =
    topFour.length === 4 && topFour.every((q) => matchesPlayedByTeam[q.team_id] === 3);
  const complete =
    topFour.length === 4 &&
    expectedMatches === 6 &&
    finishedPairs.size === 6 &&
    duplicatePairings === 0 &&
    invalidPairings === 0 &&
    everyTeamPlayedThree;

  return {
    expected_matches: expectedMatches,
    finished_unique_matches: finishedPairs.size,
    duplicate_pairings: duplicatePairings,
    invalid_pairings: invalidPairings,
    matches_played_by_team: matchesPlayedByTeam,
    complete,
  };
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

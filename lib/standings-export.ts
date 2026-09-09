import { isRegularLeagueMatch } from '@/lib/champion-league';
import { parseMatchdayNumber } from '@/lib/suspension-shared';
import type { Match } from '@/types/db';

type StandingsExportMatch = Pick<
  Match,
  'league_phase' | 'status' | 'home_score' | 'away_score' | 'matchday'
>;

export function selectRegularLeagueExportMatches<T extends StandingsExportMatch>(
  matches: T[],
  matchdayFilter: number | null
): { regularMatches: T[]; scoredMatches: T[] } {
  const regularMatches = matches.filter(isRegularLeagueMatch);
  let scoredMatches = regularMatches.filter(
    (match) =>
      match.status === 'finished' &&
      match.home_score !== null &&
      match.away_score !== null
  );

  if (matchdayFilter !== null && !Number.isNaN(matchdayFilter)) {
    scoredMatches = scoredMatches.filter(
      (match) => parseMatchdayNumber(match.matchday) <= matchdayFilter
    );
  }

  return { regularMatches, scoredMatches };
}

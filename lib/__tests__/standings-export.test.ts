import { describe, expect, it } from 'vitest';
import { calculateStandings } from '@/lib/calculations';
import { selectRegularLeagueExportMatches } from '@/lib/standings-export';
import type { Match } from '@/types/db';

function match(
  id: string,
  leaguePhase: Match['league_phase'],
  overrides: Partial<Match> = {}
): Match {
  return {
    id,
    season_id: 'season-1',
    age_group_id: 'age-1',
    division_id: 'division-1',
    home_team_id: 'team-a',
    away_team_id: 'team-b',
    home_score: 1,
    away_score: 1,
    status: 'finished',
    matchday: 'MD1',
    league_phase: leaguePhase,
    ...overrides,
  } as Match;
}

describe('regular League standings export scope', () => {
  it('counts only legacy-null and regular phases, never post-league phases', () => {
    const matches = [
      match('legacy', null),
      match('regular', 'regular', { matchday: 'MD2' }),
      match('champion', 'champion_league', { home_score: 4, away_score: 0 }),
      match('final', 'final', { home_score: 5, away_score: 0 }),
      match('third', 'third_place', { home_score: 6, away_score: 0 }),
    ];

    const { regularMatches, scoredMatches } = selectRegularLeagueExportMatches(matches, null);

    expect(regularMatches.map((row) => row.id)).toEqual(['legacy', 'regular']);
    expect(scoredMatches.map((row) => row.id)).toEqual(['legacy', 'regular']);
  });

  it('keeps League points unchanged when Champion League and placement results exist', () => {
    const matches = [
      match('league-draw', 'regular', { home_score: 1, away_score: 1 }),
      match('champion-win', 'champion_league', { home_score: 9, away_score: 0 }),
      match('final-win', 'final', { home_score: 8, away_score: 0 }),
      match('third-win', 'third_place', { home_score: 7, away_score: 0 }),
    ];

    const { scoredMatches } = selectRegularLeagueExportMatches(matches, null);
    const stats = calculateStandings(scoredMatches, 'team-a');

    expect(stats.played).toBe(1);
    expect(stats.wins).toBe(0);
    expect(stats.draws).toBe(1);
    expect(stats.losses).toBe(0);
    expect(stats.goalsFor).toBe(1);
    expect(stats.goalsAgainst).toBe(1);
    expect(stats.points).toBe(1);
  });

  it('applies MatchDay filtering only after restricting to the regular League', () => {
    const matches = [
      match('md1', null, { matchday: 'MD1', home_score: 2, away_score: 0 }),
      match('md2', 'regular', { matchday: 'MatchDay 2', home_score: 3, away_score: 0 }),
      match('md3', 'regular', { matchday: 'MD3', home_score: 4, away_score: 0 }),
      match('cl1', 'champion_league', { matchday: 'CL1', home_score: 10, away_score: 0 }),
    ];

    const { regularMatches, scoredMatches } = selectRegularLeagueExportMatches(matches, 2);

    expect(regularMatches.map((row) => row.id)).toEqual(['md1', 'md2', 'md3']);
    expect(scoredMatches.map((row) => row.id)).toEqual(['md1', 'md2']);
  });

  it('does not treat post-league-only fixtures as regular League data', () => {
    const matches = [
      match('champion', 'champion_league'),
      match('final', 'final'),
      match('third', 'third_place'),
    ];

    const { regularMatches, scoredMatches } = selectRegularLeagueExportMatches(matches, null);

    expect(regularMatches).toHaveLength(0);
    expect(scoredMatches).toHaveLength(0);
  });

  it('ignores unfinished or unscored regular League fixtures', () => {
    const matches = [
      match('finished', 'regular'),
      match('scheduled', 'regular', { status: 'scheduled' }),
      match('missing-home-score', 'regular', { home_score: null }),
      match('missing-away-score', 'regular', { away_score: null }),
    ];

    const { regularMatches, scoredMatches } = selectRegularLeagueExportMatches(matches, null);

    expect(regularMatches).toHaveLength(4);
    expect(scoredMatches.map((row) => row.id)).toEqual(['finished']);
  });
});

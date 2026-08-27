import { describe, expect, it } from 'vitest';
import {
  calculateChampionLeagueStandings,
  getChampionLeaguePlacementPairings,
  getChampionLeagueProgress,
  isRegularLeagueMatch,
  type ChampionLeagueQualifier,
} from '@/lib/champion-league';
import { buildRegularLeagueStandings } from '@/lib/league-standings';
import type { Match } from '@/types/db';

const qualifiers: ChampionLeagueQualifier[] = [
  { team_id: 'A', league_rank: 1, team_name: 'A' },
  { team_id: 'B', league_rank: 2, team_name: 'B' },
  { team_id: 'C', league_rank: 3, team_name: 'C' },
  { team_id: 'D', league_rank: 4, team_name: 'D' },
];

function match(
  id: string,
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
  leaguePhase: Match['league_phase'] = 'champion_league'
): Match {
  return {
    id,
    match_code: id,
    season_id: 'S',
    age_group_id: 'AG',
    division_id: 'DIV',
    matchday: id,
    match_no: null,
    match_date: '2026-08-01',
    match_time: '10:00:00',
    home_team_id: home,
    away_team_id: away,
    home_score: homeScore,
    away_score: awayScore,
    status: 'finished',
    league_phase: leaguePhase,
    note: null,
    created_at: '',
    updated_at: '',
  };
}

describe('Champion League', () => {
  it('treats legacy null and explicit regular as regular-league matches', () => {
    expect(isRegularLeagueMatch({ league_phase: null })).toBe(true);
    expect(isRegularLeagueMatch({ league_phase: 'regular' })).toBe(true);
    expect(isRegularLeagueMatch({ league_phase: 'champion_league' })).toBe(false);
  });

  it('does not let post-league matches alter the final regular-league table', () => {
    const regular = match('R1', 'A', 'B', 1, 0, 'regular');
    const champion = match('C1', 'B', 'A', 9, 0, 'champion_league');
    const rows = buildRegularLeagueStandings(
      [regular, champion],
      [
        { id: 'A', name: 'A' },
        { id: 'B', name: 'B' },
      ],
      { seasonId: 'S', ageGroupId: 'AG', divisionId: 'DIV' }
    );
    expect(rows.map((r) => [r.team_id, r.points, r.goal_diff])).toEqual([
      ['A', 3, 1],
      ['B', 0, -1],
    ]);
  });

  it('awards one point to each team for a draw', () => {
    const rows = calculateChampionLeagueStandings(qualifiers, [match('C1', 'A', 'B', 2, 2)]);
    expect(rows.find((r) => r.team_id === 'A')?.points).toBe(1);
    expect(rows.find((r) => r.team_id === 'B')?.points).toBe(1);
  });

  it('uses regular-league rank immediately when Champion League points tie even if GD is worse', () => {
    const rows = calculateChampionLeagueStandings(qualifiers, [
      match('C1', 'A', 'C', 1, 0),
      match('C2', 'A', 'D', 0, 10),
      match('C3', 'B', 'C', 9, 0),
      match('C4', 'B', 'D', 0, 1),
    ]);

    const a = rows.find((r) => r.team_id === 'A')!;
    const b = rows.find((r) => r.team_id === 'B')!;
    expect(a.points).toBe(3);
    expect(b.points).toBe(3);
    expect(a.goal_diff).toBeLessThan(b.goal_diff);
    expect(a.rank).toBeLessThan(b.rank);
  });

  it('requires all six unique round-robin pairings, exactly once, before placement progression', () => {
    const firstFive = [
      match('1', 'A', 'B', 1, 0),
      match('2', 'A', 'C', 1, 0),
      match('3', 'A', 'D', 1, 0),
      match('4', 'B', 'C', 1, 0),
      match('5', 'B', 'D', 1, 0),
    ];
    expect(getChampionLeagueProgress(qualifiers, firstFive).complete).toBe(false);

    const allSix = [...firstFive, match('6', 'C', 'D', 1, 0)];
    const progress = getChampionLeagueProgress(qualifiers, allSix);
    expect(progress.complete).toBe(true);
    expect(progress.finished_unique_matches).toBe(6);
    expect(Object.values(progress.matches_played_by_team)).toEqual([3, 3, 3, 3]);

    const rows = calculateChampionLeagueStandings(qualifiers, allSix);
    expect(getChampionLeaguePlacementPairings(rows, progress)).toEqual({
      final: { home_team_id: rows[0].team_id, away_team_id: rows[1].team_id },
      third_place: { home_team_id: rows[2].team_id, away_team_id: rows[3].team_id },
    });
  });

  it('does not call a duplicated pairing a complete single round robin', () => {
    const matches = [
      match('1', 'A', 'B', 1, 0),
      match('2', 'A', 'C', 1, 0),
      match('3', 'A', 'D', 1, 0),
      match('4', 'B', 'C', 1, 0),
      match('5', 'B', 'D', 1, 0),
      match('6', 'C', 'D', 1, 0),
      match('7', 'B', 'A', 0, 1),
    ];
    const progress = getChampionLeagueProgress(qualifiers, matches);
    expect(progress.complete).toBe(false);
    expect(progress.duplicate_pairings).toBe(1);
  });
});

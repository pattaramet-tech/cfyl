import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  calculateChampionLeagueStandings,
  getChampionLeagueFixtureStructureStatus,
  getChampionLeaguePlacementPairings,
  getChampionLeagueProgress,
  getChampionLeagueRoundRobinPairings,
  getGeneratedLeaguePostMatchCode,
  getRegularLeagueActivationReadiness,
  isGeneratedLeaguePostMatchCode,
  isRegularLeagueMatch,
  parseChampionLeagueQualifierSnapshot,
  validateChampionLeaguePlacementFixtures,
  type ChampionLeagueQualifier,
} from '@/lib/champion-league';
import { isLegacyTournamentV1Fixture } from '@/lib/tournament-fixtures';
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

  it('freezes only a valid four-team qualifier snapshot with unique ranks', () => {
    expect(
      parseChampionLeagueQualifierSnapshot(qualifiers)?.map(({ team_id, league_rank, team_name }) => ({
        team_id,
        league_rank,
        team_name,
      }))
    ).toEqual(qualifiers.map(({ team_id, league_rank, team_name }) => ({ team_id, league_rank, team_name })));
    expect(
      parseChampionLeagueQualifierSnapshot([
        qualifiers[0],
        { ...qualifiers[1], league_rank: 1 },
        qualifiers[2],
        qualifiers[3],
      ])
    ).toBeNull();
    expect(
      parseChampionLeagueQualifierSnapshot([
        qualifiers[0],
        { ...qualifiers[1], team_id: 'A' },
        qualifiers[2],
        qualifiers[3],
      ])
    ).toBeNull();
  });

  it('requires every regular fixture to be finished and every active team to appear before activation', () => {
    const completed = [
      match('R1', 'A', 'B', 1, 0, 'regular'),
      match('R2', 'C', 'D', 2, 2, 'regular'),
    ];
    expect(getRegularLeagueActivationReadiness(completed, ['A', 'B', 'C', 'D']).ready).toBe(true);

    const unfinished: Match = {
      ...match('R3', 'A', 'C', 0, 0, 'regular'),
      status: 'scheduled',
      home_score: null,
      away_score: null,
    };
    const readiness = getRegularLeagueActivationReadiness(
      [...completed, unfinished],
      ['A', 'B', 'C', 'D']
    );
    expect(readiness.ready).toBe(false);
    expect(readiness.unfinished_match_count).toBe(1);
    expect(getRegularLeagueActivationReadiness(completed, ['A', 'B', 'C', 'D', 'E']).ready).toBe(false);
  });

  it('blocks completion and ignores an ambiguous pairing when a duplicate fixture exists even if duplicate is unplayed', () => {
    const six = [
      match('1', 'A', 'B', 3, 0),
      match('2', 'A', 'C', 1, 0),
      match('3', 'A', 'D', 1, 0),
      match('4', 'B', 'C', 1, 0),
      match('5', 'B', 'D', 1, 0),
      match('6', 'C', 'D', 1, 0),
    ];
    const scheduledDuplicate: Match = {
      ...match('7', 'B', 'A', 0, 0),
      status: 'scheduled',
      home_score: null,
      away_score: null,
    };
    const fixtures = [...six, scheduledDuplicate];
    const progress = getChampionLeagueProgress(qualifiers, fixtures);
    expect(progress.complete).toBe(false);
    expect(progress.fixture_matches).toBe(7);
    expect(progress.duplicate_pairings).toBe(1);
    expect(progress.finished_unique_matches).toBe(5);

    const rows = calculateChampionLeagueStandings(qualifiers, fixtures);
    expect(rows.find((row) => row.team_id === 'A')?.played).toBe(2);
    expect(rows.find((row) => row.team_id === 'B')?.played).toBe(2);
  });

  it('blocks completion when an invalid scheduled Champion League fixture exists', () => {
    const six = [
      match('1', 'A', 'B', 1, 0),
      match('2', 'A', 'C', 1, 0),
      match('3', 'A', 'D', 1, 0),
      match('4', 'B', 'C', 1, 0),
      match('5', 'B', 'D', 1, 0),
      match('6', 'C', 'D', 1, 0),
    ];
    const invalidScheduled: Match = {
      ...match('7', 'A', 'X', 0, 0),
      status: 'postponed',
      home_score: null,
      away_score: null,
    };
    const progress = getChampionLeagueProgress(qualifiers, [...six, invalidScheduled]);
    expect(progress.complete).toBe(false);
    expect(progress.invalid_pairings).toBe(1);
    expect(progress.fixture_matches).toBe(7);
  });

  it('rejects stale placement fixtures after a projected Champion League result change', () => {
    const six = [
      match('1', 'A', 'B', 1, 0),
      match('2', 'A', 'C', 1, 0),
      match('3', 'A', 'D', 1, 0),
      match('4', 'B', 'C', 1, 0),
      match('5', 'B', 'D', 1, 0),
      match('6', 'C', 'D', 1, 0),
    ];
    const baseIntegrity = validateChampionLeaguePlacementFixtures(qualifiers, six);
    expect(baseIntegrity.valid).toBe(true);
    expect(baseIntegrity.expected_pairings).not.toBeNull();

    const placement = baseIntegrity.expected_pairings!;
    const finalFixture = match(
      'F',
      placement.final.home_team_id,
      placement.final.away_team_id,
      0,
      0,
      'final'
    );
    const thirdFixture = match(
      'T',
      placement.third_place.home_team_id,
      placement.third_place.away_team_id,
      0,
      0,
      'third_place'
    );
    expect(validateChampionLeaguePlacementFixtures(qualifiers, [...six, finalFixture, thirdFixture]).valid).toBe(true);

    const projected = six.map((fixture) =>
      fixture.id === '4' ? { ...fixture, home_score: 0, away_score: 9 } : fixture
    );
    const projectedIntegrity = validateChampionLeaguePlacementFixtures(
      qualifiers,
      [...projected, finalFixture, thirdFixture]
    );
    expect(projectedIntegrity.valid).toBe(false);
    expect(projectedIntegrity.reason).toMatch(/Final|Third Place/);
  });

  it('treats only division-less, phase-less staged rows as legacy Tournament V1 fixtures', () => {
    expect(
      isLegacyTournamentV1Fixture({ division_id: null, league_phase: null, stage: 'group' })
    ).toBe(true);
    expect(
      isLegacyTournamentV1Fixture({ division_id: 'DIV', league_phase: null, stage: 'group' })
    ).toBe(false);
    expect(
      isLegacyTournamentV1Fixture({ division_id: null, league_phase: 'champion_league', stage: 'final' })
    ).toBe(false);
  });

  it('generates a deterministic six-pair round robin from frozen ranks with three matches per team', () => {
    const pairings = getChampionLeagueRoundRobinPairings(qualifiers);
    expect(pairings).toHaveLength(6);
    expect(pairings.map((row) => [row.round_no, row.home_team_id, row.away_team_id])).toEqual([
      [1, 'A', 'D'],
      [1, 'C', 'B'],
      [2, 'C', 'A'],
      [2, 'B', 'D'],
      [3, 'A', 'B'],
      [3, 'D', 'C'],
    ]);
    const counts = new Map<string, number>();
    const unordered = new Set<string>();
    for (const row of pairings) {
      counts.set(row.home_team_id, (counts.get(row.home_team_id) || 0) + 1);
      counts.set(row.away_team_id, (counts.get(row.away_team_id) || 0) + 1);
      unordered.add([row.home_team_id, row.away_team_id].sort().join('::'));
    }
    expect(unordered.size).toBe(6);
    expect(Object.fromEntries(counts)).toEqual({ A: 3, D: 3, C: 3, B: 3 });
  });

  it('reports fixture structure complete independently of whether results are finished', () => {
    const scheduled = getChampionLeagueRoundRobinPairings(qualifiers).map((row) => ({
      ...match(String(row.slot), row.home_team_id, row.away_team_id, 0, 0),
      status: 'scheduled' as const,
      home_score: null,
      away_score: null,
    }));
    const structure = getChampionLeagueFixtureStructureStatus(qualifiers, scheduled);
    expect(structure.complete).toBe(true);
    expect(structure.fixture_matches).toBe(6);
    expect(structure.unique_pairings).toBe(6);
    expect(structure.missing_pairings).toBe(0);
    expect(Object.values(structure.matches_by_team)).toEqual([3, 3, 3, 3]);
    expect(getChampionLeagueProgress(qualifiers, scheduled).complete).toBe(false);
  });

  it('generated post-league match codes are deterministic and recognizable', () => {
    expect(getGeneratedLeaguePostMatchCode('champion_league', 'DIV', 1)).toBe('CL-DIV-R1');
    expect(getGeneratedLeaguePostMatchCode('final', 'DIV')).toBe('CL-DIV-FINAL');
    expect(getGeneratedLeaguePostMatchCode('third_place', 'DIV')).toBe('CL-DIV-THIRD');
    expect(isGeneratedLeaguePostMatchCode('CL-DIV-R6')).toBe(true);
    expect(isGeneratedLeaguePostMatchCode('CL-DIV-FINAL')).toBe(true);
    expect(isGeneratedLeaguePostMatchCode('REG-1')).toBe(false);
  });

  it('CFYL-002 migration enforces one Final and one Third Place per League scope', () => {
    const sql = readFileSync('scripts/migration-league-champion-fixtures.sql', 'utf8');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_matches_league_placement_phase_scope');
    expect(sql).toContain('season_id, age_group_id, division_id, league_phase');
    expect(sql).toContain("WHERE league_phase IN ('final', 'third_place')");
  });

  it('migration enforces concurrency-safe unordered Champion League pairing uniqueness', () => {
    const sql = readFileSync('scripts/migration-league-champion-league.sql', 'utf8');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_matches_champion_league_pair_scope');
    expect(sql).toContain('LEAST(home_team_id, away_team_id)');
    expect(sql).toContain('GREATEST(home_team_id, away_team_id)');
    expect(sql).toContain("WHERE league_phase = 'champion_league'");
  });
});

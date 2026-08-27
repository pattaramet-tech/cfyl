import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

function createMockClient(db: Db) {
  function builder(table: string) {
    const filters: Array<[string, unknown]> = [];
    const rows = () => db[table] || [];
    const execute = () =>
      rows().filter((row) => filters.every(([column, value]) => row[column] === value));

    const api = {
      select() {
        return api;
      },
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return api;
      },
      order() {
        return api;
      },
      maybeSingle() {
        const matches = execute();
        return Promise.resolve({ data: matches[0] ?? null, error: null });
      },
      then(
        resolve: (value: { data: Row[]; error: null }) => unknown,
        reject?: (reason: unknown) => unknown
      ) {
        return Promise.resolve({ data: execute(), error: null }).then(resolve, reject);
      },
    };

    return api;
  }

  return {
    from(table: string) {
      return builder(table);
    },
  };
}

const state = vi.hoisted(() => ({
  client: null as ReturnType<typeof createMockClient> | null,
}));

vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return state.client;
  },
}));

import { GET } from '../route';

const scope = {
  season_id: 'season-1',
  age_group_id: 'age-1',
  division_id: 'division-1',
};

function makeRequest(): NextRequest {
  const searchParams = new URLSearchParams({
    seasonId: scope.season_id,
    ageGroupId: scope.age_group_id,
    divisionId: scope.division_id,
  });
  return { nextUrl: { searchParams } } as unknown as NextRequest;
}

function postLeagueMatch(id: string, leaguePhase: 'champion_league' | 'final' | 'third_place'): Row {
  return {
    id,
    ...scope,
    match_code: id,
    matchday: 'CL',
    match_date: '2026-09-01',
    match_time: '10:00:00',
    home_team_id: 'team-a',
    away_team_id: 'team-b',
    home_score: null,
    away_score: null,
    status: 'scheduled',
    league_phase: leaguePhase,
  };
}

function dbWithSnapshot(snapshot?: Row): Db {
  return {
    matches: [
      postLeagueMatch('cl-1', 'champion_league'),
      postLeagueMatch('final-1', 'final'),
      postLeagueMatch('third-1', 'third_place'),
    ],
    league_champion_league_snapshots: snapshot ? [snapshot] : [],
  };
}

describe('GET /api/public/champion-league fail-closed placement exposure', () => {
  beforeEach(() => {
    state.client = null;
  });

  it('does not expose Final or Third Place when the activation snapshot is missing', async () => {
    state.client = createMockClient(dbWithSnapshot());

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.active).toBe(false);
    expect(body.matches.champion_league).toHaveLength(1);
    expect(body.matches.final).toEqual([]);
    expect(body.matches.third_place).toEqual([]);
    expect(body.pairings).toBeNull();
    expect(body.activation).toBeNull();
  });

  it('does not expose Final or Third Place when the stored snapshot is malformed', async () => {
    state.client = createMockClient(
      dbWithSnapshot({
        id: 'snapshot-1',
        ...scope,
        qualifiers: [{ team_id: 'team-a', league_rank: 1, team_name: 'A' }],
        regular_match_count: 12,
        activated_at: '2026-08-27T12:00:00Z',
      })
    );

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.active).toBe(false);
    expect(body.matches.champion_league).toHaveLength(1);
    expect(body.matches.final).toEqual([]);
    expect(body.matches.third_place).toEqual([]);
    expect(body.pairings).toBeNull();
    expect(body.activation).toBeNull();
  });
});

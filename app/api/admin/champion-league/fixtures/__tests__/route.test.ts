import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;
type MockError = { code: string; message?: string } | null;
type QueryResult = { data: Row[] | null; error: MockError };
interface AuthState {
  authenticated: boolean;
  profile?: { id: string; email: string; can_edit_matches: boolean };
}

const state = vi.hoisted(() => ({
  db: {} as Db,
  raceInsertOnce: false,
  auth: {
    authenticated: true,
    profile: {
      id: 'admin-1',
      email: 'admin@example.com',
      can_edit_matches: true,
    },
  } as AuthState,
}));

vi.mock('@/lib/admin-middleware', () => ({
  verifyAdminAuth: vi.fn(async () => state.auth),
}));

vi.mock('@/lib/audit-log', () => ({
  logAdminAction: vi.fn(async () => undefined),
}));

vi.mock('@/lib/suspension-calc', () => ({
  refreshSuspensionServingMatches: vi.fn(async () => ({ updated: 0 })),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let operation: 'select' | 'insert' | 'update' = 'select';
      let insertRows: Row[] = [];
      let updateValues: Row = {};

      const selectedRows = () =>
        (state.db[table] || []).filter((row) =>
          filters.every(([column, value]) => row[column] === value)
        );

      const execute = () => {
        if (operation === 'insert') {
          const rows = insertRows.map((row, index) => ({
            id: row.id || `${table}-${(state.db[table] || []).length + index + 1}`,
            created_at: row.created_at || '2026-08-27T00:00:00Z',
            updated_at: row.updated_at || '2026-08-27T00:00:00Z',
            ...row,
          }));
          state.db[table] ||= [];
          state.db[table].push(...rows);
          if (state.raceInsertOnce) {
            state.raceInsertOnce = false;
            return { data: null, error: { code: '23505', message: 'simulated concurrent insert' } };
          }
          return { data: rows, error: null };
        }

        if (operation === 'update') {
          const matches = selectedRows();
          for (const row of matches) Object.assign(row, updateValues);
          return { data: matches, error: null };
        }

        return { data: selectedRows(), error: null };
      };

      // Supabase builders are thenable and self-referential; keep the mock surface intentionally dynamic.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api: any = {
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
        insert(value: Row | Row[]) {
          operation = 'insert';
          insertRows = Array.isArray(value) ? value : [value];
          return api;
        },
        update(value: Row) {
          operation = 'update';
          updateValues = value;
          return api;
        },
        maybeSingle() {
          const result = execute();
          return Promise.resolve({ data: result.data?.[0] ?? null, error: result.error });
        },
        single() {
          const result = execute();
          return Promise.resolve({ data: result.data?.[0] ?? null, error: result.error });
        },
        then(resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(execute()).then(resolve, reject);
        },
      };
      return api;
    },
  }),
}));

import { GET, PATCH, POST } from '../route';
import { PUT as PUT_MATCH } from '../../../matches/[matchId]/route';

const scope = {
  season_id: 'season-1',
  age_group_id: 'age-1',
  division_id: 'division-1',
};

const qualifiers = [
  { team_id: 'A', league_rank: 1, team_name: 'A' },
  { team_id: 'B', league_rank: 2, team_name: 'B' },
  { team_id: 'C', league_rank: 3, team_name: 'C' },
  { team_id: 'D', league_rank: 4, team_name: 'D' },
];

function snapshot(): Row {
  return {
    id: 'snapshot-1',
    ...scope,
    qualifiers,
    activated_at: '2026-08-27T00:00:00Z',
  };
}

function requestBody(body: Record<string, unknown>): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function getRequest(): NextRequest {
  const searchParams = new URLSearchParams({
    seasonId: scope.season_id,
    ageGroupId: scope.age_group_id,
    divisionId: scope.division_id,
  });
  return { nextUrl: { searchParams } } as unknown as NextRequest;
}

function schedules() {
  return Array.from({ length: 6 }, (_, index) => ({
    slot: index + 1,
    match_no: 101 + index,
    match_date: `2026-09-${String(index + 1).padStart(2, '0')}`,
    match_time: '10:00',
    venue: 'Dome 1',
    home_team_id: 'ATTACKER-CONTROLLED',
    away_team_id: 'ATTACKER-CONTROLLED',
  }));
}

function championMatch(
  id: string,
  home: string,
  away: string,
  homeScore: number | null,
  awayScore: number | null,
  status: 'scheduled' | 'finished' = 'finished'
): Row {
  return {
    id,
    ...scope,
    match_code: id,
    matchday: 'CL',
    match_no: null,
    match_date: '2026-09-01',
    match_time: '10:00:00',
    venue: 'Dome 1',
    home_team_id: home,
    away_team_id: away,
    home_score: homeScore,
    away_score: awayScore,
    status,
    league_phase: 'champion_league',
    note: null,
    created_at: '',
    updated_at: '',
  };
}

function finishedRoundRobin(): Row[] {
  return [
    championMatch('1', 'A', 'B', 1, 0),
    championMatch('2', 'A', 'C', 1, 0),
    championMatch('3', 'A', 'D', 1, 0),
    championMatch('4', 'B', 'C', 1, 0),
    championMatch('5', 'B', 'D', 1, 0),
    championMatch('6', 'C', 'D', 1, 0),
  ];
}

function initializeDb(matches: Row[] = []) {
  state.db = {
    league_champion_league_snapshots: [snapshot()],
    matches: [...matches],
  };
}

describe('admin Champion League fixture generation', () => {
  beforeEach(() => {
    initializeDb();
    state.raceInsertOnce = false;
    state.auth = {
      authenticated: true,
      profile: { id: 'admin-1', email: 'admin@example.com', can_edit_matches: true },
    };
  });

  it('requires an authenticated match editor', async () => {
    state.auth = { authenticated: false };
    const response = await POST(requestBody({ action: 'generate_round_robin', ...scope, schedules: schedules() }));
    expect(response.status).toBe(401);
  });

  it('GET previews six deterministic server-owned pairings after activation', async () => {
    const response = await GET(getRequest());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.active).toBe(true);
    expect(body.round_robin.preview).toHaveLength(6);
    expect(body.round_robin.preview.map((row: Row) => [row.home_team_id, row.away_team_id])).toEqual([
      ['A', 'D'],
      ['C', 'B'],
      ['C', 'A'],
      ['B', 'D'],
      ['A', 'B'],
      ['D', 'C'],
    ]);
  });

  it('generates exactly six fixtures using frozen Top 4 teams and ignores client team fields', async () => {
    const response = await POST(
      requestBody({ action: 'generate_round_robin', ...scope, schedules: schedules() })
    );
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.idempotent).toBe(false);

    const rows = state.db.matches.filter((row) => row.league_phase === 'champion_league');
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => !String(row.home_team_id).includes('ATTACKER'))).toBe(true);
    expect(rows.every((row) => !String(row.away_team_id).includes('ATTACKER'))).toBe(true);
    expect(new Set(rows.flatMap((row) => [row.home_team_id, row.away_team_id]))).toEqual(
      new Set(['A', 'B', 'C', 'D'])
    );
    const pairKeys = rows.map((row) => [row.home_team_id, row.away_team_id].sort().join('::'));
    expect(new Set(pairKeys).size).toBe(6);
    const teamCounts = rows.flatMap((row) => [row.home_team_id, row.away_team_id]).reduce<Record<string, number>>(
      (acc, id) => ({ ...acc, [id]: (acc[id] || 0) + 1 }),
      {}
    );
    expect(teamCounts).toEqual({ A: 3, D: 3, C: 3, B: 3 });
  });

  it('is idempotent when generation is repeated after a complete six-fixture structure exists', async () => {
    await POST(requestBody({ action: 'generate_round_robin', ...scope, schedules: schedules() }));
    const second = await POST(requestBody({ action: 'generate_round_robin', ...scope, schedules: schedules() }));
    const body = await second.json();
    expect(second.status).toBe(200);
    expect(body.idempotent).toBe(true);
    expect(state.db.matches.filter((row) => row.league_phase === 'champion_league')).toHaveLength(6);
  });

  it('treats a DB unique race as idempotent success after the competing request commits all six rows', async () => {
    state.raceInsertOnce = true;
    const response = await POST(requestBody({ action: 'generate_round_robin', ...scope, schedules: schedules() }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.idempotent).toBe(true);
    expect(body.concurrent).toBe(true);
    expect(state.db.matches.filter((row) => row.league_phase === 'champion_league')).toHaveLength(6);
  });

  it('rejects generation over a partial existing Champion League structure', async () => {
    initializeDb([championMatch('partial', 'A', 'B', null, null, 'scheduled')]);
    const response = await POST(requestBody({ action: 'generate_round_robin', ...scope, schedules: schedules() }));
    expect(response.status).toBe(409);
    expect(state.db.matches).toHaveLength(1);
  });

  it('rejects placement generation until all six Champion League results are complete', async () => {
    const scheduled = finishedRoundRobin().map((row) => ({ ...row, status: 'scheduled', home_score: null, away_score: null }));
    initializeDb(scheduled);
    const response = await POST(
      requestBody({
        action: 'generate_placements',
        ...scope,
        schedules: {
          final: { match_date: '2026-10-01', match_time: '14:00', venue: 'Dome 1' },
          third_place: { match_date: '2026-10-01', match_time: '12:00', venue: 'Dome 1' },
        },
      })
    );
    expect(response.status).toBe(409);
    expect(state.db.matches.some((row) => row.league_phase === 'final')).toBe(false);
  });

  it('generates Final rank 1-2 and Third Place rank 3-4 exactly once after completion', async () => {
    initializeDb(finishedRoundRobin());
    const request = () =>
      requestBody({
        action: 'generate_placements',
        ...scope,
        schedules: {
          final: { match_no: 201, match_date: '2026-10-01', match_time: '14:00', venue: 'Dome 1' },
          third_place: { match_no: 200, match_date: '2026-10-01', match_time: '12:00', venue: 'Dome 1' },
        },
      });

    const first = await POST(request());
    expect(first.status).toBe(201);
    const final = state.db.matches.filter((row) => row.league_phase === 'final');
    const third = state.db.matches.filter((row) => row.league_phase === 'third_place');
    expect(final).toHaveLength(1);
    expect(third).toHaveLength(1);
    expect(new Set([final[0].home_team_id, final[0].away_team_id])).toEqual(new Set(['A', 'B']));
    expect(new Set([third[0].home_team_id, third[0].away_team_id])).toEqual(new Set(['C', 'D']));

    const second = await POST(request());
    const secondBody = await second.json();
    expect(second.status).toBe(200);
    expect(secondBody.idempotent).toBe(true);
    expect(state.db.matches.filter((row) => row.league_phase === 'final')).toHaveLength(1);
    expect(state.db.matches.filter((row) => row.league_phase === 'third_place')).toHaveLength(1);
  });

  it('treats a DB unique placement race as idempotent success after the competing request commits both rows', async () => {
    initializeDb(finishedRoundRobin());
    state.raceInsertOnce = true;
    const response = await POST(
      requestBody({
        action: 'generate_placements',
        ...scope,
        schedules: {
          final: { match_no: 201, match_date: '2026-10-01', match_time: '14:00', venue: 'Dome 1' },
          third_place: { match_no: 200, match_date: '2026-10-01', match_time: '12:00', venue: 'Dome 1' },
        },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.idempotent).toBe(true);
    expect(body.concurrent).toBe(true);
    expect(state.db.matches.filter((row) => row.league_phase === 'final')).toHaveLength(1);
    expect(state.db.matches.filter((row) => row.league_phase === 'third_place')).toHaveLength(1);
  });

  it('rejects a Champion League result correction that would stale generated placement fixtures', async () => {
    initializeDb(finishedRoundRobin());
    const placementResponse = await POST(
      requestBody({
        action: 'generate_placements',
        ...scope,
        schedules: {
          final: { match_no: 201, match_date: '2026-10-01', match_time: '14:00', venue: 'Dome 1' },
          third_place: { match_no: 200, match_date: '2026-10-01', match_time: '12:00', venue: 'Dome 1' },
        },
      })
    );
    expect(placementResponse.status).toBe(201);

    const target = state.db.matches.find((row) => row.id === '4')!;
    expect([target.home_score, target.away_score]).toEqual([1, 0]);

    const correction = await PUT_MATCH(
      requestBody({
        home_score: 0,
        away_score: 9,
        status: 'finished',
        result_type: 'normal',
        league_phase: 'champion_league',
      }),
      { params: Promise.resolve({ matchId: '4' }) }
    );
    const correctionBody = await correction.json();

    expect(correction.status).toBe(409);
    expect(correctionBody.error).toMatch(/Final\/Third Place fixtures inconsistent/);
    expect([target.home_score, target.away_score]).toEqual([1, 0]);
  });

  it('PATCH updates schedule metadata only for a generated non-finished fixture', async () => {
    await POST(requestBody({ action: 'generate_round_robin', ...scope, schedules: schedules() }));
    const generated = state.db.matches.find((row) => row.match_code === 'CL-division-1-R1')!;
    const pairBefore = [generated.home_team_id, generated.away_team_id, generated.league_phase];

    const response = await PATCH(
      requestBody({
        match_id: generated.id,
        schedule: { match_no: 999, match_date: '2026-11-01', match_time: '18:30', venue: 'Dome 2' },
      })
    );
    expect(response.status).toBe(200);
    expect([generated.home_team_id, generated.away_team_id, generated.league_phase]).toEqual(pairBefore);
    expect(generated.match_no).toBe(999);
    expect(generated.match_date).toBe('2026-11-01');
    expect(generated.match_time).toBe('18:30:00');
    expect(generated.venue).toBe('Dome 2');
  });
});

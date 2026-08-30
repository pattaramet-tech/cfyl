import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;

function relationOne(value: unknown): Row | null {
  if (Array.isArray(value)) return (value[0] as Row | undefined) ?? null;
  if (value && typeof value === 'object') return value as Row;
  return null;
}

function createMockClient(rows: Row[], serverCap = Number.POSITIVE_INFINITY) {
  return {
    from(table: string) {
      if (table !== 'goals') throw new Error(`Unexpected table: ${table}`);

      const filters: Array<(row: Row) => boolean> = [];
      let rangeStart = 0;
      let rangeEnd = Number.POSITIVE_INFINITY;

      const api = {
        select() {
          return api;
        },
        eq(column: string, value: unknown) {
          if (column.startsWith('match.')) {
            const field = column.slice('match.'.length);
            filters.push((row) => relationOne(row.match)?.[field] === value);
          } else {
            filters.push((row) => row[column] === value);
          }
          return api;
        },
        not(column: string, operator: string, value: unknown) {
          if (operator === 'is' && value === null) {
            filters.push((row) => row[column] !== null && row[column] !== undefined);
          }
          return api;
        },
        order() {
          return api;
        },
        range(from: number, to: number) {
          rangeStart = from;
          rangeEnd = to;
          return api;
        },
        then(
          resolve: (value: { data: Row[]; error: null; count: number }) => unknown,
          reject?: (reason: unknown) => unknown
        ) {
          const filtered = rows.filter((row) => filters.every((filter) => filter(row)));
          const requestedLength = Math.max(0, rangeEnd - rangeStart + 1);
          const returnedLength = Math.min(requestedLength, serverCap);
          const data = filtered.slice(rangeStart, rangeStart + returnedLength);
          return Promise.resolve({ data, error: null, count: filtered.length }).then(resolve, reject);
        },
      };

      return api;
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

function makeRequest(overrides: Record<string, string> = {}): NextRequest {
  const searchParams = new URLSearchParams({
    seasonId: 'season-1',
    ageGroupId: 'age-1',
    divisionId: 'division-1',
    limit: '100',
    ...overrides,
  });
  return { nextUrl: { searchParams } } as unknown as NextRequest;
}

function goal(overrides: Row = {}): Row {
  return {
    player_id: 'player-1',
    is_own_goal: false,
    goals: 1,
    player: {
      player_code: 'P001',
      full_name: 'ราเชนทร์ รุ่งเรือง',
      shirt_no: 9,
      team_id: 'team-1',
      division_id: null,
    },
    team: { name: 'รร.ท่าข้ามพิทยาคม', short_name: 'ท่าข้าม' },
    match: {
      season_id: 'season-1',
      age_group_id: 'age-1',
      division_id: 'division-1',
    },
    ...overrides,
  };
}

describe('GET /api/public/top-scorers', () => {
  beforeEach(() => {
    state.client = null;
  });

  it('scopes goals by match competition metadata when player division metadata is null or stale', async () => {
    state.client = createMockClient([
      goal({ goals: 1 }),
      goal({ goals: 2, match: [{ season_id: 'season-1', age_group_id: 'age-1', division_id: 'division-1' }] }),
      goal({ goals: 5, match: { season_id: 'season-1', age_group_id: 'age-1', division_id: 'division-2' } }),
      goal({ goals: 7, match: { season_id: 'season-2', age_group_id: 'age-1', division_id: 'division-1' } }),
      goal({ goals: 11, match: { season_id: 'season-1', age_group_id: 'age-2', division_id: 'division-1' } }),
    ]);

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([
      expect.objectContaining({
        player_id: 'player-1',
        full_name: 'ราเชนทร์ รุ่งเรือง',
        team_name: 'รร.ท่าข้ามพิทยาคม',
        total_goals: 3,
      }),
    ]);
  });

  it('paginates until all scoped rows are included when the server caps each response', async () => {
    state.client = createMockClient(
      Array.from({ length: 6 }, () => goal({ full_name: 'พีรเดช บุญที' })),
      2
    );

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].total_goals).toBe(6);
  });

  it('continues to exclude own goals and rows without a player id', async () => {
    state.client = createMockClient([
      goal({ goals: 2 }),
      goal({ goals: 4, is_own_goal: true }),
      goal({ goals: 8, player_id: null }),
    ]);

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].total_goals).toBe(2);
  });
});

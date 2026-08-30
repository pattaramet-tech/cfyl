import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;

function createMockClient(rows: Row[]) {
  const filters: Array<(row: Row) => boolean> = [];

  const api = {
    select() {
      return api;
    },
    eq(column: string, value: unknown) {
      filters.push((row) => row[column] === value);
      return api;
    },
    not(column: string, operator: string, value: unknown) {
      if (operator === 'is' && value === null) {
        filters.push((row) => row[column] !== null && row[column] !== undefined);
      }
      return api;
    },
    then(
      resolve: (value: { data: Row[]; error: null }) => unknown,
      reject?: (reason: unknown) => unknown
    ) {
      return Promise.resolve({ data: rows.filter((row) => filters.every((filter) => filter(row))), error: null }).then(
        resolve,
        reject
      );
    },
  };

  return {
    from(table: string) {
      if (table !== 'goals') throw new Error(`Unexpected table: ${table}`);
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

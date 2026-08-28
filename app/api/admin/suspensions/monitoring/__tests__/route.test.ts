import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  db: {
    suspensions: [] as Row[],
    matches: [] as Row[],
    cards: [] as Row[],
  },
}));

vi.mock('@/lib/admin-middleware', () => ({
  verifyAdminAuth: vi.fn(async () => ({ authenticated: true, profile: { id: 'admin-1' } })),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from(table: 'suspensions' | 'matches' | 'cards') {
      const eqFilters: Array<{ column: string; value: unknown }> = [];
      const inFilters: Array<{ column: string; values: unknown[] }> = [];
      let orFilter: string | null = null;

      const rows = () => {
        let result = [...state.db[table]];
        result = result.filter((row) =>
          eqFilters.every(({ column, value }) => row[column] === value)
        );
        result = result.filter((row) =>
          inFilters.every(({ column, values }) => values.includes(row[column]))
        );
        if (orFilter) {
          const match = orFilter.match(/home_team_id\.eq\.([^,]+),away_team_id\.eq\.(.+)$/);
          if (match) {
            const teamId = match[1];
            result = result.filter(
              (row) => row.home_team_id === teamId || row.away_team_id === teamId
            );
          }
        }
        return result;
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api: any = {
        select() {
          return api;
        },
        eq(column: string, value: unknown) {
          eqFilters.push({ column, value });
          return api;
        },
        in(column: string, values: unknown[]) {
          inFilters.push({ column, values });
          return api;
        },
        or(value: string) {
          orFilter = value;
          return api;
        },
        then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  })),
}));

import { GET } from '../route';

function suspension(overrides: Row = {}): Row {
  return {
    id: 'susp-1',
    player_id: 'player-1',
    team_id: 'A',
    season_id: 'season-1',
    age_group_id: 'age-1',
    suspension_type: 'accumulated_points',
    trigger_match_id: 'trigger',
    accumulated_threshold: 6,
    source_card_ids: ['card-1'],
    serving_match_ids: [],
    ban_matches: 1,
    total_points: 6,
    suspended_from_match_id: null,
    served_completed_at: null,
    legacy_migrated: false,
    suspension_details: { suspended_matches: [] },
    updated_at: '2026-08-28T00:00:00Z',
    ...overrides,
  };
}

function match(overrides: Row): Row {
  return {
    id: 'match',
    status: 'scheduled',
    season_id: 'season-1',
    age_group_id: 'age-1',
    home_team_id: 'A',
    away_team_id: 'B',
    match_date: '2026-09-10',
    match_time: '10:00:00',
    matchday: 'MD10',
    match_code: 'M10',
    ...overrides,
  };
}

function request() {
  return new Request(
    'http://localhost/api/admin/suspensions/monitoring?seasonId=season-1&ageGroupId=age-1'
  );
}

function initializeBase() {
  state.db.suspensions = [suspension()];
  state.db.cards = [
    { id: 'card-1', player_id: 'player-1', match_id: 'trigger', card_type: 'yellow' },
  ];
  state.db.matches = [
    match({
      id: 'trigger',
      status: 'finished',
      match_date: '2026-09-01',
      match_time: '10:00:00',
      matchday: 'MD9',
      match_code: 'M9',
    }),
  ];
}

describe('GET /api/admin/suspensions/monitoring readiness', () => {
  beforeEach(() => initializeBase());

  it('flags stale no-next state when an eligible future scheduled fixture exists', async () => {
    state.db.matches.push(
      match({ id: 'future', match_date: '2026-09-05', matchday: 'CL1', match_code: 'CL1' })
    );

    const response = await GET(request() as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          suspension_id: 'susp-1',
          issue_code: 'ACTIVE_BAN_STALE_NO_NEXT_MATCH',
          severity: 'error',
        }),
      ])
    );
  });

  it('does not flag stale no-next state when no eligible future fixture exists', async () => {
    const response = await GET(request() as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ issue_code: 'ACTIVE_BAN_STALE_NO_NEXT_MATCH' }),
      ])
    );
  });

  it('reports wrong team, season, age group, status and chronology on referenced serving matches', async () => {
    state.db.suspensions = [
      suspension({
        ban_matches: 5,
        serving_match_ids: ['wrong-team', 'wrong-season', 'wrong-age', 'postponed', 'before-trigger'],
      }),
    ];
    state.db.matches.push(
      match({ id: 'wrong-team', home_team_id: 'X', away_team_id: 'Y' }),
      match({ id: 'wrong-season', season_id: 'season-2' }),
      match({ id: 'wrong-age', age_group_id: 'age-2' }),
      match({ id: 'postponed', status: 'postponed' }),
      match({ id: 'before-trigger', match_date: '2026-08-31', matchday: 'MD8' })
    );

    const response = await GET(request() as never);
    const body = await response.json();
    const codes = new Set(body.issues.map((issue: { issue_code: string }) => issue.issue_code));

    expect(response.status).toBe(200);
    expect(codes.has('SERVING_MATCH_WRONG_TEAM')).toBe(true);
    expect(codes.has('SERVING_MATCH_WRONG_SEASON')).toBe(true);
    expect(codes.has('SERVING_MATCH_WRONG_AGE_GROUP')).toBe(true);
    expect(codes.has('SERVING_MATCH_POSTPONED')).toBe(true);
    expect(codes.has('SERVING_MATCH_BEFORE_TRIGGER')).toBe(true);
  });

  it('treats a same-day later kickoff as chronologically after the trigger', async () => {
    state.db.suspensions = [suspension({ serving_match_ids: ['same-day-later'] })];
    state.db.matches.push(
      match({
        id: 'same-day-later',
        match_date: '2026-09-01',
        match_time: '12:00:00',
        matchday: 'MD9',
      })
    );

    const response = await GET(request() as never);
    const body = await response.json();

    expect(body.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ issue_code: 'SERVING_MATCH_BEFORE_TRIGGER' }),
      ])
    );
  });
});

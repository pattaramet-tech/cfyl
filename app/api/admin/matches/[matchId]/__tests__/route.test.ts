import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  currentMatch: {
    id: 'match-1',
    match_code: 'M1',
    season_id: 'season-1',
    age_group_id: 'age-1',
    division_id: 'division-1',
    home_team_id: 'A',
    away_team_id: 'B',
    home_score: 0,
    away_score: 0,
    status: 'scheduled',
    result_type: 'normal',
    league_phase: 'regular',
    match_date: '2026-09-10',
    match_time: '10:00:00',
    updated_at: '2026-08-28T00:00:00Z',
  } as Record<string, unknown>,
  refresh: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/admin-middleware', () => ({
  verifyAdminAuth: vi.fn(async () => ({
    authenticated: true,
    profile: {
      id: 'admin-1',
      email: 'admin@example.com',
      can_edit_matches: true,
    },
  })),
  badRequestResponse: (message: string) => Response.json({ error: message }, { status: 400 }),
  internalErrorResponse: (message: string) => Response.json({ error: message }, { status: 500 }),
}));

vi.mock('@/lib/audit-log', () => ({
  logAdminAction: state.audit,
}));

vi.mock('@/lib/suspension-calc', () => ({
  refreshSuspensionServingMatches: state.refresh,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from(table: string) {
      if (table !== 'matches') throw new Error(`Unexpected table ${table}`);
      let operation: 'select' | 'update' = 'select';
      let updateValues: Record<string, unknown> = {};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api: any = {
        select() {
          return api;
        },
        update(values: Record<string, unknown>) {
          operation = 'update';
          updateValues = values;
          return api;
        },
        eq() {
          return api;
        },
        single() {
          if (operation === 'update') {
            return Promise.resolve({
              data: { ...state.currentMatch, ...updateValues },
              error: null,
            });
          }
          return Promise.resolve({ data: { ...state.currentMatch }, error: null });
        },
        maybeSingle() {
          return api.single();
        },
      };
      return api;
    },
  })),
}));

import { PUT } from '../route';

describe('PUT /api/admin/matches/[matchId] suspension refresh evidence', () => {
  beforeEach(() => {
    state.refresh.mockReset();
    state.audit.mockReset();
    state.refresh.mockImplementation(async ({ teamId }: { teamId: string }) => {
      if (teamId === 'A') return { refreshed: 1, skipped: 0, failed: 0 };
      return { refreshed: 0, skipped: 0, failed: 1 };
    });
  });

  it('refreshes both affected teams and returns structured repair evidence on partial failure', async () => {
    const request = new Request('http://localhost/api/admin/matches/match-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        home_score: 0,
        away_score: 0,
        status: 'postponed',
        result_type: 'normal',
      }),
    });

    const response = await PUT(request as never, {
      params: Promise.resolve({ matchId: 'match-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(state.refresh).toHaveBeenCalledTimes(2);
    expect(state.refresh).toHaveBeenCalledWith({
      seasonId: 'season-1',
      ageGroupId: 'age-1',
      teamId: 'A',
    });
    expect(state.refresh).toHaveBeenCalledWith({
      seasonId: 'season-1',
      ageGroupId: 'age-1',
      teamId: 'B',
    });
    expect(body.serving_refresh).toEqual(
      expect.objectContaining({
        attempted: true,
        status: 'partial_failure',
        repair_required: true,
        total_refreshed: 1,
        total_failed: 1,
      })
    );
    expect(body.serving_refresh.team_results).toEqual([
      expect.objectContaining({ team_id: 'A', refreshed: 1, failed: 0 }),
      expect.objectContaining({ team_id: 'B', refreshed: 0, failed: 1 }),
    ]);
    expect(body.serving_refresh_warning).toContain('needs repair');
  });
});

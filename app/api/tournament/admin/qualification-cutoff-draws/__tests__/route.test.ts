import { beforeEach, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createMockSaveQualificationCutoffDrawRpc, type Db, type Row } from '@/lib/tournament/services/__tests__/mockQualificationCutoffDrawRpc';

function createMockClient(db: Db, rpcHandler?: (name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string; code?: string } | null }) {
  function builder(table: string) {
    const filters: Array<['eq' | 'is' | 'in', string, unknown]> = [];
    const rows = (): Row[] => db[table] || (db[table] = []);
    function matches(row: Row): boolean {
      return filters.every(([op, col, val]) => {
        if (op === 'eq') return row[col] === val;
        if (op === 'is') return (row[col] ?? null) === val;
        if (op === 'in') return (val as unknown[]).includes(row[col]);
        return true;
      });
    }
    const api = {
      select() {
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push(['eq', col, val]);
        return api;
      },
      is(col: string, val: unknown) {
        filters.push(['is', col, val]);
        return api;
      },
      in(col: string, val: unknown[]) {
        filters.push(['in', col, val]);
        return api;
      },
      order() {
        return api;
      },
      maybeSingle() {
        const data = rows().filter(matches);
        return Promise.resolve({ data: data.length ? data[0] : null, error: null });
      },
      then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve({ data: rows().filter(matches), error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  return {
    from(table: string) {
      return builder(table);
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (!rpcHandler) return Promise.resolve({ data: null, error: { message: 'no rpc handler configured', code: 'PGRST202' } });
      return Promise.resolve(rpcHandler(name, args));
    },
  };
}

import { vi } from 'vitest';
const hoisted = vi.hoisted(() => ({ client: null as ReturnType<typeof createMockClient> | null, authorized: true as boolean }));

vi.mock('@/lib/tournament/db/supabase-tournament', () => ({
  getTournamentServiceClient: () => hoisted.client,
}));

vi.mock('@/lib/tournament/services/auth', () => ({
  requireTournamentSuperAdmin: async () => ({
    authenticated: true,
    authorized: hoisted.authorized,
    userId: 'super-1',
    email: 'super1@test.com',
    error: hoisted.authorized ? undefined : 'User does not have tournament_super_admin role',
  }),
}));

import { GET, POST } from '../route';

function makeGetRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/tournament/admin/qualification-cutoff-draws');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { nextUrl: url, json: async () => ({}) } as unknown as NextRequest;
}

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const TOURNAMENT_ID = 'tour-1';
const CATEGORY_ID = 'cat-1';
const GROUP_ID = 'group-a';

function officialMatch(overrides: Row): Row {
  return { category_id: CATEGORY_ID, status: 'finished', result_workflow_status: 'published', deleted_at: null, regulation_home_score: 3, regulation_away_score: 0, decided_by: 'regulation', ...overrides };
}

function baseDb(): Db {
  return {
    tournaments: [{ id: TOURNAMENT_ID, slug: 'cfyl-2026', deleted_at: null }],
    tournament_categories: [{ id: CATEGORY_ID, tournament_id: TOURNAMENT_ID, code: 'B-U14', deleted_at: null }],
    tournament_groups: [{ id: GROUP_ID, tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, code: 'A' }],
    tournament_qualification_rules: [{ tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, qualify_rank_per_group: 2 }],
    tournament_teams: [
      { id: 'A', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'A', name: 'Team A', deleted_at: null },
      { id: 'B', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'B', name: 'Team B', deleted_at: null },
      { id: 'C', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'C', name: 'Team C', deleted_at: null },
      { id: 'D', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'D', name: 'Team D', deleted_at: null },
    ],
    tournament_group_members: [
      { group_id: GROUP_ID, team_id: 'A' },
      { group_id: GROUP_ID, team_id: 'B' },
      { group_id: GROUP_ID, team_id: 'C' },
      { group_id: GROUP_ID, team_id: 'D' },
    ],
    tournament_matches: [
      officialMatch({ id: 'm1', group_id: GROUP_ID, home_team_id: 'A', away_team_id: 'B', winner_team_id: 'A' }),
      officialMatch({ id: 'm2', group_id: GROUP_ID, home_team_id: 'A', away_team_id: 'C', winner_team_id: 'A' }),
      officialMatch({ id: 'm3', group_id: GROUP_ID, home_team_id: 'A', away_team_id: 'D', winner_team_id: 'A' }),
      officialMatch({ id: 'm4', group_id: GROUP_ID, home_team_id: 'B', away_team_id: 'C', winner_team_id: 'B' }),
      officialMatch({ id: 'm5', group_id: GROUP_ID, home_team_id: 'C', away_team_id: 'D', winner_team_id: 'C' }),
      officialMatch({ id: 'm6', group_id: GROUP_ID, home_team_id: 'D', away_team_id: 'B', winner_team_id: 'D' }),
    ],
    tournament_match_cards: [],
    tournament_standing_overrides: [],
    tournament_qualification_cutoff_draws: [],
    tournament_qualification_cutoff_draw_candidates: [],
  };
}

async function previewAndExtractToken(): Promise<string> {
  const response = await POST(makePostRequest({ tournament_slug: 'cfyl-2026', category_code: 'B-U14', group_code: 'A', selected_team_ids: ['B'], preview: true }));
  const body = await response.json();
  expect(response.status).toBe(200);
  return body.data.preview_token as string;
}

describe('qualification-cutoff-draws route — auth', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    hoisted.authorized = true;
  });

  it('34/24-style. returns 403 for an unauthorized caller', async () => {
    hoisted.authorized = false;
    hoisted.client = createMockClient(baseDb()) as never;
    const response = await POST(makePostRequest({ tournament_slug: 'cfyl-2026', category_code: 'B-U14', group_code: 'A', selected_team_ids: ['B'], preview: true }));
    expect(response.status).toBe(403);
  });

  it('GET context also requires super_admin', async () => {
    hoisted.authorized = false;
    hoisted.client = createMockClient(baseDb()) as never;
    const response = await GET(makeGetRequest({ tournament_slug: 'cfyl-2026', category_code: 'B-U14', group_code: 'A' }));
    expect(response.status).toBe(403);
  });
});

describe('qualification-cutoff-draws route — GET context', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    hoisted.authorized = true;
  });

  it('reports pending_draw for a tied group with candidates and available slots', async () => {
    hoisted.client = createMockClient(baseDb()) as never;
    const response = await GET(makeGetRequest({ tournament_slug: 'cfyl-2026', category_code: 'B-U14', group_code: 'A' }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.qualification_state).toBe('pending_draw');
    expect(body.data.available_slots).toBe(1);
    expect(body.data.draw_candidates.map((t: { team_id: string }) => t.team_id).sort()).toEqual(['B', 'C', 'D']);
  });
});

describe('qualification-cutoff-draws route — Preview writes nothing', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    hoisted.authorized = true;
  });

  it('34. Preview performs no RPC call and leaves the draw tables untouched', async () => {
    const db = baseDb();
    let rpcCalled = false;
    hoisted.client = createMockClient(db, () => {
      rpcCalled = true;
      return { data: null, error: null };
    }) as never;
    const response = await POST(makePostRequest({ tournament_slug: 'cfyl-2026', category_code: 'B-U14', group_code: 'A', selected_team_ids: ['B'], preview: true }));
    expect(response.status).toBe(200);
    expect(rpcCalled).toBe(false);
    expect(db.tournament_qualification_cutoff_draws).toHaveLength(0);
  });
});

describe('qualification-cutoff-draws route — Save safety', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    hoisted.authorized = true;
  });

  it('37. Save without a preview token is rejected', async () => {
    const db = baseDb();
    const rpc = createMockSaveQualificationCutoffDrawRpc(db, { categoryId: CATEGORY_ID, groupId: GROUP_ID });
    hoisted.client = createMockClient(db, rpc) as never;
    const response = await POST(makePostRequest({ tournament_slug: 'cfyl-2026', category_code: 'B-U14', group_code: 'A', selected_team_ids: ['B'], idempotency_key: 'idem-1' }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('QUALIFICATION_CUTOFF_DRAW_PREVIEW_REQUIRED');
  });

  it('a valid Preview Token allows Save to succeed via the RPC', async () => {
    const db = baseDb();
    const rpc = createMockSaveQualificationCutoffDrawRpc(db, { categoryId: CATEGORY_ID, groupId: GROUP_ID });
    hoisted.client = createMockClient(db, rpc) as never;
    const token = await previewAndExtractToken();
    const response = await POST(
      makePostRequest({ tournament_slug: 'cfyl-2026', category_code: 'B-U14', group_code: 'A', selected_team_ids: ['B'], preview_token: token, idempotency_key: 'idem-2' })
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.idempotent).toBe(false);
    expect((db.tournament_qualification_cutoff_draws as Row[])).toHaveLength(1);
  });

  it('42. same idempotency key + same selection returns idempotent success', async () => {
    const db = baseDb();
    const rpc = createMockSaveQualificationCutoffDrawRpc(db, { categoryId: CATEGORY_ID, groupId: GROUP_ID });
    hoisted.client = createMockClient(db, rpc) as never;
    const token1 = await previewAndExtractToken();
    await POST(makePostRequest({ tournament_slug: 'cfyl-2026', category_code: 'B-U14', group_code: 'A', selected_team_ids: ['B'], preview_token: token1, idempotency_key: 'idem-retry' }));

    const token2 = await previewAndExtractToken();
    const response2 = await POST(
      makePostRequest({ tournament_slug: 'cfyl-2026', category_code: 'B-U14', group_code: 'A', selected_team_ids: ['B'], preview_token: token2, idempotency_key: 'idem-retry' })
    );
    const body2 = await response2.json();
    expect(response2.status).toBe(200);
    expect(body2.data.idempotent).toBe(true);
    expect((db.tournament_qualification_cutoff_draws as Row[])).toHaveLength(1);
  });

  it('fails closed with 503 when the RPC is missing, and writes nothing', async () => {
    const db = baseDb();
    hoisted.client = createMockClient(db, () => ({ data: null, error: { message: 'Could not find the function tournament.save_qualification_cutoff_draw', code: 'PGRST202' } })) as never;
    const token = await previewAndExtractToken();
    const response = await POST(
      makePostRequest({ tournament_slug: 'cfyl-2026', category_code: 'B-U14', group_code: 'A', selected_team_ids: ['B'], preview_token: token, idempotency_key: 'idem-3' })
    );
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.code).toBe('QUALIFICATION_CUTOFF_DRAW_RPC_UNAVAILABLE');
    expect(db.tournament_qualification_cutoff_draws).toHaveLength(0);
  });
});

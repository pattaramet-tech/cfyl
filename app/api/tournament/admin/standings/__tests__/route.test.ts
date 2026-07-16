import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;
type FailConfig = Partial<Record<string, Partial<Record<'select' | 'insert' | 'update' | 'upsert' | 'delete', boolean>>>>;

function createMockClient(db: Db, failConfig: FailConfig = {}) {
  function builder(table: string) {
    let mode: 'select' | 'update' | 'insert' | 'upsert' | 'delete' = 'select';
    let patch: Row | null = null;
    let insertRows: Row[] = [];
    let upsertRow: Row | null = null;
    let upsertConflictCols: string[] = [];
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

    function forcedError(op: keyof NonNullable<FailConfig[string]>): { message: string } | null {
      if (failConfig[table]?.[op]) return { message: `Simulated ${String(op)} failure on ${table}` };
      return null;
    }

    function execute(): { data: Row[] | Row | null; error: { message: string } | null } {
      if (mode === 'update') {
        const err = forcedError('update');
        if (err) return { data: null, error: err };
        const matched = rows().filter(matches);
        matched.forEach((row) => Object.assign(row, patch));
        return { data: matched, error: null };
      }
      if (mode === 'delete') {
        const err = forcedError('delete');
        if (err) return { data: null, error: err };
        const remaining: Row[] = [];
        for (const row of rows()) if (!matches(row)) remaining.push(row);
        db[table] = remaining;
        return { data: [], error: null };
      }
      if (mode === 'insert') {
        const err = forcedError('insert');
        if (err) return { data: null, error: err };
        const created = insertRows.map((row) => {
          const withId: Row = { id: `mock-${Math.random().toString(36).slice(2)}`, ...row };
          rows().push(withId);
          return withId;
        });
        return { data: created, error: null };
      }
      if (mode === 'upsert') {
        const err = forcedError('upsert');
        if (err) return { data: null, error: err };
        const conflictMatch = (row: Row) => upsertConflictCols.every((col) => row[col] === (upsertRow as Row)[col]);
        const existingIndex = rows().findIndex(conflictMatch);
        if (existingIndex >= 0) Object.assign(rows()[existingIndex], upsertRow);
        else rows().push({ ...(upsertRow as Row) });
        return { data: [upsertRow as Row], error: null };
      }
      const err = forcedError('select');
      if (err) return { data: null, error: err };
      return { data: rows().filter(matches), error: null };
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
      update(p: Row) {
        mode = 'update';
        patch = p;
        return api;
      },
      delete() {
        mode = 'delete';
        return api;
      },
      insert(p: Row | Row[]) {
        mode = 'insert';
        insertRows = Array.isArray(p) ? p : [p];
        return api;
      },
      upsert(p: Row, opts?: { onConflict?: string }) {
        mode = 'upsert';
        upsertRow = p;
        upsertConflictCols = (opts?.onConflict || '').split(',').map((s) => s.trim()).filter(Boolean);
        return api;
      },
      maybeSingle() {
        const { data, error } = execute();
        const list = (data as Row[]) || [];
        return Promise.resolve({ data: Array.isArray(data) ? (list.length ? list[0] : null) : data, error });
      },
      then(resolve: (value: { data: Row[] | Row | null; error: { message: string } | null }) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(execute()).then(resolve, reject);
      },
    };
    return api;
  }

  return { from: (table: string) => builder(table) };
}

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createMockClient> | null }));
const authState = vi.hoisted(() => ({ authorized: true as boolean }));

vi.mock('@/lib/tournament/db/supabase-tournament', () => ({
  getTournamentServiceClient: () => state.client,
}));

vi.mock('@/lib/tournament/services/auth', () => ({
  requireTournamentSuperAdmin: async () => ({
    authenticated: true,
    authorized: authState.authorized,
    userId: 'admin-1',
    email: 'admin@test.com',
    error: authState.authorized ? undefined : 'Not a tournament_super_admin',
  }),
}));

import { GET, POST } from '../route';

function makeGetRequest(params: Record<string, string>): NextRequest {
  const search = new URLSearchParams(params).toString();
  return { nextUrl: { searchParams: new URLSearchParams(search) } } as unknown as NextRequest;
}

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function groupResultMatches(groupId: string, categoryId: string, teams: string[]): Row[] {
  const base = { category_id: categoryId, group_id: groupId, status: 'finished', result_workflow_status: 'published', decided_by: 'regulation', deleted_at: null };
  const matches: Row[] = [];
  for (let i = 0; i < teams.length; i += 1) {
    for (let j = i + 1; j < teams.length; j += 1) {
      matches.push({
        id: `${groupId}-${teams[i]}-${teams[j]}`,
        home_team_id: teams[i],
        away_team_id: teams[j],
        regulation_home_score: 1,
        regulation_away_score: 0,
        winner_team_id: teams[i],
        ...base,
      });
    }
  }
  return matches;
}

function buildDb(): Db {
  return {
    tournaments: [{ id: 'tour-1', slug: 'cfyl-2026', deleted_at: null }],
    tournament_categories: [{ id: 'cat-1', tournament_id: 'tour-1', code: 'B-U14', deleted_at: null }],
    tournament_groups: [
      { id: 'group-a', tournament_id: 'tour-1', category_id: 'cat-1', code: 'A' },
      { id: 'group-b', tournament_id: 'tour-1', category_id: 'cat-1', code: 'B' },
    ],
    tournament_qualification_rules: [
      {
        tournament_id: 'tour-1',
        category_id: 'cat-1',
        qualify_rank_per_group: 2,
        best_third_placed_count: 2,
        best_third_placed_method: 'ranked',
        cross_group_comparison: true,
      },
    ],
    tournament_teams: [
      { id: 'a1', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'A1', name: 'A1', deleted_at: null },
      { id: 'a2', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'A2', name: 'A2', deleted_at: null },
      { id: 'a3', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'A3', name: 'A3', deleted_at: null },
      { id: 'b1', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'B1', name: 'B1', deleted_at: null },
      { id: 'b2', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'B2', name: 'B2', deleted_at: null },
      { id: 'b3', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'B3', name: 'B3', deleted_at: null },
      { id: 'b4', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'B4', name: 'B4', deleted_at: null },
    ],
    tournament_group_members: [
      { group_id: 'group-a', team_id: 'a1' },
      { group_id: 'group-a', team_id: 'a2' },
      { group_id: 'group-a', team_id: 'a3' },
      { group_id: 'group-b', team_id: 'b1' },
      { group_id: 'group-b', team_id: 'b2' },
      { group_id: 'group-b', team_id: 'b3' },
      { group_id: 'group-b', team_id: 'b4' },
    ],
    tournament_match_cards: [],
    tournament_standing_overrides: [],
    // Group A: 3 teams -> 2 matches per team. Group B: 4 teams -> 3 matches
    // per team. Unequal countedMatches for the two groups' 3rd-place teams.
    tournament_matches: [
      ...groupResultMatches('group-a', 'cat-1', ['a1', 'a2', 'a3']),
      ...groupResultMatches('group-b', 'cat-1', ['b1', 'b2', 'b3', 'b4']),
    ],
    tournament_audit_logs: [],
  };
}

describe('standings admin route — GET cross-group ranking surfacing', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    authState.authorized = true;
  });

  it('surfaces normalization_required when the category groups have unequal counted matches', async () => {
    state.client = createMockClient(buildDb());
    const response = await GET(makeGetRequest({ tournament_slug: 'cfyl-2026', category_code: 'B-U14' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.best_third_placed_ranking.state).toBe('normalization_required');
    expect(body.data.best_third_placed_ranking.ranked).toEqual([]);
    expect(body.data.best_third_placed_ranking.explanation).toContain('ยังไม่สามารถเปรียบเทียบทีมอันดับ 3 ข้ามกลุ่มได้');
  });

  it('does not compute a ranking (returns null) for a draw-method (G-U16-style) category', async () => {
    const db = buildDb();
    db.tournament_qualification_rules = [
      {
        tournament_id: 'tour-1',
        category_id: 'cat-1',
        qualify_rank_per_group: 2,
        best_third_placed_count: 2,
        best_third_placed_method: 'draw',
        cross_group_comparison: false,
      },
    ];
    state.client = createMockClient(db);
    const response = await GET(makeGetRequest({ tournament_slug: 'cfyl-2026', category_code: 'B-U14' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.best_third_placed_ranking).toBeNull();
  });
});

describe('standings admin route — manual override POST safety', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    authState.authorized = true;
  });

  const overrideBody = {
    tournament_slug: 'cfyl-2026',
    group_id: 'group-a',
    team_id: 'a2',
    override_rank: 1,
    reason: 'คำสั่งกรรมการกลาง',
  };

  it('POST returns 403 for an unauthorized caller', async () => {
    authState.authorized = false;
    state.client = createMockClient(buildDb());
    const response = await POST(makePostRequest({ ...overrideBody, preview: true }));
    expect(response.status).toBe(403);
  });

  it('Preview succeeds and returns a preview_token', async () => {
    state.client = createMockClient(buildDb());
    const response = await POST(makePostRequest({ ...overrideBody, preview: true }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.preview_token).toBeTruthy();
    expect(body.data.after.override_rank).toBe(1);
  });

  it('Save without a preview_token is rejected with STANDINGS_OVERRIDE_PREVIEW_REQUIRED (400)', async () => {
    state.client = createMockClient(buildDb());
    const response = await POST(makePostRequest(overrideBody));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('STANDINGS_OVERRIDE_PREVIEW_REQUIRED');
  });

  it('Save with a valid preview_token from Preview succeeds and writes the override', async () => {
    const db = buildDb();
    state.client = createMockClient(db);
    const previewResponse = await POST(makePostRequest({ ...overrideBody, preview: true }));
    const previewBody = await previewResponse.json();

    const saveResponse = await POST(makePostRequest({ ...overrideBody, preview_token: previewBody.data.preview_token }));
    const saveBody = await saveResponse.json();

    expect(saveResponse.status).toBe(200);
    expect(saveBody.data.audit_logged).toBe(true);
    expect(db.tournament_standing_overrides).toHaveLength(1);
    expect(db.tournament_audit_logs).toHaveLength(1);
  });

  it('an out-of-range rank is rejected with 400 STANDINGS_OVERRIDE_RANK_OUT_OF_RANGE', async () => {
    state.client = createMockClient(buildDb());
    const response = await POST(makePostRequest({ ...overrideBody, override_rank: 999, preview: true }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('STANDINGS_OVERRIDE_RANK_OUT_OF_RANGE');
  });
});

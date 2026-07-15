import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

function createMockClient(db: Db) {
  function builder(table: string) {
    let mode: 'select' | 'update' | 'insert' = 'select';
    let patch: Row | null = null;
    let insertRows: Row[] = [];
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

    function execute(): { data: Row[]; error: null } {
      if (mode === 'update') {
        const matched = rows().filter(matches);
        matched.forEach((row) => Object.assign(row, patch));
        return { data: matched, error: null };
      }
      if (mode === 'insert') {
        const created = insertRows.map((row) => {
          const withId: Row = { id: `mock-${Math.random().toString(36).slice(2)}`, ...row };
          rows().push(withId);
          return withId;
        });
        return { data: created, error: null };
      }
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
      order() {
        return api;
      },
      update(p: Row) {
        mode = 'update';
        patch = p;
        return api;
      },
      insert(p: Row | Row[]) {
        mode = 'insert';
        insertRows = Array.isArray(p) ? p : [p];
        return api;
      },
      maybeSingle() {
        const { data, error } = execute();
        return Promise.resolve({ data: data.length ? data[0] : null, error });
      },
      single() {
        const { data, error } = execute();
        return Promise.resolve({ data: data.length ? data[0] : null, error });
      },
      then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(execute()).then(resolve, reject);
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

function buildDb(): Db {
  return {
    tournaments: [{ id: 'tour-1', slug: 'cfyl-2026', deleted_at: null }],
    tournament_categories: [{ id: 'cat-1', tournament_id: 'tour-1', code: 'G-U16', deleted_at: null }],
    tournament_qualification_rules: [
      { tournament_id: 'tour-1', category_id: 'cat-1', best_third_placed_count: 2, best_third_placed_method: 'draw' },
    ],
    tournament_teams: [
      { id: 'team-1', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'A3', name: 'Group A 3rd' },
      { id: 'team-2', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'B3', name: 'Group B 3rd' },
      { id: 'team-3', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'C3', name: 'Group C 3rd' },
    ],
    tournament_group_members: [],
    tournament_matches: [
      {
        id: 'match-qf-1',
        tournament_id: 'tour-1',
        category_id: 'cat-1',
        match_code: 'G-U16-QF-001',
        home_source_type: 'group_rank',
        home_source_ref: 'A:1',
        away_source_type: 'draw_selected',
        away_source_ref: 'G-U16-THIRD-DRAW-1',
        home_team_id: 'team-a1',
        away_team_id: null,
        sources_resolved_at: null,
        deleted_at: null,
      },
    ],
    tournament_qualification_draws: [],
    tournament_qualification_draw_candidates: [],
    tournament_audit_logs: [],
  };
}

const validBody = {
  tournament_slug: 'cfyl-2026',
  category_code: 'G-U16',
  candidate_team_ids: ['team-1', 'team-2', 'team-3'],
  selections: [
    { source_ref: 'G-U16-THIRD-DRAW-1', team_id: 'team-1' },
    { source_ref: 'G-U16-THIRD-DRAW-2', team_id: 'team-2' },
  ],
};

describe('qualification-draws route', () => {
  beforeEach(() => {
    state.client = null;
    authState.authorized = true;
  });

  it('GET returns 403 for an unauthorized caller', async () => {
    authState.authorized = false;
    state.client = createMockClient(buildDb());

    const response = await GET(makeGetRequest({ tournament_slug: 'cfyl-2026', category_code: 'G-U16' }));

    expect(response.status).toBe(403);
  });

  it('GET loads eligible candidate options for the page', async () => {
    state.client = createMockClient(buildDb());

    const response = await GET(makeGetRequest({ tournament_slug: 'cfyl-2026', category_code: 'G-U16' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.candidate_options).toHaveLength(3);
    expect(body.data.placeholder_source_refs).toEqual(['G-U16-THIRD-DRAW-1', 'G-U16-THIRD-DRAW-2']);
  });

  it('POST returns 403 for an unauthorized caller and does not write', async () => {
    authState.authorized = false;
    const db = buildDb();
    state.client = createMockClient(db);

    const response = await POST(makePostRequest(validBody));

    expect(response.status).toBe(403);
    expect(db.tournament_qualification_draws).toHaveLength(0);
  });

  it('POST preview does not write data', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const response = await POST(makePostRequest({ ...validBody, preview: true }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.preview).toBe(true);
    expect(body.data.affected_matches).toHaveLength(1);
    expect(db.tournament_qualification_draws).toHaveLength(0);
  });

  it('POST confirmation writes exactly once and records an audit log entry', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const response = await POST(makePostRequest(validBody));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(db.tournament_qualification_draws).toHaveLength(1);
    expect(body.data.updated_match_ids).toEqual(['match-qf-1']);

    const auditEntry = db.tournament_audit_logs.find(
      (log) => log.action === 'qualification-draws.confirm_manual_placeholder_assignment'
    );
    expect(auditEntry).toBeDefined();
    expect(auditEntry?.entity_id).toBe(body.data.draw_id);
  });

  it('requires candidate_team_ids before accepting selections', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const response = await POST(makePostRequest({ ...validBody, candidate_team_ids: [] }));

    expect(response.status).toBe(400);
    expect(db.tournament_qualification_draws).toHaveLength(0);
  });
});

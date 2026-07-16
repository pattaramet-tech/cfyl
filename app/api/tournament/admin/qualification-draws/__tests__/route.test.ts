import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { NextRequest } from 'next/server';
import {
  mockSaveQualificationDrawAssignmentRpc,
  type RpcFailureInjection,
} from '../../../../../../lib/tournament/services/__tests__/mockSaveQualificationDrawAssignmentRpc';

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

function createMockClient(db: Db, options: { injection?: RpcFailureInjection } = {}) {
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

    function execute(): { data: Row[]; error: null } {
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
    rpc(fnName: string, args: Record<string, unknown>) {
      if (fnName !== 'save_qualification_draw_assignment') {
        return Promise.resolve({ data: null, error: { message: `mock client: unknown rpc "${fnName}"` } });
      }
      const result = mockSaveQualificationDrawAssignmentRpc(db, args as never, options.injection);
      return Promise.resolve(result);
    },
  };
}

const state = vi.hoisted(() => ({
  client: null as ReturnType<typeof createMockClient> | null,
  rpcCallCount: 0,
}));
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

// One published, official round-robin per group (A/B/C), engineered so that
// team-1/team-2/team-3 finish exactly 3rd in their respective group — this
// makes them the Standings Engine's computed G-U16 third-place candidates,
// matching the team IDs already referenced by validBody below.
function groupResultMatches(params: {
  groupId: string;
  first: string;
  second: string;
  third: string;
}): Row[] {
  const base = {
    tournament_id: 'tour-1',
    category_id: 'cat-1',
    group_id: params.groupId,
    status: 'finished',
    result_workflow_status: 'published',
    decided_by: 'regulation',
    deleted_at: null,
  };
  return [
    { id: `${params.groupId}-m1`, home_team_id: params.first, away_team_id: params.second, regulation_home_score: 2, regulation_away_score: 0, winner_team_id: params.first, ...base },
    { id: `${params.groupId}-m2`, home_team_id: params.first, away_team_id: params.third, regulation_home_score: 2, regulation_away_score: 0, winner_team_id: params.first, ...base },
    { id: `${params.groupId}-m3`, home_team_id: params.second, away_team_id: params.third, regulation_home_score: 1, regulation_away_score: 0, winner_team_id: params.second, ...base },
  ];
}

function buildDb(overrides: { existingDraw?: Row } = {}): Db {
  return {
    tournaments: [{ id: 'tour-1', slug: 'cfyl-2026', status: 'active', deleted_at: null }],
    tournament_categories: [{ id: 'cat-1', tournament_id: 'tour-1', code: 'G-U16', deleted_at: null }],
    tournament_qualification_rules: [
      {
        tournament_id: 'tour-1',
        category_id: 'cat-1',
        qualify_rank_per_group: 2,
        best_third_placed_count: 2,
        best_third_placed_method: 'draw',
        cross_group_comparison: false,
      },
    ],
    tournament_groups: [
      { id: 'group-a', tournament_id: 'tour-1', category_id: 'cat-1', code: 'A' },
      { id: 'group-b', tournament_id: 'tour-1', category_id: 'cat-1', code: 'B' },
      { id: 'group-c', tournament_id: 'tour-1', category_id: 'cat-1', code: 'C' },
    ],
    tournament_teams: [
      { id: 'team-a1', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'A1', name: 'Group A 1st', deleted_at: null },
      { id: 'team-a2', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'A2', name: 'Group A 2nd', deleted_at: null },
      { id: 'team-1', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'A3', name: 'Group A 3rd', deleted_at: null },
      { id: 'team-b1', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'B1', name: 'Group B 1st', deleted_at: null },
      { id: 'team-b2', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'B2', name: 'Group B 2nd', deleted_at: null },
      { id: 'team-2', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'B3', name: 'Group B 3rd', deleted_at: null },
      { id: 'team-c1', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'C1', name: 'Group C 1st', deleted_at: null },
      { id: 'team-c2', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'C2', name: 'Group C 2nd', deleted_at: null },
      { id: 'team-3', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'C3', name: 'Group C 3rd', deleted_at: null },
    ],
    tournament_group_members: [
      { group_id: 'group-a', team_id: 'team-a1' },
      { group_id: 'group-a', team_id: 'team-a2' },
      { group_id: 'group-a', team_id: 'team-1' },
      { group_id: 'group-b', team_id: 'team-b1' },
      { group_id: 'group-b', team_id: 'team-b2' },
      { group_id: 'group-b', team_id: 'team-2' },
      { group_id: 'group-c', team_id: 'team-c1' },
      { group_id: 'group-c', team_id: 'team-c2' },
      { group_id: 'group-c', team_id: 'team-3' },
    ],
    tournament_match_cards: [],
    tournament_standing_overrides: [],
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
      {
        id: 'match-qf-2',
        tournament_id: 'tour-1',
        category_id: 'cat-1',
        match_code: 'G-U16-QF-002',
        home_source_type: 'group_rank',
        home_source_ref: 'B:1',
        away_source_type: 'draw_selected',
        away_source_ref: 'G-U16-THIRD-DRAW-2',
        home_team_id: 'team-b1',
        away_team_id: null,
        sources_resolved_at: null,
        deleted_at: null,
      },
      ...groupResultMatches({ groupId: 'group-a', first: 'team-a1', second: 'team-a2', third: 'team-1' }),
      ...groupResultMatches({ groupId: 'group-b', first: 'team-b1', second: 'team-b2', third: 'team-2' }),
      ...groupResultMatches({ groupId: 'group-c', first: 'team-c1', second: 'team-c2', third: 'team-3' }),
    ],
    tournament_qualification_draws: overrides.existingDraw ? [overrides.existingDraw] : [],
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
  expected_active_draw_id: null,
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

  it('GET loads eligible candidate options and the active draw id for the page', async () => {
    state.client = createMockClient(buildDb());

    const response = await GET(makeGetRequest({ tournament_slug: 'cfyl-2026', category_code: 'G-U16' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.candidate_options).toHaveLength(3);
    expect(body.data.placeholder_source_refs).toEqual(['G-U16-THIRD-DRAW-1', 'G-U16-THIRD-DRAW-2']);
    expect(body.data.active_draw_id).toBeNull();
  });

  it('POST returns 403 for an unauthorized caller and does not write', async () => {
    authState.authorized = false;
    const db = buildDb();
    state.client = createMockClient(db);

    const response = await POST(makePostRequest(validBody));

    expect(response.status).toBe(403);
    expect(db.tournament_qualification_draws).toHaveLength(0);
  });

  it('POST preview does not write data and exposes the current active draw id', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const response = await POST(makePostRequest({ ...validBody, preview: true }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.preview).toBe(true);
    expect(body.data.active_draw_id).toBeNull();
    expect(body.data.affected_matches).toHaveLength(2);
    expect(db.tournament_qualification_draws).toHaveLength(0);
  });

  it('POST Save performs exactly one RPC write call and records exactly one audit log entry (no separate audit call)', async () => {
    const db = buildDb();
    const client = createMockClient(db);
    let rpcCallCount = 0;
    const originalRpc = client.rpc.bind(client);
    client.rpc = (fnName: string, args: Record<string, unknown>) => {
      rpcCallCount += 1;
      return originalRpc(fnName, args);
    };
    state.client = client;

    const response = await POST(makePostRequest(validBody));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(rpcCallCount).toBe(1);
    expect(db.tournament_qualification_draws).toHaveLength(1);
    expect(body.data.updated_match_ids.sort()).toEqual(['match-qf-1', 'match-qf-2']);

    const auditEntry = db.tournament_audit_logs.find(
      (log) => log.action === 'qualification-draws.confirm_manual_placeholder_assignment'
    );
    expect(auditEntry).toBeDefined();
    expect(auditEntry?.entity_id).toBe(body.data.draw_id);
    expect(db.tournament_audit_logs).toHaveLength(1);
  });

  it('route.ts does not import the audit service module (audit write lives only inside the RPC)', () => {
    const source = fs.readFileSync(path.join(__dirname, '../route.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"]@\/lib\/tournament\/services\/audit['"]/);
  });

  it('a stale initial Save (expected null, but an active draw already exists) returns HTTP 409 and makes zero writes', async () => {
    const existingDraw = {
      id: 'draw-existing',
      category_id: 'cat-1',
      qualification_slot: 'group_third_place',
      slots_available: 2,
      version: 1,
      drawn_by: 'admin-0',
      drawn_at: new Date().toISOString(),
      note: null,
      superseded_at: null,
    };
    const db = buildDb({ existingDraw });
    state.client = createMockClient(db);

    const response = await POST(makePostRequest(validBody)); // expected_active_draw_id: null, but draw-existing is active
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('QUALIFICATION_DRAW_STALE_STATE');
    expect(db.tournament_qualification_draws).toHaveLength(1); // unchanged — still just the seeded draw
  });

  it('a correction with the correct expected_active_draw_id succeeds; the wrong id returns 409', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const firstResponse = await POST(makePostRequest(validBody));
    const firstBody = await firstResponse.json();
    expect(firstResponse.status).toBe(200);

    const wrongIdResponse = await POST(
      makePostRequest({ ...validBody, expected_active_draw_id: 'not-the-real-draw-id' })
    );
    expect(wrongIdResponse.status).toBe(409);
    const wrongIdBody = await wrongIdResponse.json();
    expect(wrongIdBody.code).toBe('QUALIFICATION_DRAW_STALE_STATE');

    const correctionResponse = await POST(
      makePostRequest({
        ...validBody,
        selections: [
          { source_ref: 'G-U16-THIRD-DRAW-1', team_id: 'team-2' },
          { source_ref: 'G-U16-THIRD-DRAW-2', team_id: 'team-3' },
        ],
        expected_active_draw_id: firstBody.data.draw_id,
      })
    );
    expect(correctionResponse.status).toBe(200);
    const correctionBody = await correctionResponse.json();
    expect(correctionBody.data.version).toBe(2);
    expect(correctionBody.data.previous_draw_id).toBe(firstBody.data.draw_id);
  });

  it('requires candidate_team_ids before accepting selections', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const response = await POST(makePostRequest({ ...validBody, candidate_team_ids: [] }));

    expect(response.status).toBe(400);
    expect(db.tournament_qualification_draws).toHaveLength(0);
  });

  it('GET returns no candidates and the Thai incomplete message when Standings are not yet complete (no silent fallback to all teams)', async () => {
    const db = buildDb();
    // Remove group C's results — Standings can no longer compute a resolved
    // third place for every group, so the candidate pool must be empty, not
    // silently substituted with "all teams in category".
    db.tournament_matches = db.tournament_matches.filter((row) => !String(row.id).startsWith('group-c-'));
    state.client = createMockClient(db);

    const response = await GET(makeGetRequest({ tournament_slug: 'cfyl-2026', category_code: 'G-U16' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.candidate_options).toHaveLength(0);
    expect(body.data.candidates_incomplete_reason).toBe(
      'ยังไม่สามารถระบุทีมอันดับ 3 ได้ เนื่องจากผลการแข่งขันยังไม่ครบหรือยังไม่เผยแพร่'
    );
  });

  it('POST rejects a candidate_team_ids submission that does not match the Standings-computed eligible teams', async () => {
    const db = buildDb();
    // Substitute a team that is NOT the Standings-computed 3rd place of any
    // group (team-a1 finished 1st in group A, not eligible).
    state.client = createMockClient(db);

    const response = await POST(
      makePostRequest({ ...validBody, candidate_team_ids: ['team-a1', 'team-2', 'team-3'], preview: true })
    );

    expect(response.status).toBe(400);
  });
});

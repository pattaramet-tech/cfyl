import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mock Supabase-like query builder + .rpc() support, in the same style as
// the mock clients used across PR #7/#9/#10's route tests.
//
// IMPORTANT SCOPE NOTE: the RPC handler here is a JS stand-in that lets us
// assert the *contract* the app layer expects from
// tournament.publish_full_match_report() (inputs it sends, how it reacts to
// success/error/unavailable responses) — it does NOT prove the real SQL in
// scripts/tournament-v2/014-full-result-publish-transaction.sql actually
// behaves atomically. That would require applying the migration to an
// isolated, disposable Postgres instance, which was not done here (see the
// PR's final report). What these tests DO prove: the app layer performs
// exactly one mutating call (the RPC) for Official Publish, never falls
// back to sequential writes, and never reports success without a
// successful RPC response.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

function createMockClient(
  db: Db,
  rpcHandler?: (name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string; code?: string } | null }
) {
  function builder(table: string) {
    let mode: 'select' | 'update' = 'select';
    let patch: Row | null = null;
    const filters: Array<['eq' | 'is' | 'in', string, unknown]> = [];
    let orderCol: string | null = null;
    let orderAscending = true;
    let limitCount: number | null = null;

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
      let result = rows().filter(matches);
      if (orderCol) {
        result = [...result].sort((a, b) => {
          const av = String(a[orderCol as string] ?? '');
          const bv = String(b[orderCol as string] ?? '');
          return orderAscending ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (limitCount !== null) result = result.slice(0, limitCount);
      return { data: result, error: null };
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
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col;
        orderAscending = opts?.ascending !== false;
        return api;
      },
      limit(n: number) {
        limitCount = n;
        return api;
      },
      update(p: Row) {
        mode = 'update';
        patch = p;
        return api;
      },
      maybeSingle() {
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
    rpc(name: string, args: Record<string, unknown>) {
      if (!rpcHandler) {
        return Promise.resolve({ data: null, error: { message: 'no rpc handler configured', code: 'PGRST202' } });
      }
      return Promise.resolve(rpcHandler(name, args));
    },
  };
}

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createMockClient> | null }));
const authState = vi.hoisted(() => ({ authorized: true as boolean }));

vi.mock('@/lib/tournament/db/supabase-tournament', () => ({
  getTournamentServiceClient: () => state.client,
}));

vi.mock('@/lib/tournament/services/auth', () => ({
  requireTournamentResultOperator: async () => ({
    authenticated: true,
    authorized: authState.authorized,
    userId: 'operator-1',
    email: 'operator@test.com',
    error: authState.authorized ? undefined : 'Not authorized for result entry',
  }),
}));

import { POST } from '../route';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const TOURNAMENT_ID = 'tour-1';
const MATCH_ID = 'match-1';
const HOME = 'team-home';
const AWAY = 'team-away';
const VENUE_ID = 'venue-1';

function baseMatchRow(overrides: Row = {}): Row {
  return {
    id: MATCH_ID,
    tournament_id: TOURNAMENT_ID,
    category_id: 'cat-1',
    venue_id: VENUE_ID,
    court_id: 'court-1',
    match_code: 'M-001',
    match_no: 1,
    match_date: '2026-07-20',
    match_time: '10:00',
    home_team_id: HOME,
    away_team_id: AWAY,
    status: 'in_progress',
    result_workflow_status: 'not_started',
    schedule_status: 'published',
    result_type: 'normal',
    version: 3,
    deleted_at: null,
    ...overrides,
  };
}

function baseDb(matchOverrides: Row = {}): Db {
  return {
    tournaments: [{ id: TOURNAMENT_ID, slug: 'cfyl-2026', deleted_at: null }],
    tournament_matches: [baseMatchRow(matchOverrides)],
    tournament_players: [
      { id: 'player-home-1', tournament_id: TOURNAMENT_ID, category_id: 'cat-1', team_id: HOME, full_name: 'Home Scorer', deleted_at: null },
      { id: 'player-away-1', tournament_id: TOURNAMENT_ID, category_id: 'cat-1', team_id: AWAY, full_name: 'Away Scorer', deleted_at: null },
      { id: 'player-other-team', tournament_id: TOURNAMENT_ID, category_id: 'cat-1', team_id: 'team-elsewhere', full_name: 'Other Team Player', deleted_at: null },
      { id: 'player-other-tournament', tournament_id: 'tour-9', category_id: 'cat-1', team_id: HOME, full_name: 'Other Tournament Player', deleted_at: null },
      { id: 'player-other-category', tournament_id: TOURNAMENT_ID, category_id: 'cat-9', team_id: HOME, full_name: 'Other Category Player', deleted_at: null },
      { id: 'player-deleted', tournament_id: TOURNAMENT_ID, category_id: 'cat-1', team_id: HOME, full_name: 'Deleted Player', deleted_at: '2026-01-01T00:00:00Z' },
    ],
    tournament_result_submissions: [],
  };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    tournament_slug: 'cfyl-2026',
    venue_id: VENUE_ID,
    regulation_home_score: 2,
    regulation_away_score: 0,
    decided_by: 'regulation',
    winner_team_id: HOME,
    goals: [{ team_id: HOME, player_id: 'player-home-1', minute: 10, is_own_goal: false, goals: 1, note: null }],
    cards: [{ team_id: AWAY, player_id: 'player-away-1', card_type: 'yellow', minute: 55, note: null }],
    report_text: 'สรุปการแข่งขัน',
    ...overrides,
  };
}

function successRpcHandler(db: Db) {
  return (name: string, args: Record<string, unknown>) => {
    if (name !== 'publish_full_match_report') return { data: null, error: { message: 'unexpected rpc' } };
    const match = db.tournament_matches.find((m) => m.id === args.p_match_id);
    if (!match) return { data: null, error: { message: 'FULL_REPORT_MATCH_NOT_FOUND: not found' } };
    if (match.result_workflow_status === 'published') {
      return { data: null, error: { message: 'FULL_REPORT_ALREADY_PUBLISHED_USE_CORRECTION: already published' } };
    }
    if (match.version !== args.p_expected_version) {
      return { data: null, error: { message: 'FULL_REPORT_VERSION_CONFLICT: stale version' } };
    }
    const submissionId = `sub-${Math.random().toString(36).slice(2)}`;
    db.tournament_result_submissions.push({
      id: submissionId,
      match_id: args.p_match_id,
      stage: 'full_report',
      payload: args.p_payload,
      idempotency_key: args.p_idempotency_key,
      submitted_at: '2026-07-20T12:00:00.000Z',
    });
    match.version = (match.version as number) + 1;
    match.status = 'finished';
    match.result_workflow_status = 'published';
    match.regulation_home_score = args.p_regulation_home_score;
    match.regulation_away_score = args.p_regulation_away_score;
    match.winner_team_id = args.p_winner_team_id;
    return {
      data: { submission_id: submissionId, match_id: args.p_match_id, new_match_version: match.version, published_at: '2026-07-20T12:00:00.000Z', idempotent: false },
      error: null,
    };
  };
}

async function previewAndExtractToken(db: Db): Promise<string> {
  const response = await POST(makeRequest({ ...validBody(), preview: true }), { params: Promise.resolve({ matchId: MATCH_ID }) });
  const body = await response.json();
  expect(response.status).toBe(200);
  return body.data.preview_token as string;
}

describe('full-report route — auth', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    authState.authorized = true;
  });

  it('19. returns 403 for an unauthorized caller', async () => {
    authState.authorized = false;
    state.client = createMockClient(baseDb());
    const response = await POST(makeRequest({ ...validBody(), preview: true }), { params: Promise.resolve({ matchId: MATCH_ID }) });
    expect(response.status).toBe(403);
  });
});

describe('full-report route — eligibility', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    authState.authorized = true;
  });

  const cases: Array<{ label: string; overrides: Row; code: string }> = [
    { label: '12. deleted match', overrides: { deleted_at: '2026-01-01T00:00:00Z' }, code: 'FULL_REPORT_MATCH_DELETED' },
    { label: '13. cancelled match', overrides: { status: 'cancelled' }, code: 'FULL_REPORT_MATCH_STATUS_INELIGIBLE' },
    { label: '14. abandoned match', overrides: { status: 'abandoned' }, code: 'FULL_REPORT_MATCH_STATUS_INELIGIBLE' },
    { label: '15. BYE match', overrides: { status: 'bye' }, code: 'FULL_REPORT_MATCH_STATUS_INELIGIBLE' },
    { label: '16. unresolved home team', overrides: { home_team_id: null }, code: 'FULL_REPORT_HOME_TEAM_UNRESOLVED' },
    { label: '17. unresolved away team', overrides: { away_team_id: null }, code: 'FULL_REPORT_AWAY_TEAM_UNRESOLVED' },
    { label: '18. already published match', overrides: { result_workflow_status: 'published' }, code: 'FULL_REPORT_ALREADY_PUBLISHED_USE_CORRECTION' },
    { label: 'schedule not published', overrides: { schedule_status: 'draft' }, code: 'FULL_REPORT_SCHEDULE_NOT_PUBLISHED' },
  ];

  for (const testCase of cases) {
    it(testCase.label, async () => {
      state.client = createMockClient(baseDb(testCase.overrides));
      const response = await POST(makeRequest({ ...validBody(), preview: true }), { params: Promise.resolve({ matchId: MATCH_ID }) });
      const body = await response.json();
      expect(response.status).toBe(400);
      expect(body.code).toBe(testCase.code);
    });
  }

  it('20. rejects a preview scoped to the wrong venue', async () => {
    state.client = createMockClient(baseDb());
    const response = await POST(makeRequest({ ...validBody(), venue_id: 'venue-999', preview: true }), { params: Promise.resolve({ matchId: MATCH_ID }) });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('FULL_REPORT_VENUE_MISMATCH');
  });
});

describe('full-report route — result consistency (via preview)', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    authState.authorized = true;
  });

  it('rejects a regulation draw with no penalty decision', async () => {
    state.client = createMockClient(baseDb());
    const response = await POST(
      makeRequest({ ...validBody({ regulation_home_score: 1, regulation_away_score: 1, decided_by: 'regulation' }), preview: true }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    expect(response.status).toBe(400);
  });
});

describe('full-report route — player/team/goal/card validation', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    authState.authorized = true;
  });

  it('21. rejects a player from another tournament', async () => {
    state.client = createMockClient(baseDb());
    const response = await POST(
      makeRequest({ ...validBody({ goals: [{ team_id: HOME, player_id: 'player-other-tournament', minute: 1, goals: 1 }] }), preview: true }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('FULL_REPORT_GOAL_PLAYER_TOURNAMENT_MISMATCH');
  });

  it('22. rejects a player from another category', async () => {
    state.client = createMockClient(baseDb());
    const response = await POST(
      makeRequest({ ...validBody({ goals: [{ team_id: HOME, player_id: 'player-other-category', minute: 1, goals: 1 }] }), preview: true }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('FULL_REPORT_GOAL_PLAYER_CATEGORY_MISMATCH');
  });

  it('23. rejects a player from the non-selected match team', async () => {
    state.client = createMockClient(baseDb());
    const response = await POST(
      makeRequest({ ...validBody({ goals: [{ team_id: HOME, player_id: 'player-away-1', minute: 1, goals: 1 }] }), preview: true }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('FULL_REPORT_GOAL_PLAYER_TEAM_MISMATCH');
  });

  it('24. rejects a deleted player', async () => {
    state.client = createMockClient(baseDb());
    const response = await POST(
      makeRequest({ ...validBody({ cards: [{ team_id: HOME, player_id: 'player-deleted', card_type: 'yellow', minute: 5 }] }), preview: true }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('FULL_REPORT_CARD_PLAYER_DELETED');
  });

  it('25. rejects an invalid card type', async () => {
    state.client = createMockClient(baseDb());
    const response = await POST(
      makeRequest({ ...validBody({ cards: [{ team_id: HOME, player_id: 'player-home-1', card_type: 'orange', minute: 5 }] }), preview: true }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('FULL_REPORT_CARD_TYPE_INVALID');
  });

  it('26. rejects a duplicate card (same player, same card_type) before it ever reaches the DB constraint', async () => {
    state.client = createMockClient(baseDb());
    const response = await POST(
      makeRequest({
        ...validBody({
          cards: [
            { team_id: HOME, player_id: 'player-home-1', card_type: 'yellow', minute: 5 },
            { team_id: HOME, player_id: 'player-home-1', card_type: 'yellow', minute: 40 },
          ],
        }),
        preview: true,
      }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('FULL_REPORT_DUPLICATE_CARD');
  });

  it('27. penalty kicks are never included in the goal-events payload sent to the RPC', async () => {
    const db = baseDb();
    state.client = createMockClient(db);
    const response = await POST(
      makeRequest({
        ...validBody({ regulation_home_score: 1, regulation_away_score: 1, decided_by: 'penalty', penalty_home_score: 4, penalty_away_score: 2, winner_team_id: HOME }),
        preview: true,
      }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    // The only goal submitted was a regulation-play goal; nothing in the
    // preview response's goals array (which becomes the RPC's p_goals) ever
    // carries penalty fields.
    for (const goal of body.data.goals) {
      expect(goal).not.toHaveProperty('penalty_home_score');
      expect(goal).not.toHaveProperty('penalty_away_score');
    }
  });
});

describe('full-report route — Preview writes nothing', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    authState.authorized = true;
  });

  it('28. Preview performs no RPC call and leaves the match/submission tables untouched', async () => {
    const db = baseDb();
    let rpcCalled = false;
    state.client = createMockClient(db, () => {
      rpcCalled = true;
      return { data: null, error: null };
    });
    const response = await POST(makeRequest({ ...validBody(), preview: true }), { params: Promise.resolve({ matchId: MATCH_ID }) });
    expect(response.status).toBe(200);
    expect(rpcCalled).toBe(false);
    expect(db.tournament_result_submissions).toHaveLength(0);
    expect((db.tournament_matches[0] as Row).result_workflow_status).toBe('not_started');
  });
});

describe('full-report route — Publish safety (Preview Token, idempotency, version)', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    authState.authorized = true;
  });

  it('29. Publish without a Preview Token is rejected', async () => {
    const db = baseDb();
    state.client = createMockClient(db, successRpcHandler(db));
    const response = await POST(
      makeRequest({ ...validBody(), expected_version: 3, idempotency_key: 'idem-1' }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('FULL_REPORT_PREVIEW_REQUIRED');
  });

  it('30. A valid Preview Token allows Publish to succeed via the RPC', async () => {
    const db = baseDb();
    state.client = createMockClient(db, successRpcHandler(db));
    const previewToken = await previewAndExtractToken(db);

    const response = await POST(
      makeRequest({ ...validBody(), expected_version: 3, idempotency_key: 'idem-1', preview_token: previewToken }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.idempotent).toBe(false);
    expect((db.tournament_matches[0] as Row).result_workflow_status).toBe('published');
    expect((db.tournament_matches[0] as Row).status).toBe('finished');
  });

  it('31. A tampered Preview Token is rejected', async () => {
    const db = baseDb();
    state.client = createMockClient(db, successRpcHandler(db));
    const previewToken = await previewAndExtractToken(db);
    const [payload, signature] = previewToken.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    decoded.expectedMatchVersion = 999;
    const tamperedToken = `${Buffer.from(JSON.stringify(decoded), 'utf-8').toString('base64url')}.${signature}`;

    const response = await POST(
      makeRequest({ ...validBody(), expected_version: 3, idempotency_key: 'idem-2', preview_token: tamperedToken }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('FULL_REPORT_PREVIEW_INVALID');
  });

  it('32. An expired Preview Token is rejected', async () => {
    vi.useFakeTimers();
    try {
      const db = baseDb();
      state.client = createMockClient(db, successRpcHandler(db));
      const previewToken = await previewAndExtractToken(db);
      vi.advanceTimersByTime(16 * 60 * 1000);

      const response = await POST(
        makeRequest({ ...validBody(), expected_version: 3, idempotency_key: 'idem-3', preview_token: previewToken }),
        { params: Promise.resolve({ matchId: MATCH_ID }) }
      );
      const body = await response.json();
      expect(response.status).toBe(400);
      expect(body.code).toBe('FULL_REPORT_PREVIEW_EXPIRED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('33. Editing the payload after Preview is rejected (score changed)', async () => {
    const db = baseDb();
    state.client = createMockClient(db, successRpcHandler(db));
    const previewToken = await previewAndExtractToken(db);

    const response = await POST(
      makeRequest({ ...validBody({ regulation_home_score: 5 }), expected_version: 3, idempotency_key: 'idem-4', preview_token: previewToken }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('FULL_REPORT_PREVIEW_MISMATCH');
  });

  it('35. A stale match version returns 409', async () => {
    const db = baseDb();
    state.client = createMockClient(db, successRpcHandler(db));
    const previewToken = await previewAndExtractToken(db);
    // Simulate a concurrent edit bumping the match version between Preview and Publish.
    (db.tournament_matches[0] as Row).version = 4;

    const response = await POST(
      makeRequest({ ...validBody(), expected_version: 3, idempotency_key: 'idem-6', preview_token: previewToken }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.code).toBe('FULL_REPORT_VERSION_CONFLICT');
  });

  it('36. Same idempotency key + same payload returns the stored successful result without a second write', async () => {
    const db = baseDb();
    state.client = createMockClient(db, successRpcHandler(db));
    const previewToken = await previewAndExtractToken(db);
    const first = await POST(
      makeRequest({ ...validBody(), expected_version: 3, idempotency_key: 'idem-7', preview_token: previewToken }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    expect(first.status).toBe(200);
    expect(db.tournament_result_submissions).toHaveLength(1);

    // Retry with the same key/payload — no preview token required this time.
    const second = await POST(
      makeRequest({ ...validBody(), expected_version: 3, idempotency_key: 'idem-7' }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const secondBody = await second.json();
    expect(second.status).toBe(200);
    expect(secondBody.data.idempotent).toBe(true);
    expect(db.tournament_result_submissions).toHaveLength(1);
  });

  it('37. Same idempotency key + different payload is rejected', async () => {
    const db = baseDb();
    state.client = createMockClient(db, successRpcHandler(db));
    const previewToken = await previewAndExtractToken(db);
    await POST(
      makeRequest({ ...validBody(), expected_version: 3, idempotency_key: 'idem-8', preview_token: previewToken }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );

    const response = await POST(
      makeRequest({ ...validBody({ regulation_home_score: 9 }), expected_version: 3, idempotency_key: 'idem-8' }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('FULL_REPORT_IDEMPOTENCY_PAYLOAD_MISMATCH');
  });

  it('66. Publish cannot overwrite an already-published match through this route', async () => {
    const db = baseDb({ result_workflow_status: 'published', status: 'finished' });
    state.client = createMockClient(db, successRpcHandler(db));
    const response = await POST(
      makeRequest({ ...validBody(), expected_version: 3, idempotency_key: 'idem-9' }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('FULL_REPORT_ALREADY_PUBLISHED_USE_CORRECTION');
  });
});

describe('full-report route — RPC unavailable (fail closed, no fallback)', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    authState.authorized = true;
  });

  it('fails closed with FULL_REPORT_PUBLISH_RPC_UNAVAILABLE (503) when Migration 014 is not applied, and writes nothing', async () => {
    const db = baseDb();
    state.client = createMockClient(db, () => ({ data: null, error: { message: 'Could not find the function tournament.publish_full_match_report', code: 'PGRST202' } }));
    const previewToken = await previewAndExtractToken(db);

    const response = await POST(
      makeRequest({ ...validBody(), expected_version: 3, idempotency_key: 'idem-unavail', preview_token: previewToken }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.code).toBe('FULL_REPORT_PUBLISH_RPC_UNAVAILABLE');
    expect(db.tournament_result_submissions).toHaveLength(0);
    expect((db.tournament_matches[0] as Row).result_workflow_status).toBe('not_started');
  });
});

describe('full-report route — RPC-reported failure never reports success', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    authState.authorized = true;
  });

  it('45. when the RPC reports an internal failure, the match remains unpublished and no app-layer fallback write occurs', async () => {
    const db = baseDb();
    state.client = createMockClient(db, () => ({ data: null, error: { message: 'FULL_REPORT_RESULT_INCONSISTENT: simulated goal-insert failure inside the transaction' } }));
    const previewToken = await previewAndExtractToken(db);

    const response = await POST(
      makeRequest({ ...validBody(), expected_version: 3, idempotency_key: 'idem-fail', preview_token: previewToken }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    expect(response.status).toBe(400);
    expect(db.tournament_result_submissions).toHaveLength(0);
    expect((db.tournament_matches[0] as Row).result_workflow_status).toBe('not_started');
    expect((db.tournament_matches[0] as Row).status).not.toBe('finished');
  });
});

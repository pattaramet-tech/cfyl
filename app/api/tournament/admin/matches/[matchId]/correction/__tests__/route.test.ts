import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { createMockCorrectRpc, type Db, type Row } from '@/lib/tournament/services/__tests__/mockCorrectRpc';

// IMPORTANT SCOPE NOTE: the RPC handler here (createMockCorrectRpc) is a JS
// stand-in for tournament.correct_published_match_result() (Migration 018),
// which has not been applied to any environment yet — see mockCorrectRpc.ts
// for the "proves the contract, not live Postgres" caveat.

function createMockClient(
  db: Db,
  rpcHandler?: (name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string; code?: string } | null }
) {
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
      maybeSingle() {
        const result = rows().filter(matches);
        return Promise.resolve({ data: result.length ? result[0] : null, error: null });
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

// Only requireTournamentSuperAdmin is mocked — proves (together with the
// isolation test's source-grep) that this route uses the strict Super Admin
// gate, not requireTournamentResultOperator. A result_operator-only caller
// is represented by authState.authorized=false, since the real
// requireTournamentSuperAdmin would reject them the same way.
vi.mock('@/lib/tournament/services/auth', () => ({
  requireTournamentSuperAdmin: async () => ({
    authenticated: true,
    authorized: authState.authorized,
    userId: 'super-1',
    email: 'super1@test.com',
    error: authState.authorized ? undefined : 'User does not have tournament_super_admin role',
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

function baseMatchRow(overrides: Row = {}): Row {
  return {
    id: MATCH_ID,
    tournament_id: TOURNAMENT_ID,
    category_id: 'cat-1',
    match_code: 'M-001',
    home_team_id: HOME,
    away_team_id: AWAY,
    status: 'finished',
    result_workflow_status: 'published',
    schedule_status: 'published',
    regulation_home_score: 2,
    regulation_away_score: 0,
    penalty_home_score: null,
    penalty_away_score: null,
    decided_by: 'regulation',
    winner_team_id: HOME,
    result_type: 'normal',
    version: 5,
    deleted_at: null,
    ...overrides,
  };
}

function baseDb(matchOverrides: Row = {}): Db {
  return {
    tournaments: [{ id: TOURNAMENT_ID, slug: 'cfyl-2026', deleted_at: null }],
    tournament_matches: [baseMatchRow(matchOverrides)],
    tournament_result_submissions: [],
  };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    tournament_slug: 'cfyl-2026',
    regulation_home_score: 3,
    regulation_away_score: 0,
    decided_by: 'regulation',
    winner_team_id: HOME,
    correction_reason: 'สกอร์บันทึกผิด แก้ไขตามใบบันทึกสนาม',
    ...overrides,
  };
}

async function previewAndExtractToken(): Promise<{ token: string; version: number }> {
  const response = await POST(makeRequest({ ...validBody(), preview: true }), { params: Promise.resolve({ matchId: MATCH_ID }) });
  const body = await response.json();
  expect(response.status).toBe(200);
  return { token: body.data.preview_token as string, version: body.data.current_version as number };
}

describe('correction route — auth', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    authState.authorized = true;
  });

  it('24. returns 403 for an unauthorized caller (e.g. the Dedicated Shared Result-entry Account, which is never tournament_super_admin)', async () => {
    authState.authorized = false;
    state.client = createMockClient(baseDb());
    const response = await POST(makeRequest({ ...validBody(), preview: true }), { params: Promise.resolve({ matchId: MATCH_ID }) });
    expect(response.status).toBe(403);
  });
});

describe('correction route — eligibility', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    authState.authorized = true;
  });

  const cases: Array<{ label: string; overrides: Row; code: string }> = [
    { label: 'deleted match', overrides: { deleted_at: '2026-01-01T00:00:00Z' }, code: 'RESULT_CORRECTION_MATCH_DELETED' },
    { label: 'unresolved home team', overrides: { home_team_id: null }, code: 'RESULT_CORRECTION_HOME_TEAM_UNRESOLVED' },
    { label: 'unresolved away team', overrides: { away_team_id: null }, code: 'RESULT_CORRECTION_AWAY_TEAM_UNRESOLVED' },
    { label: '9. not-yet-published match', overrides: { result_workflow_status: 'not_started', status: 'in_progress' }, code: 'RESULT_CORRECTION_NOT_PUBLISHED' },
    { label: 'schedule not published', overrides: { schedule_status: 'draft' }, code: 'RESULT_CORRECTION_SCHEDULE_NOT_PUBLISHED' },
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
});

describe('correction route — reason and no-change guards', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    authState.authorized = true;
  });

  it('4. rejects a Preview with an empty correction reason', async () => {
    state.client = createMockClient(baseDb());
    const response = await POST(makeRequest({ ...validBody({ correction_reason: '   ' }), preview: true }), { params: Promise.resolve({ matchId: MATCH_ID }) });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('RESULT_CORRECTION_REASON_REQUIRED');
  });

  it('5. rejects a Preview whose corrected result is identical to the current official result', async () => {
    state.client = createMockClient(baseDb());
    const response = await POST(
      makeRequest({ ...validBody({ regulation_home_score: 2, regulation_away_score: 0, winner_team_id: HOME }), preview: true }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('RESULT_CORRECTION_NO_CHANGES');
  });

  it('6. rejects an invalid winner_team_id', async () => {
    state.client = createMockClient(baseDb());
    const response = await POST(makeRequest({ ...validBody({ winner_team_id: 'team-elsewhere' }), preview: true }), { params: Promise.resolve({ matchId: MATCH_ID }) });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('WINNER_TEAM_INVALID');
  });

  it('7. rejects a tied regulation score without a penalty decision', async () => {
    state.client = createMockClient(baseDb());
    const response = await POST(
      makeRequest({ ...validBody({ regulation_home_score: 1, regulation_away_score: 1 }), preview: true }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    expect(response.status).toBe(400);
  });

  it('8. rejects a negative regulation score', async () => {
    state.client = createMockClient(baseDb());
    const response = await POST(makeRequest({ ...validBody({ regulation_home_score: -1 }), preview: true }), { params: Promise.resolve({ matchId: MATCH_ID }) });
    expect(response.status).toBe(400);
  });
});

describe('correction route — Preview writes nothing', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    authState.authorized = true;
  });

  it('1. Preview performs no RPC call and leaves the match/submission tables untouched', async () => {
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
    expect((db.tournament_matches[0] as Row).regulation_home_score).toBe(2);
  });

  it('preview response includes the before/after comparison', async () => {
    const db = baseDb();
    state.client = createMockClient(db);
    const response = await POST(makeRequest({ ...validBody(), preview: true }), { params: Promise.resolve({ matchId: MATCH_ID }) });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.before_result.regulation_home_score).toBe(2);
    expect(body.data.after_result.regulation_home_score).toBe(3);
  });
});

describe('correction route — Publish safety (Preview Token, idempotency, version)', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    authState.authorized = true;
  });

  it('Publish without a Preview Token is rejected', async () => {
    const db = baseDb();
    state.client = createMockClient(db, createMockCorrectRpc(db));
    const response = await POST(
      makeRequest({ ...validBody(), expected_version: 5, idempotency_key: 'idem-1' }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('RESULT_CORRECTION_PREVIEW_REQUIRED');
  });

  it('2. A valid Preview Token allows the correction to succeed via the RPC', async () => {
    const db = baseDb();
    state.client = createMockClient(db, createMockCorrectRpc(db));
    const { token, version } = await previewAndExtractToken();

    const response = await POST(
      makeRequest({ ...validBody(), expected_version: version, idempotency_key: 'idem-1', preview_token: token }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.idempotent).toBe(false);
    expect((db.tournament_matches[0] as Row).regulation_home_score).toBe(3);
    // Correction never touches result_workflow_status/status.
    expect((db.tournament_matches[0] as Row).result_workflow_status).toBe('published');
    expect((db.tournament_matches[0] as Row).status).toBe('finished');
  });

  it('A tampered Preview Token is rejected', async () => {
    const db = baseDb();
    state.client = createMockClient(db, createMockCorrectRpc(db));
    const { token, version } = await previewAndExtractToken();
    const [payload, signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    decoded.expectedMatchVersion = 999;
    const tamperedToken = `${Buffer.from(JSON.stringify(decoded), 'utf-8').toString('base64url')}.${signature}`;

    const response = await POST(
      makeRequest({ ...validBody(), expected_version: version, idempotency_key: 'idem-2', preview_token: tamperedToken }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('RESULT_CORRECTION_PREVIEW_INVALID');
  });

  it('An expired Preview Token is rejected', async () => {
    vi.useFakeTimers();
    try {
      const db = baseDb();
      state.client = createMockClient(db, createMockCorrectRpc(db));
      const { token, version } = await previewAndExtractToken();
      vi.advanceTimersByTime(16 * 60 * 1000);

      const response = await POST(
        makeRequest({ ...validBody(), expected_version: version, idempotency_key: 'idem-3', preview_token: token }),
        { params: Promise.resolve({ matchId: MATCH_ID }) }
      );
      const body = await response.json();
      expect(response.status).toBe(400);
      expect(body.code).toBe('RESULT_CORRECTION_PREVIEW_EXPIRED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Editing the score after Preview is rejected', async () => {
    const db = baseDb();
    state.client = createMockClient(db, createMockCorrectRpc(db));
    const { token, version } = await previewAndExtractToken();

    const response = await POST(
      makeRequest({ ...validBody({ regulation_home_score: 9 }), expected_version: version, idempotency_key: 'idem-4', preview_token: token }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('RESULT_CORRECTION_PREVIEW_MISMATCH');
  });

  it('11. A stale match version returns 409', async () => {
    const db = baseDb();
    state.client = createMockClient(db, createMockCorrectRpc(db));
    const { token, version } = await previewAndExtractToken();
    (db.tournament_matches[0] as Row).version = version + 1;

    const response = await POST(
      makeRequest({ ...validBody(), expected_version: version, idempotency_key: 'idem-6', preview_token: token }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.code).toBe('RESULT_CORRECTION_VERSION_CONFLICT');
  });

  it('12. Same idempotency key + same payload returns the stored successful result without a second write', async () => {
    const db = baseDb();
    state.client = createMockClient(db, createMockCorrectRpc(db));
    const { token, version } = await previewAndExtractToken();
    const first = await POST(
      makeRequest({ ...validBody(), expected_version: version, idempotency_key: 'idem-7', preview_token: token }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    expect(first.status).toBe(200);
    expect(db.tournament_result_submissions).toHaveLength(1);

    const second = await POST(
      makeRequest({ ...validBody(), expected_version: version, idempotency_key: 'idem-7' }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const secondBody = await second.json();
    expect(second.status).toBe(200);
    expect(secondBody.data.idempotent).toBe(true);
    expect(db.tournament_result_submissions).toHaveLength(1);
  });

  it('13. Same idempotency key + different payload is rejected', async () => {
    const db = baseDb();
    state.client = createMockClient(db, createMockCorrectRpc(db));
    const { token, version } = await previewAndExtractToken();
    await POST(
      makeRequest({ ...validBody(), expected_version: version, idempotency_key: 'idem-8', preview_token: token }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );

    const response = await POST(
      makeRequest({ ...validBody({ regulation_home_score: 9 }), expected_version: version, idempotency_key: 'idem-8' }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('RESULT_CORRECTION_IDEMPOTENCY_PAYLOAD_MISMATCH');
  });
});

describe('correction route — RPC unavailable (fail closed, no fallback)', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    authState.authorized = true;
  });

  it('fails closed with RESULT_CORRECTION_RPC_UNAVAILABLE (503) when Migration 018 is not applied, and writes nothing', async () => {
    const db = baseDb();
    state.client = createMockClient(db, () => ({ data: null, error: { message: 'Could not find the function tournament.correct_published_match_result', code: 'PGRST202' } }));
    const { token, version } = await previewAndExtractToken();

    const response = await POST(
      makeRequest({ ...validBody(), expected_version: version, idempotency_key: 'idem-unavail', preview_token: token }),
      { params: Promise.resolve({ matchId: MATCH_ID }) }
    );
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.code).toBe('RESULT_CORRECTION_RPC_UNAVAILABLE');
    expect(db.tournament_result_submissions).toHaveLength(0);
    expect((db.tournament_matches[0] as Row).regulation_home_score).toBe(2);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { NextRequest } from 'next/server';
import {
  mockSubmitQuickResultRpc,
  type RpcFailureInjection,
} from '../../../../../../../../lib/tournament/services/__tests__/mockSubmitQuickResultRpc';

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
      then(resolve: (value: { data: Row[]; error: unknown }) => unknown, reject?: (reason: unknown) => unknown) {
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
      if (fnName !== 'submit_quick_result') {
        return Promise.resolve({ data: null, error: { message: `mock client: unknown rpc "${fnName}"` } });
      }
      const result = mockSubmitQuickResultRpc(db, args as never, options.injection);
      return Promise.resolve(result);
    },
  };
}

const state = vi.hoisted(() => ({
  client: null as ReturnType<typeof createMockClient> | null,
}));
const authState = vi.hoisted(() => ({ authorized: true as boolean, userId: 'operator-1' as string }));

vi.mock('@/lib/tournament/db/supabase-tournament', () => ({
  getTournamentServiceClient: () => state.client,
}));

vi.mock('@/lib/tournament/services/auth', () => ({
  requireTournamentResultOperator: async () => ({
    authenticated: true,
    authorized: authState.authorized,
    userId: authState.userId,
    email: 'operator@test.com',
    error: authState.authorized ? undefined : 'Not authorized',
  }),
}));

import { POST } from '../route';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function makeParams(matchId: string) {
  return { params: Promise.resolve({ matchId }) };
}

function buildDb(matchOverrides: Row = {}): Db {
  return {
    tournaments: [{ id: 'tour-1', slug: 'cfyl-2026', deleted_at: null }],
    tournament_matches: [
      {
        id: 'match-1',
        tournament_id: 'tour-1',
        category_id: 'cat-1',
        venue_id: 'venue-1',
        court_id: 'court-1',
        match_code: 'B-U12-GA-001',
        match_no: 1,
        match_date: '2026-08-01',
        match_time: '08:30',
        home_team_id: 'team-a',
        away_team_id: 'team-b',
        status: 'scheduled',
        result_workflow_status: 'not_started',
        result_type: 'normal',
        version: 3,
        deleted_at: null,
        ...matchOverrides,
      },
    ],
    tournament_teams: [
      { id: 'team-a', name: 'Home School' },
      { id: 'team-b', name: 'Away School' },
    ],
    tournament_venues: [{ id: 'venue-1', name: 'Field 1' }],
    tournament_courts: [{ id: 'court-1', name: 'Court 1' }],
    tournament_categories: [{ id: 'cat-1', code: 'B-U12', name: 'Boys U12' }],
    tournament_result_submissions: [],
    tournament_result_versions: [],
    tournament_audit_logs: [],
  };
}

const previewBody = {
  tournament_slug: 'cfyl-2026',
  venue_id: 'venue-1',
  home_score: 2,
  away_score: 1,
  preview: true,
};

function submitBodyWithToken(previewToken: string, overrides: Record<string, unknown> = {}) {
  return {
    tournament_slug: 'cfyl-2026',
    venue_id: 'venue-1',
    home_score: 2,
    away_score: 1,
    expected_version: 3,
    idempotency_key: 'idem-key-1',
    preview_token: previewToken,
    session_id: 'session-abc',
    device_metadata: { user_agent: 'test-agent', platform: 'test' },
    ...overrides,
  };
}

async function getPreviewToken(matchId = 'match-1', body: Record<string, unknown> = previewBody): Promise<string> {
  const response = await POST(makeRequest(body), makeParams(matchId));
  const payload = await response.json();
  if (response.status !== 200) throw new Error(`preview failed: ${JSON.stringify(payload)}`);
  return payload.data.preview_token as string;
}

describe('POST /api/tournament/admin/matches/[matchId]/quick-result', () => {
  beforeEach(() => {
    state.client = null;
    authState.authorized = true;
    authState.userId = 'operator-1';
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
  });

  it('returns 403 for an unauthorized caller', async () => {
    authState.authorized = false;
    const db = buildDb();
    state.client = createMockClient(db);

    const response = await POST(makeRequest(submitBodyWithToken('irrelevant')), makeParams('match-1'));

    expect(response.status).toBe(403);
    expect(db.tournament_result_submissions).toHaveLength(0);
  });

  it('preview writes no final submission and returns a signed preview token', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const response = await POST(makeRequest(previewBody), makeParams('match-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.preview).toBe(true);
    expect(body.data.home_team_name).toBe('Home School');
    expect(body.data.preview_token).toEqual(expect.any(String));
    expect(body.data.preview_expires_at).toEqual(expect.any(String));
    expect(db.tournament_result_submissions).toHaveLength(0);
    expect(db.tournament_audit_logs).toHaveLength(0);
    expect(db.tournament_matches[0].version).toBe(3);
  });

  it('submit without a preview token is rejected (409 QUICK_RESULT_PREVIEW_REQUIRED)', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const response = await POST(makeRequest(submitBodyWithToken('')), makeParams('match-1'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('QUICK_RESULT_PREVIEW_REQUIRED');
    expect(db.tournament_result_submissions).toHaveLength(0);
    expect(db.tournament_matches[0].version).toBe(3);
  });

  it('valid preview followed by submit with the token succeeds, remains provisional, and performs exactly one RPC write with no separate audit call', async () => {
    const db = buildDb();
    const client = createMockClient(db);
    let rpcCallCount = 0;
    const originalRpc = client.rpc.bind(client);
    client.rpc = (fnName: string, args: Record<string, unknown>) => {
      rpcCallCount += 1;
      return originalRpc(fnName, args);
    };
    state.client = client;

    const token = await getPreviewToken();
    const submitResponse = await POST(makeRequest(submitBodyWithToken(token)), makeParams('match-1'));
    const submitPayload = await submitResponse.json();

    expect(submitResponse.status).toBe(200);
    expect(submitPayload.data.provisional).toBe(true);
    expect(submitPayload.data.status).toBe('submitted');
    expect(db.tournament_matches[0].result_workflow_status).toBe('not_started');
    // Preview itself doesn't call the RPC — only Submit does, exactly once.
    expect(rpcCallCount).toBe(1);

    const auditEntries = db.tournament_audit_logs.filter((log) => log.action === 'tournament.quick_result.submit');
    expect(auditEntries).toHaveLength(1);
  });

  it('route.ts does not import the audit service module (audit write lives only inside the RPC)', () => {
    const source = fs.readFileSync(path.join(__dirname, '../route.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"]@\/lib\/tournament\/services\/audit['"]/);
  });

  it('rejects a tampered preview token', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const token = await getPreviewToken();
    const [payload] = token.split('.');
    const tampered = `${payload}.tamperedsignature`;

    const response = await POST(makeRequest(submitBodyWithToken(tampered)), makeParams('match-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('QUICK_RESULT_PREVIEW_INVALID');
    expect(db.tournament_result_submissions).toHaveLength(0);
  });

  it('rejects a preview token issued for a different match', async () => {
    const db = buildDb();
    db.tournament_matches.push({ ...db.tournament_matches[0], id: 'match-2', match_code: 'B-U12-GA-002' });
    state.client = createMockClient(db);

    const tokenForMatch2 = await getPreviewToken('match-2');
    const response = await POST(makeRequest(submitBodyWithToken(tokenForMatch2)), makeParams('match-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('QUICK_RESULT_PREVIEW_MISMATCH');
  });

  it('rejects a preview token issued for a different venue', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const token = await getPreviewToken('match-1', { ...previewBody, venue_id: 'venue-1' });
    const response = await POST(
      makeRequest(submitBodyWithToken(token, { venue_id: 'venue-OTHER' })),
      makeParams('match-1')
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('QUICK_RESULT_PREVIEW_MISMATCH');
  });

  it('rejects a home-score edit made after preview', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const token = await getPreviewToken();
    const response = await POST(makeRequest(submitBodyWithToken(token, { home_score: 9 })), makeParams('match-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('QUICK_RESULT_PREVIEW_MISMATCH');
  });

  it('rejects an unauthorized actor using another actor’s preview token', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const token = await getPreviewToken();
    authState.userId = 'operator-INTRUDER';
    const response = await POST(makeRequest(submitBodyWithToken(token)), makeParams('match-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('QUICK_RESULT_PREVIEW_MISMATCH');
    expect(db.tournament_result_submissions).toHaveLength(0);
  });

  it('returns the stored result for a duplicate idempotency key with the same payload', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const token = await getPreviewToken();
    await POST(makeRequest(submitBodyWithToken(token)), makeParams('match-1'));
    const second = await POST(makeRequest(submitBodyWithToken(token)), makeParams('match-1'));
    const secondBody = await second.json();

    expect(second.status).toBe(200);
    expect(secondBody.data.idempotent).toBe(true);
    expect(db.tournament_result_submissions).toHaveLength(1);
    expect(db.tournament_audit_logs).toHaveLength(1);
  });

  it('rejects a duplicate idempotency key used with a different payload', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const token = await getPreviewToken();
    await POST(makeRequest(submitBodyWithToken(token)), makeParams('match-1'));
    const response = await POST(makeRequest(submitBodyWithToken(token, { home_score: 9 })), makeParams('match-1'));

    expect(response.status).toBe(400);
    expect(db.tournament_result_submissions).toHaveLength(1);
  });

  it('returns 409 for a stale match version even with a structurally valid token', async () => {
    const db = buildDb();
    state.client = createMockClient(db);
    const token = await getPreviewToken();
    db.tournament_matches[0].version = 7; // changed after Preview

    const response = await POST(makeRequest(submitBodyWithToken(token)), makeParams('match-1'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('QUICK_RESULT_VERSION_CONFLICT');
    expect(db.tournament_result_submissions).toHaveLength(0);
  });

  it('allows only one successful writer for concurrent submissions', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const token = await getPreviewToken();
    const first = await POST(makeRequest(submitBodyWithToken(token, { idempotency_key: 'key-A' })), makeParams('match-1'));
    const second = await POST(makeRequest(submitBodyWithToken(token, { idempotency_key: 'key-B' })), makeParams('match-1'));

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(db.tournament_result_submissions).toHaveLength(1);
  });

  it('records audit entry with actor, session, and device metadata, written inside the RPC', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const token = await getPreviewToken();
    await POST(makeRequest(submitBodyWithToken(token)), makeParams('match-1'));

    const entry = db.tournament_audit_logs.find((log) => log.action === 'tournament.quick_result.submit');
    expect(entry).toBeDefined();
    expect(entry?.admin_id).toBe('operator-1');
    expect(entry?.admin_email).toBe('operator@test.com');
    const newData = entry?.new_data as Row;
    expect(newData.session_id).toBe('session-abc');
    expect(newData.device_metadata).toMatchObject({ user_agent: 'test-agent' });
    expect(newData.idempotency_key).toBe('idem-key-1');
  });

  it('a submission-insert failure inside the RPC rolls back the Match version and leaves zero writes', async () => {
    const db = buildDb();
    const client = createMockClient(db, { injection: { failAt: 'submission' } });
    state.client = client;

    const token = await getPreviewToken();
    const response = await POST(makeRequest(submitBodyWithToken(token)), makeParams('match-1'));

    expect(response.status).toBe(500);
    expect(db.tournament_matches[0].version).toBe(3);
    expect(db.tournament_result_submissions).toHaveLength(0);
    expect(db.tournament_audit_logs).toHaveLength(0);
  });

  it('blocks submission when a placeholder side is unresolved', async () => {
    const db = buildDb({ away_team_id: null });
    state.client = createMockClient(db);

    // Preview itself is blocked too — an unresolved placeholder is
    // ineligible from the start, so there is no token to obtain.
    const previewResponse = await POST(makeRequest(previewBody), makeParams('match-1'));
    const previewPayload = await previewResponse.json();
    expect(previewResponse.status).toBe(400);
    expect(previewPayload.code).toBe('AWAY_TEAM_UNRESOLVED');
  });

  it('rejects a wrong venue for the match at submit time', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const token = await getPreviewToken();
    const response = await POST(
      makeRequest(submitBodyWithToken(token, { venue_id: 'venue-OTHER' })),
      makeParams('match-1')
    );
    expect(response.status).toBe(400);
  });

  it('does not set result_workflow_status to published and does not create scorer/card records', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const token = await getPreviewToken();
    await POST(makeRequest(submitBodyWithToken(token)), makeParams('match-1'));

    expect(db.tournament_matches[0].result_workflow_status).not.toBe('published');
    expect(db.tournament_match_goals).toBeUndefined();
    expect(db.tournament_match_cards).toBeUndefined();
    expect(db.tournament_suspension_events).toBeUndefined();
  });
});

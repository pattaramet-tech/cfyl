import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { mockRollbackRpc } from './mockRollbackRpc';

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

function createMockClient(db: Db) {
  return {
    rpc(name: string, params: { p_batch_id: string; p_actor_id: string | null }) {
      if (name !== 'rollback_schedule_import_batch') {
        throw new Error(`unexpected rpc: ${name}`);
      }
      return Promise.resolve(mockRollbackRpc(db, params.p_batch_id, params.p_actor_id));
    },
  };
}

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createMockClient> | null }));

vi.mock('@/lib/tournament/db/supabase-tournament', () => ({
  getTournamentServiceClient: () => state.client,
}));

const authState = vi.hoisted(() => ({ authorized: true as boolean }));

vi.mock('@/lib/tournament/services/auth', () => ({
  requireTournamentSuperAdmin: async () => ({
    authenticated: true,
    authorized: authState.authorized,
    userId: 'admin-1',
    email: 'admin@test.com',
    error: authState.authorized ? undefined : 'Not a tournament_super_admin',
  }),
}));

import { POST } from '../route';

function makeRequest(): NextRequest {
  return {} as unknown as NextRequest;
}

function makeParams(batchId: string) {
  return { params: Promise.resolve({ batchId }) };
}

function baseMatch(overrides: Row = {}): Row {
  return {
    id: 'match-1',
    tournament_id: 'tour-1',
    match_code: 'B-U12-GA-001',
    category_id: 'cat-1',
    group_id: 'group-1',
    venue_id: 'venue-1',
    court_id: 'court-1',
    match_date: '2026-08-01',
    match_time: '08:00',
    match_no: 1,
    stage: 'group',
    home_source_type: 'group_slot',
    home_source_ref: 'A-S1',
    away_source_type: 'group_slot',
    away_source_ref: 'A-S2',
    home_team_id: null,
    away_team_id: null,
    sources_resolved_at: null,
    result_policy: 'single_step',
    result_type: 'normal',
    status: 'scheduled',
    result_workflow_status: 'not_started',
    regulation_home_score: null,
    regulation_away_score: null,
    note: null,
    schedule_batch_id: 'batch-1',
    schedule_status: 'validated',
    version: 1,
    updated_at: '2026-08-01T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

function buildDb(overrides: { batchStatus?: string; matches?: Row[]; rows?: Row[] } = {}): Db {
  return {
    tournament_schedule_batches: [
      {
        id: 'batch-1',
        tournament_id: 'tour-1',
        file_name: 'test.xlsx',
        status: overrides.batchStatus || 'saved',
        save_result: { created: 1, updated: 0, unchanged: 0, skipped: 0, failed: 0, revisionsConfirmed: 0, failures: [] },
      },
    ],
    tournament_schedule_import_rows:
      overrides.rows || [
        {
          id: 'row-1',
          batch_id: 'batch-1',
          row_no: 2,
          match_code: 'B-U12-GA-001',
          action: 'create',
          matched_match_id: 'match-1',
          before_payload: null,
          applied_match_version: 1,
          applied_match_updated_at: '2026-08-01T00:00:00.000Z',
        },
      ],
    tournament_matches: overrides.matches || [baseMatch()],
    tournament_audit_logs: [],
  };
}

describe('POST /api/tournament/admin/schedule/import/batches/[batchId]/rollback', () => {
  beforeEach(() => {
    state.client = null;
    authState.authorized = true;
  });

  it('rejects an unauthorized caller', async () => {
    authState.authorized = false;
    const db = buildDb();
    state.client = createMockClient(db);

    const response = await POST(makeRequest(), makeParams('batch-1'));

    expect(response.status).toBe(403);
    expect(db.tournament_matches).toHaveLength(1);
  });

  it('returns 404 for a batch that does not exist', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const response = await POST(makeRequest(), makeParams('missing-batch'));

    expect(response.status).toBe(404);
  });

  it('rejects rollback of a batch that is not saved', async () => {
    const db = buildDb({ batchStatus: 'preview' });
    state.client = createMockClient(db);

    const response = await POST(makeRequest(), makeParams('batch-1'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('SCHEDULE_ROLLBACK_NOT_ELIGIBLE');
  });

  it('rejects a second rollback attempt while one is already in progress', async () => {
    const db = buildDb({ batchStatus: 'rolling_back' });
    state.client = createMockClient(db);

    const response = await POST(makeRequest(), makeParams('batch-1'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('SCHEDULE_ROLLBACK_NOT_ELIGIBLE');
    // Match untouched — the second caller never got to mutate anything.
    expect(db.tournament_matches[0].version).toBe(1);
  });

  it('deletes the Match a create-action row produced', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const response = await POST(makeRequest(), makeParams('batch-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe('rolled_back');
    expect(body.data.revertedCreated).toBe(1);
    expect(db.tournament_matches).toHaveLength(0);
    expect(db.tournament_schedule_batches[0].status).toBe('rolled_back');
    expect(db.tournament_schedule_batches[0].rolled_back_at).toBeDefined();
    expect(db.tournament_schedule_batches[0].rolled_back_by).toBe('admin-1');
  });

  it('restores all original Match fields for an update-action row', async () => {
    const beforePayload = {
      category_id: 'cat-1',
      group_id: 'group-1',
      stage: 'group',
      match_code: 'B-U12-GA-001',
      match_no: 1,
      match_date: '2026-08-01',
      match_time: '08:00',
      venue_id: 'venue-1',
      court_id: 'court-1',
      home_team_id: null,
      away_team_id: null,
      home_source_type: 'group_slot',
      home_source_ref: 'A-S1',
      away_source_type: 'group_slot',
      away_source_ref: 'A-S2',
      sources_resolved_at: null,
      result_policy: 'single_step',
      result_type: 'normal',
      status: 'scheduled',
      note: null,
      schedule_batch_id: null,
      schedule_status: 'validated',
      version: 1,
      updated_at: '2026-08-01T00:00:00.000Z',
      updated_by: 'admin-0',
    };
    const db = buildDb({
      matches: [
        baseMatch({
          match_time: '08:30',
          version: 2,
          updated_at: '2026-08-02T00:00:00.000Z',
          schedule_batch_id: 'batch-1',
        }),
      ],
      rows: [
        {
          id: 'row-1',
          batch_id: 'batch-1',
          row_no: 2,
          match_code: 'B-U12-GA-001',
          action: 'update',
          matched_match_id: 'match-1',
          before_payload: beforePayload,
          applied_match_version: 2,
          applied_match_updated_at: '2026-08-02T00:00:00.000Z',
        },
      ],
    });
    state.client = createMockClient(db);

    const response = await POST(makeRequest(), makeParams('batch-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.revertedUpdated).toBe(1);
    expect(db.tournament_matches).toHaveLength(1);
    const restored = db.tournament_matches[0];
    expect(restored.match_time).toBe('08:00');
    expect(restored.schedule_status).toBe('validated');
    expect(restored.version).toBe(1);
    expect(restored.schedule_batch_id).toBe(null);
    // updated_at/updated_by are restored from the snapshot, not stamped with the
    // rollback's own now()/actor — a true undo, not a new edit event. This is what
    // makes rolling back an earlier batch (after a later one already touched the same
    // Match) composable: the earlier batch's own applied_match_version/
    // applied_match_updated_at must still match after this restore.
    expect(restored.updated_at).toBe('2026-08-01T00:00:00.000Z');
    expect(restored.updated_by).toBe('admin-0');
  });

  it('blocks rollback when the Match has been edited since this batch applied it', async () => {
    const db = buildDb({
      matches: [baseMatch({ version: 5, updated_at: '2026-08-05T00:00:00.000Z' })],
    });
    state.client = createMockClient(db);

    const response = await POST(makeRequest(), makeParams('batch-1'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('SCHEDULE_ROLLBACK_CONFLICT');
    expect(db.tournament_matches[0].version).toBe(5);
    expect(db.tournament_schedule_batches[0].status).toBe('failed');
  });

  it('blocks rollback of a currently published Match', async () => {
    const db = buildDb({ matches: [baseMatch({ schedule_status: 'published' })] });
    state.client = createMockClient(db);

    const response = await POST(makeRequest(), makeParams('batch-1'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('SCHEDULE_ROLLBACK_CONFLICT');
    expect(db.tournament_matches[0].schedule_status).toBe('published');
  });

  it('blocks rollback of a Match that already has a result entered', async () => {
    const db = buildDb({
      matches: [baseMatch({ result_workflow_status: 'published', regulation_home_score: 3, regulation_away_score: 1, status: 'finished' })],
    });
    state.client = createMockClient(db);

    const response = await POST(makeRequest(), makeParams('batch-1'));

    expect(response.status).toBe(409);
    expect(db.tournament_matches[0].status).toBe('finished');
    expect(db.tournament_matches[0].regulation_home_score).toBe(3);
  });

  it('leaves no partial restore when one row in a multi-row batch conflicts', async () => {
    const db = buildDb({
      matches: [baseMatch({ id: 'match-1' }), baseMatch({ id: 'match-2', match_code: 'B-U12-GA-002', version: 9 })],
      rows: [
        {
          id: 'row-1',
          batch_id: 'batch-1',
          row_no: 2,
          match_code: 'B-U12-GA-001',
          action: 'create',
          matched_match_id: 'match-1',
          before_payload: null,
          applied_match_version: 1,
          applied_match_updated_at: '2026-08-01T00:00:00.000Z',
        },
        {
          id: 'row-2',
          batch_id: 'batch-1',
          row_no: 3,
          match_code: 'B-U12-GA-002',
          action: 'create',
          matched_match_id: 'match-2',
          before_payload: null,
          applied_match_version: 1,
          applied_match_updated_at: '2026-08-01T00:00:00.000Z',
        },
      ],
    });
    state.client = createMockClient(db);

    const response = await POST(makeRequest(), makeParams('batch-1'));

    expect(response.status).toBe(409);
    // match-1 was perfectly eligible for deletion, but match-2's conflict must block
    // the whole batch — no partial rollback.
    expect(db.tournament_matches).toHaveLength(2);
  });

  it('is idempotent on a second call after a successful rollback', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    await POST(makeRequest(), makeParams('batch-1'));
    const second = await POST(makeRequest(), makeParams('batch-1'));
    const secondBody = await second.json();

    expect(second.status).toBe(200);
    expect(secondBody.data.idempotent).toBe(true);
    expect(secondBody.data.status).toBe('rolled_back');
  });

  it('allows rolling back an earlier batch after a later batch on the same Match was already rolled back', async () => {
    // batch-1 created match-1 (applied_match_version 1, applied_match_updated_at T1).
    // batch-2 later updated it (before_payload snapshots version 1/T1; applied_match_version
    // becomes 2/T2). Rolling back batch-2 must restore version/updated_at to EXACTLY 1/T1 —
    // not a fresh now() — so that rolling back batch-1 afterwards is not falsely flagged as
    // "changed since import" against its own recorded applied state.
    const T1 = '2026-08-01T00:00:00.000Z';
    const T2 = '2026-08-02T00:00:00.000Z';
    const db: Db = {
      tournament_schedule_batches: [
        { id: 'batch-1', tournament_id: 'tour-1', file_name: 'first.xlsx', status: 'saved', save_result: {} },
        { id: 'batch-2', tournament_id: 'tour-1', file_name: 'second.xlsx', status: 'saved', save_result: {} },
      ],
      tournament_schedule_import_rows: [
        {
          id: 'row-1',
          batch_id: 'batch-1',
          row_no: 2,
          match_code: 'B-U12-GA-001',
          action: 'create',
          matched_match_id: 'match-1',
          before_payload: null,
          applied_match_version: 1,
          applied_match_updated_at: T1,
        },
        {
          id: 'row-2',
          batch_id: 'batch-2',
          row_no: 2,
          match_code: 'B-U12-GA-001',
          action: 'update',
          matched_match_id: 'match-1',
          before_payload: { ...baseMatch(), version: 1, updated_at: T1, updated_by: null },
          applied_match_version: 2,
          applied_match_updated_at: T2,
        },
      ],
      tournament_matches: [baseMatch({ match_time: '09:00', version: 2, updated_at: T2 })],
      tournament_audit_logs: [],
    };
    state.client = createMockClient(db);

    const rollbackLater = await POST(makeRequest(), makeParams('batch-2'));
    expect(rollbackLater.status).toBe(200);
    expect(db.tournament_matches[0].version).toBe(1);
    expect(db.tournament_matches[0].updated_at).toBe(T1);

    const rollbackEarlier = await POST(makeRequest(), makeParams('batch-1'));
    const earlierBody = await rollbackEarlier.json();

    expect(rollbackEarlier.status).toBe(200);
    expect(earlierBody.data.revertedCreated).toBe(1);
    expect(db.tournament_matches).toHaveLength(0);
  });

  it('writes exactly one audit log entry, even across an idempotent retry', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    await POST(makeRequest(), makeParams('batch-1'));
    await POST(makeRequest(), makeParams('batch-1'));

    const rollbackLogs = db.tournament_audit_logs.filter((log) => log.action === 'schedule.import.rollback');
    expect(rollbackLogs).toHaveLength(1);
    expect(rollbackLogs[0].entity_id).toBe('batch-1');
  });
});

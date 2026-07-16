import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Minimal in-memory Supabase-like query builder mock, tailored to the exact
// chain shapes used by app/api/tournament/admin/schedule/import/save/route.ts
// (select/eq/is/in/order/maybeSingle/single/update/insert, plus bare-awaited
// select queries used inside Promise.all).
// ---------------------------------------------------------------------------
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

vi.mock('@/lib/tournament/db/supabase-tournament', () => ({
  getTournamentServiceClient: () => state.client,
}));

const authState = vi.hoisted(() => ({
  authorized: true as boolean,
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

import { POST } from '../route';

function makeRequest(batchId: string, confirmPublishedRevision?: boolean): NextRequest {
  return {
    json: async () => ({ batchId, ...(confirmPublishedRevision !== undefined ? { confirmPublishedRevision } : {}) }),
  } as unknown as NextRequest;
}

const normalizedRow = {
  match_code: 'B-U12-GA-001',
  category_code: 'B-U12',
  stage: 'group',
  group_code: 'A',
  venue_code: 'V1',
  court_code: 'C1',
  match_date: '2026-08-01',
  start_time: '08:30',
  match_no: 1,
  home_source_type: 'group_slot',
  home_source_ref: 'A-S1',
  away_source_type: 'group_slot',
  away_source_ref: 'A-S2',
  result_policy: 'single_step',
  status: 'scheduled',
  note: '',
};

function buildDb(overrides: { batchStatus?: string; existingMatch?: Row } = {}): Db {
  const db: Db = {
    tournaments: [{ id: 'tour-1', start_date: '2026-08-01', end_date: '2026-08-11' }],
    tournament_schedule_batches: [
      {
        id: 'batch-1',
        tournament_id: 'tour-1',
        batch_type: 'fixture_import',
        file_name: 'test.xlsx',
        status: overrides.batchStatus || 'preview',
        total_rows: 1,
        valid_rows: 1,
        warning_rows: 0,
        error_rows: 0,
        save_result: null,
      },
    ],
    tournament_schedule_import_rows: [
      {
        id: 'row-1',
        batch_id: 'batch-1',
        row_no: 2,
        status: 'valid',
        action: 'create',
        match_code: 'B-U12-GA-001',
        raw_payload: { normalized: normalizedRow },
        messages: [],
      },
    ],
    tournament_categories: [{ id: 'cat-1', tournament_id: 'tour-1', code: 'B-U12', deleted_at: null }],
    tournament_venues: [{ id: 'venue-1', tournament_id: 'tour-1', code: 'V1' }],
    tournament_courts: [{ id: 'court-1', venue_id: 'venue-1', code: 'C1' }],
    tournament_groups: [{ id: 'group-1', tournament_id: 'tour-1', category_id: 'cat-1', code: 'A' }],
    tournament_group_members: [
      { group_id: 'group-1', slot_code: 'A-S1', team_id: null },
      { group_id: 'group-1', slot_code: 'A-S2', team_id: null },
    ],
    tournament_teams: [],
    tournament_category_venues: [{ category_id: 'cat-1', venue_id: 'venue-1', is_primary: true }],
    tournament_qualification_rules: [],
    tournament_matches: overrides.existingMatch ? [overrides.existingMatch] : [],
    tournament_schedule_versions: [],
    tournament_audit_logs: [],
  };
  return db;
}

function publishedMatch(overrides: Row = {}): Row {
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
    result_policy: 'single_step',
    status: 'scheduled',
    note: null,
    schedule_status: 'published',
    version: 3,
    ...overrides,
  };
}

describe('POST /api/tournament/admin/schedule/import/save', () => {
  beforeEach(() => {
    state.client = null;
    authState.authorized = true;
  });

  it('creates a new match on first save', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const response = await POST(makeRequest('batch-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.created).toBe(1);
    expect(db.tournament_matches).toHaveLength(1);
    expect(db.tournament_matches[0].schedule_status).toBe('validated');
    expect(db.tournament_schedule_batches[0].status).toBe('saved');
  });

  it('returns an idempotent response when the same batch is saved again', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    await POST(makeRequest('batch-1'));
    const second = await POST(makeRequest('batch-1'));
    const secondBody = await second.json();

    expect(second.status).toBe(200);
    expect(secondBody.data.idempotent).toBe(true);
    expect(db.tournament_matches).toHaveLength(1);
  });

  it('rejects a concurrent save while the batch is already saving', async () => {
    const db = buildDb({ batchStatus: 'saving' });
    state.client = createMockClient(db);

    const response = await POST(makeRequest('batch-1'));

    expect(response.status).toBe(409);
    expect(db.tournament_matches).toHaveLength(0);
  });

  it('rejects a save for a batch previously marked failed', async () => {
    const db = buildDb({ batchStatus: 'failed' });
    state.client = createMockClient(db);

    const response = await POST(makeRequest('batch-1'));

    expect(response.status).toBe(409);
  });

  it('skips an unchanged published fixture without touching its status', async () => {
    const db = buildDb({
      existingMatch: {
        id: 'match-1',
        tournament_id: 'tour-1',
        match_code: 'B-U12-GA-001',
        category_id: 'cat-1',
        group_id: 'group-1',
        venue_id: 'venue-1',
        court_id: 'court-1',
        match_date: '2026-08-01',
        match_time: '08:30',
        match_no: 1,
        stage: 'group',
        home_source_type: 'group_slot',
        home_source_ref: 'A-S1',
        away_source_type: 'group_slot',
        away_source_ref: 'A-S2',
        result_policy: 'single_step',
        status: 'scheduled',
        note: null,
        schedule_status: 'published',
        version: 3,
      },
    });
    state.client = createMockClient(db);

    const response = await POST(makeRequest('batch-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.unchanged).toBe(1);
    expect(db.tournament_matches[0].schedule_status).toBe('published');
    expect(db.tournament_matches[0].version).toBe(3);
  });

  it('rejects a changed published fixture without confirmation (409), leaving the batch and match untouched', async () => {
    const db = buildDb({ existingMatch: publishedMatch() });
    state.client = createMockClient(db);

    const response = await POST(makeRequest('batch-1'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('PUBLISHED_REVISION_CONFIRMATION_REQUIRED');
    expect(body.publishedMatchCodes).toEqual(['B-U12-GA-001']);
    expect(db.tournament_matches[0].match_time).toBe('08:00');
    expect(db.tournament_matches[0].schedule_status).toBe('published');
    expect(db.tournament_matches[0].version).toBe(3);
    // Batch remains eligible for a later confirmed Save — never claimed as 'saving'.
    expect(db.tournament_schedule_batches[0].status).toBe('preview');
  });

  it('applies a confirmed published revision: match becomes revision_required, not auto-published', async () => {
    const db = buildDb({ existingMatch: publishedMatch() });
    state.client = createMockClient(db);

    const response = await POST(makeRequest('batch-1', true));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.updated).toBe(1);
    expect(body.data.revisionsConfirmed).toBe(1);
    expect(db.tournament_matches[0].match_time).toBe('08:30');
    expect(db.tournament_matches[0].schedule_status).toBe('revision_required');
    expect(db.tournament_matches[0].version).toBe(4);
  });

  it('creates a revision_required schedule version for a confirmed published revision', async () => {
    const db = buildDb({ existingMatch: publishedMatch() });
    state.client = createMockClient(db);

    await POST(makeRequest('batch-1', true));

    expect(db.tournament_schedule_versions).toHaveLength(1);
    expect(db.tournament_schedule_versions[0]).toMatchObject({
      category_id: 'cat-1',
      stage: 'group',
      status: 'revision_required',
      batch_id: 'batch-1',
    });
  });

  it('does not modify a previously published schedule version when confirming a revision', async () => {
    const db = buildDb({ existingMatch: publishedMatch() });
    db.tournament_schedule_versions.push({
      id: 'version-published-1',
      category_id: 'cat-1',
      stage: 'group',
      version: 1,
      status: 'published',
      batch_id: 'earlier-batch',
    });
    state.client = createMockClient(db);

    await POST(makeRequest('batch-1', true));

    const publishedVersion = db.tournament_schedule_versions.find((v) => v.id === 'version-published-1');
    expect(publishedVersion?.status).toBe('published');
    const newVersion = db.tournament_schedule_versions.find((v) => v.id !== 'version-published-1');
    expect(newVersion).toMatchObject({ status: 'revision_required', version: 2 });
  });

  it('records a per-match audit entry with before/after data for a confirmed revision', async () => {
    const db = buildDb({ existingMatch: publishedMatch() });
    state.client = createMockClient(db);

    await POST(makeRequest('batch-1', true));

    const entry = db.tournament_audit_logs.find(
      (log) => log.action === 'schedule.import.confirm_published_revision'
    );
    expect(entry).toBeDefined();
    expect(entry?.entity_id).toBe('match-1');
    expect((entry?.old_data as Row)?.schedule_status).toBe('published');
    expect((entry?.new_data as Row)?.schedule_status).toBe('revision_required');
    expect((entry?.old_data as Row)?.match).toBeDefined();
    expect((entry?.new_data as Row)?.match).toBeDefined();
  });

  it('handles a mixed batch: confirmed published row and a non-published row both save correctly', async () => {
    const db = buildDb({ existingMatch: publishedMatch() });
    db.tournament_schedule_import_rows.push({
      id: 'row-2',
      batch_id: 'batch-1',
      row_no: 3,
      status: 'valid',
      action: 'create',
      match_code: 'B-U12-GA-002',
      raw_payload: {
        normalized: {
          ...normalizedRow,
          match_code: 'B-U12-GA-002',
          match_no: 2,
          start_time: '10:00',
          home_source_ref: 'A-S3',
          away_source_ref: 'A-S4',
        },
      },
      messages: [],
    });
    db.tournament_group_members.push(
      { group_id: 'group-1', slot_code: 'A-S3', team_id: null },
      { group_id: 'group-1', slot_code: 'A-S4', team_id: null }
    );
    state.client = createMockClient(db);

    const response = await POST(makeRequest('batch-1', true));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.created).toBe(1);
    expect(body.data.updated).toBe(1);
    expect(body.data.revisionsConfirmed).toBe(1);
    expect(db.tournament_matches).toHaveLength(2);
    const newMatch = db.tournament_matches.find((m) => m.match_code === 'B-U12-GA-002');
    expect(newMatch?.schedule_status).toBe('validated');
    const revisedMatch = db.tournament_matches.find((m) => m.match_code === 'B-U12-GA-001');
    expect(revisedMatch?.schedule_status).toBe('revision_required');
  });

  it('rejects confirmation from a user who is not authorized as tournament_super_admin', async () => {
    authState.authorized = false;
    const db = buildDb({ existingMatch: publishedMatch() });
    state.client = createMockClient(db);

    const response = await POST(makeRequest('batch-1', true));

    expect(response.status).toBe(403);
    expect(db.tournament_matches[0].schedule_status).toBe('published');
  });

  it('does not let confirmation bypass fresh revalidation against current database state', async () => {
    const db = buildDb({ existingMatch: publishedMatch() });
    // Simulate the venue having been removed since Preview ran.
    db.tournament_venues = [];
    state.client = createMockClient(db);

    const response = await POST(makeRequest('batch-1', true));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.failed).toBe(1);
    expect(db.tournament_matches[0].match_time).toBe('08:00');
    expect(db.tournament_matches[0].schedule_status).toBe('published');
  });

  it('returns the idempotent stored result on retry after a confirmed revision save', async () => {
    const db = buildDb({ existingMatch: publishedMatch() });
    state.client = createMockClient(db);

    await POST(makeRequest('batch-1', true));
    const second = await POST(makeRequest('batch-1', true));
    const secondBody = await second.json();

    expect(second.status).toBe(200);
    expect(secondBody.data.idempotent).toBe(true);
    expect(secondBody.data.revisionsConfirmed).toBe(1);
    // No duplicate write: still exactly one match, one version.
    expect(db.tournament_matches).toHaveLength(1);
    expect(db.tournament_schedule_versions).toHaveLength(1);
  });

  it('allows only one writer when a confirmed save races against an already-saving batch', async () => {
    const db = buildDb({ batchStatus: 'saving', existingMatch: publishedMatch() });
    state.client = createMockClient(db);

    const response = await POST(makeRequest('batch-1', true));

    expect(response.status).toBe(409);
    expect(db.tournament_matches[0].schedule_status).toBe('published');
  });

  it('does not require confirmation for a normal import with no published changes', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const response = await POST(makeRequest('batch-1', false));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.created).toBe(1);
  });

  it('updates a changed non-published fixture successfully', async () => {
    const db = buildDb({
      existingMatch: {
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
        result_policy: 'single_step',
        status: 'scheduled',
        note: null,
        schedule_status: 'validated',
        version: 1,
      },
    });
    state.client = createMockClient(db);

    const response = await POST(makeRequest('batch-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.updated).toBe(1);
    expect(db.tournament_matches[0].match_time).toBe('08:30');
    expect(db.tournament_matches[0].version).toBe(2);
  });

  it('creates a schedule version record for a successfully saved category/stage', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    await POST(makeRequest('batch-1'));

    expect(db.tournament_schedule_versions).toHaveLength(1);
    expect(db.tournament_schedule_versions[0]).toMatchObject({
      category_id: 'cat-1',
      stage: 'group',
      version: 1,
      status: 'validated',
      batch_id: 'batch-1',
    });
  });

  it('does not create a schedule version when the only row is unchanged', async () => {
    const db = buildDb({
      existingMatch: {
        id: 'match-1',
        tournament_id: 'tour-1',
        match_code: 'B-U12-GA-001',
        category_id: 'cat-1',
        group_id: 'group-1',
        venue_id: 'venue-1',
        court_id: 'court-1',
        match_date: '2026-08-01',
        match_time: '08:30',
        match_no: 1,
        stage: 'group',
        home_source_type: 'group_slot',
        home_source_ref: 'A-S1',
        away_source_type: 'group_slot',
        away_source_ref: 'A-S2',
        result_policy: 'single_step',
        status: 'scheduled',
        note: null,
        schedule_status: 'validated',
        version: 1,
      },
    });
    state.client = createMockClient(db);

    await POST(makeRequest('batch-1'));

    expect(db.tournament_schedule_versions).toHaveLength(0);
  });

  it('stores the final save summary into save_result on the batch', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const response = await POST(makeRequest('batch-1'));
    const body = await response.json();

    expect(db.tournament_schedule_batches[0].save_result).toMatchObject({
      created: body.data.created,
      updated: body.data.updated,
      unchanged: body.data.unchanged,
      skipped: body.data.skipped,
      failed: body.data.failed,
      revisionsConfirmed: body.data.revisionsConfirmed,
    });
  });

  it('returns the exact stored save_result on an idempotent retry, without writing again', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    const first = await POST(makeRequest('batch-1'));
    const firstBody = await first.json();
    const storedAfterFirst = db.tournament_schedule_batches[0].save_result;

    const second = await POST(makeRequest('batch-1'));
    const secondBody = await second.json();

    expect(secondBody.data.created).toBe(firstBody.data.created);
    expect(db.tournament_schedule_batches[0].save_result).toEqual(storedAfterFirst);
  });

  it('records matched_match_id and the resulting version/updated_at for a newly created match', async () => {
    const db = buildDb();
    state.client = createMockClient(db);

    await POST(makeRequest('batch-1'));

    const createdMatch = db.tournament_matches[0];
    const row = db.tournament_schedule_import_rows[0];
    expect(row.matched_match_id).toBe(createdMatch.id);
    expect(row.before_payload).toBeNull();
    expect(row.applied_match_version).toBe(1);
    expect(row.applied_match_updated_at).toBeTypeOf('string');
  });

  it('stores a complete pre-import Match snapshot in before_payload before mutating an existing match', async () => {
    const existingMatch = {
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
      note: null,
      schedule_batch_id: null,
      schedule_status: 'validated',
      version: 1,
    };
    const db = buildDb({ existingMatch });
    state.client = createMockClient(db);

    await POST(makeRequest('batch-1'));

    const row = db.tournament_schedule_import_rows[0];
    expect(row.before_payload).toMatchObject({
      match_time: '08:00',
      schedule_status: 'validated',
      version: 1,
      home_source_ref: 'A-S1',
    });
    expect(row.matched_match_id).toBe('match-1');
    expect(row.applied_match_version).toBe(2);
    expect(db.tournament_matches[0].match_time).toBe('08:30');
    expect(db.tournament_matches[0].version).toBe(2);
  });
});

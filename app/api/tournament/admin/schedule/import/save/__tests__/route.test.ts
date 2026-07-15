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

vi.mock('@/lib/tournament/services/auth', () => ({
  requireTournamentSuperAdmin: async () => ({
    authenticated: true,
    authorized: true,
    userId: 'admin-1',
    email: 'admin@test.com',
  }),
}));

import { POST } from '../route';

function makeRequest(batchId: string): NextRequest {
  return { json: async () => ({ batchId }) } as unknown as NextRequest;
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

describe('POST /api/tournament/admin/schedule/import/save', () => {
  beforeEach(() => {
    state.client = null;
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

  it('rejects a changed published fixture and leaves the original row untouched', async () => {
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
        schedule_status: 'published',
        version: 3,
      },
    });
    state.client = createMockClient(db);

    const response = await POST(makeRequest('batch-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.failed).toBe(1);
    expect(body.data.failures[0].code).toBe('E_PUBLISHED_LOCKED');
    expect(db.tournament_matches[0].match_time).toBe('08:00');
    expect(db.tournament_matches[0].schedule_status).toBe('published');
    expect(db.tournament_matches[0].version).toBe(3);
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
});

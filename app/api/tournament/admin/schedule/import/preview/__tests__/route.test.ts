import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

function createMockClient(db: Db) {
  function builder(table: string) {
    let mode: 'select' | 'insert' = 'select';
    let insertRows: Row[] = [];
    const filters: Array<['eq' | 'is', string, unknown]> = [];

    const rows = (): Row[] => db[table] || (db[table] = []);

    function matches(row: Row): boolean {
      return filters.every(([op, col, val]) => {
        if (op === 'eq') return row[col] === val;
        if (op === 'is') return (row[col] ?? null) === val;
        return true;
      });
    }

    function execute(): { data: Row[]; error: null } {
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
      insert(p: Row | Row[]) {
        mode = 'insert';
        insertRows = Array.isArray(p) ? p : [p];
        return api;
      },
      delete() {
        return api;
      },
      single() {
        const { data } = execute();
        return Promise.resolve({ data: data.length ? data[0] : null, error: data.length ? null : { message: 'not found' } });
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

function makeRequest(tournamentId: string, rows: Row[]): NextRequest {
  return { json: async () => ({ tournamentId, fileName: 'test.xlsx', rows }) } as unknown as NextRequest;
}

function buildDb(existingMatch: Row): Db {
  return {
    tournaments: [{ id: 'tour-1', name: 'Test Tournament', start_date: '2026-08-01', end_date: '2026-08-11', deleted_at: null }],
    tournament_categories: [{ id: 'cat-1', tournament_id: 'tour-1', code: 'B-U12', name: 'Boys U12', deleted_at: null }],
    tournament_venues: [{ id: 'venue-1', tournament_id: 'tour-1', code: 'V1', name: 'Field 1' }],
    tournament_courts: [{ id: 'court-1', venue_id: 'venue-1', code: 'C1', name: 'Court 1' }],
    tournament_groups: [{ id: 'group-1', tournament_id: 'tour-1', category_id: 'cat-1', code: 'A', name: 'Group A' }],
    tournament_group_members: [
      { group_id: 'group-1', slot_code: 'A-S1', team_id: null },
      { group_id: 'group-1', slot_code: 'A-S2', team_id: null },
    ],
    tournament_teams: [],
    tournament_category_venues: [{ category_id: 'cat-1', venue_id: 'venue-1', is_primary: true }],
    tournament_qualification_rules: [],
    tournament_matches: [existingMatch],
    tournament_schedule_batches: [],
    tournament_schedule_import_rows: [],
    tournament_audit_logs: [],
  };
}

describe('POST /api/tournament/admin/schedule/import/preview', () => {
  beforeEach(() => {
    state.client = null;
  });

  it('flags a changed published fixture as requiring revision confirmation', async () => {
    const db = buildDb({
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
    });
    state.client = createMockClient(db);

    const response = await POST(
      makeRequest('tour-1', [
        {
          match_code: 'B-U12-GA-001',
          category_code: 'B-U12',
          stage: 'group',
          group_code: 'A',
          venue_code: 'V1',
          court_code: 'C1',
          match_date: '2026-08-01',
          start_time: '09:00',
          match_no: 1,
          home_source_type: 'group_slot',
          home_source_ref: 'A-S1',
          away_source_type: 'group_slot',
          away_source_ref: 'A-S2',
          result_policy: 'single_step',
          status: 'scheduled',
          note: '',
        },
      ])
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.has_published_changes).toBe(true);
    expect(body.data.published_change_count).toBe(1);
    expect(body.data.published_match_codes).toEqual(['B-U12-GA-001']);
    const row = body.data.results[0];
    expect(row.requires_revision_confirmation).toBe(true);
    expect(row.messages.some((m: { code: string }) => m.code === 'W11')).toBe(true);
    expect(row.diff.length).toBeGreaterThan(0);
  });

  it('does not flag an unchanged published fixture as requiring confirmation', async () => {
    const db = buildDb({
      id: 'match-1',
      tournament_id: 'tour-1',
      match_code: 'B-U12-GA-001',
      category_id: 'cat-1',
      group_id: 'group-1',
      venue_id: 'venue-1',
      court_id: 'court-1',
      match_date: '2026-08-01',
      match_time: '09:00',
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
    });
    state.client = createMockClient(db);

    const response = await POST(
      makeRequest('tour-1', [
        {
          match_code: 'B-U12-GA-001',
          category_code: 'B-U12',
          stage: 'group',
          group_code: 'A',
          venue_code: 'V1',
          court_code: 'C1',
          match_date: '2026-08-01',
          start_time: '09:00',
          match_no: 1,
          home_source_type: 'group_slot',
          home_source_ref: 'A-S1',
          away_source_type: 'group_slot',
          away_source_ref: 'A-S2',
          result_policy: 'single_step',
          status: 'scheduled',
          note: '',
        },
      ])
    );
    const body = await response.json();

    expect(body.data.has_published_changes).toBe(false);
    expect(body.data.results[0].requires_revision_confirmation).toBe(false);
  });
});

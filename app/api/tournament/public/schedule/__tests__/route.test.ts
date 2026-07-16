import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

function createMockClient(db: Db) {
  function builder(table: string) {
    let selectedSingle = false;
    let limitCount: number | null = null;
    const filters: Array<['eq' | 'is', string, unknown]> = [];

    const rows = (): Row[] => db[table] || (db[table] = []);

    function matches(row: Row): boolean {
      return filters.every(([op, col, val]) => {
        if (op === 'eq') return row[col] === val;
        if (op === 'is') return (row[col] ?? null) === val;
        return true;
      });
    }

    function execute(): Row[] {
      let result = rows().filter(matches);
      if (limitCount !== null) result = result.slice(0, limitCount);
      return result;
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
      order() {
        return api;
      },
      limit(n: number) {
        limitCount = n;
        return api;
      },
      single() {
        selectedSingle = true;
        const data = execute();
        return Promise.resolve({ data: data.length ? data[0] : null, error: data.length ? null : { message: 'not found' } });
      },
      maybeSingle() {
        selectedSingle = true;
        const data = execute();
        return Promise.resolve({ data: data.length ? data[0] : null, error: null });
      },
      then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
        if (selectedSingle) return Promise.resolve().then(resolve, reject);
        return Promise.resolve({ data: execute(), error: null }).then(resolve, reject);
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

import { GET } from '../route';

function makeRequest(params: Record<string, string>): NextRequest {
  const search = new URLSearchParams(params).toString();
  return {
    nextUrl: { searchParams: new URLSearchParams(search) },
  } as unknown as NextRequest;
}

function buildDb(matches: Row[] = []): Db {
  return {
    tournaments: [{ id: 'tour-1', slug: 'cfyl-2026-real', start_date: '2026-08-01', end_date: '2026-08-11', deleted_at: null }],
    tournament_categories: [{ id: 'cat-1', tournament_id: 'tour-1', code: 'B-U12', deleted_at: null }],
    tournament_venues: [{ id: 'venue-1', tournament_id: 'tour-1', code: 'V1' }],
    tournament_courts: [{ id: 'court-1', code: 'C1' }],
    tournament_teams: [
      { id: 'team-1', tournament_id: 'tour-1', name: 'Home School' },
      { id: 'team-2', tournament_id: 'tour-1', name: 'Away School' },
    ],
    tournament_matches: matches,
    tournament_groups: [],
    tournament_draw_assignments: [],
  };
}

function match(overrides: Row = {}): Row {
  return {
    id: 'match-1',
    tournament_id: 'tour-1',
    match_code: 'B-U12-GA-001',
    match_no: 1,
    match_date: '2026-08-01',
    match_time: '08:30',
    category_id: 'cat-1',
    venue_id: 'venue-1',
    court_id: 'court-1',
    home_team_id: null,
    away_team_id: null,
    home_source_ref: 'A-S1',
    away_source_ref: 'A-S2',
    stage: 'group',
    schedule_status: 'validated',
    deleted_at: null,
    ...overrides,
  };
}

describe('GET /api/tournament/public/schedule', () => {
  beforeEach(() => {
    state.client = null;
  });

  it('returns published fixtures as OFFICIAL', async () => {
    const db = buildDb([match({ schedule_status: 'published' })]);
    state.client = createMockClient(db);

    const response = await GET(makeRequest({ tournament_slug: 'cfyl-2026-real' }));
    const body = await response.json();

    expect(body.status).toBe('OFFICIAL');
    expect(body.is_official).toBe(true);
    expect(body.total_matches).toBe(1);
    expect(body.data[0].match_number).toBeDefined();
  });

  it('does not expose a validated (not yet published) fixture', async () => {
    const db = buildDb([match({ schedule_status: 'validated' })]);
    state.client = createMockClient(db);

    const response = await GET(makeRequest({ tournament_slug: 'cfyl-2026-real' }));
    const body = await response.json();

    expect(body.status).toBe('NOT_PUBLISHED');
    expect(body.is_official).toBe(false);
    expect(body.total_matches).toBe(0);
    expect(body.data).toEqual([]);
  });

  it('does not expose a draft fixture', async () => {
    const db = buildDb([match({ schedule_status: 'draft' })]);
    state.client = createMockClient(db);

    const response = await GET(makeRequest({ tournament_slug: 'cfyl-2026-real' }));
    const body = await response.json();

    expect(body.status).toBe('NOT_PUBLISHED');
    expect(body.data).toEqual([]);
  });

  it('does not expose a revision_required fixture', async () => {
    const db = buildDb([match({ schedule_status: 'revision_required' })]);
    state.client = createMockClient(db);

    const response = await GET(makeRequest({ tournament_slug: 'cfyl-2026-real' }));
    const body = await response.json();

    expect(body.status).toBe('NOT_PUBLISHED');
    expect(body.data).toEqual([]);
  });

  it('returns only published rows when published and draft fixtures are mixed', async () => {
    const db = buildDb([
      match({ id: 'match-1', match_code: 'B-U12-GA-001', schedule_status: 'published' }),
      match({ id: 'match-2', match_code: 'B-U12-GA-002', match_no: 2, schedule_status: 'draft' }),
    ]);
    state.client = createMockClient(db);

    const response = await GET(makeRequest({ tournament_slug: 'cfyl-2026-real' }));
    const body = await response.json();

    expect(body.total_matches).toBe(1);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].match_number).toBe(1);
  });

  it('returns NOT_PUBLISHED rather than sample data when no matches are published', async () => {
    const db = buildDb([match({ schedule_status: 'validated' })]);
    state.client = createMockClient(db);

    const response = await GET(makeRequest({ tournament_slug: 'cfyl-2026-real' }));
    const body = await response.json();

    expect(body.source.type).toBe('tournament_database');
    expect(body.source.fallback).toBe(false);
  });

  it('does not mix sample fallback data with a real (unrelated) tournament that has no imports', async () => {
    const db = buildDb([]);
    state.client = createMockClient(db);

    const response = await GET(makeRequest({ tournament_slug: 'cfyl-2026-real' }));
    const body = await response.json();

    expect(body.status).toBe('NOT_PUBLISHED');
    expect(body.total_matches).toBe(0);
    expect(body.data).toEqual([]);
  });

  it('resolves a draw_selected placeholder to its selected team once resolved', async () => {
    const db = buildDb([
      match({
        schedule_status: 'published',
        away_source_ref: 'G-U16-THIRD-DRAW-1',
        away_team_id: 'team-2',
      }),
    ]);
    state.client = createMockClient(db);

    const response = await GET(makeRequest({ tournament_slug: 'cfyl-2026-real' }));
    const body = await response.json();

    expect(body.data[0].away_team).toBe('Away School');
    expect(body.data[0].away_slot).toBe('G-U16-THIRD-DRAW-1');
  });
});

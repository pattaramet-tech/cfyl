import { describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

function createMockClient(db: Db) {
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
        const data = rows().filter(matches);
        return Promise.resolve({ data: data.length ? data[0] : null, error: null });
      },
      then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve({ data: rows().filter(matches), error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  return { from: (table: string) => builder(table) };
}

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createMockClient> | null }));

vi.mock('@/lib/tournament/db/supabase-tournament', () => ({
  getTournamentServiceClient: () => state.client,
}));

import { GET } from '../route';

function makeGetRequest(params: Record<string, string>): NextRequest {
  const search = new URLSearchParams(params).toString();
  return { nextUrl: { searchParams: new URLSearchParams(search) } } as unknown as NextRequest;
}

function groupResultMatches(groupId: string, categoryId: string, teams: string[]): Row[] {
  const base = { category_id: categoryId, group_id: groupId, status: 'finished', result_workflow_status: 'published', decided_by: 'regulation', deleted_at: null };
  const matches: Row[] = [];
  for (let i = 0; i < teams.length; i += 1) {
    for (let j = i + 1; j < teams.length; j += 1) {
      matches.push({
        id: `${groupId}-${teams[i]}-${teams[j]}`,
        home_team_id: teams[i],
        away_team_id: teams[j],
        regulation_home_score: 1,
        regulation_away_score: 0,
        winner_team_id: teams[i],
        ...base,
      });
    }
  }
  return matches;
}

function buildDb(): Db {
  return {
    tournaments: [{ id: 'tour-1', slug: 'cfyl-2026', deleted_at: null }],
    tournament_categories: [{ id: 'cat-1', tournament_id: 'tour-1', code: 'B-U14', deleted_at: null }],
    tournament_groups: [
      { id: 'group-a', tournament_id: 'tour-1', category_id: 'cat-1', code: 'A' },
      { id: 'group-b', tournament_id: 'tour-1', category_id: 'cat-1', code: 'B' },
    ],
    tournament_qualification_rules: [
      {
        tournament_id: 'tour-1',
        category_id: 'cat-1',
        qualify_rank_per_group: 2,
        best_third_placed_count: 2,
        best_third_placed_method: 'ranked',
        cross_group_comparison: true,
      },
    ],
    tournament_teams: [
      { id: 'a1', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'A1', name: 'A1', deleted_at: null },
      { id: 'a2', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'A2', name: 'A2', deleted_at: null },
      { id: 'a3', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'A3', name: 'A3', deleted_at: null },
      { id: 'b1', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'B1', name: 'B1', deleted_at: null },
      { id: 'b2', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'B2', name: 'B2', deleted_at: null },
      { id: 'b3', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'B3', name: 'B3', deleted_at: null },
      { id: 'b4', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'B4', name: 'B4', deleted_at: null },
    ],
    tournament_group_members: [
      { group_id: 'group-a', team_id: 'a1' },
      { group_id: 'group-a', team_id: 'a2' },
      { group_id: 'group-a', team_id: 'a3' },
      { group_id: 'group-b', team_id: 'b1' },
      { group_id: 'group-b', team_id: 'b2' },
      { group_id: 'group-b', team_id: 'b3' },
      { group_id: 'group-b', team_id: 'b4' },
    ],
    tournament_match_cards: [],
    tournament_standing_overrides: [
      { group_id: 'group-a', team_id: 'a2', override_rank: 1, reason: 'internal admin note that must never leak publicly' },
    ],
    tournament_matches: [
      ...groupResultMatches('group-a', 'cat-1', ['a1', 'a2', 'a3']),
      ...groupResultMatches('group-b', 'cat-1', ['b1', 'b2', 'b3', 'b4']),
    ],
  };
}

describe('standings public route — cross-group state and privacy', () => {
  it('surfaces normalization_required for unequal-match groups, same as the admin API', async () => {
    state.client = createMockClient(buildDb());
    const response = await GET(makeGetRequest({ tournament_slug: 'cfyl-2026', category_code: 'B-U14' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.best_third_placed_ranking.state).toBe('normalization_required');
    expect(body.data.best_third_placed_ranking.ranked).toEqual([]);
  });

  it('never exposes the override reason (internal admin note) even though override_applied is shown', async () => {
    state.client = createMockClient(buildDb());
    const response = await GET(makeGetRequest({ tournament_slug: 'cfyl-2026', category_code: 'B-U14' }));
    const body = await response.json();

    const groupA = body.data.groups.find((g: { group_code: string }) => g.group_code === 'A');
    const a2 = groupA.rows.find((r: { team_id: string }) => r.team_id === 'a2');
    expect(a2.override_applied).toBe(true);
    expect(a2.override_reason).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('internal admin note');
  });

  it('returns null best_third_placed_ranking for a draw-method category (G-U16 unaffected)', async () => {
    const db = buildDb();
    db.tournament_qualification_rules = [
      {
        tournament_id: 'tour-1',
        category_id: 'cat-1',
        qualify_rank_per_group: 2,
        best_third_placed_count: 2,
        best_third_placed_method: 'draw',
        cross_group_comparison: false,
      },
    ];
    state.client = createMockClient(db);
    const response = await GET(makeGetRequest({ tournament_slug: 'cfyl-2026', category_code: 'B-U14' }));
    const body = await response.json();
    expect(body.data.best_third_placed_ranking).toBeNull();
  });
});

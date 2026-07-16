import { describe, expect, it } from 'vitest';
import { getCategoryStandings, getG16ThirdPlaceCandidates, G16_INCOMPLETE_MESSAGE } from '../standings';

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
  return { from: (table: string) => builder(table) } as never;
}

const TOURNAMENT_ID = 'tour-1';
const CATEGORY_ID = 'cat-1';

function baseDb(): Db {
  return {
    tournament_categories: [{ id: CATEGORY_ID, tournament_id: TOURNAMENT_ID, code: 'B-U14', deleted_at: null }],
    tournament_groups: [{ id: 'group-a', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, code: 'A' }],
    tournament_qualification_rules: [
      {
        tournament_id: TOURNAMENT_ID,
        category_id: CATEGORY_ID,
        qualify_rank_per_group: 2,
        best_third_placed_count: 0,
        best_third_placed_method: 'ranked',
        cross_group_comparison: false,
      },
    ],
    tournament_teams: [
      { id: 'team-a', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'A', name: 'Team A', deleted_at: null },
      { id: 'team-b', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'B', name: 'Team B', deleted_at: null },
    ],
    tournament_group_members: [
      { group_id: 'group-a', team_id: 'team-a' },
      { group_id: 'group-a', team_id: 'team-b' },
    ],
    tournament_matches: [],
    tournament_match_cards: [],
    tournament_standing_overrides: [],
    tournament_result_submissions: [],
  };
}

function publishedMatch(overrides: Row = {}): Row {
  return {
    id: 'm1',
    group_id: 'group-a',
    category_id: CATEGORY_ID,
    home_team_id: 'team-a',
    away_team_id: 'team-b',
    regulation_home_score: 2,
    regulation_away_score: 0,
    winner_team_id: 'team-a',
    decided_by: 'regulation',
    status: 'finished',
    result_workflow_status: 'published',
    deleted_at: null,
    ...overrides,
  };
}

async function loadStandings(db: Db) {
  const client = createMockClient(db);
  return getCategoryStandings({ client, tournamentId: TOURNAMENT_ID, categoryCode: 'B-U14' });
}

describe('getCategoryStandings — official-result-only filtering', () => {
  it('includes a published, finished, official match', async () => {
    const db = baseDb();
    db.tournament_matches = [publishedMatch()];
    const result = await loadStandings(db);
    const teamA = result.groups[0].rows.find((r) => r.teamId === 'team-a')!;
    expect(teamA.played).toBe(1);
    expect(teamA.points).toBe(3);
  });

  it('excludes a match whose result is still draft (never reads Quick Result / draft state)', async () => {
    const db = baseDb();
    db.tournament_matches = [publishedMatch({ result_workflow_status: 'draft' })];
    const result = await loadStandings(db);
    const teamA = result.groups[0].rows.find((r) => r.teamId === 'team-a')!;
    expect(teamA.played).toBe(0);
  });

  it('excludes a match that is submitted but not yet published', async () => {
    const db = baseDb();
    db.tournament_matches = [publishedMatch({ result_workflow_status: 'submitted' })];
    const result = await loadStandings(db);
    expect(result.groups[0].rows.find((r) => r.teamId === 'team-a')!.played).toBe(0);
  });

  it('excludes a match still in previewed workflow state', async () => {
    const db = baseDb();
    db.tournament_matches = [publishedMatch({ result_workflow_status: 'previewed' })];
    const result = await loadStandings(db);
    expect(result.groups[0].rows.find((r) => r.teamId === 'team-a')!.played).toBe(0);
  });

  it('excludes a superseded/corrected result (only the current published state counts)', async () => {
    const db = baseDb();
    db.tournament_matches = [publishedMatch({ result_workflow_status: 'corrected' })];
    const result = await loadStandings(db);
    expect(result.groups[0].rows.find((r) => r.teamId === 'team-a')!.played).toBe(0);
  });

  it('excludes a cancelled match even if scores are present', async () => {
    const db = baseDb();
    db.tournament_matches = [publishedMatch({ status: 'cancelled' })];
    const result = await loadStandings(db);
    expect(result.groups[0].rows.find((r) => r.teamId === 'team-a')!.played).toBe(0);
  });

  it('excludes an abandoned match (no approved awarded-result rule exists yet)', async () => {
    const db = baseDb();
    db.tournament_matches = [publishedMatch({ status: 'abandoned' })];
    const result = await loadStandings(db);
    expect(result.groups[0].rows.find((r) => r.teamId === 'team-a')!.played).toBe(0);
  });

  it('excludes a BYE placeholder match', async () => {
    const db = baseDb();
    db.tournament_matches = [publishedMatch({ status: 'bye' })];
    const result = await loadStandings(db);
    expect(result.groups[0].rows.find((r) => r.teamId === 'team-a')!.played).toBe(0);
  });

  it('excludes a soft-deleted match', async () => {
    const db = baseDb();
    db.tournament_matches = [publishedMatch({ deleted_at: '2026-01-01T00:00:00Z' })];
    const result = await loadStandings(db);
    expect(result.groups[0].rows.find((r) => r.teamId === 'team-a')!.played).toBe(0);
  });

  it('excludes a match with an unresolved team (home_team_id still null)', async () => {
    const db = baseDb();
    db.tournament_matches = [publishedMatch({ home_team_id: null })];
    const result = await loadStandings(db);
    expect(result.groups[0].rows.find((r) => r.teamId === 'team-b')!.played).toBe(0);
  });

  it('is unaffected by a Quick Result submission payload with different scores than the official match row', async () => {
    const db = baseDb();
    db.tournament_matches = [publishedMatch({ regulation_home_score: 2, regulation_away_score: 0 })];
    // A Quick Result submission exists with a DIFFERENT score than the
    // official match row. The Standings Engine must never read this table.
    db.tournament_result_submissions = [
      { match_id: 'm1', stage: 'quick_result', payload: { home_score: 9, away_score: 9 }, status: 'submitted' },
    ];
    const result = await loadStandings(db);
    const teamA = result.groups[0].rows.find((r) => r.teamId === 'team-a')!;
    expect(teamA.goalsFor).toBe(2);
    expect(teamA.goalsAgainst).toBe(0);
  });
});

describe('getG16ThirdPlaceCandidates — D-29 identification only', () => {
  function g16Db(): Db {
    const db = baseDb();
    db.tournament_categories = [{ id: CATEGORY_ID, tournament_id: TOURNAMENT_ID, code: 'G-U16', deleted_at: null }];
    db.tournament_qualification_rules = [
      {
        tournament_id: TOURNAMENT_ID,
        category_id: CATEGORY_ID,
        qualify_rank_per_group: 2,
        best_third_placed_count: 2,
        best_third_placed_method: 'draw',
        cross_group_comparison: false,
      },
    ];
    db.tournament_groups = [
      { id: 'group-a', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, code: 'A' },
      { id: 'group-b', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, code: 'B' },
      { id: 'group-c', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, code: 'C' },
    ];
    db.tournament_teams = [
      { id: 'a1', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'A1', name: 'A1', deleted_at: null },
      { id: 'a2', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'A2', name: 'A2', deleted_at: null },
      { id: 'a3', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'A3', name: 'A3', deleted_at: null },
      { id: 'b1', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'B1', name: 'B1', deleted_at: null },
      { id: 'b2', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'B2', name: 'B2', deleted_at: null },
      { id: 'b3', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'B3', name: 'B3', deleted_at: null },
      { id: 'c1', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'C1', name: 'C1', deleted_at: null },
      { id: 'c2', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'C2', name: 'C2', deleted_at: null },
      { id: 'c3', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'C3', name: 'C3', deleted_at: null },
    ];
    db.tournament_group_members = [
      { group_id: 'group-a', team_id: 'a1' }, { group_id: 'group-a', team_id: 'a2' }, { group_id: 'group-a', team_id: 'a3' },
      { group_id: 'group-b', team_id: 'b1' }, { group_id: 'group-b', team_id: 'b2' }, { group_id: 'group-b', team_id: 'b3' },
      { group_id: 'group-c', team_id: 'c1' }, { group_id: 'group-c', team_id: 'c2' }, { group_id: 'group-c', team_id: 'c3' },
    ];
    function groupMatches(groupId: string, first: string, second: string, third: string): Row[] {
      const base = { category_id: CATEGORY_ID, group_id: groupId, status: 'finished', result_workflow_status: 'published', decided_by: 'regulation', deleted_at: null };
      return [
        { id: `${groupId}-1`, home_team_id: first, away_team_id: second, regulation_home_score: 2, regulation_away_score: 0, winner_team_id: first, ...base },
        { id: `${groupId}-2`, home_team_id: first, away_team_id: third, regulation_home_score: 2, regulation_away_score: 0, winner_team_id: first, ...base },
        { id: `${groupId}-3`, home_team_id: second, away_team_id: third, regulation_home_score: 1, regulation_away_score: 0, winner_team_id: second, ...base },
      ];
    }
    db.tournament_matches = [
      ...groupMatches('group-a', 'a1', 'a2', 'a3'),
      ...groupMatches('group-b', 'b1', 'b2', 'b3'),
      ...groupMatches('group-c', 'c1', 'c2', 'c3'),
    ];
    return db;
  }

  it('returns exactly three eligible candidates (one per group), never auto-selecting two', async () => {
    const client = createMockClient(g16Db());
    const result = await getG16ThirdPlaceCandidates({ client, tournamentId: TOURNAMENT_ID, categoryCode: 'G-U16' });
    expect(result.isComplete).toBe(true);
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map((c) => c.teamId).sort()).toEqual(['a3', 'b3', 'c3']);
    expect((result as unknown as { selected?: unknown }).selected).toBeUndefined();
  });

  it('returns the exact Thai incomplete message when a group has no published results yet', async () => {
    const db = g16Db();
    db.tournament_matches = (db.tournament_matches as Row[]).filter((m) => !String(m.id).startsWith('group-c-'));
    const client = createMockClient(db);
    const result = await getG16ThirdPlaceCandidates({ client, tournamentId: TOURNAMENT_ID, categoryCode: 'G-U16' });
    expect(result.isComplete).toBe(false);
    expect(result.incompleteReason).toBe(G16_INCOMPLETE_MESSAGE);
    expect(result.candidates.length).toBeLessThan(3);
  });
});

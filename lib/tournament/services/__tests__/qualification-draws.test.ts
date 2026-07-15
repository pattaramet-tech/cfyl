import { describe, expect, it } from 'vitest';
import {
  buildDrawSelectedMatchUpdates,
  getQualificationDrawState,
  previewQualificationDrawSelections,
  saveQualificationDrawSelections,
} from '../qualification-draws';

describe('buildDrawSelectedMatchUpdates', () => {
  it('updates draw_selected matches once the selected teams are known', () => {
    const updates = buildDrawSelectedMatchUpdates({
      matches: [
        {
          id: 'match-1',
          home_source_type: 'group_rank',
          home_source_ref: 'A:1',
          away_source_type: 'draw_selected',
          away_source_ref: 'G-U16-THIRD-DRAW-1',
          home_team_id: 'team-a1',
          away_team_id: null,
          sources_resolved_at: null,
        },
      ],
      teamIdsBySourceRef: new Map([['G-U16-THIRD-DRAW-1', 'team-c3']]),
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(updates).toEqual([
      {
        id: 'match-1',
        home_team_id: 'team-a1',
        away_team_id: 'team-c3',
        sources_resolved_at: '2026-07-15T12:00:00.000Z',
      },
    ]);
  });

  it('leaves matches unchanged while draw_selected is still unconfigured', () => {
    const updates = buildDrawSelectedMatchUpdates({
      matches: [
        {
          id: 'match-1',
          home_source_type: 'draw_selected',
          home_source_ref: 'G-U16-THIRD-DRAW-2',
          away_source_type: 'group_rank',
          away_source_ref: 'B:1',
          home_team_id: null,
          away_team_id: 'team-b1',
          sources_resolved_at: null,
        },
      ],
      teamIdsBySourceRef: new Map(),
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(updates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Minimal in-memory Supabase-like query builder mock, shared style with the
// schedule-import route tests, tailored to the exact chain shapes used by
// qualification-draws.ts (select/eq/is/in/order/maybeSingle/single/update/insert).
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
  } as unknown as Parameters<typeof saveQualificationDrawSelections>[0]['client'];
}

const team1 = { id: 'team-1', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'A3', name: 'Group A 3rd' };
const team2 = { id: 'team-2', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'B3', name: 'Group B 3rd' };
const team3 = { id: 'team-3', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'C3', name: 'Group C 3rd' };
const otherCategoryTeam = { id: 'team-x', tournament_id: 'tour-1', category_id: 'cat-2', team_code: 'X1', name: 'Other Cat Team' };

function buildDb(overrides: { existingMatches?: Row[]; existingDraw?: Row } = {}): Db {
  const db: Db = {
    tournament_categories: [
      { id: 'cat-1', tournament_id: 'tour-1', code: 'G-U16', deleted_at: null },
      { id: 'cat-2', tournament_id: 'tour-1', code: 'B-U12', deleted_at: null },
    ],
    tournament_qualification_rules: [
      { tournament_id: 'tour-1', category_id: 'cat-1', best_third_placed_count: 2, best_third_placed_method: 'draw' },
    ],
    tournament_teams: [team1, team2, team3, otherCategoryTeam],
    tournament_group_members: [
      { group_id: 'group-a', team_id: 'team-1' },
      { group_id: 'group-b', team_id: 'team-2' },
      { group_id: 'group-c', team_id: 'team-3' },
    ],
    tournament_matches: overrides.existingMatches || [
      {
        id: 'match-qf-1',
        tournament_id: 'tour-1',
        category_id: 'cat-1',
        match_code: 'G-U16-QF-001',
        home_source_type: 'group_rank',
        home_source_ref: 'A:1',
        away_source_type: 'draw_selected',
        away_source_ref: 'G-U16-THIRD-DRAW-1',
        home_team_id: 'team-a1',
        away_team_id: null,
        sources_resolved_at: null,
        deleted_at: null,
      },
      {
        id: 'match-qf-2',
        tournament_id: 'tour-1',
        category_id: 'cat-1',
        match_code: 'G-U16-QF-002',
        home_source_type: 'group_rank',
        home_source_ref: 'B:1',
        away_source_type: 'draw_selected',
        away_source_ref: 'G-U16-THIRD-DRAW-2',
        home_team_id: 'team-b1',
        away_team_id: null,
        sources_resolved_at: null,
        deleted_at: null,
      },
    ],
    tournament_qualification_draws: overrides.existingDraw ? [overrides.existingDraw] : [],
    tournament_qualification_draw_candidates: [],
  };
  return db;
}

const validAssignments = [
  { sourceRef: 'G-U16-THIRD-DRAW-1', teamId: 'team-1' },
  { sourceRef: 'G-U16-THIRD-DRAW-2', teamId: 'team-2' },
];

describe('getQualificationDrawState', () => {
  it('loads eligible candidate options scoped to the category', async () => {
    const db = buildDb();
    const state = await getQualificationDrawState({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
    });

    expect(state.candidateOptions.map((c) => c.teamId).sort()).toEqual(['team-1', 'team-2', 'team-3']);
    expect(state.placeholderSourceRefs).toEqual(['G-U16-THIRD-DRAW-1', 'G-U16-THIRD-DRAW-2']);
    expect(state.versions).toEqual([]);
  });
});

describe('saveQualificationDrawSelections — candidate validation', () => {
  it('requires exactly three candidates', async () => {
    const db = buildDb();
    await expect(
      saveQualificationDrawSelections({
        client: createMockClient(db),
        tournamentId: 'tour-1',
        categoryCode: 'G-U16',
        candidateTeamIds: ['team-1', 'team-2'],
        assignments: validAssignments,
        actorUserId: 'admin-1',
      })
    ).rejects.toThrow(/Exactly 3 candidate teams/);
  });

  it('rejects duplicate candidates', async () => {
    const db = buildDb();
    await expect(
      saveQualificationDrawSelections({
        client: createMockClient(db),
        tournamentId: 'tour-1',
        categoryCode: 'G-U16',
        candidateTeamIds: ['team-1', 'team-1', 'team-2'],
        assignments: validAssignments,
        actorUserId: 'admin-1',
      })
    ).rejects.toThrow(/Duplicate candidate team|Exactly 3/);
  });

  it('rejects a candidate that does not belong to the category', async () => {
    const db = buildDb();
    await expect(
      saveQualificationDrawSelections({
        client: createMockClient(db),
        tournamentId: 'tour-1',
        categoryCode: 'G-U16',
        candidateTeamIds: ['team-1', 'team-2', 'team-x'],
        assignments: validAssignments,
        actorUserId: 'admin-1',
      })
    ).rejects.toThrow(/does not belong to this category/);
  });

  it('rejects a selected team that is not among the confirmed candidates', async () => {
    const db = buildDb();
    await expect(
      saveQualificationDrawSelections({
        client: createMockClient(db),
        tournamentId: 'tour-1',
        categoryCode: 'G-U16',
        candidateTeamIds: ['team-1', 'team-2', 'team-3'],
        assignments: [
          { sourceRef: 'G-U16-THIRD-DRAW-1', teamId: 'team-x' },
          { sourceRef: 'G-U16-THIRD-DRAW-2', teamId: 'team-2' },
        ],
        actorUserId: 'admin-1',
      })
    ).rejects.toThrow(/not an eligible third-place team/);
  });

  it('rejects the same team selected in both placeholders', async () => {
    const db = buildDb();
    await expect(
      saveQualificationDrawSelections({
        client: createMockClient(db),
        tournamentId: 'tour-1',
        categoryCode: 'G-U16',
        candidateTeamIds: ['team-1', 'team-2', 'team-3'],
        assignments: [
          { sourceRef: 'G-U16-THIRD-DRAW-1', teamId: 'team-1' },
          { sourceRef: 'G-U16-THIRD-DRAW-2', teamId: 'team-1' },
        ],
        actorUserId: 'admin-1',
      })
    ).rejects.toThrow(/cannot resolve to the same team/);
  });
});

describe('saveQualificationDrawSelections — save behavior', () => {
  it('preserves source_type/source_ref and resolves all referencing matches', async () => {
    const db = buildDb();
    const result = await saveQualificationDrawSelections({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: validAssignments,
      actorUserId: 'admin-1',
    });

    expect(result.updatedMatchIds.sort()).toEqual(['match-qf-1', 'match-qf-2']);
    const match1 = db.tournament_matches.find((m) => m.id === 'match-qf-1');
    const match2 = db.tournament_matches.find((m) => m.id === 'match-qf-2');
    expect(match1?.away_team_id).toBe('team-1');
    expect(match1?.away_source_type).toBe('draw_selected');
    expect(match1?.away_source_ref).toBe('G-U16-THIRD-DRAW-1');
    expect(match2?.away_team_id).toBe('team-2');
    expect(match2?.away_source_type).toBe('draw_selected');
    expect(match2?.away_source_ref).toBe('G-U16-THIRD-DRAW-2');
  });

  it('preserves selected order (slot 1 vs slot 2) in stored candidate rows', async () => {
    const db = buildDb();
    await saveQualificationDrawSelections({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: [
        { sourceRef: 'G-U16-THIRD-DRAW-1', teamId: 'team-3' },
        { sourceRef: 'G-U16-THIRD-DRAW-2', teamId: 'team-1' },
      ],
      actorUserId: 'admin-1',
    });

    const candidates = db.tournament_qualification_draw_candidates;
    expect(candidates.find((c) => c.team_id === 'team-3')).toMatchObject({ is_selected: true, draw_order: 1 });
    expect(candidates.find((c) => c.team_id === 'team-1')).toMatchObject({ is_selected: true, draw_order: 2 });
    expect(candidates.find((c) => c.team_id === 'team-2')).toMatchObject({ is_selected: false, draw_order: null });
  });

  it('writes exactly one draw and one candidate set per confirmation', async () => {
    const db = buildDb();
    await saveQualificationDrawSelections({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: validAssignments,
      actorUserId: 'admin-1',
    });

    expect(db.tournament_qualification_draws).toHaveLength(1);
    expect(db.tournament_qualification_draw_candidates).toHaveLength(3);
  });

  it('records the manual candidate confirmation marker in the note', async () => {
    const db = buildDb();
    await saveQualificationDrawSelections({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: validAssignments,
      note: 'จับฉลากหน้างานวันที่ 15 ก.ค.',
      actorUserId: 'admin-1',
    });

    expect(db.tournament_qualification_draws[0].note).toContain('MANUAL_CANDIDATE_CONFIRMATION');
    expect(db.tournament_qualification_draws[0].note).toContain('จับฉลากหน้างาน');
  });
});

describe('saveQualificationDrawSelections — correction and versioning', () => {
  it('creates a new version and supersedes the previous active draw on correction', async () => {
    const db = buildDb();
    const first = await saveQualificationDrawSelections({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: validAssignments,
      actorUserId: 'admin-1',
    });

    const second = await saveQualificationDrawSelections({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: [
        { sourceRef: 'G-U16-THIRD-DRAW-1', teamId: 'team-2' },
        { sourceRef: 'G-U16-THIRD-DRAW-2', teamId: 'team-3' },
      ],
      actorUserId: 'admin-2',
    });

    expect(second.version).toBe(first.version + 1);
    expect(db.tournament_qualification_draws).toHaveLength(2);
    const firstDraw = db.tournament_qualification_draws.find((d) => d.id === first.drawId);
    const secondDraw = db.tournament_qualification_draws.find((d) => d.id === second.drawId);
    // Previous version is superseded, not deleted.
    expect(firstDraw).toBeDefined();
    expect(firstDraw?.superseded_at).not.toBeNull();
    expect(secondDraw?.superseded_at ?? null).toBeNull();
    // Correction resolves matches to the new selections.
    const match1 = db.tournament_matches.find((m) => m.id === 'match-qf-1');
    expect(match1?.away_team_id).toBe('team-2');
  });
});

describe('previewQualificationDrawSelections', () => {
  it('reports affected matches without writing any data', async () => {
    const db = buildDb();
    const result = await previewQualificationDrawSelections({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: validAssignments,
    });

    expect(result.affectedMatches).toHaveLength(2);
    expect(result.affectedMatches.find((m) => m.matchCode === 'G-U16-QF-001')).toMatchObject({
      side: 'away',
      sourceRef: 'G-U16-THIRD-DRAW-1',
      resolvedTeamId: 'team-1',
    });

    // No writes of any kind.
    expect(db.tournament_qualification_draws).toHaveLength(0);
    expect(db.tournament_qualification_draw_candidates).toHaveLength(0);
    const match1 = db.tournament_matches.find((m) => m.id === 'match-qf-1');
    expect(match1?.away_team_id).toBeNull();
  });

  it('still validates candidates and assignments during preview', async () => {
    const db = buildDb();
    await expect(
      previewQualificationDrawSelections({
        client: createMockClient(db),
        tournamentId: 'tour-1',
        categoryCode: 'G-U16',
        candidateTeamIds: ['team-1', 'team-2'],
        assignments: validAssignments,
      })
    ).rejects.toThrow(/Exactly 3 candidate teams/);
  });
});

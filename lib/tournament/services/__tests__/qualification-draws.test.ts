import { describe, expect, it } from 'vitest';
import { getQualificationDrawState, previewQualificationDrawSelections, saveQualificationDrawSelections } from '../qualification-draws';
import {
  mockSaveQualificationDrawAssignmentRpc,
  type RpcFailureInjection,
} from './mockSaveQualificationDrawAssignmentRpc';

// ---------------------------------------------------------------------------
// Minimal in-memory Supabase-like query builder mock, shared style with the
// schedule-import route tests, tailored to the exact chain shapes used by
// qualification-draws.ts (select/eq/is/in/order/maybeSingle/single), plus an
// .rpc() hook wired to the transactional save_qualification_draw_assignment
// mock — this is now the ONLY write path Save exercises.
// ---------------------------------------------------------------------------
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
    rpc(fnName: string, args: Record<string, unknown>) {
      if (fnName !== 'save_qualification_draw_assignment') {
        return Promise.resolve({ data: null, error: { message: `mock client: unknown rpc "${fnName}"` } });
      }
      // Synchronous body — by the time this Promise is constructed, the
      // staged-write-then-commit sequence below has already fully run (or
      // failed without touching `db`). Two concurrent callers therefore
      // cannot interleave mid-transaction, mirroring the real RPC's
      // category-row FOR UPDATE lock for this test's purposes.
      const result = mockSaveQualificationDrawAssignmentRpc(db, args as never, options.injection);
      return Promise.resolve(result);
    },
  } as unknown as Parameters<typeof saveQualificationDrawSelections>[0]['client'];
}

const team1 = { id: 'team-1', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'A3', name: 'Group A 3rd' };
const team2 = { id: 'team-2', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'B3', name: 'Group B 3rd' };
const team3 = { id: 'team-3', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'C3', name: 'Group C 3rd' };
const otherCategoryTeam = { id: 'team-x', tournament_id: 'tour-1', category_id: 'cat-2', team_code: 'X1', name: 'Other Cat Team' };

// Standings-computable fixture: each of team-1/team-2/team-3 must genuinely
// finish 3rd (via a published, official round-robin) in its own group — this
// is now the ONLY legitimate source for the "eligible candidate" checks that
// getQualificationDrawState / save / preview all perform, replacing the old
// "all teams in category" placeholder source.
function groupResultMatches(groupId: string, first: string, second: string, third: string): Row[] {
  const base = {
    tournament_id: 'tour-1',
    category_id: 'cat-1',
    group_id: groupId,
    status: 'finished',
    result_workflow_status: 'published',
    decided_by: 'regulation',
    deleted_at: null,
  };
  return [
    { id: `${groupId}-m1`, home_team_id: first, away_team_id: second, regulation_home_score: 2, regulation_away_score: 0, winner_team_id: first, ...base },
    { id: `${groupId}-m2`, home_team_id: first, away_team_id: third, regulation_home_score: 2, regulation_away_score: 0, winner_team_id: first, ...base },
    { id: `${groupId}-m3`, home_team_id: second, away_team_id: third, regulation_home_score: 1, regulation_away_score: 0, winner_team_id: second, ...base },
  ];
}

function buildDb(overrides: { existingMatches?: Row[]; existingDraw?: Row; tournamentStatus?: string } = {}): Db {
  const db: Db = {
    tournaments: [{ id: 'tour-1', slug: 'cfyl-2026', status: overrides.tournamentStatus || 'active', deleted_at: null }],
    tournament_categories: [
      { id: 'cat-1', tournament_id: 'tour-1', code: 'G-U16', deleted_at: null },
      { id: 'cat-2', tournament_id: 'tour-1', code: 'B-U12', deleted_at: null },
    ],
    tournament_groups: [
      { id: 'group-a', tournament_id: 'tour-1', category_id: 'cat-1', code: 'A' },
      { id: 'group-b', tournament_id: 'tour-1', category_id: 'cat-1', code: 'B' },
      { id: 'group-c', tournament_id: 'tour-1', category_id: 'cat-1', code: 'C' },
    ],
    tournament_qualification_rules: [
      {
        tournament_id: 'tour-1',
        category_id: 'cat-1',
        qualify_rank_per_group: 2,
        best_third_placed_count: 2,
        best_third_placed_method: 'draw',
        cross_group_comparison: false,
      },
    ],
    tournament_teams: [
      team1,
      team2,
      team3,
      otherCategoryTeam,
      { id: 'team-a1', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'A1', name: 'Group A 1st' },
      { id: 'team-a2', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'A2', name: 'Group A 2nd' },
      { id: 'team-b1', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'B1', name: 'Group B 1st' },
      { id: 'team-b2', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'B2', name: 'Group B 2nd' },
      { id: 'team-c1', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'C1', name: 'Group C 1st' },
      { id: 'team-c2', tournament_id: 'tour-1', category_id: 'cat-1', team_code: 'C2', name: 'Group C 2nd' },
    ],
    tournament_group_members: [
      { group_id: 'group-a', team_id: 'team-a1' },
      { group_id: 'group-a', team_id: 'team-a2' },
      { group_id: 'group-a', team_id: 'team-1' },
      { group_id: 'group-b', team_id: 'team-b1' },
      { group_id: 'group-b', team_id: 'team-b2' },
      { group_id: 'group-b', team_id: 'team-2' },
      { group_id: 'group-c', team_id: 'team-c1' },
      { group_id: 'group-c', team_id: 'team-c2' },
      { group_id: 'group-c', team_id: 'team-3' },
    ],
    tournament_match_cards: [],
    tournament_standing_overrides: [],
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
      {
        // Unrelated fixture: does not reference draw_selected at all.
        id: 'match-unrelated',
        tournament_id: 'tour-1',
        category_id: 'cat-1',
        match_code: 'G-U16-GRP-001',
        home_source_type: 'team',
        home_source_ref: null,
        away_source_type: 'team',
        away_source_ref: null,
        home_team_id: 'team-1',
        away_team_id: 'team-2',
        sources_resolved_at: null,
        deleted_at: null,
      },
      ...groupResultMatches('group-a', 'team-a1', 'team-a2', 'team-1'),
      ...groupResultMatches('group-b', 'team-b1', 'team-b2', 'team-2'),
      ...groupResultMatches('group-c', 'team-c1', 'team-c2', 'team-3'),
    ],
    tournament_qualification_draws: overrides.existingDraw ? [overrides.existingDraw] : [],
    tournament_qualification_draw_candidates: [],
    tournament_audit_logs: [],
  };
  return db;
}

const validAssignments = [
  { sourceRef: 'G-U16-THIRD-DRAW-1', teamId: 'team-1' },
  { sourceRef: 'G-U16-THIRD-DRAW-2', teamId: 'team-2' },
];

function snapshotUnrelated(db: Db) {
  return JSON.stringify(db.tournament_matches.find((m) => m.id === 'match-unrelated'));
}

describe('getQualificationDrawState', () => {
  it('loads eligible candidate options scoped to the category and reports no active draw', async () => {
    const db = buildDb();
    const state = await getQualificationDrawState({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
    });

    expect(state.candidateOptions.map((c) => c.teamId).sort()).toEqual(['team-1', 'team-2', 'team-3']);
    expect(state.placeholderSourceRefs).toEqual(['G-U16-THIRD-DRAW-1', 'G-U16-THIRD-DRAW-2']);
    expect(state.versions).toEqual([]);
    expect(state.activeDrawId).toBeNull();
  });
});

describe('saveQualificationDrawSelections — candidate validation (fast TS pre-validation)', () => {
  it('requires exactly three candidates', async () => {
    const db = buildDb();
    await expect(
      saveQualificationDrawSelections({
        client: createMockClient(db),
        tournamentId: 'tour-1',
        categoryCode: 'G-U16',
        candidateTeamIds: ['team-1', 'team-2'],
        assignments: validAssignments,
        expectedActiveDrawId: null,
        actorUserId: 'admin-1',
      })
    ).rejects.toThrow(/Exactly 3 candidate teams/);
    expect(db.tournament_qualification_draws).toHaveLength(0);
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
        expectedActiveDrawId: null,
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
        expectedActiveDrawId: null,
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
        expectedActiveDrawId: null,
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
        expectedActiveDrawId: null,
        actorUserId: 'admin-1',
      })
    ).rejects.toThrow(/cannot resolve to the same team/);
  });
});

describe('saveQualificationDrawSelections — atomic write via RPC', () => {
  it('performs exactly one client.rpc write call and returns its result verbatim', async () => {
    const db = buildDb();
    let rpcCallCount = 0;
    const client = createMockClient(db);
    const originalRpc = client.rpc.bind(client);
    client.rpc = ((fnName: string, args: Record<string, unknown>) => {
      rpcCallCount += 1;
      return originalRpc(fnName, args);
    }) as typeof client.rpc;

    const result = await saveQualificationDrawSelections({
      client,
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: validAssignments,
      expectedActiveDrawId: null,
      actorUserId: 'admin-1',
      actorEmail: 'admin@test.com',
    });

    expect(rpcCallCount).toBe(1);
    expect(result.drawId).toBeTruthy();
    expect(result.previousDrawId).toBeNull();
  });

  it('preserves source_type/source_ref and resolves all referencing matches, leaving unrelated Matches untouched', async () => {
    const db = buildDb();
    const unrelatedBefore = snapshotUnrelated(db);

    const result = await saveQualificationDrawSelections({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: validAssignments,
      expectedActiveDrawId: null,
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
    expect(snapshotUnrelated(db)).toBe(unrelatedBefore);
  });

  it('resolves every affected Match in one pass — no partial resolution', async () => {
    const db = buildDb();
    await saveQualificationDrawSelections({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: validAssignments,
      expectedActiveDrawId: null,
      actorUserId: 'admin-1',
    });

    const match1 = db.tournament_matches.find((m) => m.id === 'match-qf-1');
    const match2 = db.tournament_matches.find((m) => m.id === 'match-qf-2');
    expect(match1?.away_team_id).not.toBeNull();
    expect(match2?.away_team_id).not.toBeNull();
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
      expectedActiveDrawId: null,
      actorUserId: 'admin-1',
    });

    const candidates = db.tournament_qualification_draw_candidates;
    expect(candidates.find((c) => c.team_id === 'team-3')).toMatchObject({ is_selected: true, draw_order: 1 });
    expect(candidates.find((c) => c.team_id === 'team-1')).toMatchObject({ is_selected: true, draw_order: 2 });
    expect(candidates.find((c) => c.team_id === 'team-2')).toMatchObject({ is_selected: false, draw_order: null });
  });

  it('writes exactly one draw, one candidate set, and one audit log per confirmation', async () => {
    const db = buildDb();
    const result = await saveQualificationDrawSelections({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: validAssignments,
      expectedActiveDrawId: null,
      actorUserId: 'admin-1',
      actorEmail: 'admin@test.com',
    });

    expect(db.tournament_qualification_draws).toHaveLength(1);
    expect(db.tournament_qualification_draw_candidates).toHaveLength(3);
    const auditEntries = db.tournament_audit_logs.filter((log) => log.entity_id === result.drawId);
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].action).toBe('qualification-draws.confirm_manual_placeholder_assignment');
  });

  it('records the manual candidate confirmation marker in the note', async () => {
    const db = buildDb();
    await saveQualificationDrawSelections({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: validAssignments,
      expectedActiveDrawId: null,
      note: 'จับฉลากหน้างานวันที่ 15 ก.ค.',
      actorUserId: 'admin-1',
    });

    expect(db.tournament_qualification_draws[0].note).toContain('MANUAL_CANDIDATE_CONFIRMATION');
    expect(db.tournament_qualification_draws[0].note).toContain('จับฉลากหน้างาน');
  });
});

describe('saveQualificationDrawSelections — expected_active_draw_id concurrency token', () => {
  it('initial Save with expected_active_draw_id=null succeeds only when no active draw exists', async () => {
    const db = buildDb();
    const result = await saveQualificationDrawSelections({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: validAssignments,
      expectedActiveDrawId: null,
      actorUserId: 'admin-1',
    });
    expect(result.version).toBe(1);
  });

  it('a stale initial Save (expected null, but an active draw already exists) is rejected with QUALIFICATION_DRAW_STALE_STATE and makes zero writes', async () => {
    const db = buildDb();
    await saveQualificationDrawSelections({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: validAssignments,
      expectedActiveDrawId: null,
      actorUserId: 'admin-1',
    });
    const drawCountAfterFirst = db.tournament_qualification_draws.length;

    await expect(
      saveQualificationDrawSelections({
        client: createMockClient(db),
        tournamentId: 'tour-1',
        categoryCode: 'G-U16',
        candidateTeamIds: ['team-1', 'team-2', 'team-3'],
        assignments: validAssignments,
        expectedActiveDrawId: null, // stale — an active draw now exists
        actorUserId: 'admin-2',
      })
    ).rejects.toThrow(/QUALIFICATION_DRAW_STALE_STATE/);

    expect(db.tournament_qualification_draws).toHaveLength(drawCountAfterFirst);
  });

  it('a correction requires the exact currently-active draw id', async () => {
    const db = buildDb();
    const first = await saveQualificationDrawSelections({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: validAssignments,
      expectedActiveDrawId: null,
      actorUserId: 'admin-1',
    });

    await expect(
      saveQualificationDrawSelections({
        client: createMockClient(db),
        tournamentId: 'tour-1',
        categoryCode: 'G-U16',
        candidateTeamIds: ['team-1', 'team-2', 'team-3'],
        assignments: validAssignments,
        expectedActiveDrawId: 'some-other-stale-draw-id',
        actorUserId: 'admin-2',
      })
    ).rejects.toThrow(/QUALIFICATION_DRAW_STALE_STATE/);

    const second = await saveQualificationDrawSelections({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: [
        { sourceRef: 'G-U16-THIRD-DRAW-1', teamId: 'team-2' },
        { sourceRef: 'G-U16-THIRD-DRAW-2', teamId: 'team-3' },
      ],
      expectedActiveDrawId: first.drawId,
      actorUserId: 'admin-2',
    });
    expect(second.version).toBe(2);
    expect(second.previousDrawId).toBe(first.drawId);
  });

  it('two concurrent corrections built from the same expected_active_draw_id cannot both succeed', async () => {
    const db = buildDb();
    const first = await saveQualificationDrawSelections({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: validAssignments,
      expectedActiveDrawId: null,
      actorUserId: 'admin-1',
    });

    const attemptA = saveQualificationDrawSelections({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: [
        { sourceRef: 'G-U16-THIRD-DRAW-1', teamId: 'team-2' },
        { sourceRef: 'G-U16-THIRD-DRAW-2', teamId: 'team-3' },
      ],
      expectedActiveDrawId: first.drawId,
      actorUserId: 'admin-A',
    }).then(
      (r) => ({ ok: true as const, result: r }),
      (e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })
    );
    const attemptB = saveQualificationDrawSelections({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: [
        { sourceRef: 'G-U16-THIRD-DRAW-1', teamId: 'team-3' },
        { sourceRef: 'G-U16-THIRD-DRAW-2', teamId: 'team-1' },
      ],
      expectedActiveDrawId: first.drawId,
      actorUserId: 'admin-B',
    }).then(
      (r) => ({ ok: true as const, result: r }),
      (e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })
    );

    const [outcomeA, outcomeB] = await Promise.all([attemptA, attemptB]);
    const succeeded = [outcomeA, outcomeB].filter((o) => o.ok);
    const failed = [outcomeA, outcomeB].filter((o) => !o.ok);

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as { ok: false; error: string }).error).toMatch(/QUALIFICATION_DRAW_STALE_STATE/);

    // Exactly one active draw remains, at version 2 — never both, never neither.
    const activeDraws = db.tournament_qualification_draws.filter((d) => !d.superseded_at);
    expect(activeDraws).toHaveLength(1);
    expect(activeDraws[0].version).toBe(2);
  });
});

describe('saveQualificationDrawSelections — rollback on mid-sequence failure', () => {
  it('a candidate-insertion failure rolls back the supersede and the new draw insertion', async () => {
    const db = buildDb();
    await expect(
      saveQualificationDrawSelections({
        client: createMockClient(db, { injection: { failAt: 'candidates' } }),
        tournamentId: 'tour-1',
        categoryCode: 'G-U16',
        candidateTeamIds: ['team-1', 'team-2', 'team-3'],
        assignments: validAssignments,
        expectedActiveDrawId: null,
        actorUserId: 'admin-1',
      })
    ).rejects.toThrow(/SIMULATED_FAILURE/);

    expect(db.tournament_qualification_draws).toHaveLength(0);
    expect(db.tournament_qualification_draw_candidates).toHaveLength(0);
  });

  it('a Match-update failure rolls back the draw and candidate rows', async () => {
    const db = buildDb();
    await expect(
      saveQualificationDrawSelections({
        client: createMockClient(db, { injection: { failAt: 'matchUpdate' } }),
        tournamentId: 'tour-1',
        categoryCode: 'G-U16',
        candidateTeamIds: ['team-1', 'team-2', 'team-3'],
        assignments: validAssignments,
        expectedActiveDrawId: null,
        actorUserId: 'admin-1',
      })
    ).rejects.toThrow(/SIMULATED_FAILURE/);

    expect(db.tournament_qualification_draws).toHaveLength(0);
    expect(db.tournament_qualification_draw_candidates).toHaveLength(0);
    const match1 = db.tournament_matches.find((m) => m.id === 'match-qf-1');
    expect(match1?.away_team_id).toBeNull();
  });

  it('an audit-insertion failure rolls back the draw, candidates, and Match updates', async () => {
    const db = buildDb();
    await expect(
      saveQualificationDrawSelections({
        client: createMockClient(db, { injection: { failAt: 'audit' } }),
        tournamentId: 'tour-1',
        categoryCode: 'G-U16',
        candidateTeamIds: ['team-1', 'team-2', 'team-3'],
        assignments: validAssignments,
        expectedActiveDrawId: null,
        actorUserId: 'admin-1',
      })
    ).rejects.toThrow(/SIMULATED_FAILURE/);

    expect(db.tournament_qualification_draws).toHaveLength(0);
    expect(db.tournament_qualification_draw_candidates).toHaveLength(0);
    expect(db.tournament_audit_logs).toHaveLength(0);
    const match1 = db.tournament_matches.find((m) => m.id === 'match-qf-1');
    const match2 = db.tournament_matches.find((m) => m.id === 'match-qf-2');
    expect(match1?.away_team_id).toBeNull();
    expect(match2?.away_team_id).toBeNull();
  });
});

describe('saveQualificationDrawSelections — correction and versioning', () => {
  it('creates a new version and supersedes the previous active draw on correction, keeping history append-only', async () => {
    const db = buildDb();
    const first = await saveQualificationDrawSelections({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: validAssignments,
      expectedActiveDrawId: null,
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
      expectedActiveDrawId: first.drawId,
      actorUserId: 'admin-2',
    });

    expect(second.version).toBe(first.version + 1);
    // Append-only: both versions still present, nothing deleted.
    expect(db.tournament_qualification_draws).toHaveLength(2);
    const firstDraw = db.tournament_qualification_draws.find((d) => d.id === first.drawId);
    const secondDraw = db.tournament_qualification_draws.find((d) => d.id === second.drawId);
    expect(firstDraw).toBeDefined();
    expect(firstDraw?.superseded_at).not.toBeNull();
    expect(secondDraw?.superseded_at ?? null).toBeNull();
    const match1 = db.tournament_matches.find((m) => m.id === 'match-qf-1');
    expect(match1?.away_team_id).toBe('team-2');
  });
});

describe('previewQualificationDrawSelections', () => {
  it('reports affected matches and the current active draw id without writing any data', async () => {
    const db = buildDb();
    const result = await previewQualificationDrawSelections({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      categoryCode: 'G-U16',
      candidateTeamIds: ['team-1', 'team-2', 'team-3'],
      assignments: validAssignments,
    });

    expect(result.activeDrawId).toBeNull();
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

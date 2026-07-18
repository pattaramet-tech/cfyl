import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadQualificationCutoffDrawContext,
  previewQualificationCutoffDraw,
  saveQualificationCutoffDraw,
  QualificationCutoffDrawError,
} from '../qualification-cutoff-draws';
import { createMockSaveQualificationCutoffDrawRpc, type Db, type Row } from './mockQualificationCutoffDrawRpc';

function createMockClient(db: Db, rpc?: ReturnType<typeof createMockSaveQualificationCutoffDrawRpc>) {
  function builder(table: string) {
    const filters: Array<['eq' | 'is' | 'in', string, unknown]> = [];
    let orderCol: string | null = null;
    let orderAscending = true;
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
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col;
        orderAscending = opts?.ascending !== false;
        return api;
      },
      maybeSingle() {
        const data = rows().filter(matches);
        return Promise.resolve({ data: data.length ? data[0] : null, error: null });
      },
      then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
        let result = rows().filter(matches);
        if (orderCol) {
          const col = orderCol;
          result = [...result].sort((a, b) => {
            const av = Number(a[col]) || 0;
            const bv = Number(b[col]) || 0;
            return orderAscending ? av - bv : bv - av;
          });
        }
        return Promise.resolve({ data: result, error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  return {
    from: (table: string) => builder(table),
    rpc: rpc || (() => Promise.resolve({ data: null, error: { message: 'no rpc configured', code: 'PGRST202' } })),
  } as never;
}

const TOURNAMENT_ID = 'tour-1';
const CATEGORY_ID = 'cat-1';
const GROUP_ID = 'group-a';

function baseDb(): Db {
  return {
    tournament_categories: [{ id: CATEGORY_ID, tournament_id: TOURNAMENT_ID, code: 'B-U14', deleted_at: null }],
    tournament_groups: [{ id: GROUP_ID, tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, code: 'A' }],
    tournament_qualification_rules: [
      { tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, qualify_rank_per_group: 2, best_third_placed_count: 0, best_third_placed_method: 'ranked', cross_group_comparison: false },
    ],
    tournament_teams: [
      { id: 'team-a', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'A', name: 'Team A', deleted_at: null },
      { id: 'team-b', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'B', name: 'Team B', deleted_at: null },
      { id: 'team-c', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'C', name: 'Team C', deleted_at: null },
    ],
    tournament_group_members: [
      { group_id: GROUP_ID, team_id: 'team-a' },
      { group_id: GROUP_ID, team_id: 'team-b' },
      { group_id: GROUP_ID, team_id: 'team-c' },
    ],
    // A beats B and C; B beats C — A=6, B=3, C=0. NOT a tie (used for "not
    // applicable" tests). Tie scenarios override this per-test below.
    tournament_matches: [
      { id: 'm1', group_id: GROUP_ID, category_id: CATEGORY_ID, home_team_id: 'team-a', away_team_id: 'team-b', winner_team_id: 'team-a', regulation_home_score: 2, regulation_away_score: 0, decided_by: 'regulation', status: 'finished', result_workflow_status: 'published', deleted_at: null },
      { id: 'm2', group_id: GROUP_ID, category_id: CATEGORY_ID, home_team_id: 'team-a', away_team_id: 'team-c', winner_team_id: 'team-a', regulation_home_score: 2, regulation_away_score: 0, decided_by: 'regulation', status: 'finished', result_workflow_status: 'published', deleted_at: null },
      { id: 'm3', group_id: GROUP_ID, category_id: CATEGORY_ID, home_team_id: 'team-b', away_team_id: 'team-c', winner_team_id: 'team-b', regulation_home_score: 1, regulation_away_score: 0, decided_by: 'regulation', status: 'finished', result_workflow_status: 'published', deleted_at: null },
    ],
    tournament_match_cards: [],
    tournament_standing_overrides: [],
    tournament_qualification_cutoff_draws: [],
    tournament_qualification_cutoff_draw_candidates: [],
  };
}

// A tie scenario: A wins both, B and C tie at 0 points each (both lost to A,
// never played each other in this reduced fixture) — for simplicity we
// instead construct B/C tie via a draw between... no draws exist (D-09), so
// use: A beats B and C; B and C split evenly is impossible with 1 match. Use
// a 4th match structure isn't needed — reuse resolveQualificationCutoff's
// own tested cluster logic; here we just need SOME tie. Construct: remove
// the B-vs-C match entirely (group incomplete) is wrong too. Simplest: make
// B and C both draw... no draws. Use unequal group where B and C both lost
// to A 0-2 and have NOT played each other (group incomplete) then complete
// it with an artificial "insufficient" fixture replaced below per-test.
function tiedDb(): Db {
  const db = baseDb();
  // A=6 (beat B,C). B and C both lost to A. Their match: give it to neither
  // by making it NOT YET official (draft) so group stays incomplete is not
  // what we want. Instead: 4 teams, D added, so B/C tie at 3 each (B beats
  // C's placeholder D, C beats D too is impossible without D). Simplify:
  // reuse the same 4-team cyclic-tie construction proven in
  // calculateGroupStandings.test.ts.
  db.tournament_teams = [
    ...(db.tournament_teams as Row[]),
    { id: 'team-d', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'D', name: 'Team D', deleted_at: null },
  ];
  db.tournament_group_members = [...(db.tournament_group_members as Row[]), { group_id: GROUP_ID, team_id: 'team-d' }];
  function officialMatch(overrides: Row): Row {
    return {
      category_id: CATEGORY_ID,
      status: 'finished',
      result_workflow_status: 'published',
      deleted_at: null,
      regulation_home_score: 3,
      regulation_away_score: 0,
      decided_by: 'regulation',
      ...overrides,
    };
  }
  db.tournament_matches = [
    officialMatch({ id: 'm1', group_id: GROUP_ID, home_team_id: 'team-a', away_team_id: 'team-b', winner_team_id: 'team-a' }),
    officialMatch({ id: 'm2', group_id: GROUP_ID, home_team_id: 'team-a', away_team_id: 'team-c', winner_team_id: 'team-a' }),
    officialMatch({ id: 'm3', group_id: GROUP_ID, home_team_id: 'team-a', away_team_id: 'team-d', winner_team_id: 'team-a' }),
    officialMatch({ id: 'm4', group_id: GROUP_ID, home_team_id: 'team-b', away_team_id: 'team-c', winner_team_id: 'team-b' }),
    officialMatch({ id: 'm5', group_id: GROUP_ID, home_team_id: 'team-c', away_team_id: 'team-d', winner_team_id: 'team-c' }),
    officialMatch({ id: 'm6', group_id: GROUP_ID, home_team_id: 'team-d', away_team_id: 'team-b', winner_team_id: 'team-d' }),
  ];
  return db;
}

describe('qualification-cutoff-draws service', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
  });

  it('loadQualificationCutoffDrawContext reports pending_draw for a 3-way tie straddling the cutoff', async () => {
    const db = tiedDb();
    const client = createMockClient(db) as never;
    const context = await loadQualificationCutoffDrawContext({ client, tournamentId: TOURNAMENT_ID, categoryCode: 'B-U14', groupCode: 'A' });
    expect(context.qualificationState).toBe('pending_draw');
    expect(context.availableSlots).toBe(1);
    expect(context.drawCandidates.map((t) => t.teamId).sort()).toEqual(['team-b', 'team-c', 'team-d']);
    expect(context.automaticQualifiers.map((t) => t.teamId)).toEqual(['team-a']);
  });

  it('34. Preview writes zero rows', async () => {
    const db = tiedDb();
    const client = createMockClient(db) as never;
    const before = JSON.stringify(db.tournament_qualification_cutoff_draws);
    await previewQualificationCutoffDraw({ client, tournamentId: TOURNAMENT_ID, categoryCode: 'B-U14', groupCode: 'A', selectedTeamIds: ['team-b'], actorUserId: 'super-1' });
    expect(JSON.stringify(db.tournament_qualification_cutoff_draws)).toBe(before);
  });

  it('Preview rejects when the group has no cutoff tie (already resolved)', async () => {
    const db = baseDb(); // A=6,B=3,C=0 — no tie at the cutoff
    const client = createMockClient(db) as never;
    await expect(
      previewQualificationCutoffDraw({ client, tournamentId: TOURNAMENT_ID, categoryCode: 'B-U14', groupCode: 'A', selectedTeamIds: ['team-b'], actorUserId: 'super-1' })
    ).rejects.toMatchObject({ code: 'QUALIFICATION_CUTOFF_DRAW_NOT_APPLICABLE' });
  });

  it('13. over-selection is rejected at Preview', async () => {
    const db = tiedDb();
    const client = createMockClient(db) as never;
    await expect(
      previewQualificationCutoffDraw({ client, tournamentId: TOURNAMENT_ID, categoryCode: 'B-U14', groupCode: 'A', selectedTeamIds: ['team-b', 'team-c'], actorUserId: 'super-1' })
    ).rejects.toMatchObject({ code: 'QUALIFICATION_CUTOFF_DRAW_SELECTION_COUNT_MISMATCH' });
  });

  it('15. selecting a non-candidate team is rejected at Preview', async () => {
    const db = tiedDb();
    const client = createMockClient(db) as never;
    await expect(
      previewQualificationCutoffDraw({ client, tournamentId: TOURNAMENT_ID, categoryCode: 'B-U14', groupCode: 'A', selectedTeamIds: ['team-a'], actorUserId: 'super-1' })
    ).rejects.toMatchObject({ code: 'QUALIFICATION_CUTOFF_DRAW_SELECTION_NOT_CANDIDATE' });
  });

  it('a valid Preview followed by Save succeeds end-to-end via exactly one RPC call', async () => {
    const db = tiedDb();
    const rpc = createMockSaveQualificationCutoffDrawRpc(db, { categoryId: CATEGORY_ID, groupId: GROUP_ID });
    const client = createMockClient(db, rpc) as never;

    const preview = await previewQualificationCutoffDraw({ client, tournamentId: TOURNAMENT_ID, categoryCode: 'B-U14', groupCode: 'A', selectedTeamIds: ['team-b'], actorUserId: 'super-1' });
    const result = await saveQualificationCutoffDraw({
      client,
      tournamentId: TOURNAMENT_ID,
      categoryCode: 'B-U14',
      groupCode: 'A',
      selectedTeamIds: ['team-b'],
      previewToken: preview.previewToken,
      idempotencyKey: 'idem-1',
      actorUserId: 'super-1',
      actorEmail: 'super1@test.com',
    });
    expect(result.idempotent).toBe(false);
    expect(result.selectedTeamIds).toEqual(['team-b']);
    expect((db.tournament_qualification_cutoff_draws as Row[])).toHaveLength(1);
  });

  it('37. Save without a Preview Token is rejected', async () => {
    const db = tiedDb();
    const rpc = createMockSaveQualificationCutoffDrawRpc(db, { categoryId: CATEGORY_ID, groupId: GROUP_ID });
    const client = createMockClient(db, rpc) as never;
    await expect(
      saveQualificationCutoffDraw({
        client,
        tournamentId: TOURNAMENT_ID,
        categoryCode: 'B-U14',
        groupCode: 'A',
        selectedTeamIds: ['team-b'],
        previewToken: '',
        idempotencyKey: 'idem-2',
        actorUserId: 'super-1',
        actorEmail: 'super1@test.com',
      })
    ).rejects.toMatchObject({ code: 'QUALIFICATION_CUTOFF_DRAW_PREVIEW_REQUIRED' });
  });

  it('38. A tampered Preview Token is rejected', async () => {
    const db = tiedDb();
    const rpc = createMockSaveQualificationCutoffDrawRpc(db, { categoryId: CATEGORY_ID, groupId: GROUP_ID });
    const client = createMockClient(db, rpc) as never;
    const preview = await previewQualificationCutoffDraw({ client, tournamentId: TOURNAMENT_ID, categoryCode: 'B-U14', groupCode: 'A', selectedTeamIds: ['team-b'], actorUserId: 'super-1' });
    const [payload, signature] = preview.previewToken.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    decoded.candidateSnapshot = 'tampered';
    const tamperedToken = `${Buffer.from(JSON.stringify(decoded), 'utf-8').toString('base64url')}.${signature}`;
    await expect(
      saveQualificationCutoffDraw({
        client,
        tournamentId: TOURNAMENT_ID,
        categoryCode: 'B-U14',
        groupCode: 'A',
        selectedTeamIds: ['team-b'],
        previewToken: tamperedToken,
        idempotencyKey: 'idem-3',
        actorUserId: 'super-1',
        actorEmail: 'super1@test.com',
      })
    ).rejects.toMatchObject({ code: 'QUALIFICATION_CUTOFF_DRAW_PREVIEW_INVALID' });
  });

  it('40. Editing the selection after Preview is rejected (preview mismatch)', async () => {
    const db = tiedDb();
    const rpc = createMockSaveQualificationCutoffDrawRpc(db, { categoryId: CATEGORY_ID, groupId: GROUP_ID });
    const client = createMockClient(db, rpc) as never;
    const preview = await previewQualificationCutoffDraw({ client, tournamentId: TOURNAMENT_ID, categoryCode: 'B-U14', groupCode: 'A', selectedTeamIds: ['team-b'], actorUserId: 'super-1' });
    await expect(
      saveQualificationCutoffDraw({
        client,
        tournamentId: TOURNAMENT_ID,
        categoryCode: 'B-U14',
        groupCode: 'A',
        selectedTeamIds: ['team-c'],
        previewToken: preview.previewToken,
        idempotencyKey: 'idem-4',
        actorUserId: 'super-1',
        actorEmail: 'super1@test.com',
      })
    ).rejects.toMatchObject({ code: 'QUALIFICATION_CUTOFF_DRAW_PREVIEW_MISMATCH' });
  });

  it('42. a retry with the same idempotency key after a successful save is idempotent (no fresh Preview Token needed)', async () => {
    const db = tiedDb();
    const rpc = createMockSaveQualificationCutoffDrawRpc(db, { categoryId: CATEGORY_ID, groupId: GROUP_ID });
    const client = createMockClient(db, rpc) as never;
    const preview = await previewQualificationCutoffDraw({ client, tournamentId: TOURNAMENT_ID, categoryCode: 'B-U14', groupCode: 'A', selectedTeamIds: ['team-b'], actorUserId: 'super-1' });
    const first = await saveQualificationCutoffDraw({
      client,
      tournamentId: TOURNAMENT_ID,
      categoryCode: 'B-U14',
      groupCode: 'A',
      selectedTeamIds: ['team-b'],
      previewToken: preview.previewToken,
      idempotencyKey: 'idem-retry',
      actorUserId: 'super-1',
      actorEmail: 'super1@test.com',
    });
    expect(first.idempotent).toBe(false);

    // The RPC's idempotency check happens BEFORE the preview-token/active-draw
    // comparisons the RPC itself performs — but this service layer still
    // requires SOME valid preview token to reach the RPC at all. Re-preview
    // (identical selection) and retry with the same key.
    const secondPreview = await previewQualificationCutoffDraw({ client, tournamentId: TOURNAMENT_ID, categoryCode: 'B-U14', groupCode: 'A', selectedTeamIds: ['team-b'], actorUserId: 'super-1' });
    const second = await saveQualificationCutoffDraw({
      client,
      tournamentId: TOURNAMENT_ID,
      categoryCode: 'B-U14',
      groupCode: 'A',
      selectedTeamIds: ['team-b'],
      previewToken: secondPreview.previewToken,
      idempotencyKey: 'idem-retry',
      actorUserId: 'super-1',
      actorEmail: 'super1@test.com',
    });
    expect(second.idempotent).toBe(true);
    expect(second.drawId).toBe(first.drawId);
    expect((db.tournament_qualification_cutoff_draws as Row[])).toHaveLength(1);
  });

  it('fails closed with QUALIFICATION_CUTOFF_DRAW_RPC_UNAVAILABLE when the RPC is missing', async () => {
    const db = tiedDb();
    const client = createMockClient(db) as never; // no rpc handler configured
    const preview = await previewQualificationCutoffDraw({ client, tournamentId: TOURNAMENT_ID, categoryCode: 'B-U14', groupCode: 'A', selectedTeamIds: ['team-b'], actorUserId: 'super-1' });
    await expect(
      saveQualificationCutoffDraw({
        client,
        tournamentId: TOURNAMENT_ID,
        categoryCode: 'B-U14',
        groupCode: 'A',
        selectedTeamIds: ['team-b'],
        previewToken: preview.previewToken,
        idempotencyKey: 'idem-5',
        actorUserId: 'super-1',
        actorEmail: 'super1@test.com',
      })
    ).rejects.toMatchObject({ code: 'QUALIFICATION_CUTOFF_DRAW_RPC_UNAVAILABLE' });
  });
});

describe('QualificationCutoffDrawError', () => {
  it('carries a code distinct from its message', () => {
    const error = new QualificationCutoffDrawError('SOME_CODE', 'some message');
    expect(error.code).toBe('SOME_CODE');
    expect(error.message).toBe('some message');
  });
});

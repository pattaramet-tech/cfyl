import { beforeEach, describe, expect, it } from 'vitest';
import { previewResultCorrection, publishResultCorrection, type CorrectedResultInput } from '../resultCorrection';
import { createMockCorrectRpc, type Db, type Row } from './mockCorrectRpc';
import { getCategoryStandings } from '../standings';

// Proves the boundary explicitly required by this task: Standings must
// reflect a corrected official regulation score through the EXISTING dynamic
// calculation (no direct Standings write from this PR), and penalty scores
// must remain excluded from GF/GA/GD even after a correction.

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
        const result = rows().filter(matches);
        return Promise.resolve({ data: result.length ? result[0] : null, error: null });
      },
      then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve({ data: rows().filter(matches), error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  return {
    from: (table: string) => builder(table),
    rpc: createMockCorrectRpc(db),
  };
}

const TOURNAMENT_ID = 'tour-1';
const CATEGORY_ID = 'cat-1';
const GROUP_ID = 'group-a';
const MATCH_ID = 'match-1';
const HOME = 'team-a';
const AWAY = 'team-b';

function buildDb(matchOverrides: Row = {}): Db {
  return {
    tournament_categories: [{ id: CATEGORY_ID, tournament_id: TOURNAMENT_ID, code: 'B-U14', deleted_at: null }],
    tournament_groups: [{ id: GROUP_ID, tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, code: 'A' }],
    tournament_qualification_rules: [
      { tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, qualify_rank_per_group: 2, best_third_placed_count: 0, best_third_placed_method: 'ranked', cross_group_comparison: false },
    ],
    tournament_teams: [
      { id: HOME, tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'A', name: 'Team A', deleted_at: null },
      { id: AWAY, tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_code: 'B', name: 'Team B', deleted_at: null },
    ],
    tournament_group_members: [
      { group_id: GROUP_ID, team_id: HOME },
      { group_id: GROUP_ID, team_id: AWAY },
    ],
    tournament_match_cards: [],
    tournament_standing_overrides: [],
    tournament_matches: [
      {
        id: MATCH_ID,
        tournament_id: TOURNAMENT_ID,
        category_id: CATEGORY_ID,
        group_id: GROUP_ID,
        match_code: 'M-001',
        home_team_id: HOME,
        away_team_id: AWAY,
        status: 'finished',
        result_workflow_status: 'published',
        schedule_status: 'published',
        regulation_home_score: 2,
        regulation_away_score: 0,
        penalty_home_score: null,
        penalty_away_score: null,
        decided_by: 'regulation',
        winner_team_id: HOME,
        result_type: 'normal',
        version: 5,
        deleted_at: null,
        ...matchOverrides,
      },
    ],
    tournament_result_submissions: [],
  };
}

function correctionInput(overrides: Partial<CorrectedResultInput> = {}): CorrectedResultInput {
  return {
    regulationHomeScore: 3,
    regulationAwayScore: 1,
    penaltyHomeScore: null,
    penaltyAwayScore: null,
    decidedBy: 'regulation',
    winnerTeamId: HOME,
    correctionReason: 'สกอร์ทางการบันทึกผิด แก้ไขตามใบบันทึกผู้ตัดสิน',
    ...overrides,
  };
}

describe('Result Correction publish -> PR #10 Standings integration', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
  });

  it('before correction, Standings reflects the original published score (2-0)', async () => {
    const db = buildDb();
    const client = createMockClient(db) as never;
    const standings = await getCategoryStandings({ client, tournamentId: TOURNAMENT_ID, categoryCode: 'B-U14' });
    const teamA = standings.groups[0].rows.find((r) => r.teamId === HOME)!;
    expect(teamA.goalsFor).toBe(2);
    expect(teamA.goalsAgainst).toBe(0);
  });

  it('22. after a corrected regulation score, Standings reflects the corrected score automatically (no direct Standings write from this PR)', async () => {
    const db = buildDb();
    const client = createMockClient(db) as never;

    const preview = await previewResultCorrection({ client, tournamentId: TOURNAMENT_ID, matchId: MATCH_ID, actorUserId: 'super-1', input: correctionInput() });
    await publishResultCorrection({
      client,
      tournamentId: TOURNAMENT_ID,
      matchId: MATCH_ID,
      expectedVersion: preview.currentVersion,
      idempotencyKey: 'idem-standings-1',
      previewToken: preview.previewToken,
      actorUserId: 'super-1',
      actorEmail: 'super1@test.com',
      input: correctionInput(),
    });

    const standings = await getCategoryStandings({ client, tournamentId: TOURNAMENT_ID, categoryCode: 'B-U14' });
    const teamA = standings.groups[0].rows.find((r) => r.teamId === HOME)!;
    const teamB = standings.groups[0].rows.find((r) => r.teamId === AWAY)!;
    expect(teamA.goalsFor).toBe(3);
    expect(teamA.goalsAgainst).toBe(1);
    expect(teamA.points).toBe(3);
    expect(teamB.goalsAgainst).toBe(3);
  });

  it('23. penalty shootout scores from a correction remain excluded from Standings GF/GA/GD', async () => {
    const db = buildDb({ regulation_home_score: 1, regulation_away_score: 1, decided_by: 'penalty', penalty_home_score: 3, penalty_away_score: 2, winner_team_id: HOME, result_type: 'penalty_decided' });
    const client = createMockClient(db) as never;
    const input = correctionInput({ regulationHomeScore: 1, regulationAwayScore: 1, decidedBy: 'penalty', penaltyHomeScore: 5, penaltyAwayScore: 4, winnerTeamId: HOME });

    const preview = await previewResultCorrection({ client, tournamentId: TOURNAMENT_ID, matchId: MATCH_ID, actorUserId: 'super-1', input });
    await publishResultCorrection({
      client,
      tournamentId: TOURNAMENT_ID,
      matchId: MATCH_ID,
      expectedVersion: preview.currentVersion,
      idempotencyKey: 'idem-standings-2',
      previewToken: preview.previewToken,
      actorUserId: 'super-1',
      actorEmail: 'super1@test.com',
      input,
    });

    const standings = await getCategoryStandings({ client, tournamentId: TOURNAMENT_ID, categoryCode: 'B-U14' });
    const teamA = standings.groups[0].rows.find((r) => r.teamId === HOME)!;
    const teamB = standings.groups[0].rows.find((r) => r.teamId === AWAY)!;
    // Regulation stayed 1-1; the corrected penalty shootout (5-4) must never leak into GF/GA/GD.
    expect(teamA.goalsFor).toBe(1);
    expect(teamA.goalsAgainst).toBe(1);
    expect(teamA.goalDifference).toBe(0);
    expect(teamB.goalsFor).toBe(1);
    expect(teamA.points).toBe(3);
    expect(teamB.points).toBe(0);
  });
});

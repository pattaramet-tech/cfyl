import { beforeEach, describe, expect, it } from 'vitest';
import { publishFullMatchReport, previewFullMatchReport, type FullMatchReportInput } from '../fullMatchReport';
import { getCategoryStandings } from '../standings';

// Proves the boundary explicitly required by this task: "Published results
// must become valid input for PR #10 Standings automatically through the
// existing published-result filter. Do not directly write calculated
// Standings rows." This service never imports or calls any Standings
// calculation function (see fullMatchReportIsolation.test.ts) — the only
// integration point is that a successful publish sets exactly the
// tournament_matches columns (status='finished',
// result_workflow_status='published', regulation/penalty scores,
// winner_team_id, decided_by) that PR #10's getCategoryStandings() already
// reads. This test proves that handoff works end-to-end against the same
// in-memory mock database, without either module writing to the other.

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

function createMockClient(db: Db) {
  function builder(table: string) {
    const filters: Array<['eq' | 'is' | 'in', string, unknown]> = [];
    let orderCol: string | null = null;
    let limitCount: number | null = null;
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
      order(col: string) {
        orderCol = col;
        return api;
      },
      limit(n: number) {
        limitCount = n;
        return api;
      },
      maybeSingle() {
        let result = rows().filter(matches);
        if (orderCol) result = [...result].sort((a, b) => String(b[orderCol as string]).localeCompare(String(a[orderCol as string])));
        if (limitCount !== null) result = result.slice(0, limitCount);
        return Promise.resolve({ data: result.length ? result[0] : null, error: null });
      },
      then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
        let result = rows().filter(matches);
        if (orderCol) result = [...result].sort((a, b) => String(b[orderCol as string]).localeCompare(String(a[orderCol as string])));
        if (limitCount !== null) result = result.slice(0, limitCount);
        return Promise.resolve({ data: result, error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  return {
    from: (table: string) => builder(table),
    // Simulates exactly what tournament.publish_full_match_report() commits
    // — this stand-in exists because Migration 014 is a draft and was not
    // applied to any real Postgres instance for this task.
    rpc(name: string, args: Record<string, unknown>) {
      if (name !== 'publish_full_match_report') return Promise.resolve({ data: null, error: { message: 'unexpected rpc' } });
      const match = db.tournament_matches.find((m) => m.id === args.p_match_id);
      if (!match) return Promise.resolve({ data: null, error: { message: 'FULL_REPORT_MATCH_NOT_FOUND: not found' } });
      const submissionId = `sub-${Math.random().toString(36).slice(2)}`;
      db.tournament_result_submissions.push({
        id: submissionId,
        match_id: args.p_match_id,
        stage: 'full_report',
        payload: args.p_payload,
        idempotency_key: args.p_idempotency_key,
        submitted_at: '2026-07-20T12:00:00.000Z',
      });
      match.version = (match.version as number) + 1;
      match.status = 'finished';
      match.result_workflow_status = 'published';
      match.regulation_home_score = args.p_regulation_home_score;
      match.regulation_away_score = args.p_regulation_away_score;
      match.penalty_home_score = args.p_penalty_home_score;
      match.penalty_away_score = args.p_penalty_away_score;
      match.decided_by = args.p_decided_by;
      match.winner_team_id = args.p_winner_team_id;
      return Promise.resolve({
        data: { submission_id: submissionId, match_id: args.p_match_id, new_match_version: match.version, published_at: '2026-07-20T12:00:00.000Z', idempotent: false },
        error: null,
      });
    },
  };
}

const TOURNAMENT_ID = 'tour-1';
const CATEGORY_ID = 'cat-1';
const GROUP_ID = 'group-a';
const MATCH_ID = 'match-1';
const HOME = 'team-a';
const AWAY = 'team-b';

function buildDb(): Db {
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
        venue_id: 'venue-1',
        match_code: 'M-001',
        home_team_id: HOME,
        away_team_id: AWAY,
        status: 'in_progress',
        result_workflow_status: 'not_started',
        schedule_status: 'published',
        result_type: 'normal',
        version: 1,
        deleted_at: null,
        regulation_home_score: null,
        regulation_away_score: null,
        penalty_home_score: null,
        penalty_away_score: null,
        decided_by: null,
        winner_team_id: null,
      },
    ],
    tournament_players: [{ id: 'player-1', tournament_id: TOURNAMENT_ID, category_id: CATEGORY_ID, team_id: HOME, full_name: 'Scorer', deleted_at: null }],
    tournament_result_submissions: [],
  };
}

function reportInput(): FullMatchReportInput {
  return {
    regulationHomeScore: 3,
    regulationAwayScore: 1,
    penaltyHomeScore: null,
    penaltyAwayScore: null,
    decidedBy: 'regulation',
    winnerTeamId: HOME,
    reportText: 'match report',
    goals: [{ teamId: HOME, playerId: 'player-1', minute: 10, isOwnGoal: false, goals: 1, note: null }],
    cards: [],
  };
}

describe('Full Match Report publish -> PR #10 Standings integration', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
  });

  it('55. before Publish, Standings does not include the result (team shows 0 played)', async () => {
    const db = buildDb();
    const client = createMockClient(db) as never;
    const standings = await getCategoryStandings({ client, tournamentId: TOURNAMENT_ID, categoryCode: 'B-U14' });
    const teamA = standings.groups[0].rows.find((r) => r.teamId === HOME)!;
    expect(teamA.played).toBe(0);
    expect(teamA.points).toBe(0);
  });

  it('56. after a mocked RPC Publish, Standings includes the result automatically (no direct Standings write from this PR)', async () => {
    const db = buildDb();
    const client = createMockClient(db) as never;

    const preview = await previewFullMatchReport({
      client,
      tournamentId: TOURNAMENT_ID,
      venueId: 'venue-1',
      matchId: MATCH_ID,
      actorUserId: 'admin-1',
      input: reportInput(),
    });
    await publishFullMatchReport({
      client,
      tournamentId: TOURNAMENT_ID,
      venueId: 'venue-1',
      matchId: MATCH_ID,
      expectedVersion: preview.currentVersion,
      idempotencyKey: 'idem-integration-1',
      previewToken: preview.previewToken,
      actorUserId: 'admin-1',
      actorEmail: 'admin1@test.com',
      input: reportInput(),
    });

    const standings = await getCategoryStandings({ client, tournamentId: TOURNAMENT_ID, categoryCode: 'B-U14' });
    const teamA = standings.groups[0].rows.find((r) => r.teamId === HOME)!;
    const teamB = standings.groups[0].rows.find((r) => r.teamId === AWAY)!;
    expect(teamA.played).toBe(1);
    expect(teamA.points).toBe(3);
    expect(teamA.goalsFor).toBe(3);
    expect(teamB.goalsAgainst).toBe(3);
  });

  it('57. penalty shootout scores are excluded from Standings GF/GA/GD even after Publish', async () => {
    const db = buildDb();
    const client = createMockClient(db) as never;
    const penaltyInput: FullMatchReportInput = {
      regulationHomeScore: 1,
      regulationAwayScore: 1,
      penaltyHomeScore: 5,
      penaltyAwayScore: 4,
      decidedBy: 'penalty',
      winnerTeamId: HOME,
      reportText: null,
      goals: [{ teamId: HOME, playerId: 'player-1', minute: 20, isOwnGoal: false, goals: 1, note: null }],
      cards: [],
    };

    const preview = await previewFullMatchReport({
      client,
      tournamentId: TOURNAMENT_ID,
      venueId: 'venue-1',
      matchId: MATCH_ID,
      actorUserId: 'admin-1',
      input: penaltyInput,
    });
    await publishFullMatchReport({
      client,
      tournamentId: TOURNAMENT_ID,
      venueId: 'venue-1',
      matchId: MATCH_ID,
      expectedVersion: preview.currentVersion,
      idempotencyKey: 'idem-integration-2',
      previewToken: preview.previewToken,
      actorUserId: 'admin-1',
      actorEmail: 'admin1@test.com',
      input: penaltyInput,
    });

    const standings = await getCategoryStandings({ client, tournamentId: TOURNAMENT_ID, categoryCode: 'B-U14' });
    const teamA = standings.groups[0].rows.find((r) => r.teamId === HOME)!;
    const teamB = standings.groups[0].rows.find((r) => r.teamId === AWAY)!;
    // Regulation was 1-1; penalty shootout (5-4) must not leak into GF/GA/GD.
    expect(teamA.goalsFor).toBe(1);
    expect(teamA.goalsAgainst).toBe(1);
    expect(teamA.goalDifference).toBe(0);
    expect(teamB.goalsFor).toBe(1);
    // Winner (via penalty) still gets the points per D-09 (no draws).
    expect(teamA.points).toBe(3);
    expect(teamB.points).toBe(0);
  });
});

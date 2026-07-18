import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { publishResultCorrection, previewResultCorrection } from '../resultCorrection';
import { createMockCorrectRpc, type Db, type Row } from './mockCorrectRpc';

const repoRoot = join(__dirname, '..', '..', '..', '..');

function readSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf-8');
}

describe('Result Correction — source-level isolation', () => {
  it('25. the public schedule route never references correction reason, actor details, old_data/new_data, idempotency keys, or Preview Tokens', () => {
    const source = readSource('app/api/tournament/public/schedule/route.ts');
    expect(source).not.toMatch(/correction_reason|correctionReason/);
    expect(source).not.toMatch(/preview_token|previewToken/);
    expect(source).not.toMatch(/idempotency_key|idempotencyKey/);
    expect(source).not.toMatch(/tournament_audit_logs/);
    expect(source).not.toMatch(/old_data|new_data/);
  });

  it('25. the public standings route never references correction reason, actor details, old_data/new_data, idempotency keys, or Preview Tokens', () => {
    const source = readSource('app/api/tournament/public/standings/route.ts');
    expect(source).not.toMatch(/correction_reason|correctionReason/);
    expect(source).not.toMatch(/preview_token|previewToken/);
    expect(source).not.toMatch(/idempotency_key|idempotencyKey/);
    expect(source).not.toMatch(/tournament_audit_logs/);
    expect(source).not.toMatch(/old_data|new_data/);
  });

  it('there is no public result-correction route in this PR', () => {
    expect(() => readSource('app/api/tournament/public/correction/route.ts')).toThrow();
    expect(() => readSource('app/api/tournament/public/matches/correction/route.ts')).toThrow();
  });

  it('the correction route requires tournament_super_admin, not the weaker result_operator gate used by Full Match Report/Quick Result', () => {
    const source = readSource('app/api/tournament/admin/matches/[matchId]/correction/route.ts');
    expect(source).toMatch(/requireTournamentSuperAdmin/);
    expect(source).not.toMatch(/requireTournamentResultOperator/);
  });

  it('the result correction service never calls Standings calculation functions directly (Standings is a read-only downstream consumer)', () => {
    const source = readSource('lib/tournament/services/resultCorrection.ts');
    expect(source).not.toMatch(/calculateStandings|calculateGroupStandings|resolveTournamentTiebreak/);
    expect(source).not.toMatch(/\.from\(['"]tournament_standing/);
  });

  it('the result correction service never touches Knockout Advancement or Suspension tables/functions', () => {
    const source = readSource('lib/tournament/services/resultCorrection.ts');
    expect(source).not.toMatch(/tournament_suspension_events|tournament_suspension_serving_matches/);
    expect(source).not.toMatch(/advanceKnockout|resolveBracket|match_winner|match_loser|group_rank|best_ranked/);
  });

  it('the result correction service and migration contain no randomization', () => {
    const service = readSource('lib/tournament/services/resultCorrection.ts');
    const migration = readSource('scripts/tournament-v2/018-score-only-result-correction.sql');
    expect(service).not.toMatch(/Math\.random|crypto\.getRandomValues/);
    expect(migration).not.toMatch(/random\(\)/i);
  });

  it('the correction page never renders or edits goals, cards, players, or report text inputs', () => {
    const source = readSource('app/admin/tournament/matches/[matchId]/correction/page.tsx');
    expect(source).not.toMatch(/goal|card_type|report_text|player_id|shirt_no/i);
  });

  it('the correction route body type never accepts goals, cards, players, or report_text fields', () => {
    const source = readSource('app/api/tournament/admin/matches/[matchId]/correction/route.ts');
    expect(source).not.toMatch(/\bgoals\b|\bcards\b|report_text|player_id/);
  });
});

const TOURNAMENT_ID = 'tour-1';
const MATCH_ID = 'match-1';
const HOME = 'team-home';
const AWAY = 'team-away';

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

function baseDb(): Db {
  return {
    tournament_matches: [
      {
        id: MATCH_ID,
        tournament_id: TOURNAMENT_ID,
        category_id: 'cat-1',
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
      },
    ],
    // Original Full Match Report submission/version — must survive untouched.
    tournament_result_submissions: [
      { id: 'sub-original', match_id: MATCH_ID, stage: 'full_report', payload: { regulationHomeScore: 2, regulationAwayScore: 0 }, status: 'published', version: 1, idempotency_key: 'idem-original-publish', submitted_at: '2026-07-19T10:00:00.000Z' },
    ],
    tournament_result_versions: [{ submission_id: 'sub-original', version: 1, payload: { regulationHomeScore: 2, regulationAwayScore: 0 } }],
    // Goals/cards/report/quick-result rows — must all remain byte-for-byte unchanged.
    tournament_match_goals: [{ id: 'goal-1', match_id: MATCH_ID, team_id: HOME, player_id: 'player-1', minute: 10, is_own_goal: false, goals: 1, note: null }],
    tournament_match_cards: [{ id: 'card-1', match_id: MATCH_ID, team_id: AWAY, player_id: 'player-2', card_type: 'yellow', minute: 55, note: null }],
    tournament_match_reports: [{ match_id: MATCH_ID, report: 'สรุปการแข่งขันต้นฉบับ', submitted_at: '2026-07-19T10:00:00.000Z' }],
  };
}

describe('Result Correction — data isolation at runtime', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
  });

  it('17/18/19/20/21. a successful correction leaves the original Full Report submission/version, goals, cards, report text, and Quick Result rows byte-for-byte unchanged', async () => {
    const db = baseDb();
    db.tournament_result_submissions.push({
      id: 'qr-1',
      match_id: MATCH_ID,
      stage: 'quick_result',
      payload: { home_score: 2, away_score: 0 },
      submitted_at: '2026-07-19T09:00:00.000Z',
    });
    const client = createMockClient(db) as never;

    const snapshotBefore = JSON.stringify({
      originalSubmission: db.tournament_result_submissions.find((s) => s.id === 'sub-original'),
      originalVersion: db.tournament_result_versions,
      goals: db.tournament_match_goals,
      cards: db.tournament_match_cards,
      reports: db.tournament_match_reports,
      quickResult: db.tournament_result_submissions.find((s) => s.id === 'qr-1'),
    });

    const preview = await previewResultCorrection({
      client,
      tournamentId: TOURNAMENT_ID,
      matchId: MATCH_ID,
      actorUserId: 'super-1',
      input: { regulationHomeScore: 3, regulationAwayScore: 0, penaltyHomeScore: null, penaltyAwayScore: null, decidedBy: 'regulation', winnerTeamId: HOME, correctionReason: 'สกอร์บันทึกผิด' },
    });
    await publishResultCorrection({
      client,
      tournamentId: TOURNAMENT_ID,
      matchId: MATCH_ID,
      expectedVersion: preview.currentVersion,
      idempotencyKey: 'idem-isolation-1',
      previewToken: preview.previewToken,
      actorUserId: 'super-1',
      actorEmail: 'super1@test.com',
      input: { regulationHomeScore: 3, regulationAwayScore: 0, penaltyHomeScore: null, penaltyAwayScore: null, decidedBy: 'regulation', winnerTeamId: HOME, correctionReason: 'สกอร์บันทึกผิด' },
    });

    const snapshotAfter = JSON.stringify({
      originalSubmission: db.tournament_result_submissions.find((s) => s.id === 'sub-original'),
      originalVersion: db.tournament_result_versions.filter((v) => v.submission_id === 'sub-original'),
      goals: db.tournament_match_goals,
      cards: db.tournament_match_cards,
      reports: db.tournament_match_reports,
      quickResult: db.tournament_result_submissions.find((s) => s.id === 'qr-1'),
    });

    expect(snapshotAfter).toBe(snapshotBefore);
    // A NEW row was appended (stage='correction'), the original was not touched.
    expect(db.tournament_result_submissions.some((s) => s.stage === 'correction')).toBe(true);
    expect((db.tournament_matches[0] as Row).regulation_home_score).toBe(3);
  });
});

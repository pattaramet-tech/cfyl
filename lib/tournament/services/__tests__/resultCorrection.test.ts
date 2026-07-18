import { beforeEach, describe, expect, it } from 'vitest';
import { previewResultCorrection, publishResultCorrection, ResultCorrectionError, type CorrectedResultInput } from '../resultCorrection';
import { createMockCorrectRpc, type Db, type Row } from './mockCorrectRpc';

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
const MATCH_ID = 'match-1';
const HOME = 'team-home';
const AWAY = 'team-away';

function baseDb(matchOverrides: Row = {}): Db {
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
        ...matchOverrides,
      },
    ],
    tournament_result_submissions: [],
  };
}

function baseInput(overrides: Partial<CorrectedResultInput> = {}): CorrectedResultInput {
  return {
    regulationHomeScore: 3,
    regulationAwayScore: 0,
    penaltyHomeScore: null,
    penaltyAwayScore: null,
    decidedBy: 'regulation',
    winnerTeamId: HOME,
    correctionReason: 'สกอร์บันทึกผิด แก้ไขตามใบบันทึกสนาม',
    ...overrides,
  };
}

describe('resultCorrection service', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
  });

  it('2. a valid regulation correction succeeds end-to-end', async () => {
    const db = baseDb();
    const client = createMockClient(db) as never;
    const preview = await previewResultCorrection({ client, tournamentId: TOURNAMENT_ID, matchId: MATCH_ID, actorUserId: 'super-1', input: baseInput() });

    const result = await publishResultCorrection({
      client,
      tournamentId: TOURNAMENT_ID,
      matchId: MATCH_ID,
      expectedVersion: preview.currentVersion,
      idempotencyKey: 'idem-reg-1',
      previewToken: preview.previewToken,
      actorUserId: 'super-1',
      actorEmail: 'super1@test.com',
      input: baseInput(),
    });

    expect(result.idempotent).toBe(false);
    expect(result.newMatchVersion).toBe(6);
    expect((db.tournament_matches[0] as Row).regulation_home_score).toBe(3);
  });

  it('3. a valid penalty correction succeeds end-to-end', async () => {
    const db = baseDb();
    const client = createMockClient(db) as never;
    const input = baseInput({
      regulationHomeScore: 1,
      regulationAwayScore: 1,
      decidedBy: 'penalty',
      penaltyHomeScore: 5,
      penaltyAwayScore: 4,
      winnerTeamId: HOME,
    });
    const preview = await previewResultCorrection({ client, tournamentId: TOURNAMENT_ID, matchId: MATCH_ID, actorUserId: 'super-1', input });

    const result = await publishResultCorrection({
      client,
      tournamentId: TOURNAMENT_ID,
      matchId: MATCH_ID,
      expectedVersion: preview.currentVersion,
      idempotencyKey: 'idem-pen-1',
      previewToken: preview.previewToken,
      actorUserId: 'super-1',
      actorEmail: 'super1@test.com',
      input,
    });

    expect(result.idempotent).toBe(false);
    expect((db.tournament_matches[0] as Row).result_type).toBe('penalty_decided');
    expect((db.tournament_matches[0] as Row).penalty_home_score).toBe(5);
  });

  it('4. correction reason is required at Preview time', async () => {
    const db = baseDb();
    const client = createMockClient(db) as never;
    await expect(
      previewResultCorrection({ client, tournamentId: TOURNAMENT_ID, matchId: MATCH_ID, actorUserId: 'super-1', input: baseInput({ correctionReason: '   ' }) })
    ).rejects.toMatchObject({ code: 'RESULT_CORRECTION_REASON_REQUIRED' });
  });

  it('5. a "correction" identical to the current official result is rejected at Preview time', async () => {
    const db = baseDb();
    const client = createMockClient(db) as never;
    await expect(
      previewResultCorrection({
        client,
        tournamentId: TOURNAMENT_ID,
        matchId: MATCH_ID,
        actorUserId: 'super-1',
        input: baseInput({ regulationHomeScore: 2, regulationAwayScore: 0, winnerTeamId: HOME }),
      })
    ).rejects.toMatchObject({ code: 'RESULT_CORRECTION_NO_CHANGES' });
  });

  it('9. a match without a published result is rejected', async () => {
    const db = baseDb({ result_workflow_status: 'not_started', status: 'in_progress' });
    const client = createMockClient(db) as never;
    await expect(
      previewResultCorrection({ client, tournamentId: TOURNAMENT_ID, matchId: MATCH_ID, actorUserId: 'super-1', input: baseInput() })
    ).rejects.toMatchObject({ code: 'RESULT_CORRECTION_NOT_PUBLISHED' });
  });

  it('10. unresolved home team is rejected', async () => {
    const db = baseDb({ home_team_id: null });
    const client = createMockClient(db) as never;
    await expect(
      previewResultCorrection({ client, tournamentId: TOURNAMENT_ID, matchId: MATCH_ID, actorUserId: 'super-1', input: baseInput() })
    ).rejects.toMatchObject({ code: 'RESULT_CORRECTION_HOME_TEAM_UNRESOLVED' });
  });

  it('11. a stale match version at Publish time is rejected (version bumped after Preview)', async () => {
    const db = baseDb();
    const client = createMockClient(db) as never;
    const preview = await previewResultCorrection({ client, tournamentId: TOURNAMENT_ID, matchId: MATCH_ID, actorUserId: 'super-1', input: baseInput() });
    (db.tournament_matches[0] as Row).version = 6;

    await expect(
      publishResultCorrection({
        client,
        tournamentId: TOURNAMENT_ID,
        matchId: MATCH_ID,
        expectedVersion: preview.currentVersion,
        idempotencyKey: 'idem-stale',
        previewToken: preview.previewToken,
        actorUserId: 'super-1',
        actorEmail: 'super1@test.com',
        input: baseInput(),
      })
    ).rejects.toMatchObject({ code: 'RESULT_CORRECTION_VERSION_CONFLICT' });
  });

  it('rejects publishing a correction whose Preview was never taken for this exact result (payload/reason changed after Preview)', async () => {
    const db = baseDb();
    const client = createMockClient(db) as never;
    const preview = await previewResultCorrection({ client, tournamentId: TOURNAMENT_ID, matchId: MATCH_ID, actorUserId: 'super-1', input: baseInput() });

    await expect(
      publishResultCorrection({
        client,
        tournamentId: TOURNAMENT_ID,
        matchId: MATCH_ID,
        expectedVersion: preview.currentVersion,
        idempotencyKey: 'idem-edit',
        previewToken: preview.previewToken,
        actorUserId: 'super-1',
        actorEmail: 'super1@test.com',
        input: baseInput({ regulationHomeScore: 4 }),
      })
    ).rejects.toMatchObject({ code: 'RESULT_CORRECTION_PREVIEW_MISMATCH' });
  });

  it('rejects actor substitution: a Preview issued for one actor cannot be redeemed by Publish as another actor', async () => {
    const db = baseDb();
    const client = createMockClient(db) as never;
    const preview = await previewResultCorrection({ client, tournamentId: TOURNAMENT_ID, matchId: MATCH_ID, actorUserId: 'super-1', input: baseInput() });

    await expect(
      publishResultCorrection({
        client,
        tournamentId: TOURNAMENT_ID,
        matchId: MATCH_ID,
        expectedVersion: preview.currentVersion,
        idempotencyKey: 'idem-actor-sub',
        previewToken: preview.previewToken,
        actorUserId: 'super-2',
        actorEmail: 'super2@test.com',
        input: baseInput(),
      })
    ).rejects.toMatchObject({ code: 'RESULT_CORRECTION_PREVIEW_MISMATCH' });
  });

  it('Publish without a Preview Token is rejected', async () => {
    const db = baseDb();
    const client = createMockClient(db) as never;
    await expect(
      publishResultCorrection({
        client,
        tournamentId: TOURNAMENT_ID,
        matchId: MATCH_ID,
        expectedVersion: 5,
        idempotencyKey: 'idem-no-token',
        previewToken: '',
        actorUserId: 'super-1',
        actorEmail: 'super1@test.com',
        input: baseInput(),
      })
    ).rejects.toMatchObject({ code: 'RESULT_CORRECTION_PREVIEW_REQUIRED' });
  });

  it('a retry of a same-key correction that just succeeded is idempotent and requires no fresh Preview Token', async () => {
    const db = baseDb();
    const client = createMockClient(db) as never;
    const preview = await previewResultCorrection({ client, tournamentId: TOURNAMENT_ID, matchId: MATCH_ID, actorUserId: 'super-1', input: baseInput() });

    const first = await publishResultCorrection({
      client,
      tournamentId: TOURNAMENT_ID,
      matchId: MATCH_ID,
      expectedVersion: preview.currentVersion,
      idempotencyKey: 'idem-retry',
      previewToken: preview.previewToken,
      actorUserId: 'super-1',
      actorEmail: 'super1@test.com',
      input: baseInput(),
    });
    expect(first.idempotent).toBe(false);

    const second = await publishResultCorrection({
      client,
      tournamentId: TOURNAMENT_ID,
      matchId: MATCH_ID,
      expectedVersion: preview.currentVersion,
      idempotencyKey: 'idem-retry',
      previewToken: '',
      actorUserId: 'super-1',
      actorEmail: 'super1@test.com',
      input: baseInput(),
    });
    expect(second.idempotent).toBe(true);
    expect(second.submissionId).toBe(first.submissionId);
  });
});

describe('ResultCorrectionError', () => {
  it('carries a code distinct from its message', () => {
    const error = new ResultCorrectionError('SOME_CODE', 'some message');
    expect(error.code).toBe('SOME_CODE');
    expect(error.message).toBe('some message');
  });
});

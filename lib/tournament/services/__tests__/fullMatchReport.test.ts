import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCanonicalFullReportPayload,
  previewFullMatchReport,
  publishFullMatchReport,
  FullMatchReportError,
  type FullMatchReportInput,
} from '../fullMatchReport';

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
    // Mirrors Migration 014's actual contract: builds its own canonical
    // payload from the received args (no p_payload param), and checks
    // idempotency BEFORE the already-published check.
    rpc(name: string, args: Record<string, unknown>) {
      if (name !== 'publish_full_match_report') return Promise.resolve({ data: null, error: { message: 'unexpected rpc' } });
      const match = db.tournament_matches.find((m) => m.id === args.p_match_id);
      if (!match) return Promise.resolve({ data: null, error: { message: 'FULL_REPORT_MATCH_NOT_FOUND: not found' } });

      const canonicalPayload = {
        matchId: args.p_match_id,
        tournamentId: args.p_tournament_id,
        regulationHomeScore: args.p_regulation_home_score,
        regulationAwayScore: args.p_regulation_away_score,
        penaltyHomeScore: args.p_penalty_home_score,
        penaltyAwayScore: args.p_penalty_away_score,
        decidedBy: args.p_decided_by,
        winnerTeamId: args.p_winner_team_id,
        resultType: args.p_result_type,
        goals: args.p_goals || [],
        cards: args.p_cards || [],
        reportText: args.p_report_text,
      };
      const existing = db.tournament_result_submissions.find(
        (s) => s.match_id === args.p_match_id && s.stage === 'full_report' && s.idempotency_key === args.p_idempotency_key
      );
      if (existing) {
        if (JSON.stringify(existing.payload) !== JSON.stringify(canonicalPayload)) {
          return Promise.resolve({ data: null, error: { message: 'FULL_REPORT_IDEMPOTENCY_PAYLOAD_MISMATCH: idempotency_key already used with a different payload' } });
        }
        return Promise.resolve({
          data: { submission_id: existing.id, match_id: args.p_match_id, new_match_version: match.version, published_at: existing.submitted_at, idempotent: true },
          error: null,
        });
      }

      if (match.result_workflow_status === 'published') {
        return Promise.resolve({ data: null, error: { message: 'FULL_REPORT_ALREADY_PUBLISHED_USE_CORRECTION: already published' } });
      }

      const submissionId = `sub-${Math.random().toString(36).slice(2)}`;
      db.tournament_result_submissions.push({
        id: submissionId,
        match_id: args.p_match_id,
        stage: 'full_report',
        payload: canonicalPayload,
        idempotency_key: args.p_idempotency_key,
        submitted_at: '2026-07-20T12:00:00.000Z',
      });
      match.version = (match.version as number) + 1;
      match.status = 'finished';
      match.result_workflow_status = 'published';
      return Promise.resolve({
        data: { submission_id: submissionId, match_id: args.p_match_id, new_match_version: match.version, published_at: '2026-07-20T12:00:00.000Z', idempotent: false },
        error: null,
      });
    },
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
        ...matchOverrides,
      },
    ],
    tournament_players: [
      { id: 'player-home-1', tournament_id: TOURNAMENT_ID, category_id: 'cat-1', team_id: HOME, full_name: 'P1', deleted_at: null },
      { id: 'player-home-2', tournament_id: TOURNAMENT_ID, category_id: 'cat-1', team_id: HOME, full_name: 'P2', deleted_at: null },
    ],
    tournament_result_submissions: [],
  };
}

function baseInput(overrides: Partial<FullMatchReportInput> = {}): FullMatchReportInput {
  return {
    regulationHomeScore: 2,
    regulationAwayScore: 0,
    penaltyHomeScore: null,
    penaltyAwayScore: null,
    decidedBy: 'regulation',
    winnerTeamId: HOME,
    reportText: 'note',
    goals: [{ teamId: HOME, playerId: 'player-home-1', minute: 10, isOwnGoal: false, goals: 1, note: null }],
    cards: [],
    ...overrides,
  };
}

describe('fullMatchReport service', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
  });

  it('34. rejects actor substitution: a Preview issued for one actor cannot be redeemed by Publish as another actor', async () => {
    const db = baseDb();
    const client = createMockClient(db) as never;
    const preview = await previewFullMatchReport({
      client,
      tournamentId: TOURNAMENT_ID,
      venueId: 'venue-1',
      matchId: MATCH_ID,
      actorUserId: 'admin-1',
      input: baseInput(),
    });

    await expect(
      publishFullMatchReport({
        client,
        tournamentId: TOURNAMENT_ID,
        venueId: 'venue-1',
        matchId: MATCH_ID,
        expectedVersion: preview.currentVersion,
        idempotencyKey: 'idem-actor-sub',
        previewToken: preview.previewToken,
        actorUserId: 'admin-2',
        actorEmail: 'admin2@test.com',
        input: baseInput(),
      })
    ).rejects.toMatchObject({ code: 'FULL_REPORT_PREVIEW_MISMATCH' });
  });

  it('a valid Preview by the same actor allows Publish to succeed', async () => {
    const db = baseDb();
    const client = createMockClient(db) as never;
    const preview = await previewFullMatchReport({
      client,
      tournamentId: TOURNAMENT_ID,
      venueId: 'venue-1',
      matchId: MATCH_ID,
      actorUserId: 'admin-1',
      input: baseInput(),
    });

    const result = await publishFullMatchReport({
      client,
      tournamentId: TOURNAMENT_ID,
      venueId: 'venue-1',
      matchId: MATCH_ID,
      expectedVersion: preview.currentVersion,
      idempotencyKey: 'idem-ok',
      previewToken: preview.previewToken,
      actorUserId: 'admin-1',
      actorEmail: 'admin1@test.com',
      input: baseInput(),
    });

    expect(result.idempotent).toBe(false);
    expect(result.newMatchVersion).toBe(2);
  });

  it('does not attempt to reconcile own-goal totals against the regulation score (undocumented convention — not guessed)', async () => {
    const db = baseDb();
    const client = createMockClient(db) as never;
    // Regulation score says home won 2-0, but the only goal event recorded
    // is a single own goal — deliberately inconsistent with a naive
    // "sum of goal events == regulation score" reconciliation. This must
    // NOT throw, because implementing that reconciliation would require
    // guessing whether team_id on an own-goal row means the scoring-against
    // team or the scoring player's own team, which is undocumented.
    const preview = await previewFullMatchReport({
      client,
      tournamentId: TOURNAMENT_ID,
      venueId: 'venue-1',
      matchId: MATCH_ID,
      actorUserId: 'admin-1',
      input: baseInput({ goals: [{ teamId: AWAY, playerId: null, minute: 30, isOwnGoal: true, goals: 1, note: 'own goal' }] }),
    });
    expect(preview.goals).toHaveLength(1);
    expect(preview.goals[0].isOwnGoal).toBe(true);
  });

  it('Quick Result comparison reports a mismatch when scores differ, but does not block Preview', async () => {
    const db = baseDb();
    db.tournament_result_submissions = [
      { id: 'qr-1', match_id: MATCH_ID, stage: 'quick_result', payload: { home_score: 1, away_score: 1 }, submitted_at: '2026-07-20T09:00:00.000Z' },
    ];
    const client = createMockClient(db) as never;
    const preview = await previewFullMatchReport({
      client,
      tournamentId: TOURNAMENT_ID,
      venueId: 'venue-1',
      matchId: MATCH_ID,
      actorUserId: 'admin-1',
      input: baseInput({ regulationHomeScore: 2, regulationAwayScore: 0 }),
    });
    expect(preview.quickResultComparison.hasQuickResult).toBe(true);
    expect(preview.quickResultComparison.matches).toBe(false);
    expect(preview.quickResultComparison.quickResultHomeScore).toBe(1);
  });

  it('Quick Result comparison reports a match when scores agree', async () => {
    const db = baseDb();
    db.tournament_result_submissions = [
      { id: 'qr-1', match_id: MATCH_ID, stage: 'quick_result', payload: { home_score: 2, away_score: 0 }, submitted_at: '2026-07-20T09:00:00.000Z' },
    ];
    const client = createMockClient(db) as never;
    const preview = await previewFullMatchReport({
      client,
      tournamentId: TOURNAMENT_ID,
      venueId: 'venue-1',
      matchId: MATCH_ID,
      actorUserId: 'admin-1',
      input: baseInput({ regulationHomeScore: 2, regulationAwayScore: 0 }),
    });
    expect(preview.quickResultComparison.matches).toBe(true);
  });

  it('buildCanonicalFullReportPayload is order-independent for goals/cards (same logical content, different array order -> identical JSON)', () => {
    const scores = {
      regulationHomeScore: 2,
      regulationAwayScore: 0,
      penaltyHomeScore: null,
      penaltyAwayScore: null,
      decidedBy: 'regulation' as const,
      winnerTeamId: HOME,
      resultType: 'normal' as const,
    };
    const goalA = { teamId: HOME, playerId: 'player-home-1', minute: 10, isOwnGoal: false, goals: 1, note: null };
    const goalB = { teamId: HOME, playerId: 'player-home-2', minute: 40, isOwnGoal: false, goals: 1, note: null };

    const payload1 = buildCanonicalFullReportPayload({ matchId: MATCH_ID, tournamentId: TOURNAMENT_ID, scores, goals: [goalA, goalB], cards: [], reportText: 'x' });
    const payload2 = buildCanonicalFullReportPayload({ matchId: MATCH_ID, tournamentId: TOURNAMENT_ID, scores, goals: [goalB, goalA], cards: [], reportText: 'x' });

    expect(JSON.stringify(payload1)).toBe(JSON.stringify(payload2));
  });

  it('never includes a penaltyHomeScore/penaltyAwayScore-carrying goal event (penalty kicks are excluded from goal events entirely)', () => {
    const scores = {
      regulationHomeScore: 1,
      regulationAwayScore: 1,
      penaltyHomeScore: 4,
      penaltyAwayScore: 3,
      decidedBy: 'penalty' as const,
      winnerTeamId: HOME,
      resultType: 'penalty_decided' as const,
    };
    const payload = buildCanonicalFullReportPayload({
      matchId: MATCH_ID,
      tournamentId: TOURNAMENT_ID,
      scores,
      goals: [{ teamId: HOME, playerId: 'player-home-1', minute: 20, isOwnGoal: false, goals: 1, note: null }],
      cards: [],
      reportText: null,
    });
    for (const goal of payload.goals) {
      expect(goal).not.toHaveProperty('penaltyHomeScore');
      expect(goal).not.toHaveProperty('penaltyAwayScore');
    }
    expect(payload.goals).toHaveLength(1);
  });

  it('rejects publishing a report whose Preview was never taken for this exact score (payload hash mismatch)', async () => {
    const db = baseDb();
    const client = createMockClient(db) as never;
    const preview = await previewFullMatchReport({
      client,
      tournamentId: TOURNAMENT_ID,
      venueId: 'venue-1',
      matchId: MATCH_ID,
      actorUserId: 'admin-1',
      input: baseInput({ regulationHomeScore: 2 }),
    });

    await expect(
      publishFullMatchReport({
        client,
        tournamentId: TOURNAMENT_ID,
        venueId: 'venue-1',
        matchId: MATCH_ID,
        expectedVersion: preview.currentVersion,
        idempotencyKey: 'idem-edit',
        previewToken: preview.previewToken,
        actorUserId: 'admin-1',
        actorEmail: 'admin1@test.com',
        input: baseInput({ regulationHomeScore: 3 }),
      })
    ).rejects.toMatchObject({ code: 'FULL_REPORT_PREVIEW_MISMATCH' });
  });
});

describe('FullMatchReportError', () => {
  it('carries a code distinct from its message', () => {
    const error = new FullMatchReportError('SOME_CODE', 'some message');
    expect(error.code).toBe('SOME_CODE');
    expect(error.message).toBe('some message');
  });
});

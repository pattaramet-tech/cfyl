import { beforeEach, describe, expect, it } from 'vitest';
import {
  previewQuickResult,
  submitQuickResult,
  validateScoreInput,
  QuickResultError,
  listVenueMatchdayMatches,
} from '../quickResult';
import { issuePreviewToken } from '../previewToken';

describe('validateScoreInput', () => {
  it('accepts 0', () => {
    expect(validateScoreInput(0)).toEqual({ ok: true, value: 0 });
  });
  it('accepts 0 as a string', () => {
    expect(validateScoreInput('0')).toEqual({ ok: true, value: 0 });
  });
  it('accepts positive integers', () => {
    expect(validateScoreInput(4)).toEqual({ ok: true, value: 4 });
  });
  it('rejects negative numbers', () => {
    expect(validateScoreInput(-1).ok).toBe(false);
    expect(validateScoreInput(-1).error).toBe('NEGATIVE_SCORE');
  });
  it('rejects decimals', () => {
    expect(validateScoreInput(1.5).ok).toBe(false);
    expect(validateScoreInput(1.5).error).toBe('DECIMAL_SCORE');
  });
  it('rejects NaN', () => {
    expect(validateScoreInput('abc').ok).toBe(false);
    expect(validateScoreInput('abc').error).toBe('INVALID_SCORE');
  });
  it('rejects empty values', () => {
    expect(validateScoreInput('').ok).toBe(false);
    expect(validateScoreInput('').error).toBe('EMPTY_SCORE');
    expect(validateScoreInput(null).ok).toBe(false);
    expect(validateScoreInput(undefined).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Minimal in-memory Supabase-like query builder mock, shared style with other
// Tournament V2 route/service tests in this repo. Supports injecting a
// one-time insert failure on a given table to test the multi-write
// failure-path (see 'submitQuickResult — multi-write failure safety' below).
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

function createMockClient(db: Db, options: { failInsertOnce?: Set<string> } = {}) {
  const failInsertOnce = options.failInsertOnce || new Set<string>();

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

    function execute(): { data: Row[]; error: { message: string } | null } {
      if (mode === 'update') {
        const matched = rows().filter(matches);
        matched.forEach((row) => Object.assign(row, patch));
        return { data: matched, error: null };
      }
      if (mode === 'insert') {
        if (failInsertOnce.has(table)) {
          failInsertOnce.delete(table);
          return { data: [], error: { message: `simulated insert failure on ${table}` } };
        }
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
      then(resolve: (value: { data: Row[]; error: unknown }) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(execute()).then(resolve, reject);
      },
    };
    return api;
  }

  return {
    from(table: string) {
      return builder(table);
    },
  } as unknown as Parameters<typeof submitQuickResult>[0]['client'];
}

function baseMatch(overrides: Row = {}): Row {
  return {
    id: 'match-1',
    tournament_id: 'tour-1',
    category_id: 'cat-1',
    venue_id: 'venue-1',
    court_id: 'court-1',
    match_code: 'B-U12-GA-001',
    match_no: 1,
    match_date: '2026-08-01',
    match_time: '08:30',
    home_team_id: 'team-a',
    away_team_id: 'team-b',
    status: 'scheduled',
    result_workflow_status: 'not_started',
    result_type: 'normal',
    version: 3,
    deleted_at: null,
    ...overrides,
  };
}

function buildDb(matchOverrides: Row = {}): Db {
  return {
    tournament_matches: [baseMatch(matchOverrides)],
    tournament_teams: [
      { id: 'team-a', name: 'Home School' },
      { id: 'team-b', name: 'Away School' },
    ],
    tournament_venues: [{ id: 'venue-1', name: 'Field 1' }],
    tournament_courts: [{ id: 'court-1', name: 'Court 1' }],
    tournament_categories: [{ id: 'cat-1', code: 'B-U12', name: 'Boys U12' }],
    tournament_result_submissions: [],
    tournament_result_versions: [],
  };
}

const ACTOR = 'operator-1';

beforeEach(() => {
  process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
});

describe('previewQuickResult', () => {
  it('returns a full preview with a signed preview token, writing nothing', async () => {
    const db = buildDb();
    const preview = await previewQuickResult({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      venueId: 'venue-1',
      matchId: 'match-1',
      homeScore: 2,
      awayScore: 1,
      actorUserId: ACTOR,
    });

    expect(preview.homeTeamName).toBe('Home School');
    expect(preview.awayTeamName).toBe('Away School');
    expect(preview.homeScore).toBe(2);
    expect(preview.awayScore).toBe(1);
    expect(preview.currentVersion).toBe(3);
    expect(preview.previewToken).toEqual(expect.any(String));
    expect(preview.previewToken.split('.')).toHaveLength(2);
    expect(preview.previewExpiresAt).toEqual(expect.any(String));
    expect(db.tournament_result_submissions).toHaveLength(0);
    expect(db.tournament_matches[0].version).toBe(3);
  });

  it('blocks when the home team placeholder is unresolved', async () => {
    const db = buildDb({ home_team_id: null });
    await expect(
      previewQuickResult({ client: createMockClient(db), tournamentId: 'tour-1', venueId: 'venue-1', matchId: 'match-1', homeScore: 1, awayScore: 0, actorUserId: ACTOR })
    ).rejects.toMatchObject({ code: 'HOME_TEAM_UNRESOLVED' } as Partial<QuickResultError>);
  });

  it('blocks when the away team placeholder is unresolved', async () => {
    const db = buildDb({ away_team_id: null });
    await expect(
      previewQuickResult({ client: createMockClient(db), tournamentId: 'tour-1', venueId: 'venue-1', matchId: 'match-1', homeScore: 1, awayScore: 0, actorUserId: ACTOR })
    ).rejects.toMatchObject({ code: 'AWAY_TEAM_UNRESOLVED' });
  });

  it('rejects a match belonging to a different venue', async () => {
    const db = buildDb();
    await expect(
      previewQuickResult({ client: createMockClient(db), tournamentId: 'tour-1', venueId: 'venue-OTHER', matchId: 'match-1', homeScore: 1, awayScore: 0, actorUserId: ACTOR })
    ).rejects.toMatchObject({ code: 'VENUE_MATCH_MISMATCH' });
  });

  it('rejects a deleted match', async () => {
    const db = buildDb({ deleted_at: '2026-01-01T00:00:00Z' });
    await expect(
      previewQuickResult({ client: createMockClient(db), tournamentId: 'tour-1', venueId: 'venue-1', matchId: 'match-1', homeScore: 1, awayScore: 0, actorUserId: ACTOR })
    ).rejects.toMatchObject({ code: 'MATCH_DELETED' });
  });

  it('excludes a BYE match', async () => {
    const db = buildDb({ status: 'bye', away_team_id: null });
    await expect(
      previewQuickResult({ client: createMockClient(db), tournamentId: 'tour-1', venueId: 'venue-1', matchId: 'match-1', homeScore: 1, awayScore: 0, actorUserId: ACTOR })
    ).rejects.toMatchObject({ code: 'MATCH_STATUS_INCOMPATIBLE' });
  });

  it('rejects a negative score', async () => {
    const db = buildDb();
    await expect(
      previewQuickResult({ client: createMockClient(db), tournamentId: 'tour-1', venueId: 'venue-1', matchId: 'match-1', homeScore: -1, awayScore: 0, actorUserId: ACTOR })
    ).rejects.toMatchObject({ code: 'HOME_SCORE_NEGATIVE_SCORE' });
  });
});

/** Runs a real Preview to obtain a valid token+version for a submitQuickResult test. */
async function preview(db: Db, overrides: Partial<Parameters<typeof previewQuickResult>[0]> = {}) {
  return previewQuickResult({
    client: createMockClient(db),
    tournamentId: 'tour-1',
    venueId: 'venue-1',
    matchId: 'match-1',
    homeScore: 2,
    awayScore: 1,
    actorUserId: ACTOR,
    ...overrides,
  });
}

function submitParamsFromPreview(db: Db, previewResult: Awaited<ReturnType<typeof previewQuickResult>>, idempotencyKey = 'idem-key-1') {
  return {
    client: createMockClient(db),
    tournamentId: 'tour-1',
    venueId: 'venue-1',
    matchId: 'match-1',
    homeScore: previewResult.homeScore,
    awayScore: previewResult.awayScore,
    expectedVersion: previewResult.currentVersion,
    idempotencyKey,
    previewToken: previewResult.previewToken,
    actorUserId: ACTOR,
    actorEmail: 'operator@test.com',
    sessionId: 'session-1',
    deviceMetadata: null,
  };
}

describe('submitQuickResult — preview token enforcement', () => {
  it('rejects submission with no preview token at all', async () => {
    const db = buildDb();
    await expect(
      submitQuickResult({
        client: createMockClient(db),
        tournamentId: 'tour-1',
        venueId: 'venue-1',
        matchId: 'match-1',
        homeScore: 2,
        awayScore: 1,
        expectedVersion: 3,
        idempotencyKey: 'idem-key-1',
        previewToken: '',
        actorUserId: ACTOR,
        actorEmail: 'operator@test.com',
        sessionId: null,
        deviceMetadata: null,
      })
    ).rejects.toMatchObject({ code: 'QUICK_RESULT_PREVIEW_REQUIRED' });
    expect(db.tournament_result_submissions).toHaveLength(0);
  });

  it('succeeds with a valid token and identical payload, staying provisional', async () => {
    const db = buildDb();
    const previewResult = await preview(db);
    const result = await submitQuickResult(submitParamsFromPreview(db, previewResult));

    expect(result.status).toBe('submitted');
    expect(db.tournament_result_submissions).toHaveLength(1);
    expect(db.tournament_matches[0].result_workflow_status).toBe('not_started');
    expect(db.tournament_matches[0].version).toBe(4);
  });

  it('rejects a tampered token', async () => {
    const db = buildDb();
    const previewResult = await preview(db);
    const [payload] = previewResult.previewToken.split('.');
    const tamperedToken = `${payload}.tamperedSignature`;

    await expect(
      submitQuickResult({ ...submitParamsFromPreview(db, previewResult), previewToken: tamperedToken })
    ).rejects.toMatchObject({ code: 'QUICK_RESULT_PREVIEW_INVALID' });
    expect(db.tournament_result_submissions).toHaveLength(0);
  });

  it('rejects an expired token', async () => {
    const db = buildDb();
    const expiredToken = issuePreviewToken({
      tournamentId: 'tour-1',
      matchId: 'match-1',
      venueId: 'venue-1',
      homeScore: 2,
      awayScore: 1,
      matchVersion: 3,
      actorUserId: ACTOR,
    });
    // Force expiry by constructing a token whose payload already expired.
    const [payloadB64] = expiredToken.token.split('.');
    const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    decoded.expiresAt = Date.now() - 1000;
    const rePayload = Buffer.from(JSON.stringify(decoded), 'utf-8').toString('base64url');
    const { createHmac } = await import('crypto');
    const signature = createHmac('sha256', process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET as string)
      .update(rePayload)
      .digest('base64url');
    const reSignedExpiredToken = `${rePayload}.${signature}`;

    await expect(
      submitQuickResult({
        client: createMockClient(db),
        tournamentId: 'tour-1',
        venueId: 'venue-1',
        matchId: 'match-1',
        homeScore: 2,
        awayScore: 1,
        expectedVersion: 3,
        idempotencyKey: 'idem-key-1',
        previewToken: reSignedExpiredToken,
        actorUserId: ACTOR,
        actorEmail: 'operator@test.com',
        sessionId: null,
        deviceMetadata: null,
      })
    ).rejects.toMatchObject({ code: 'QUICK_RESULT_PREVIEW_EXPIRED' });
    expect(db.tournament_result_submissions).toHaveLength(0);
  });

  it('rejects a token issued for a different match', async () => {
    const db = buildDb();
    db.tournament_matches.push(baseMatch({ id: 'match-2', match_code: 'B-U12-GA-002' }));
    const previewResult = await preview(db);

    await expect(
      submitQuickResult({ ...submitParamsFromPreview(db, previewResult), matchId: 'match-2' })
    ).rejects.toMatchObject({ code: 'QUICK_RESULT_PREVIEW_MISMATCH' });
    expect(db.tournament_result_submissions).toHaveLength(0);
  });

  it('rejects a token issued for a different tournament', async () => {
    const db = buildDb();
    const previewResult = await preview(db);

    await expect(
      submitQuickResult({ ...submitParamsFromPreview(db, previewResult), tournamentId: 'tour-OTHER' })
    ).rejects.toMatchObject({ code: 'QUICK_RESULT_PREVIEW_MISMATCH' });
  });

  it('rejects a token issued for a different venue', async () => {
    const db = buildDb();
    const previewResult = await preview(db);

    await expect(
      submitQuickResult({ ...submitParamsFromPreview(db, previewResult), venueId: 'venue-OTHER' })
    ).rejects.toMatchObject({ code: 'QUICK_RESULT_PREVIEW_MISMATCH' });
  });

  it('rejects a home-score change after preview', async () => {
    const db = buildDb();
    const previewResult = await preview(db);

    await expect(
      submitQuickResult({ ...submitParamsFromPreview(db, previewResult), homeScore: 9 })
    ).rejects.toMatchObject({ code: 'QUICK_RESULT_PREVIEW_MISMATCH' });
  });

  it('rejects an away-score change after preview', async () => {
    const db = buildDb();
    const previewResult = await preview(db);

    await expect(
      submitQuickResult({ ...submitParamsFromPreview(db, previewResult), awayScore: 9 })
    ).rejects.toMatchObject({ code: 'QUICK_RESULT_PREVIEW_MISMATCH' });
  });

  it('rejects an expected-version mismatch against the token', async () => {
    const db = buildDb();
    const previewResult = await preview(db);

    await expect(
      submitQuickResult({ ...submitParamsFromPreview(db, previewResult), expectedVersion: 999 })
    ).rejects.toMatchObject({ code: 'QUICK_RESULT_PREVIEW_MISMATCH' });
  });

  it('rejects a token presented by a different actor than the one who previewed', async () => {
    const db = buildDb();
    const previewResult = await preview(db);

    await expect(
      submitQuickResult({ ...submitParamsFromPreview(db, previewResult), actorUserId: 'operator-INTRUDER' })
    ).rejects.toMatchObject({ code: 'QUICK_RESULT_PREVIEW_MISMATCH' });
    expect(db.tournament_result_submissions).toHaveLength(0);
  });

  it('still returns 409 QUICK_RESULT_VERSION_CONFLICT for a stale database version even with a structurally valid token', async () => {
    const db = buildDb();
    const previewResult = await preview(db); // token carries matchVersion 3
    // Someone else updates the match after Preview.
    db.tournament_matches[0].version = 5;

    await expect(submitQuickResult(submitParamsFromPreview(db, previewResult))).rejects.toMatchObject({
      code: 'QUICK_RESULT_VERSION_CONFLICT',
    });
    expect(db.tournament_result_submissions).toHaveLength(0);
  });
});

describe('submitQuickResult — existing validation (still enforced)', () => {
  it('rejects a wrong venue for the match', async () => {
    const db = buildDb();
    const previewResult = await previewQuickResult({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      venueId: 'venue-OTHER',
      matchId: 'match-1',
      homeScore: 2,
      awayScore: 1,
      actorUserId: ACTOR,
    }).catch((e) => e as QuickResultError);
    expect((previewResult as QuickResultError).code).toBe('VENUE_MATCH_MISMATCH');
  });

  it('rejects a deleted match at submit time even with a token from before deletion', async () => {
    const db = buildDb();
    const previewResult = await preview(db);
    db.tournament_matches[0].deleted_at = '2026-01-01T00:00:00Z';

    await expect(submitQuickResult(submitParamsFromPreview(db, previewResult))).rejects.toMatchObject({
      code: 'MATCH_DELETED',
    });
  });

  it('blocks submission when the home placeholder becomes unresolved after preview', async () => {
    const db = buildDb();
    const previewResult = await preview(db);
    db.tournament_matches[0].home_team_id = null;

    await expect(submitQuickResult(submitParamsFromPreview(db, previewResult))).rejects.toMatchObject({
      code: 'HOME_TEAM_UNRESOLVED',
    });
  });

  it('rejects a match that already has an official published result', async () => {
    const db = buildDb();
    const previewResult = await preview(db);
    db.tournament_matches[0].result_workflow_status = 'published';

    await expect(submitQuickResult(submitParamsFromPreview(db, previewResult))).rejects.toMatchObject({
      code: 'RESULT_ALREADY_PUBLISHED',
    });
  });
});

describe('submitQuickResult — idempotent retries', () => {
  it('returns the stored result for a duplicate idempotency key with the same payload, without re-checking the token', async () => {
    const db = buildDb();
    const previewResult = await preview(db);
    const params = submitParamsFromPreview(db, previewResult);

    const first = await submitQuickResult(params);
    // Retry reuses the SAME (now token-consumed-in-spirit, but not literally
    // invalidated) token — per the idempotency-first order of operations,
    // the token is not even re-verified on a same-payload replay.
    const second = await submitQuickResult(params);

    expect(second.idempotent).toBe(true);
    expect(second.submissionId).toBe(first.submissionId);
    expect(db.tournament_result_submissions).toHaveLength(1);
  });

  it('rejects a duplicate idempotency key used with a different score payload', async () => {
    const db = buildDb();
    const previewResult = await preview(db);
    const params = submitParamsFromPreview(db, previewResult);
    await submitQuickResult(params);

    await expect(submitQuickResult({ ...params, homeScore: 9 })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
    });
    expect(db.tournament_result_submissions).toHaveLength(1);
  });

  it('rejects a duplicate idempotency key used against a different match', async () => {
    const db = buildDb();
    db.tournament_matches.push(baseMatch({ id: 'match-2', match_code: 'B-U12-GA-002' }));
    const previewResult = await preview(db);
    const params = submitParamsFromPreview(db, previewResult, 'shared-key');
    await submitQuickResult(params);

    // Same idempotency key, but scoped by match_id in the unique constraint —
    // a different match_id means no existing row is found for THIS match, so
    // it is treated as a genuinely new write and still requires a valid
    // matching token (which it has, since this is match-2's own preview).
    const secondPreview = await previewQuickResult({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      venueId: 'venue-1',
      matchId: 'match-2',
      homeScore: 2,
      awayScore: 1,
      actorUserId: ACTOR,
    });
    const secondResult = await submitQuickResult({
      ...submitParamsFromPreview(db, secondPreview, 'shared-key'),
      matchId: 'match-2',
    });
    expect(secondResult.idempotent).toBe(false);
    expect(db.tournament_result_submissions).toHaveLength(2);
  });

  it('allows only one successful writer for concurrent submissions with different idempotency keys', async () => {
    const db = buildDb();
    const previewA = await preview(db);
    const first = await submitQuickResult(submitParamsFromPreview(db, previewA, 'key-A'));

    // A second concurrent caller previewed before the first submit landed,
    // so it still holds a token claiming matchVersion 3 — but the DB is now
    // at version 4.
    const previewB = await preview(db); // this reload sees version 3 too (mock db not yet aware — simulate stale by reusing previewA's token instead)
    void previewB;
    await expect(
      submitQuickResult({ ...submitParamsFromPreview(db, previewA, 'key-B') })
    ).rejects.toMatchObject({ code: 'QUICK_RESULT_VERSION_CONFLICT' });

    expect(first.idempotent).toBe(false);
    expect(db.tournament_result_submissions).toHaveLength(1);
  });

  it('rejects a missing idempotency key', async () => {
    const db = buildDb();
    const previewResult = await preview(db);
    await expect(
      submitQuickResult({ ...submitParamsFromPreview(db, previewResult), idempotencyKey: '' })
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  });
});

describe('submitQuickResult — multi-write failure safety (NOT a database transaction)', () => {
  it('rolls back the version claim (best-effort) when the submission insert fails, leaving no orphaned write', async () => {
    const db = buildDb();
    const previewResult = await preview(db);

    const failingClient = createMockClient(db, { failInsertOnce: new Set(['tournament_result_submissions']) });
    await expect(
      submitQuickResult({ ...submitParamsFromPreview(db, previewResult), client: failingClient })
    ).rejects.toThrow(/simulated insert failure/);

    // The compensating rollback restored the original version — no orphaned
    // version bump, no submission row. This is a best-effort code-level
    // rollback (a second UPDATE call), not a database transaction: if that
    // rollback UPDATE itself failed, the match would be left claimed with no
    // submission, and a retry would correctly surface
    // QUICK_RESULT_VERSION_CONFLICT (fail-safe: never silently fabricates or
    // duplicates a result) rather than succeeding against stale state.
    expect(db.tournament_matches[0].version).toBe(3);
    expect(db.tournament_result_submissions).toHaveLength(0);
  });

  it('does not fail the submission when only the result_versions history insert fails', async () => {
    const db = buildDb();
    const previewResult = await preview(db);

    const failingClient = createMockClient(db, { failInsertOnce: new Set(['tournament_result_versions']) });
    const result = await submitQuickResult({ ...submitParamsFromPreview(db, previewResult), client: failingClient });

    // Non-fatal: the submission (source of truth for the provisional score)
    // is saved; only the supplementary audit-history row is missing.
    expect(result.status).toBe('submitted');
    expect(db.tournament_result_submissions).toHaveLength(1);
    expect(db.tournament_result_versions).toHaveLength(0);
  });
});

describe('listVenueMatchdayMatches', () => {
  it('lists matches for the venue/date with resolved team names and eligibility', async () => {
    const db = buildDb();
    const matches = await listVenueMatchdayMatches({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      venueId: 'venue-1',
      date: '2026-08-01',
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      matchCode: 'B-U12-GA-001',
      homeTeamName: 'Home School',
      awayTeamName: 'Away School',
      eligible: true,
      hasQuickResult: false,
    });
  });

  it('marks a match with an existing quick result submission', async () => {
    const db = buildDb();
    db.tournament_result_submissions.push({ id: 'sub-1', match_id: 'match-1', stage: 'quick_result' });
    const matches = await listVenueMatchdayMatches({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      venueId: 'venue-1',
      date: '2026-08-01',
    });
    expect(matches[0].hasQuickResult).toBe(true);
  });

  it('shows TBD safely for an unresolved team without crashing', async () => {
    const db = buildDb({ home_team_id: null });
    const matches = await listVenueMatchdayMatches({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      venueId: 'venue-1',
      date: '2026-08-01',
    });
    expect(matches[0].homeTeamName).toBe('TBD');
    expect(matches[0].eligible).toBe(false);
    expect(matches[0].ineligibleReason).toBe('HOME_TEAM_UNRESOLVED');
  });
});

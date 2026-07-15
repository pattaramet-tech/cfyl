import { describe, expect, it } from 'vitest';
import {
  previewQuickResult,
  submitQuickResult,
  validateScoreInput,
  QuickResultError,
  listVenueMatchdayMatches,
} from '../quickResult';

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
// Tournament V2 route/service tests in this repo.
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

describe('previewQuickResult', () => {
  it('returns a full preview without writing anything', async () => {
    const db = buildDb();
    const preview = await previewQuickResult({
      client: createMockClient(db),
      tournamentId: 'tour-1',
      venueId: 'venue-1',
      matchId: 'match-1',
      homeScore: 2,
      awayScore: 1,
    });

    expect(preview.homeTeamName).toBe('Home School');
    expect(preview.awayTeamName).toBe('Away School');
    expect(preview.homeScore).toBe(2);
    expect(preview.awayScore).toBe(1);
    expect(preview.currentVersion).toBe(3);
    expect(db.tournament_result_submissions).toHaveLength(0);
  });

  it('blocks when the home team placeholder is unresolved and explains which side', async () => {
    const db = buildDb({ home_team_id: null });
    await expect(
      previewQuickResult({ client: createMockClient(db), tournamentId: 'tour-1', venueId: 'venue-1', matchId: 'match-1', homeScore: 1, awayScore: 0 })
    ).rejects.toMatchObject({ code: 'HOME_TEAM_UNRESOLVED' } as Partial<QuickResultError>);
  });

  it('blocks when the away team placeholder is unresolved', async () => {
    const db = buildDb({ away_team_id: null });
    await expect(
      previewQuickResult({ client: createMockClient(db), tournamentId: 'tour-1', venueId: 'venue-1', matchId: 'match-1', homeScore: 1, awayScore: 0 })
    ).rejects.toMatchObject({ code: 'AWAY_TEAM_UNRESOLVED' });
  });

  it('rejects a match belonging to a different venue', async () => {
    const db = buildDb();
    await expect(
      previewQuickResult({ client: createMockClient(db), tournamentId: 'tour-1', venueId: 'venue-OTHER', matchId: 'match-1', homeScore: 1, awayScore: 0 })
    ).rejects.toMatchObject({ code: 'VENUE_MATCH_MISMATCH' });
  });

  it('rejects a deleted match', async () => {
    const db = buildDb({ deleted_at: '2026-01-01T00:00:00Z' });
    await expect(
      previewQuickResult({ client: createMockClient(db), tournamentId: 'tour-1', venueId: 'venue-1', matchId: 'match-1', homeScore: 1, awayScore: 0 })
    ).rejects.toMatchObject({ code: 'MATCH_DELETED' });
  });

  it('excludes a BYE match', async () => {
    const db = buildDb({ status: 'bye', away_team_id: null });
    await expect(
      previewQuickResult({ client: createMockClient(db), tournamentId: 'tour-1', venueId: 'venue-1', matchId: 'match-1', homeScore: 1, awayScore: 0 })
    ).rejects.toMatchObject({ code: 'MATCH_STATUS_INCOMPATIBLE' });
  });

  it('rejects a negative score', async () => {
    const db = buildDb();
    await expect(
      previewQuickResult({ client: createMockClient(db), tournamentId: 'tour-1', venueId: 'venue-1', matchId: 'match-1', homeScore: -1, awayScore: 0 })
    ).rejects.toMatchObject({ code: 'HOME_SCORE_NEGATIVE_SCORE' });
  });
});

const validSubmitParams = {
  tournamentId: 'tour-1',
  venueId: 'venue-1',
  matchId: 'match-1',
  homeScore: 2,
  awayScore: 1,
  expectedVersion: 3,
  idempotencyKey: 'idem-key-1',
  actorUserId: 'operator-1',
  actorEmail: 'operator@test.com',
  sessionId: 'session-1',
  deviceMetadata: null,
};

describe('submitQuickResult', () => {
  it('succeeds with a valid preview-matching payload, remains provisional, and does not publish', async () => {
    const db = buildDb();
    const result = await submitQuickResult({ client: createMockClient(db), ...validSubmitParams });

    expect(result.status).toBe('submitted');
    expect(result.idempotent).toBe(false);
    expect(db.tournament_result_submissions).toHaveLength(1);
    expect(db.tournament_result_submissions[0].stage).toBe('quick_result');
    expect(db.tournament_result_submissions[0].status).toBe('submitted');
    // Never publishes the official result — result_workflow_status is untouched.
    const match = db.tournament_matches.find((m) => m.id === 'match-1');
    expect(match?.result_workflow_status).toBe('not_started');
    expect(match?.version).toBe(4);
  });

  it('writes exactly one result_versions row per submission', async () => {
    const db = buildDb();
    await submitQuickResult({ client: createMockClient(db), ...validSubmitParams });
    expect(db.tournament_result_versions).toHaveLength(1);
    expect(db.tournament_result_versions[0].version).toBe(1);
  });

  it('rejects a wrong venue for the match', async () => {
    const db = buildDb();
    await expect(
      submitQuickResult({ client: createMockClient(db), ...validSubmitParams, venueId: 'venue-OTHER' })
    ).rejects.toMatchObject({ code: 'VENUE_MATCH_MISMATCH' });
    expect(db.tournament_result_submissions).toHaveLength(0);
  });

  it('rejects a deleted match', async () => {
    const db = buildDb({ deleted_at: '2026-01-01T00:00:00Z' });
    await expect(submitQuickResult({ client: createMockClient(db), ...validSubmitParams })).rejects.toMatchObject({
      code: 'MATCH_DELETED',
    });
  });

  it('blocks submission when the home placeholder is unresolved', async () => {
    const db = buildDb({ home_team_id: null });
    await expect(submitQuickResult({ client: createMockClient(db), ...validSubmitParams })).rejects.toMatchObject({
      code: 'HOME_TEAM_UNRESOLVED',
    });
  });

  it('blocks submission when the away placeholder is unresolved', async () => {
    const db = buildDb({ away_team_id: null });
    await expect(submitQuickResult({ client: createMockClient(db), ...validSubmitParams })).rejects.toMatchObject({
      code: 'AWAY_TEAM_UNRESOLVED',
    });
  });

  it('rejects an empty final score', async () => {
    const db = buildDb();
    await expect(
      submitQuickResult({ client: createMockClient(db), ...validSubmitParams, homeScore: '' })
    ).rejects.toMatchObject({ code: 'HOME_SCORE_EMPTY_SCORE' });
  });

  it('rejects a decimal score', async () => {
    const db = buildDb();
    await expect(
      submitQuickResult({ client: createMockClient(db), ...validSubmitParams, awayScore: 1.5 })
    ).rejects.toMatchObject({ code: 'AWAY_SCORE_DECIMAL_SCORE' });
  });

  it('returns a stale-version 409-mapped conflict when the match version no longer matches', async () => {
    const db = buildDb({ version: 5 });
    await expect(
      submitQuickResult({ client: createMockClient(db), ...validSubmitParams, expectedVersion: 3 })
    ).rejects.toMatchObject({ code: 'QUICK_RESULT_VERSION_CONFLICT' });
    expect(db.tournament_result_submissions).toHaveLength(0);
  });

  it('returns the stored result for a duplicate idempotency key with the same payload (idempotent retry)', async () => {
    const db = buildDb();
    const first = await submitQuickResult({ client: createMockClient(db), ...validSubmitParams });
    const second = await submitQuickResult({ client: createMockClient(db), ...validSubmitParams });

    expect(second.idempotent).toBe(true);
    expect(second.submissionId).toBe(first.submissionId);
    // No duplicate submission was created.
    expect(db.tournament_result_submissions).toHaveLength(1);
  });

  it('rejects a duplicate idempotency key used with a different payload', async () => {
    const db = buildDb();
    await submitQuickResult({ client: createMockClient(db), ...validSubmitParams });
    await expect(
      submitQuickResult({ client: createMockClient(db), ...validSubmitParams, homeScore: 9 })
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' });
    expect(db.tournament_result_submissions).toHaveLength(1);
  });

  it('allows only one successful writer for concurrent submissions with different idempotency keys', async () => {
    const db = buildDb();
    const first = await submitQuickResult({ client: createMockClient(db), ...validSubmitParams, idempotencyKey: 'key-A' });
    // Second concurrent request still thinks the match is at the original version — rejected.
    await expect(
      submitQuickResult({ client: createMockClient(db), ...validSubmitParams, idempotencyKey: 'key-B' })
    ).rejects.toMatchObject({ code: 'QUICK_RESULT_VERSION_CONFLICT' });

    expect(first.idempotent).toBe(false);
    expect(db.tournament_result_submissions).toHaveLength(1);
  });

  it('rejects a missing idempotency key', async () => {
    const db = buildDb();
    await expect(
      submitQuickResult({ client: createMockClient(db), ...validSubmitParams, idempotencyKey: '' })
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  });

  it('rejects a match that already has an official published result', async () => {
    const db = buildDb({ result_workflow_status: 'published' });
    await expect(submitQuickResult({ client: createMockClient(db), ...validSubmitParams })).rejects.toMatchObject({
      code: 'RESULT_ALREADY_PUBLISHED',
    });
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

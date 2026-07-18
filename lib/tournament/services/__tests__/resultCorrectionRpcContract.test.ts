import { describe, expect, it } from 'vitest';
import { createMockCorrectRpc, type Db, type Row } from './mockCorrectRpc';

// Defense-in-depth tests for Migration 018's own validation (see
// mockCorrectRpc.ts for the "this proves the contract, not live Postgres"
// caveat). These call the RPC handler DIRECTLY with hand-crafted args,
// bypassing lib/tournament/services/resultCorrection.ts's own app-layer
// validation entirely.

const TOURNAMENT_ID = 'tour-1';
const MATCH_ID = 'match-1';
const HOME = 'team-home';
const AWAY = 'team-away';

function baseMatchRow(overrides: Row = {}): Row {
  return {
    id: MATCH_ID,
    tournament_id: TOURNAMENT_ID,
    category_id: 'cat-1',
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
    ...overrides,
  };
}

function baseDb(matchOverrides: Row = {}): Db {
  return {
    tournament_matches: [baseMatchRow(matchOverrides)],
    tournament_result_submissions: [],
  };
}

function baseArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    p_match_id: MATCH_ID,
    p_tournament_id: TOURNAMENT_ID,
    p_expected_version: 5,
    p_actor_user_id: 'super-1',
    p_actor_email: 'super1@test.com',
    p_idempotency_key: 'idem-1',
    p_correction_reason: 'สกอร์บันทึกผิด',
    p_regulation_home_score: 3,
    p_regulation_away_score: 0,
    p_penalty_home_score: null,
    p_penalty_away_score: null,
    p_decided_by: 'regulation',
    p_winner_team_id: HOME,
    p_result_type: 'normal',
    ...overrides,
  };
}

describe('Migration 018 RPC contract — idempotency', () => {
  it('12. two same-key/same-payload calls: one physical correction, one idempotent success', () => {
    const db = baseDb();
    const rpc = createMockCorrectRpc(db);

    const first = rpc('correct_published_match_result', baseArgs());
    expect(first.error).toBeNull();
    expect(first.data?.idempotent).toBe(false);

    const second = rpc('correct_published_match_result', baseArgs());
    expect(second.error).toBeNull();
    expect(second.data?.idempotent).toBe(true);
    expect(second.data?.submission_id).toBe(first.data?.submission_id);

    // 16. Exactly one of everything, even though the RPC was called twice —
    // version increments exactly once.
    expect(db.tournament_result_submissions).toHaveLength(1);
    expect(db.tournament_result_versions).toHaveLength(1);
    expect(db.tournament_result_approvals).toHaveLength(1);
    expect(db.tournament_audit_logs).toHaveLength(1);
    expect((db.tournament_matches[0] as Row).version).toBe(6);
  });

  it('13. same key with a genuinely different payload is rejected even before any correction happens', () => {
    const db = baseDb();
    const rpc = createMockCorrectRpc(db);

    rpc('correct_published_match_result', baseArgs({ p_idempotency_key: 'idem-x', p_regulation_home_score: 3 }));
    const second = rpc('correct_published_match_result', baseArgs({ p_idempotency_key: 'idem-x', p_regulation_home_score: 5 }));

    expect(second.error?.message).toContain('RESULT_CORRECTION_IDEMPOTENCY_PAYLOAD_MISMATCH');
    expect(db.tournament_result_submissions).toHaveLength(1);
  });

  it('14. two different corrections issued from the same prior version: one succeeds, one hits a version conflict (sequential simulation of concurrency)', () => {
    const db = baseDb();
    const rpc = createMockCorrectRpc(db);

    // Both callers read version=5 (the same starting point) before either commits.
    const first = rpc('correct_published_match_result', baseArgs({ p_idempotency_key: 'idem-a', p_regulation_home_score: 3, p_expected_version: 5 }));
    expect(first.error).toBeNull();
    expect((db.tournament_matches[0] as Row).version).toBe(6);

    // The second caller still believes the version is 5 — it is now stale.
    const second = rpc('correct_published_match_result', baseArgs({ p_idempotency_key: 'idem-b', p_regulation_home_score: 4, p_expected_version: 5 }));
    expect(second.error?.message).toContain('RESULT_CORRECTION_VERSION_CONFLICT');

    // Exactly one successful correction, no lost update, no duplicate physical correction.
    expect(db.tournament_result_submissions).toHaveLength(1);
    expect((db.tournament_matches[0] as Row).regulation_home_score).toBe(3);
  });
});

describe('Migration 018 RPC contract — audit correctness', () => {
  it('15. audit log records both the previous and corrected official result plus the correction reason', () => {
    const db = baseDb();
    const rpc = createMockCorrectRpc(db);
    const result = rpc('correct_published_match_result', baseArgs());
    expect(result.error).toBeNull();

    const auditRow = (db.tournament_audit_logs as Row[])[0];
    expect(auditRow.action).toBe('tournament.result_correction.publish');
    const oldData = auditRow.old_data as Row;
    const newData = auditRow.new_data as Row;
    expect(oldData.regulationHomeScore).toBe(2);
    expect(oldData.regulationAwayScore).toBe(0);
    expect(oldData.correctionReason).toBe('สกอร์บันทึกผิด');
    expect(newData.regulationHomeScore).toBe(3);
    expect(newData.correctionReason).toBe('สกอร์บันทึกผิด');
  });
});

describe('Migration 018 RPC contract — eligibility and consistency', () => {
  it('a match without a published result is rejected', () => {
    const db = baseDb({ result_workflow_status: 'not_started', status: 'in_progress' });
    const rpc = createMockCorrectRpc(db);
    const result = rpc('correct_published_match_result', baseArgs());
    expect(result.error?.message).toContain('RESULT_CORRECTION_NOT_PUBLISHED');
  });

  it('an unresolved team is rejected', () => {
    const db = baseDb({ away_team_id: null });
    const rpc = createMockCorrectRpc(db);
    const result = rpc('correct_published_match_result', baseArgs());
    expect(result.error?.message).toContain('RESULT_CORRECTION_TEAM_UNRESOLVED');
  });

  it('an empty correction reason is rejected', () => {
    const db = baseDb();
    const rpc = createMockCorrectRpc(db);
    const result = rpc('correct_published_match_result', baseArgs({ p_correction_reason: '   ' }));
    expect(result.error?.message).toContain('RESULT_CORRECTION_REASON_REQUIRED');
  });

  it('a "correction" identical to the current official result is rejected', () => {
    const db = baseDb();
    const rpc = createMockCorrectRpc(db);
    const result = rpc('correct_published_match_result', baseArgs({ p_regulation_home_score: 2, p_regulation_away_score: 0, p_winner_team_id: HOME }));
    expect(result.error?.message).toContain('RESULT_CORRECTION_NO_CHANGES');
  });

  it('an invalid winner_team_id is rejected', () => {
    const db = baseDb();
    const rpc = createMockCorrectRpc(db);
    const result = rpc('correct_published_match_result', baseArgs({ p_winner_team_id: 'team-elsewhere' }));
    expect(result.error?.message).toContain('RESULT_CORRECTION_WINNER_TEAM_INVALID');
  });

  it('negative regulation score is rejected', () => {
    const db = baseDb();
    const rpc = createMockCorrectRpc(db);
    const result = rpc('correct_published_match_result', baseArgs({ p_regulation_home_score: -1 }));
    expect(result.error?.message).toContain('RESULT_CORRECTION_SCORE_INVALID');
  });

  it('a tied regulation correction without a penalty decision is rejected', () => {
    const db = baseDb();
    const rpc = createMockCorrectRpc(db);
    const result = rpc('correct_published_match_result', baseArgs({ p_regulation_home_score: 1, p_regulation_away_score: 1 }));
    expect(result.error?.message).toContain('RESULT_CORRECTION_RESULT_INCONSISTENT');
  });

  it('tied penalty scores are rejected', () => {
    const db = baseDb();
    const rpc = createMockCorrectRpc(db);
    const result = rpc(
      'correct_published_match_result',
      baseArgs({ p_regulation_home_score: 1, p_regulation_away_score: 1, p_decided_by: 'penalty', p_penalty_home_score: 3, p_penalty_away_score: 3, p_result_type: 'penalty_decided' })
    );
    expect(result.error?.message).toContain('RESULT_CORRECTION_RESULT_INCONSISTENT');
  });

  it('result_type inconsistent with decided_by is rejected', () => {
    const db = baseDb();
    const rpc = createMockCorrectRpc(db);
    const result = rpc('correct_published_match_result', baseArgs({ p_result_type: 'penalty_decided' }));
    expect(result.error?.message).toContain('RESULT_CORRECTION_RESULT_TYPE_INCONSISTENT');
  });

  it('a stale expected_version is rejected', () => {
    const db = baseDb();
    const rpc = createMockCorrectRpc(db);
    const result = rpc('correct_published_match_result', baseArgs({ p_expected_version: 1 }));
    expect(result.error?.message).toContain('RESULT_CORRECTION_VERSION_CONFLICT');
  });
});

describe('Migration 018 RPC contract — rollback on failure', () => {
  it('26. a rejected call leaves the match, submissions, versions, approvals, and audit log completely untouched', () => {
    const db = baseDb();
    const rpc = createMockCorrectRpc(db);
    const before = JSON.stringify(db);

    const result = rpc('correct_published_match_result', baseArgs({ p_winner_team_id: 'team-elsewhere' }));

    expect(result.error?.message).toContain('RESULT_CORRECTION_WINNER_TEAM_INVALID');
    expect(JSON.stringify(db)).toBe(before);
    expect(db.tournament_result_submissions).toHaveLength(0);
    expect(db.tournament_result_versions || []).toHaveLength(0);
    expect(db.tournament_result_approvals || []).toHaveLength(0);
    expect(db.tournament_audit_logs || []).toHaveLength(0);
  });
});

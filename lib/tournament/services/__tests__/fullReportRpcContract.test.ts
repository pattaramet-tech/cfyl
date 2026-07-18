import { describe, expect, it } from 'vitest';
import { createMockPublishRpc, type Db, type Row } from './mockPublishRpc';

// Defense-in-depth tests for Migration 014's own validation (see
// mockPublishRpc.ts for the "this proves the contract, not live Postgres"
// caveat). These call the RPC handler DIRECTLY with hand-crafted args,
// bypassing lib/tournament/services/fullMatchReport.ts's own app-layer
// validation entirely — proving the RPC rejects bad input even if a future
// caller (or a bug) skips the app layer's checks.

const TOURNAMENT_ID = 'tour-1';
const MATCH_ID = 'match-1';
const HOME = 'team-home';
const AWAY = 'team-away';
const OTHER_TEAM = 'team-other';

function baseMatchRow(overrides: Row = {}): Row {
  return {
    id: MATCH_ID,
    tournament_id: TOURNAMENT_ID,
    category_id: 'cat-1',
    home_team_id: HOME,
    away_team_id: AWAY,
    status: 'in_progress',
    result_workflow_status: 'not_started',
    schedule_status: 'published',
    version: 1,
    deleted_at: null,
    ...overrides,
  };
}

function baseDb(matchOverrides: Row = {}): Db {
  return {
    tournament_matches: [baseMatchRow(matchOverrides)],
    tournament_players: [
      { id: 'p-home-1', tournament_id: TOURNAMENT_ID, category_id: 'cat-1', team_id: HOME, deleted_at: null },
      { id: 'p-away-1', tournament_id: TOURNAMENT_ID, category_id: 'cat-1', team_id: AWAY, deleted_at: null },
      { id: 'p-other-team', tournament_id: TOURNAMENT_ID, category_id: 'cat-1', team_id: OTHER_TEAM, deleted_at: null },
      { id: 'p-other-tournament', tournament_id: 'tour-9', category_id: 'cat-1', team_id: HOME, deleted_at: null },
      { id: 'p-other-category', tournament_id: TOURNAMENT_ID, category_id: 'cat-9', team_id: HOME, deleted_at: null },
      { id: 'p-deleted', tournament_id: TOURNAMENT_ID, category_id: 'cat-1', team_id: HOME, deleted_at: '2026-01-01T00:00:00Z' },
    ],
    tournament_result_submissions: [],
  };
}

function baseArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    p_match_id: MATCH_ID,
    p_tournament_id: TOURNAMENT_ID,
    p_expected_version: 1,
    p_actor_user_id: 'admin-1',
    p_actor_email: 'admin1@test.com',
    p_idempotency_key: 'idem-1',
    p_regulation_home_score: 2,
    p_regulation_away_score: 0,
    p_penalty_home_score: null,
    p_penalty_away_score: null,
    p_decided_by: 'regulation',
    p_winner_team_id: HOME,
    p_result_type: 'normal',
    p_goals: [],
    p_cards: [],
    p_report_text: null,
    p_quick_result_comparison: null,
    ...overrides,
  };
}

describe('Migration 014 RPC contract — concurrency (sequential simulation)', () => {
  it('1. two same-key/same-payload calls: one physical publication, one idempotent success', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);

    const first = rpc('publish_full_match_report', baseArgs());
    expect(first.error).toBeNull();
    expect(first.data?.idempotent).toBe(false);

    const second = rpc('publish_full_match_report', baseArgs());
    expect(second.error).toBeNull();
    expect(second.data?.idempotent).toBe(true);
    expect(second.data?.submission_id).toBe(first.data?.submission_id);

    // Exactly one of everything, even though the RPC was called twice.
    expect(db.tournament_result_submissions).toHaveLength(1);
    expect(db.tournament_result_versions).toHaveLength(1);
    expect(db.tournament_audit_logs).toHaveLength(1);
    expect((db.tournament_matches[0] as Row).version).toBe(2);
  });

  it('2. a different-key request against an already-published match is rejected, not treated as idempotent', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);

    rpc('publish_full_match_report', baseArgs({ p_idempotency_key: 'idem-first' }));
    const second = rpc('publish_full_match_report', baseArgs({ p_idempotency_key: 'idem-second' }));

    expect(second.error?.message).toContain('FULL_REPORT_ALREADY_PUBLISHED_USE_CORRECTION');
    expect(db.tournament_result_submissions).toHaveLength(1);
  });

  it('same key with a genuinely different payload is rejected even before any publish happens', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);

    rpc('publish_full_match_report', baseArgs({ p_idempotency_key: 'idem-x', p_regulation_home_score: 2 }));
    const second = rpc('publish_full_match_report', baseArgs({ p_idempotency_key: 'idem-x', p_regulation_home_score: 5 }));

    expect(second.error?.message).toContain('FULL_REPORT_IDEMPOTENCY_PAYLOAD_MISMATCH');
    expect(db.tournament_result_submissions).toHaveLength(1);
  });
});

describe('Migration 014 RPC contract — penalty/result_type consistency', () => {
  it('3. negative penalty score rejected', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);
    const result = rpc(
      'publish_full_match_report',
      baseArgs({
        p_regulation_home_score: 1,
        p_regulation_away_score: 1,
        p_decided_by: 'penalty',
        p_penalty_home_score: -1,
        p_penalty_away_score: 2,
        p_result_type: 'penalty_decided',
        p_winner_team_id: AWAY,
      })
    );
    expect(result.error?.message).toContain('FULL_REPORT_SCORE_INVALID');
  });

  it('4. result_type=normal with a penalty decision rejected', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);
    const result = rpc(
      'publish_full_match_report',
      baseArgs({
        p_regulation_home_score: 1,
        p_regulation_away_score: 1,
        p_decided_by: 'penalty',
        p_penalty_home_score: 4,
        p_penalty_away_score: 2,
        p_result_type: 'normal',
        p_winner_team_id: HOME,
      })
    );
    expect(result.error?.message).toContain('FULL_REPORT_RESULT_TYPE_INCONSISTENT');
  });

  it('5. result_type=penalty_decided with a regulation decision rejected', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);
    const result = rpc(
      'publish_full_match_report',
      baseArgs({
        p_regulation_home_score: 3,
        p_regulation_away_score: 1,
        p_decided_by: 'regulation',
        p_result_type: 'penalty_decided',
        p_winner_team_id: HOME,
      })
    );
    expect(result.error?.message).toContain('FULL_REPORT_RESULT_TYPE_INCONSISTENT');
  });

  it('6/7. there is no p_payload parameter — the stored/idempotency payload is always built by the RPC from its own validated scalar parameters, so a caller cannot submit a payload whose score or winner diverges from what is actually written', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);
    const result = rpc('publish_full_match_report', baseArgs());
    expect(result.error).toBeNull();
    const stored = (db.tournament_result_submissions[0] as Row).payload as Row;
    expect(stored.regulationHomeScore).toBe(2);
    expect(stored.regulationAwayScore).toBe(0);
    expect(stored.winnerTeamId).toBe(HOME);
    // No parameter named p_payload exists on the function signature at all
    // (see scripts/tournament-v2/014-full-result-publish-transaction.sql) —
    // there is nothing for a caller to submit that could diverge.
  });
});

describe('Migration 014 RPC contract — goal event scope', () => {
  it('8. goal team outside the match is rejected', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);
    const result = rpc('publish_full_match_report', baseArgs({ p_goals: [{ team_id: OTHER_TEAM, player_id: null, minute: 1, goals: 1 }] }));
    expect(result.error?.message).toContain('FULL_REPORT_GOAL_TEAM_INVALID');
  });

  it('9. goal player from another team is rejected', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);
    const result = rpc('publish_full_match_report', baseArgs({ p_goals: [{ team_id: HOME, player_id: 'p-away-1', minute: 1, goals: 1 }] }));
    expect(result.error?.message).toContain('FULL_REPORT_GOAL_PLAYER_TEAM_MISMATCH');
  });

  it('10. goal player from another tournament is rejected', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);
    const result = rpc('publish_full_match_report', baseArgs({ p_goals: [{ team_id: HOME, player_id: 'p-other-tournament', minute: 1, goals: 1 }] }));
    expect(result.error?.message).toContain('FULL_REPORT_GOAL_PLAYER_TOURNAMENT_MISMATCH');
  });

  it('11. goal player from another category is rejected', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);
    const result = rpc('publish_full_match_report', baseArgs({ p_goals: [{ team_id: HOME, player_id: 'p-other-category', minute: 1, goals: 1 }] }));
    expect(result.error?.message).toContain('FULL_REPORT_GOAL_PLAYER_CATEGORY_MISMATCH');
  });

  it('12. deleted goal player is rejected', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);
    const result = rpc('publish_full_match_report', baseArgs({ p_goals: [{ team_id: HOME, player_id: 'p-deleted', minute: 1, goals: 1 }] }));
    expect(result.error?.message).toContain('FULL_REPORT_GOAL_PLAYER_DELETED');
  });

  it('19. invalid (non-positive) goal count is rejected', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);
    const result = rpc('publish_full_match_report', baseArgs({ p_goals: [{ team_id: HOME, player_id: null, minute: 1, goals: 0 }] }));
    expect(result.error?.message).toContain('FULL_REPORT_GOAL_COUNT_INVALID');
  });

  it('20a. negative goal minute is rejected', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);
    const result = rpc('publish_full_match_report', baseArgs({ p_goals: [{ team_id: HOME, player_id: null, minute: -5, goals: 1 }] }));
    expect(result.error?.message).toContain('FULL_REPORT_GOAL_MINUTE_INVALID');
  });

  it('an own-goal event skips the team-match check (undocumented convention — not enforced either way) but still validates tournament/category/not-deleted', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);
    // p-away-1 belongs to AWAY, submitted against HOME as an own goal — must
    // NOT be rejected for team mismatch (the ambiguity is intentionally
    // unresolved), but a deleted/other-tournament player must still fail.
    const result = rpc(
      'publish_full_match_report',
      baseArgs({ p_goals: [{ team_id: HOME, player_id: 'p-away-1', is_own_goal: true, minute: 1, goals: 1 }] })
    );
    expect(result.error).toBeNull();

    const dbDeleted = baseDb();
    const rpcDeleted = createMockPublishRpc(dbDeleted);
    const deletedResult = rpcDeleted(
      'publish_full_match_report',
      baseArgs({ p_goals: [{ team_id: HOME, player_id: 'p-deleted', is_own_goal: true, minute: 1, goals: 1 }] })
    );
    expect(deletedResult.error?.message).toContain('FULL_REPORT_GOAL_PLAYER_DELETED');
  });
});

describe('Migration 014 RPC contract — card event scope', () => {
  it('13. card team outside the match is rejected', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);
    const result = rpc('publish_full_match_report', baseArgs({ p_cards: [{ team_id: OTHER_TEAM, player_id: 'p-other-team', card_type: 'yellow', minute: 1 }] }));
    expect(result.error?.message).toContain('FULL_REPORT_CARD_TEAM_INVALID');
  });

  it('14. card player from another team is rejected', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);
    const result = rpc('publish_full_match_report', baseArgs({ p_cards: [{ team_id: HOME, player_id: 'p-away-1', card_type: 'yellow', minute: 1 }] }));
    expect(result.error?.message).toContain('FULL_REPORT_CARD_PLAYER_TEAM_MISMATCH');
  });

  it('15. card player from another tournament is rejected', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);
    const result = rpc('publish_full_match_report', baseArgs({ p_cards: [{ team_id: HOME, player_id: 'p-other-tournament', card_type: 'yellow', minute: 1 }] }));
    expect(result.error?.message).toContain('FULL_REPORT_CARD_PLAYER_TOURNAMENT_MISMATCH');
  });

  it('16. card player from another category is rejected', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);
    const result = rpc('publish_full_match_report', baseArgs({ p_cards: [{ team_id: HOME, player_id: 'p-other-category', card_type: 'yellow', minute: 1 }] }));
    expect(result.error?.message).toContain('FULL_REPORT_CARD_PLAYER_CATEGORY_MISMATCH');
  });

  it('17. deleted card player is rejected', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);
    const result = rpc('publish_full_match_report', baseArgs({ p_cards: [{ team_id: HOME, player_id: 'p-deleted', card_type: 'yellow', minute: 1 }] }));
    expect(result.error?.message).toContain('FULL_REPORT_CARD_PLAYER_DELETED');
  });

  it('18. duplicate (player, card_type) is rejected inside the transaction, before insert', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);
    const result = rpc(
      'publish_full_match_report',
      baseArgs({
        p_cards: [
          { team_id: HOME, player_id: 'p-home-1', card_type: 'yellow', minute: 10 },
          { team_id: HOME, player_id: 'p-home-1', card_type: 'yellow', minute: 40 },
        ],
      })
    );
    expect(result.error?.message).toContain('FULL_REPORT_DUPLICATE_CARD');
    expect(db.tournament_match_cards || []).toHaveLength(0);
  });

  it('20b. negative card minute is rejected', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);
    const result = rpc('publish_full_match_report', baseArgs({ p_cards: [{ team_id: HOME, player_id: 'p-home-1', card_type: 'yellow', minute: -1 }] }));
    expect(result.error?.message).toContain('FULL_REPORT_CARD_MINUTE_INVALID');
  });
});

describe('Migration 014 RPC contract — failed validation rolls back everything', () => {
  it('21. a rejected call leaves the match, submissions, goals, cards, and audit log completely untouched', () => {
    const db = baseDb();
    const rpc = createMockPublishRpc(db);
    const before = JSON.stringify(db);

    const result = rpc(
      'publish_full_match_report',
      baseArgs({
        p_goals: [{ team_id: HOME, player_id: null, minute: 1, goals: 1 }],
        // A valid goal followed by an invalid card — the invalid card must
        // cause the ENTIRE call to fail, including the otherwise-valid goal.
        p_cards: [{ team_id: HOME, player_id: 'p-deleted', card_type: 'yellow', minute: 1 }],
      })
    );

    expect(result.error?.message).toContain('FULL_REPORT_CARD_PLAYER_DELETED');
    expect(JSON.stringify(db)).toBe(before);
    expect((db.tournament_matches[0] as Row).result_workflow_status).toBe('not_started');
    expect(db.tournament_result_submissions).toHaveLength(0);
  });
});

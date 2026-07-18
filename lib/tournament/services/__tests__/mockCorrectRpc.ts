// Faithful JS re-implementation of Migration 018's SQL contract
// (scripts/tournament-v2/018-score-only-result-correction.sql), used as the
// mock `.rpc('correct_published_match_result', ...)` handler across the
// Result Correction test suite. This lets us prove the APPLICATION LAYER's
// contract with the RPC and exercise the SAME validation rules the SQL
// function implements — it does NOT prove the real SQL executes correctly
// against a live Postgres instance, since Migration 018 has not been applied
// anywhere yet. Keep this file's logic in sync with the migration's ordering
// and rules by hand; there is no automated cross-check between the two.

export type Row = Record<string, unknown>;
export type Db = Record<string, Row[]>;

interface RpcResult {
  data: Row | null;
  error: { message: string } | null;
}

function err(message: string): RpcResult {
  return { data: null, error: { message } };
}

function buildNewPayload(args: Record<string, unknown>): Row {
  return {
    matchId: args.p_match_id,
    tournamentId: args.p_tournament_id,
    correctionReason: args.p_correction_reason,
    regulationHomeScore: args.p_regulation_home_score,
    regulationAwayScore: args.p_regulation_away_score,
    penaltyHomeScore: args.p_penalty_home_score,
    penaltyAwayScore: args.p_penalty_away_score,
    decidedBy: args.p_decided_by,
    winnerTeamId: args.p_winner_team_id,
    resultType: args.p_result_type,
  };
}

function buildBeforePayload(match: Row): Row {
  return {
    matchId: match.id,
    tournamentId: match.tournament_id,
    regulationHomeScore: match.regulation_home_score,
    regulationAwayScore: match.regulation_away_score,
    penaltyHomeScore: match.penalty_home_score,
    penaltyAwayScore: match.penalty_away_score,
    decidedBy: match.decided_by,
    winnerTeamId: match.winner_team_id,
    resultType: match.result_type,
  };
}

/** Creates a `.rpc()` handler bound to the given in-memory `db`. Mutates
 * `db.tournament_matches`/`tournament_result_submissions`/
 * `tournament_result_versions`/`tournament_result_approvals`/
 * `tournament_audit_logs` on a successful correction, exactly as Migration
 * 018 would inside its single transaction — nothing is written on any
 * rejected call, mirroring an all-or-nothing rollback. Never touches
 * `tournament_match_goals`/`tournament_match_cards`/`tournament_match_reports`
 * — there is no code path here capable of writing them, mirroring the real
 * migration's parameter list. */
export function createMockCorrectRpc(db: Db) {
  return function correctPublishedMatchResultRpc(name: string, args: Record<string, unknown>): RpcResult {
    if (name !== 'correct_published_match_result') return err('unexpected rpc');

    const match = (db.tournament_matches || []).find((m) => m.id === args.p_match_id);
    if (!match) return err('RESULT_CORRECTION_MATCH_NOT_FOUND: match not found');

    // Idempotency — checked immediately after the (simulated) row lock,
    // before any eligibility/validation check, per Migration 018.
    const newPayload = buildNewPayload(args);
    const existing = (db.tournament_result_submissions || []).find(
      (s) => s.match_id === args.p_match_id && s.stage === 'correction' && s.idempotency_key === args.p_idempotency_key
    );
    if (existing) {
      if (JSON.stringify(existing.payload) !== JSON.stringify(newPayload)) {
        return err('RESULT_CORRECTION_IDEMPOTENCY_PAYLOAD_MISMATCH: idempotency_key already used with a different payload');
      }
      return {
        data: {
          submission_id: existing.id,
          match_id: args.p_match_id,
          new_match_version: match.version,
          corrected_at: existing.submitted_at,
          idempotent: true,
        },
        error: null,
      };
    }

    // Eligibility.
    if (match.deleted_at) return err('RESULT_CORRECTION_MATCH_DELETED: match has been deleted');
    if (match.tournament_id !== args.p_tournament_id) return err('RESULT_CORRECTION_TOURNAMENT_MISMATCH: match does not belong to the specified tournament');
    if (!match.home_team_id || !match.away_team_id) return err('RESULT_CORRECTION_TEAM_UNRESOLVED: home or away team is not yet resolved');
    if (match.schedule_status !== 'published') return err('RESULT_CORRECTION_SCHEDULE_NOT_PUBLISHED: schedule is not in an eligible published state');
    if (match.result_workflow_status !== 'published') {
      return err('RESULT_CORRECTION_NOT_PUBLISHED: match does not yet have a published official result to correct');
    }
    if (match.version !== args.p_expected_version) return err('RESULT_CORRECTION_VERSION_CONFLICT: match has changed since Preview');

    const reason = (args.p_correction_reason as string | null) || '';
    if (!reason.trim()) return err('RESULT_CORRECTION_REASON_REQUIRED: correction_reason is required');

    // D-09 result-consistency.
    const regHome = args.p_regulation_home_score as number;
    const regAway = args.p_regulation_away_score as number;
    const penHome = args.p_penalty_home_score as number | null;
    const penAway = args.p_penalty_away_score as number | null;
    const decidedBy = args.p_decided_by as string;
    const winnerTeamId = args.p_winner_team_id as string;
    const resultType = args.p_result_type as string;

    if (!winnerTeamId || (winnerTeamId !== match.home_team_id && winnerTeamId !== match.away_team_id)) {
      return err('RESULT_CORRECTION_WINNER_TEAM_INVALID: winner_team_id must be the home or away team');
    }
    if (regHome == null || regAway == null || regHome < 0 || regAway < 0) {
      return err('RESULT_CORRECTION_SCORE_INVALID: regulation scores must be non-negative integers');
    }

    if (regHome !== regAway) {
      if (decidedBy !== 'regulation' || penHome != null || penAway != null) {
        return err('RESULT_CORRECTION_RESULT_INCONSISTENT: a regulation-decided match must not carry penalty fields');
      }
      if (resultType !== 'normal') {
        return err('RESULT_CORRECTION_RESULT_TYPE_INCONSISTENT: a regulation-decided match must have result_type=normal');
      }
      const expectedWinner = regHome > regAway ? match.home_team_id : match.away_team_id;
      if (winnerTeamId !== expectedWinner) {
        return err('RESULT_CORRECTION_RESULT_INCONSISTENT: winner_team_id does not match the higher regulation score');
      }
    } else {
      if (decidedBy !== 'penalty' || penHome == null || penAway == null) {
        return err('RESULT_CORRECTION_RESULT_INCONSISTENT: a tied-regulation match requires a valid penalty decision');
      }
      if (penHome < 0 || penAway < 0) {
        return err('RESULT_CORRECTION_SCORE_INVALID: penalty scores must be non-negative integers');
      }
      if (penHome === penAway) {
        return err('RESULT_CORRECTION_RESULT_INCONSISTENT: penalty shootout scores must not be tied');
      }
      if (resultType !== 'penalty_decided') {
        return err('RESULT_CORRECTION_RESULT_TYPE_INCONSISTENT: a penalty-decided match must have result_type=penalty_decided');
      }
      const expectedWinner = penHome > penAway ? match.home_team_id : match.away_team_id;
      if (winnerTeamId !== expectedWinner) {
        return err('RESULT_CORRECTION_RESULT_INCONSISTENT: winner_team_id does not match the penalty shootout winner');
      }
    }

    // No-change guard, compared against the locked row's own columns.
    const noChange =
      match.regulation_home_score === regHome &&
      match.regulation_away_score === regAway &&
      (match.penalty_home_score ?? null) === (penHome ?? null) &&
      (match.penalty_away_score ?? null) === (penAway ?? null) &&
      match.decided_by === decidedBy &&
      match.winner_team_id === winnerTeamId &&
      match.result_type === resultType;
    if (noChange) {
      return err('RESULT_CORRECTION_NO_CHANGES: corrected result is identical to the current official result');
    }

    // All validation passed — commit the "transaction" (mutate the mock db).
    const beforePayload = buildBeforePayload(match);
    const submissionId = `corr-${Math.random().toString(36).slice(2)}`;
    const now = '2026-07-20T13:00:00.000Z';

    db.tournament_result_submissions = db.tournament_result_submissions || [];
    db.tournament_result_submissions.push({
      id: submissionId,
      match_id: args.p_match_id,
      stage: 'correction',
      payload: newPayload,
      status: 'corrected',
      version: 1,
      idempotency_key: args.p_idempotency_key,
      submitted_at: now,
    });

    db.tournament_result_versions = db.tournament_result_versions || [];
    db.tournament_result_versions.push({ submission_id: submissionId, version: 1, payload: newPayload, change_reason: reason });

    db.tournament_result_approvals = db.tournament_result_approvals || [];
    db.tournament_result_approvals.push({ submission_id: submissionId, action: 'corrected', actor_id: args.p_actor_user_id, note: reason });

    match.version = (match.version as number) + 1;
    match.regulation_home_score = regHome;
    match.regulation_away_score = regAway;
    match.penalty_home_score = penHome;
    match.penalty_away_score = penAway;
    match.decided_by = decidedBy;
    match.winner_team_id = winnerTeamId;
    match.result_type = resultType;
    // result_workflow_status/status are deliberately left untouched — the
    // match was already 'published'/'finished' and stays that way.

    db.tournament_audit_logs = db.tournament_audit_logs || [];
    db.tournament_audit_logs.push({
      tournament_id: args.p_tournament_id,
      admin_id: args.p_actor_user_id,
      action: 'tournament.result_correction.publish',
      entity_type: 'tournament_match',
      entity_id: args.p_match_id,
      old_data: { ...beforePayload, correctionReason: reason },
      new_data: newPayload,
    });

    return {
      data: { submission_id: submissionId, match_id: args.p_match_id, new_match_version: match.version, corrected_at: now, idempotent: false },
      error: null,
    };
  };
}

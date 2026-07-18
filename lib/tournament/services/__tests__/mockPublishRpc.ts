// Faithful JS re-implementation of Migration 014's SQL contract
// (scripts/tournament-v2/014-full-result-publish-transaction.sql), used as
// the mock `.rpc('publish_full_match_report', ...)` handler across the Full
// Match Report test suite. This lets us prove the APPLICATION LAYER's
// contract with the RPC (what it sends, how it reacts to each response) and
// exercise the SAME validation rules the SQL function implements — it does
// NOT prove the real SQL executes correctly against a live Postgres
// instance, since Migration 014 has not been applied anywhere. Keep this
// file's logic in sync with the migration's ordering and rules by hand;
// there is no automated cross-check between the two.

export type Row = Record<string, unknown>;
export type Db = Record<string, Row[]>;

interface RpcResult {
  data: Row | null;
  error: { message: string } | null;
}

function err(message: string): RpcResult {
  return { data: null, error: { message } };
}

function buildCanonicalPayload(args: Record<string, unknown>): Row {
  return {
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
}

/** Creates a `.rpc()` handler bound to the given in-memory `db`. Mutates
 * `db.tournament_matches`/`tournament_result_submissions`/
 * `tournament_match_goals`/`tournament_match_cards`/`tournament_match_reports`/
 * `tournament_audit_logs` on a successful publish, exactly as Migration 014
 * would inside its single transaction — nothing is written on any rejected
 * call, mirroring an all-or-nothing rollback. */
export function createMockPublishRpc(db: Db) {
  return function publishFullMatchReportRpc(name: string, args: Record<string, unknown>): RpcResult {
    if (name !== 'publish_full_match_report') return err('unexpected rpc');

    const match = (db.tournament_matches || []).find((m) => m.id === args.p_match_id);
    if (!match) return err('FULL_REPORT_MATCH_NOT_FOUND: match not found');

    // Idempotency — checked immediately after the (simulated) row lock,
    // before any eligibility/validation check, per Migration 014.
    const canonicalPayload = buildCanonicalPayload(args);
    const existing = (db.tournament_result_submissions || []).find(
      (s) => s.match_id === args.p_match_id && s.stage === 'full_report' && s.idempotency_key === args.p_idempotency_key
    );
    if (existing) {
      if (JSON.stringify(existing.payload) !== JSON.stringify(canonicalPayload)) {
        return err('FULL_REPORT_IDEMPOTENCY_PAYLOAD_MISMATCH: idempotency_key already used with a different payload');
      }
      return {
        data: {
          submission_id: existing.id,
          match_id: args.p_match_id,
          new_match_version: match.version,
          published_at: existing.submitted_at,
          idempotent: true,
        },
        error: null,
      };
    }

    // Eligibility.
    if (match.deleted_at) return err('FULL_REPORT_MATCH_DELETED: match has been deleted');
    if (match.tournament_id !== args.p_tournament_id) return err('FULL_REPORT_TOURNAMENT_MISMATCH: match does not belong to the specified tournament');
    if (['cancelled', 'abandoned', 'void', 'bye'].includes(String(match.status))) {
      return err('FULL_REPORT_MATCH_STATUS_INELIGIBLE: match status is not eligible for official publication');
    }
    if (!match.home_team_id || !match.away_team_id) return err('FULL_REPORT_TEAM_UNRESOLVED: home or away team is not yet resolved');
    if (match.schedule_status !== 'published') return err('FULL_REPORT_SCHEDULE_NOT_PUBLISHED: schedule is not in an eligible published state');
    if (match.result_workflow_status === 'published') {
      return err('FULL_REPORT_ALREADY_PUBLISHED_USE_CORRECTION: this match already has a published official result');
    }
    if (match.version !== args.p_expected_version) return err('FULL_REPORT_VERSION_CONFLICT: match has changed since Preview');

    // D-09 result-consistency + result_type consistency.
    const regHome = args.p_regulation_home_score as number;
    const regAway = args.p_regulation_away_score as number;
    const penHome = args.p_penalty_home_score as number | null;
    const penAway = args.p_penalty_away_score as number | null;
    const decidedBy = args.p_decided_by as string;
    const winnerTeamId = args.p_winner_team_id as string;
    const resultType = args.p_result_type as string;

    if (!winnerTeamId || (winnerTeamId !== match.home_team_id && winnerTeamId !== match.away_team_id)) {
      return err('FULL_REPORT_WINNER_TEAM_INVALID: winner_team_id must be the home or away team');
    }
    if (regHome == null || regAway == null || regHome < 0 || regAway < 0) {
      return err('FULL_REPORT_SCORE_INVALID: regulation scores must be non-negative integers');
    }

    if (regHome !== regAway) {
      if (decidedBy !== 'regulation' || penHome != null || penAway != null) {
        return err('FULL_REPORT_RESULT_INCONSISTENT: a regulation-decided match must not carry penalty fields');
      }
      if (resultType !== 'normal') {
        return err('FULL_REPORT_RESULT_TYPE_INCONSISTENT: a regulation-decided match must have result_type=normal');
      }
      const expectedWinner = regHome > regAway ? match.home_team_id : match.away_team_id;
      if (winnerTeamId !== expectedWinner) {
        return err('FULL_REPORT_RESULT_INCONSISTENT: winner_team_id does not match the higher regulation score');
      }
    } else {
      if (decidedBy !== 'penalty' || penHome == null || penAway == null) {
        return err('FULL_REPORT_RESULT_INCONSISTENT: a tied-regulation match requires a valid penalty decision');
      }
      if (penHome < 0 || penAway < 0) {
        return err('FULL_REPORT_SCORE_INVALID: penalty scores must be non-negative integers');
      }
      if (penHome === penAway) {
        return err('FULL_REPORT_RESULT_INCONSISTENT: penalty shootout scores must not be tied');
      }
      if (resultType !== 'penalty_decided') {
        return err('FULL_REPORT_RESULT_TYPE_INCONSISTENT: a penalty-decided match must have result_type=penalty_decided');
      }
      const expectedWinner = penHome > penAway ? match.home_team_id : match.away_team_id;
      if (winnerTeamId !== expectedWinner) {
        return err('FULL_REPORT_RESULT_INCONSISTENT: winner_team_id does not match the penalty shootout winner');
      }
    }

    // Goal scope validation.
    const players = db.tournament_players || [];
    const goalRows: Row[] = [];
    for (const goal of (args.p_goals as Row[]) || []) {
      const teamId = goal.team_id as string;
      const playerId = (goal.player_id as string) || null;
      const isOwnGoal = !!goal.is_own_goal;
      const minute = goal.minute === '' || goal.minute == null ? null : Number(goal.minute);
      const goalsCount = goal.goals == null || goal.goals === '' ? 1 : Number(goal.goals);

      if (!teamId || (teamId !== match.home_team_id && teamId !== match.away_team_id)) {
        return err('FULL_REPORT_GOAL_TEAM_INVALID: goal team must be the home or away team of this match');
      }
      if (!Number.isInteger(goalsCount) || goalsCount < 1) {
        return err('FULL_REPORT_GOAL_COUNT_INVALID: goal count must be a positive integer');
      }
      if (minute != null && (!Number.isInteger(minute) || minute < 0)) {
        return err('FULL_REPORT_GOAL_MINUTE_INVALID: goal minute must be non-negative');
      }
      if (playerId) {
        const player = players.find((p) => p.id === playerId);
        if (!player) return err('FULL_REPORT_GOAL_PLAYER_NOT_FOUND: goal player not found');
        if (player.deleted_at) return err('FULL_REPORT_GOAL_PLAYER_DELETED: goal player has been deleted');
        if (player.tournament_id !== args.p_tournament_id) return err('FULL_REPORT_GOAL_PLAYER_TOURNAMENT_MISMATCH: goal player does not belong to this tournament');
        if (player.category_id !== match.category_id) return err('FULL_REPORT_GOAL_PLAYER_CATEGORY_MISMATCH: goal player does not belong to this category');
        if (!isOwnGoal && player.team_id !== teamId) return err('FULL_REPORT_GOAL_PLAYER_TEAM_MISMATCH: goal player does not belong to the selected team');
      }
      goalRows.push({ match_id: args.p_match_id, player_id: playerId, team_id: teamId, minute, is_own_goal: isOwnGoal, goals: goalsCount, note: goal.note || null });
    }

    // Card scope validation.
    const cardRows: Row[] = [];
    const seenCardKeys = new Set<string>();
    for (const card of (args.p_cards as Row[]) || []) {
      const teamId = card.team_id as string;
      const playerId = card.player_id as string;
      const cardType = card.card_type as string;
      const minute = card.minute === '' || card.minute == null ? null : Number(card.minute);

      if (!teamId || (teamId !== match.home_team_id && teamId !== match.away_team_id)) {
        return err('FULL_REPORT_CARD_TEAM_INVALID: card team must be the home or away team of this match');
      }
      if (!playerId) return err('FULL_REPORT_CARD_PLAYER_REQUIRED: card player is required');
      if (!['yellow', 'second_yellow', 'red'].includes(cardType)) {
        return err('FULL_REPORT_CARD_TYPE_INVALID: card_type must be yellow, second_yellow, or red');
      }
      if (minute != null && (!Number.isInteger(minute) || minute < 0)) {
        return err('FULL_REPORT_CARD_MINUTE_INVALID: card minute must be non-negative');
      }
      const player = players.find((p) => p.id === playerId);
      if (!player) return err('FULL_REPORT_CARD_PLAYER_NOT_FOUND: card player not found');
      if (player.deleted_at) return err('FULL_REPORT_CARD_PLAYER_DELETED: card player has been deleted');
      if (player.tournament_id !== args.p_tournament_id) return err('FULL_REPORT_CARD_PLAYER_TOURNAMENT_MISMATCH: card player does not belong to this tournament');
      if (player.category_id !== match.category_id) return err('FULL_REPORT_CARD_PLAYER_CATEGORY_MISMATCH: card player does not belong to this category');
      if (player.team_id !== teamId) return err('FULL_REPORT_CARD_PLAYER_TEAM_MISMATCH: card player does not belong to the selected team');

      const dupKey = `${playerId}|${cardType}`;
      if (seenCardKeys.has(dupKey)) return err('FULL_REPORT_DUPLICATE_CARD: duplicate card for the same player and card_type');
      seenCardKeys.add(dupKey);

      cardRows.push({ match_id: args.p_match_id, player_id: playerId, team_id: teamId, card_type: cardType, minute, note: card.note || null });
    }

    // All validation passed — commit the "transaction" (mutate the mock db).
    const submissionId = `sub-${Math.random().toString(36).slice(2)}`;
    const now = '2026-07-20T12:00:00.000Z';

    db.tournament_result_submissions = db.tournament_result_submissions || [];
    db.tournament_result_submissions.push({
      id: submissionId,
      match_id: args.p_match_id,
      stage: 'full_report',
      payload: canonicalPayload,
      idempotency_key: args.p_idempotency_key,
      submitted_at: now,
    });

    db.tournament_result_versions = db.tournament_result_versions || [];
    db.tournament_result_versions.push({ submission_id: submissionId, version: 1, payload: canonicalPayload });

    db.tournament_match_goals = db.tournament_match_goals || [];
    db.tournament_match_goals.push(...goalRows);

    db.tournament_match_cards = db.tournament_match_cards || [];
    db.tournament_match_cards.push(...cardRows);

    if (args.p_report_text && String(args.p_report_text).trim()) {
      db.tournament_match_reports = db.tournament_match_reports || [];
      db.tournament_match_reports.push({ match_id: args.p_match_id, report: args.p_report_text, submitted_at: now });
    }

    match.version = (match.version as number) + 1;
    match.status = 'finished';
    match.result_workflow_status = 'published';
    match.regulation_home_score = regHome;
    match.regulation_away_score = regAway;
    match.penalty_home_score = penHome;
    match.penalty_away_score = penAway;
    match.decided_by = decidedBy;
    match.winner_team_id = winnerTeamId;
    match.result_type = resultType;

    db.tournament_audit_logs = db.tournament_audit_logs || [];
    db.tournament_audit_logs.push({
      tournament_id: args.p_tournament_id,
      admin_id: args.p_actor_user_id,
      action: 'tournament.full_match_report.publish',
      entity_type: 'tournament_match',
      entity_id: args.p_match_id,
      new_data: canonicalPayload,
    });

    return {
      data: { submission_id: submissionId, match_id: args.p_match_id, new_match_version: match.version, published_at: now, idempotent: false },
      error: null,
    };
  };
}

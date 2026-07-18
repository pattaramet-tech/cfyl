-- Tournament V2 — Migration 018: Atomic Score-Only Published Result Correction
-- Source of truth: TOURNAMENT_V2_DECISION_CHECKLIST.md D-09 (result rules), D-16
-- (single-step workflow; tournament_result_approvals is explicitly documented in
-- 010-result-workflow.sql as "Correction-only"). Reuses existing tables only — no
-- new table is created by this migration, per the smallest-additive-adjustment
-- instruction for this PR.
--
-- STATUS: DRAFT. Reviewed statically only. NOT applied to any environment
-- (Staging or Production) yet. See scripts/tournament-v2/README.md for the
-- required run order and the Staging-first policy. Migration 018 must be
-- manually applied to CFYL-Tournament-Staging by the owner before
-- scripts/tournament-v2/verify-result-correction-runtime.ts may be run —
-- this PR does not run that verifier.
--
-- SCOPE: score-only correction of an ALREADY-PUBLISHED official Full Match Report
-- result (Migration 014). Never touches goals, cards, report text, or Quick
-- Result — this RPC has no parameters and no code path capable of writing any of
-- those tables. tournament_super_admin only (never the Dedicated Shared
-- Result-entry Account). No correction-request queue or second approver — single
-- atomic step: Preview (app layer, zero writes) -> Publish (this RPC, one
-- transaction).
--
-- WHY A CHECK CONSTRAINT CHANGE IS NEEDED: tournament_result_submissions.stage
-- only allowed ('quick_result','full_report') as of Migration 010. A correction
-- must be recorded as its OWN new submission row (never overwriting or deleting
-- the original 'full_report' submission/version — see "no update/delete of prior
-- history" below), so a third stage value is required. This is the smallest
-- additive adjustment: no other column, table, or existing row is touched.
-- tournament_result_submissions.status already allows 'corrected' (added by
-- Migration 010, never previously used) with no change needed.
--
-- Idempotent — safe to re-run after a partial failure (uses `create or replace
-- function`, `drop constraint if exists` + `add constraint`, and unconditional
-- revoke/grant statements).

-- ============================================================================
-- 18.1 Widen tournament_result_submissions.stage to allow 'correction'
-- ============================================================================
alter table tournament.tournament_result_submissions
  drop constraint if exists tournament_result_submissions_stage_check;

alter table tournament.tournament_result_submissions
  add constraint tournament_result_submissions_stage_check
  check (stage in ('quick_result', 'full_report', 'correction'));

-- ============================================================================
-- 18.2 tournament.correct_published_match_result — atomic score-only correction RPC
-- ============================================================================
create or replace function tournament.correct_published_match_result(
  p_match_id uuid,
  p_tournament_id uuid,
  p_expected_version int,
  p_actor_user_id uuid,
  p_actor_email text,
  p_idempotency_key text,
  p_correction_reason text,
  p_regulation_home_score int,
  p_regulation_away_score int,
  p_penalty_home_score int,
  p_penalty_away_score int,
  p_decided_by text,
  p_winner_team_id uuid,
  p_result_type text
  -- NOTE: deliberately no goals/cards/report_text/old_data/new_data/canonical
  -- payload parameters. This function cannot write tournament_match_goals,
  -- tournament_match_cards, tournament_match_reports, or any Quick Result row —
  -- there is no SQL statement anywhere in this function body that references
  -- those tables. It builds its own canonical before/after payloads from the
  -- locked Match row and the validated scalar parameters above — never trusting
  -- a caller-supplied JSON blob as authoritative, the same rule Migration 014
  -- established.
)
returns jsonb
language plpgsql
-- SECURITY DEFINER + explicit search_path, same rationale as Migration 014: the
-- safe, explicit search_path is the real reason for SECURITY DEFINER here, not
-- privilege escalation — see the REVOKE/GRANT block below, which is what
-- actually restricts who may call this function.
security definer
set search_path = tournament, pg_temp
as $$
declare
  v_match tournament.tournament_matches%rowtype;
  v_existing_submission tournament.tournament_result_submissions%rowtype;
  v_submission_id uuid;
  v_new_version int;
  v_now timestamptz := now();
  v_expected_winner uuid;
  v_before_payload jsonb;
  v_new_payload jsonb;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'RESULT_CORRECTION_IDEMPOTENCY_KEY_REQUIRED: idempotency_key is required'
      using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------------
  -- Step 1: lock the Match row BEFORE anything else — idempotency decision,
  -- published-state validation, version comparison, and corrected-result
  -- validation must all happen after this lock is held, exactly mirroring
  -- Migration 014's ordering rationale (a same-key retry must observe the
  -- first call's own committed submission row once it acquires the lock,
  -- never a stale pre-lock read).
  -- ------------------------------------------------------------------------
  select * into v_match
    from tournament.tournament_matches
    where id = p_match_id
    for update;

  if not found then
    raise exception 'RESULT_CORRECTION_MATCH_NOT_FOUND: match not found' using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------------
  -- Step 2: idempotency, checked AFTER the lock. The canonical "new" payload
  -- compared here is built from the raw, as-received parameters, deliberately
  -- BEFORE eligibility/no-change/result-consistency validation below, so a
  -- genuine idempotent retry (same key, same payload) returns the stored
  -- success without re-running validation a retry doesn't need. A different
  -- payload under the same key is rejected outright.
  -- ------------------------------------------------------------------------
  v_new_payload := jsonb_build_object(
    'matchId', p_match_id,
    'tournamentId', p_tournament_id,
    'correctionReason', p_correction_reason,
    'regulationHomeScore', p_regulation_home_score,
    'regulationAwayScore', p_regulation_away_score,
    'penaltyHomeScore', p_penalty_home_score,
    'penaltyAwayScore', p_penalty_away_score,
    'decidedBy', p_decided_by,
    'winnerTeamId', p_winner_team_id,
    'resultType', p_result_type
  );

  select * into v_existing_submission
    from tournament.tournament_result_submissions
    where match_id = p_match_id and stage = 'correction' and idempotency_key = p_idempotency_key;

  if found then
    if v_existing_submission.payload is distinct from v_new_payload then
      raise exception 'RESULT_CORRECTION_IDEMPOTENCY_PAYLOAD_MISMATCH: idempotency_key already used with a different payload'
        using errcode = 'P0001';
    end if;

    -- Identical key + identical payload: return the stored successful
    -- result. No new submission/version/approval row, Match update, or
    -- Audit Log entry — this IS the original correction being retried.
    return jsonb_build_object(
      'submission_id', v_existing_submission.id,
      'match_id', p_match_id,
      'new_match_version', v_match.version,
      'corrected_at', v_existing_submission.submitted_at,
      'idempotent', true
    );
  end if;

  -- ------------------------------------------------------------------------
  -- No existing submission for this idempotency key — genuinely new
  -- correction attempt. Continue eligibility/version/result validation.
  -- ------------------------------------------------------------------------

  if v_match.deleted_at is not null then
    raise exception 'RESULT_CORRECTION_MATCH_DELETED: match has been deleted' using errcode = 'P0001';
  end if;
  if v_match.tournament_id <> p_tournament_id then
    raise exception 'RESULT_CORRECTION_TOURNAMENT_MISMATCH: match does not belong to the specified tournament'
      using errcode = 'P0001';
  end if;
  if v_match.home_team_id is null or v_match.away_team_id is null then
    raise exception 'RESULT_CORRECTION_TEAM_UNRESOLVED: home or away team is not yet resolved' using errcode = 'P0001';
  end if;
  if v_match.schedule_status <> 'published' then
    raise exception 'RESULT_CORRECTION_SCHEDULE_NOT_PUBLISHED: schedule is not in an eligible published state'
      using errcode = 'P0001';
  end if;

  -- Correction requires an EXISTING published result — the inverse of
  -- Migration 014's own "already published" guard.
  if v_match.result_workflow_status <> 'published' then
    raise exception 'RESULT_CORRECTION_NOT_PUBLISHED: match does not yet have a published official result to correct'
      using errcode = 'P0001';
  end if;

  if v_match.version <> p_expected_version then
    raise exception 'RESULT_CORRECTION_VERSION_CONFLICT: match has changed since Preview' using errcode = 'P0001';
  end if;

  if p_correction_reason is null or length(trim(p_correction_reason)) = 0 then
    raise exception 'RESULT_CORRECTION_REASON_REQUIRED: correction_reason is required' using errcode = 'P0001';
  end if;

  -- --------------------------------------------------------------------
  -- D-09 result-consistency validation — identical rules to Migration 014,
  -- re-checked here as defense-in-depth (the app layer already validated
  -- this before Preview and before calling this RPC).
  -- --------------------------------------------------------------------
  if p_winner_team_id is null or p_winner_team_id not in (v_match.home_team_id, v_match.away_team_id) then
    raise exception 'RESULT_CORRECTION_WINNER_TEAM_INVALID: winner_team_id must be the home or away team'
      using errcode = 'P0001';
  end if;
  if p_regulation_home_score is null or p_regulation_away_score is null
     or p_regulation_home_score < 0 or p_regulation_away_score < 0 then
    raise exception 'RESULT_CORRECTION_SCORE_INVALID: regulation scores must be non-negative integers'
      using errcode = 'P0001';
  end if;

  if p_regulation_home_score <> p_regulation_away_score then
    -- Regulation-decided.
    if p_decided_by <> 'regulation' or p_penalty_home_score is not null or p_penalty_away_score is not null then
      raise exception 'RESULT_CORRECTION_RESULT_INCONSISTENT: a regulation-decided match must not carry penalty fields'
        using errcode = 'P0001';
    end if;
    if p_result_type <> 'normal' then
      raise exception 'RESULT_CORRECTION_RESULT_TYPE_INCONSISTENT: a regulation-decided match must have result_type=normal'
        using errcode = 'P0001';
    end if;
    v_expected_winner := case when p_regulation_home_score > p_regulation_away_score
      then v_match.home_team_id else v_match.away_team_id end;
    if p_winner_team_id <> v_expected_winner then
      raise exception 'RESULT_CORRECTION_RESULT_INCONSISTENT: winner_team_id does not match the higher regulation score'
        using errcode = 'P0001';
    end if;
  else
    -- Penalty-decided.
    if p_decided_by <> 'penalty' or p_penalty_home_score is null or p_penalty_away_score is null then
      raise exception 'RESULT_CORRECTION_RESULT_INCONSISTENT: a tied-regulation match requires a valid penalty decision'
        using errcode = 'P0001';
    end if;
    if p_penalty_home_score < 0 or p_penalty_away_score < 0 then
      raise exception 'RESULT_CORRECTION_SCORE_INVALID: penalty scores must be non-negative integers'
        using errcode = 'P0001';
    end if;
    if p_penalty_home_score = p_penalty_away_score then
      raise exception 'RESULT_CORRECTION_RESULT_INCONSISTENT: penalty shootout scores must not be tied'
        using errcode = 'P0001';
    end if;
    if p_result_type <> 'penalty_decided' then
      raise exception 'RESULT_CORRECTION_RESULT_TYPE_INCONSISTENT: a penalty-decided match must have result_type=penalty_decided'
        using errcode = 'P0001';
    end if;
    v_expected_winner := case when p_penalty_home_score > p_penalty_away_score
      then v_match.home_team_id else v_match.away_team_id end;
    if p_winner_team_id <> v_expected_winner then
      raise exception 'RESULT_CORRECTION_RESULT_INCONSISTENT: winner_team_id does not match the penalty shootout winner'
        using errcode = 'P0001';
    end if;
  end if;

  -- --------------------------------------------------------------------
  -- No-change guard: a "correction" that is byte-identical to the current
  -- official result is not a correction. Compared directly against the
  -- LOCKED row's own columns (never a caller-supplied "previous result"
  -- blob), so this cannot be spoofed by a stale or fabricated prior-state
  -- claim.
  -- --------------------------------------------------------------------
  if v_match.regulation_home_score = p_regulation_home_score
     and v_match.regulation_away_score = p_regulation_away_score
     and v_match.penalty_home_score is not distinct from p_penalty_home_score
     and v_match.penalty_away_score is not distinct from p_penalty_away_score
     and v_match.decided_by = p_decided_by
     and v_match.winner_team_id = p_winner_team_id
     and v_match.result_type = p_result_type
  then
    raise exception 'RESULT_CORRECTION_NO_CHANGES: corrected result is identical to the current official result'
      using errcode = 'P0001';
  end if;

  -- Canonical "before" payload, built from the locked row's own columns —
  -- never from a caller-supplied argument — for the Audit Log only.
  v_before_payload := jsonb_build_object(
    'matchId', v_match.id,
    'tournamentId', v_match.tournament_id,
    'regulationHomeScore', v_match.regulation_home_score,
    'regulationAwayScore', v_match.regulation_away_score,
    'penaltyHomeScore', v_match.penalty_home_score,
    'penaltyAwayScore', v_match.penalty_away_score,
    'decidedBy', v_match.decided_by,
    'winnerTeamId', v_match.winner_team_id,
    'resultType', v_match.result_type
  );

  -- Correction submission — a NEW row, stage='correction'. The original
  -- stage='full_report' submission/version rows from Migration 014 are never
  -- updated or deleted by this function.
  insert into tournament.tournament_result_submissions
    (match_id, stage, payload, status, version, idempotency_key, submitted_by, submitted_at)
  values
    (p_match_id, 'correction', v_new_payload, 'corrected', 1, p_idempotency_key, p_actor_user_id, v_now)
  returning id into v_submission_id;

  insert into tournament.tournament_result_versions (submission_id, version, payload, changed_by, change_reason)
  values (v_submission_id, 1, v_new_payload, p_actor_user_id, p_correction_reason);

  -- tournament_result_approvals is documented (010-result-workflow.sql) as
  -- Correction-only — this is its first real use. One row per correction,
  -- recording the reason a second time in `note` for a workflow-shaped
  -- audit trail distinct from the general-purpose tournament_audit_logs row
  -- inserted below.
  insert into tournament.tournament_result_approvals (submission_id, action, actor_id, note)
  values (v_submission_id, 'corrected', p_actor_user_id, p_correction_reason);

  -- Official match fields — SCORE ONLY. This UPDATE never references
  -- result_workflow_status, status, goals, cards, or report text: the match
  -- was already 'finished'/'published' (required above) and stays that way.
  -- The row is already locked (FOR UPDATE), so this cannot race with another
  -- correction or a Full Report publish for the same match.
  update tournament.tournament_matches
  set regulation_home_score = p_regulation_home_score,
      regulation_away_score = p_regulation_away_score,
      penalty_home_score = p_penalty_home_score,
      penalty_away_score = p_penalty_away_score,
      decided_by = p_decided_by,
      winner_team_id = p_winner_team_id,
      result_type = p_result_type,
      version = version + 1,
      updated_by = p_actor_user_id,
      updated_at = v_now
  where id = p_match_id
  returning version into v_new_version;

  -- Audit log — exactly one row, in this same transaction, carrying the
  -- correction reason and both before/after canonical payloads.
  insert into tournament.tournament_audit_logs
    (tournament_id, admin_id, admin_email, action, entity_type, entity_id, entity_label, old_data, new_data)
  values (
    p_tournament_id,
    p_actor_user_id,
    p_actor_email,
    'tournament.result_correction.publish',
    'tournament_match',
    p_match_id,
    v_match.match_code,
    v_before_payload || jsonb_build_object('correctionReason', p_correction_reason),
    v_new_payload
  );

  -- Downstream resolution (Knockout Advancement, Suspension recalculation)
  -- is intentionally NOT performed here — neither system is implemented yet.
  -- Standings (PR #10) computes dynamically from tournament_matches, so it
  -- requires no direct write from this function.
  return jsonb_build_object(
    'submission_id', v_submission_id,
    'match_id', p_match_id,
    'new_match_version', v_new_version,
    'corrected_at', v_now,
    'idempotent', false,
    'downstream_resolution_pending', true
  );
end;
$$;

comment on function tournament.correct_published_match_result(
  uuid, uuid, int, uuid, text, text, text, int, int, int, int, text, uuid, text
) is
  'Atomic score-only correction of an already-published official Full Match '
  'Report result. tournament_super_admin only — see REVOKE/GRANT below. '
  'Locks the Match row before checking idempotency and validating eligibility, '
  'so a same-key retry correctly observes the prior committed correction '
  'rather than racing past a stale read. Rejects if the match does not yet '
  'have a published result (see Migration 014), if the corrected result is '
  'identical to the current official result, or if the D-09 consistency '
  'rules are violated. Never writes tournament_match_goals, '
  'tournament_match_cards, tournament_match_reports, or any Quick Result row '
  '— this function accepts no parameters describing any of those entities. '
  'All writes (correction submission, result version, approval record, '
  'official match fields, audit log) happen in this single function '
  'invocation — a failure at any step rolls back every prior step.';

-- ============================================================================
-- 18.3 RPC security — service_role only (never anon/authenticated directly)
-- ============================================================================
-- Same rationale as Migration 014: Supabase's service_role already bypasses
-- RLS, so this REVOKE/GRANT block is what actually restricts who may call
-- this function — anon and authenticated (including the Dedicated Shared
-- Result-entry Account's own Supabase Auth session, if it ever had one) must
-- never be able to invoke this function directly. tournament_super_admin-only
-- authorization is enforced in the application layer
-- (lib/tournament/services/auth.ts requireTournamentSuperAdmin), which is the
-- only caller of the server-side Tournament client permitted to reach this
-- RPC — see app/api/tournament/admin/matches/[matchId]/correction/route.ts.
revoke all on function tournament.correct_published_match_result(
  uuid, uuid, int, uuid, text, text, text, int, int, int, int, text, uuid, text
) from public;

revoke all on function tournament.correct_published_match_result(
  uuid, uuid, int, uuid, text, text, text, int, int, int, int, text, uuid, text
) from anon;

revoke all on function tournament.correct_published_match_result(
  uuid, uuid, int, uuid, text, text, text, int, int, int, int, text, uuid, text
) from authenticated;

grant execute on function tournament.correct_published_match_result(
  uuid, uuid, int, uuid, text, text, text, int, int, int, int, text, uuid, text
) to service_role;

-- This function performs no dynamic SQL and returns only the small jsonb
-- summary object above — it never returns full row contents, service-role
-- secrets, or any column not explicitly listed in the RETURNS jsonb
-- construction.

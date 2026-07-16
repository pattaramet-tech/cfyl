-- Tournament V2 — Migration 014: Atomic Official Full Match Report Publish
-- Source of truth: TOURNAMENT_V2_DECISION_CHECKLIST.md D-09 (result rules),
-- D-16 (single-step, mandatory Preview). Reuses existing tables only — no
-- new table is created by this migration.
--
-- STATUS: DRAFT. Reviewed statically only. NOT applied to any environment
-- (Staging or Production) as part of this PR. See scripts/tournament-v2/README.md
-- for the required run order and Staging-first policy.
--
-- WHY THIS EXISTS: PR #9 (Quick Result) and PR #10 (Standings Override) both
-- had to accept non-atomic, best-effort sequential writes with compensating
-- rollback, because no approved RPC/transaction mechanism existed yet for
-- Tournament V2. Official Full Match Report publication touches far more
-- rows (submission, result version, N goal rows, N card rows, report row,
-- the match row itself, and the audit log) — a best-effort rollback across
-- that many independent writes is not an acceptable safety margin for the
-- one-time, irreversible-without-Correction act of Publish. This migration
-- introduces the first real Postgres transaction boundary for Tournament V2:
-- every step below happens inside ONE PL/pgSQL function invocation, so a
-- failure at any step rolls back everything before it — there is no
-- intermediate state where the match is "half published".
--
-- Idempotent — safe to re-run after a partial failure (uses `create or
-- replace function`, and revoke/grant statements are unconditional).

-- ============================================================================
-- 14.1 tournament.publish_full_match_report — atomic publish RPC
-- ============================================================================
create or replace function tournament.publish_full_match_report(
  p_match_id uuid,
  p_tournament_id uuid,
  p_expected_version int,
  p_actor_user_id uuid,
  p_actor_email text,
  p_idempotency_key text,
  p_regulation_home_score int,
  p_regulation_away_score int,
  p_penalty_home_score int,
  p_penalty_away_score int,
  p_decided_by text,
  p_winner_team_id uuid,
  p_result_type text,
  p_goals jsonb,                 -- array of {team_id, player_id, minute, is_own_goal, goals, note}
  p_cards jsonb,                 -- array of {team_id, player_id, card_type, minute, note}
  p_report_text text,
  p_payload jsonb,               -- canonical Full Report payload — stored verbatim in
                                  -- tournament_result_submissions.payload and
                                  -- tournament_result_versions.payload; also the
                                  -- idempotency comparison value
  p_quick_result_comparison jsonb -- Quick Result vs Full Report comparison, audit-only,
                                  -- never written to any Match/result field
)
returns jsonb
language plpgsql
-- SECURITY DEFINER + an explicit search_path: this function must resolve
-- every unqualified identifier to `tournament` (never to a schema an
-- attacker could inject via a manipulated session search_path) and must run
-- with the privileges needed to write tournament_matches/tournament_match_*
-- /tournament_result_*/tournament_audit_logs regardless of which role
-- ultimately calls it — but see the REVOKE/GRANT block below: only
-- service_role is actually allowed to call it, which already bypasses RLS
-- in Supabase, so SECURITY DEFINER here is primarily about the safe
-- search_path guarantee, not privilege escalation for anon/authenticated.
security definer
set search_path = tournament, pg_temp
as $$
declare
  v_match tournament.tournament_matches%rowtype;
  v_existing_submission tournament.tournament_result_submissions%rowtype;
  v_submission_id uuid;
  v_new_version int;
  v_now timestamptz := now();
  v_goal jsonb;
  v_card jsonb;
  v_expected_winner uuid;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'FULL_REPORT_IDEMPOTENCY_KEY_REQUIRED: idempotency_key is required'
      using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------------
  -- Step 4 (of the 12 required atomic steps): idempotency, checked FIRST and
  -- authoritatively inside this transaction (the app layer's pre-check in
  -- lib/tournament/services/fullMatchReport.ts is a UX fast-path only — this
  -- is what actually prevents a duplicate publish under concurrency). A
  -- repeat call with the same (match_id, stage='full_report',
  -- idempotency_key) and an identical payload returns the already-stored
  -- result without ANY further writes — no new submission, result version,
  -- goal/card/report row, match version bump, or audit entry. A different
  -- payload under the same key is rejected outright.
  -- ------------------------------------------------------------------------
  select * into v_existing_submission
    from tournament.tournament_result_submissions
    where match_id = p_match_id and stage = 'full_report' and idempotency_key = p_idempotency_key;

  if found then
    if v_existing_submission.payload is distinct from p_payload then
      raise exception 'FULL_REPORT_IDEMPOTENCY_PAYLOAD_MISMATCH: idempotency_key already used with a different payload'
        using errcode = 'P0001';
    end if;

    select version into v_new_version from tournament.tournament_matches where id = p_match_id;

    return jsonb_build_object(
      'submission_id', v_existing_submission.id,
      'match_id', p_match_id,
      'new_match_version', v_new_version,
      'published_at', v_existing_submission.submitted_at,
      'idempotent', true
    );
  end if;

  -- ------------------------------------------------------------------------
  -- Step 1: lock (conditionally claim) the match row using expected version.
  -- `FOR UPDATE` takes a row lock for the rest of this transaction — a
  -- second concurrent publish_full_match_report() call for the SAME match
  -- blocks here until this transaction commits or rolls back, then
  -- re-evaluates against the now-committed state (idempotency check above,
  -- then the already-published check below). This is what guarantees "only
  -- one successful concurrent writer" without needing an application-level
  -- retry loop.
  -- ------------------------------------------------------------------------
  select * into v_match
    from tournament.tournament_matches
    where id = p_match_id
    for update;

  if not found then
    raise exception 'FULL_REPORT_MATCH_NOT_FOUND: match not found' using errcode = 'P0001';
  end if;

  -- Step 3 (part 1): eligibility.
  if v_match.deleted_at is not null then
    raise exception 'FULL_REPORT_MATCH_DELETED: match has been deleted' using errcode = 'P0001';
  end if;
  if v_match.tournament_id <> p_tournament_id then
    raise exception 'FULL_REPORT_TOURNAMENT_MISMATCH: match does not belong to the specified tournament'
      using errcode = 'P0001';
  end if;
  if v_match.status in ('cancelled', 'abandoned', 'void', 'bye') then
    raise exception 'FULL_REPORT_MATCH_STATUS_INELIGIBLE: match status is not eligible for official publication'
      using errcode = 'P0001';
  end if;
  if v_match.home_team_id is null or v_match.away_team_id is null then
    raise exception 'FULL_REPORT_TEAM_UNRESOLVED: home or away team is not yet resolved' using errcode = 'P0001';
  end if;
  if v_match.schedule_status <> 'published' then
    raise exception 'FULL_REPORT_SCHEDULE_NOT_PUBLISHED: schedule is not in an eligible published state'
      using errcode = 'P0001';
  end if;

  -- Step 2: confirm not already published — Publish can never overwrite a
  -- published result through this function; Correction is a separate,
  -- not-yet-implemented workflow/PR.
  if v_match.result_workflow_status = 'published' then
    raise exception 'FULL_REPORT_ALREADY_PUBLISHED_USE_CORRECTION: this match already has a published official result — use the Correction workflow'
      using errcode = 'P0001';
  end if;

  if v_match.version <> p_expected_version then
    raise exception 'FULL_REPORT_VERSION_CONFLICT: match has changed since Preview' using errcode = 'P0001';
  end if;

  -- Defense-in-depth D-09 result-consistency re-check. The app layer
  -- (lib/tournament/fullMatchReport/validateResultConsistency.ts) already
  -- validated this before Preview and before calling this RPC — this is a
  -- second, independent enforcement inside the transaction boundary itself,
  -- so the invariant holds even if a future caller bypasses the app layer.
  if p_winner_team_id is null or p_winner_team_id not in (v_match.home_team_id, v_match.away_team_id) then
    raise exception 'FULL_REPORT_WINNER_TEAM_INVALID: winner_team_id must be the home or away team'
      using errcode = 'P0001';
  end if;
  if p_regulation_home_score is null or p_regulation_away_score is null
     or p_regulation_home_score < 0 or p_regulation_away_score < 0 then
    raise exception 'FULL_REPORT_SCORE_INVALID: regulation scores must be non-negative integers'
      using errcode = 'P0001';
  end if;

  if p_regulation_home_score <> p_regulation_away_score then
    if p_decided_by <> 'regulation' or p_penalty_home_score is not null or p_penalty_away_score is not null then
      raise exception 'FULL_REPORT_RESULT_INCONSISTENT: a regulation-decided match must not carry penalty fields'
        using errcode = 'P0001';
    end if;
    v_expected_winner := case when p_regulation_home_score > p_regulation_away_score
      then v_match.home_team_id else v_match.away_team_id end;
    if p_winner_team_id <> v_expected_winner then
      raise exception 'FULL_REPORT_RESULT_INCONSISTENT: winner_team_id does not match the higher regulation score'
        using errcode = 'P0001';
    end if;
  else
    if p_decided_by <> 'penalty' or p_penalty_home_score is null or p_penalty_away_score is null
       or p_penalty_home_score = p_penalty_away_score then
      raise exception 'FULL_REPORT_RESULT_INCONSISTENT: a tied-regulation match requires a valid, non-tied penalty decision'
        using errcode = 'P0001';
    end if;
    v_expected_winner := case when p_penalty_home_score > p_penalty_away_score
      then v_match.home_team_id else v_match.away_team_id end;
    if p_winner_team_id <> v_expected_winner then
      raise exception 'FULL_REPORT_RESULT_INCONSISTENT: winner_team_id does not match the penalty shootout winner'
        using errcode = 'P0001';
    end if;
  end if;

  -- ------------------------------------------------------------------------
  -- Steps 5-6: submission + result version. First-time publish only (see
  -- migration header) — a published match can never reach this point again
  -- (blocked above), so there is nothing to "replace" for goals/cards/report
  -- either; they are always fresh inserts in this function.
  -- ------------------------------------------------------------------------
  insert into tournament.tournament_result_submissions
    (match_id, stage, payload, status, version, idempotency_key, submitted_by, submitted_at)
  values
    (p_match_id, 'full_report', p_payload, 'published', 1, p_idempotency_key, p_actor_user_id, v_now)
  returning id into v_submission_id;

  insert into tournament.tournament_result_versions (submission_id, version, payload, changed_by)
  values (v_submission_id, 1, p_payload, p_actor_user_id);

  -- Step 7: goal events. Penalty-shootout kicks must never appear in
  -- p_goals — the app layer only ever builds this array from regulation-play
  -- goal events (see buildCanonicalFullReportPayload in fullMatchReport.ts).
  if p_goals is not null then
    for v_goal in select * from jsonb_array_elements(p_goals)
    loop
      insert into tournament.tournament_match_goals
        (match_id, player_id, team_id, minute, is_own_goal, goals, note)
      values (
        p_match_id,
        nullif(v_goal->>'player_id', '')::uuid,
        (v_goal->>'team_id')::uuid,
        nullif(v_goal->>'minute', '')::int,
        coalesce((v_goal->>'is_own_goal')::boolean, false),
        coalesce((v_goal->>'goals')::int, 1),
        nullif(v_goal->>'note', '')
      );
    end loop;
  end if;

  -- Step 8: card events.
  if p_cards is not null then
    for v_card in select * from jsonb_array_elements(p_cards)
    loop
      insert into tournament.tournament_match_cards
        (match_id, player_id, team_id, card_type, minute, note)
      values (
        p_match_id,
        (v_card->>'player_id')::uuid,
        (v_card->>'team_id')::uuid,
        v_card->>'card_type',
        nullif(v_card->>'minute', '')::int,
        nullif(v_card->>'note', '')
      );
    end loop;
  end if;

  -- Step 9: match report text (optional — only inserted when non-empty).
  if p_report_text is not null and length(trim(p_report_text)) > 0 then
    insert into tournament.tournament_match_reports (match_id, report, submitted_by, submitted_at)
    values (p_match_id, p_report_text, p_actor_user_id, v_now);
  end if;

  -- Step 10: official match fields + version bump. The row is already
  -- locked above (FOR UPDATE), so this UPDATE cannot race with another
  -- publish attempt for the same match.
  update tournament.tournament_matches
  set regulation_home_score = p_regulation_home_score,
      regulation_away_score = p_regulation_away_score,
      penalty_home_score = p_penalty_home_score,
      penalty_away_score = p_penalty_away_score,
      decided_by = p_decided_by,
      winner_team_id = p_winner_team_id,
      result_type = p_result_type,
      status = 'finished',
      result_workflow_status = 'published',
      version = version + 1,
      updated_by = p_actor_user_id,
      updated_at = v_now
  where id = p_match_id
  returning version into v_new_version;

  -- Step 11: audit log. The Quick Result comparison (never authoritative,
  -- never written to any Match/result field) is recorded here for audit
  -- visibility only.
  insert into tournament.tournament_audit_logs
    (tournament_id, admin_id, admin_email, action, entity_type, entity_id, entity_label, old_data, new_data)
  values (
    p_tournament_id,
    p_actor_user_id,
    p_actor_email,
    'tournament.full_match_report.publish',
    'tournament_match',
    p_match_id,
    v_match.match_code,
    jsonb_build_object('quick_result_comparison', p_quick_result_comparison),
    p_payload
  );

  -- Step 12: return the publication result. Downstream resolution
  -- (match_winner/match_loser/group_rank/best_ranked placeholder
  -- resolution, Knockout Advancement, Standings row writes, Suspension
  -- calculation) is intentionally NOT performed here — none of those
  -- systems are implemented yet in this PR, and this function must not
  -- invent a queue/event mechanism that doesn't exist. Standings (PR #10)
  -- computes dynamically from published tournament_matches fields, so it
  -- requires no direct write from this function at all.
  return jsonb_build_object(
    'submission_id', v_submission_id,
    'match_id', p_match_id,
    'new_match_version', v_new_version,
    'published_at', v_now,
    'idempotent', false,
    'downstream_resolution_pending', true
  );
end;
$$;

comment on function tournament.publish_full_match_report(
  uuid, uuid, int, uuid, text, text, int, int, int, int, text, uuid, text, jsonb, jsonb, text, jsonb, jsonb
) is
  'Atomic Official Full Match Report publish. First-time publish only — '
  'rejects if result_workflow_status is already published (see Correction '
  'workflow, a separate future PR). service_role only; see REVOKE/GRANT '
  'below. All 12 required steps (idempotency check, row lock + version '
  'claim, eligibility, submission, result version, goals, cards, report, '
  'official match fields, audit log, return) happen in this single '
  'function invocation/transaction — a failure at any step rolls back '
  'every prior step in this call.';

-- ============================================================================
-- 14.2 RPC security — server/service-role only
-- ============================================================================
-- Supabase's `service_role` Postgres role already bypasses RLS entirely, so
-- SECURITY DEFINER above is not being used to grant privilege escalation to
-- a lesser role — it exists solely to pin a safe, explicit search_path.
-- Nonetheless we explicitly and unconditionally lock the callable roles
-- down here, in case this function is ever inspected without that context:
-- anon and authenticated (ordinary Supabase Auth users, including any
-- future Tournament public-facing account) must NEVER be able to invoke
-- this function directly, even by discovering its name — only the
-- server-side Tournament client (lib/tournament/db/supabase-tournament.ts
-- getTournamentServiceClient(), which uses the service-role key and is
-- never exposed to the browser) may call it.
revoke all on function tournament.publish_full_match_report(
  uuid, uuid, int, uuid, text, text, int, int, int, int, text, uuid, text, jsonb, jsonb, text, jsonb, jsonb
) from public;

revoke all on function tournament.publish_full_match_report(
  uuid, uuid, int, uuid, text, text, int, int, int, int, text, uuid, text, jsonb, jsonb, text, jsonb, jsonb
) from anon;

revoke all on function tournament.publish_full_match_report(
  uuid, uuid, int, uuid, text, text, int, int, int, int, text, uuid, text, jsonb, jsonb, text, jsonb, jsonb
) from authenticated;

grant execute on function tournament.publish_full_match_report(
  uuid, uuid, int, uuid, text, text, int, int, int, int, text, uuid, text, jsonb, jsonb, text, jsonb, jsonb
) to service_role;

-- This function performs no dynamic SQL (no EXECUTE/format() building a
-- query string from input) and returns only the small jsonb summary object
-- above — it never returns full row contents, service-role secrets, or any
-- column not explicitly listed in the RETURNS jsonb construction, so there
-- is nothing here that widens the existing RLS/public-view exposure surface
-- documented in 011-scheduling-import-and-views.sql.

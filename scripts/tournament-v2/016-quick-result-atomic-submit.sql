-- Tournament V2 — Phase 1, Migration 016: Atomic Quick Result submit
--
-- Repairs a verified transactional-atomicity gap in the Quick Result feature
-- (PR #9): submitQuickResult() performed its version-claim UPDATE on
-- tournament_matches, its tournament_result_submissions INSERT, its
-- tournament_result_versions INSERT, and (in the route handler) its audit-log
-- INSERT as four separate, independent, sequential PostgREST calls with no
-- wrapping transaction. Same class of bug as PR #6's migration 013a/013b
-- (rollback_schedule_import_batch TOCTOU) and PR #7's migration 015
-- (save_qualification_draw_assignment) — this migration applies the same
-- fix here: one SECURITY DEFINER Postgres transaction for the entire write
-- path.
--
-- This is a separate, additive migration. Migration 014 (Full Match Report)
-- and migration 015 (save_qualification_draw_assignment, Qualification Draw)
-- are not renamed or modified. No column or table changes — Quick Result
-- continues to reuse tournament_result_submissions (stage='quick_result',
-- migration 010, including its existing unique (match_id, stage,
-- idempotency_key) constraint) and tournament_matches.version. No schema
-- gap was found that would require a new table or column.
--
-- Concurrency + idempotency ordering (mandatory, see inline comments below):
-- the target Match row is locked first (SELECT ... FOR UPDATE); only after
-- that lock is held does the function check for an existing submission with
-- the same (match_id, stage, idempotency_key). Locking the Match first is
-- what makes the idempotency check race-free: two concurrent calls for the
-- same match (whether same or different idempotency key) cannot interleave
-- between "read existing submissions" and "write a new one" — the second
-- caller's SELECT ... FOR UPDATE blocks until the first caller's whole
-- transaction (lock, idempotency check, validation, all four writes) has
-- committed or rolled back. This is the identical technique migration 015
-- used for its category-row lock.
--
-- The signed Preview Token (HMAC-SHA256, lib/tournament/services/previewToken.ts)
-- is NOT verified here — its secret is application configuration
-- (TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET), not database state, and stays in
-- the TypeScript service layer exactly as before. This RPC receives only the
-- already-token-verified primitive values the service layer extracted from a
-- valid token (or, for an idempotent replay, values that don't require a
-- fresh token at all — see submitQuickResult()'s unchanged token-exemption
-- logic). The RPC re-validates every other piece of eligibility state from
-- scratch — it does not trust the caller's prior validation for anything
-- except "was this preview token itself genuine," which only the app layer
-- can check.
--
-- Idempotent to re-run — CREATE OR REPLACE FUNCTION plus idempotent
-- REVOKE/GRANT, no column/table changes.

create or replace function tournament.submit_quick_result(
  p_tournament_id uuid,
  p_match_id uuid,
  p_venue_id uuid,
  p_home_score int,
  p_away_score int,
  p_expected_version int,
  p_idempotency_key text,
  p_actor_id uuid,
  p_actor_email text,
  p_session_id text,
  p_device_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = tournament, pg_temp
as $$
declare
  v_tournament_deleted_at timestamptz;
  v_match tournament.tournament_matches%rowtype;
  v_existing tournament.tournament_result_submissions%rowtype;
  v_canonical_payload jsonb;
  v_existing_request_payload jsonb;
  v_stored_payload jsonb;
  v_now timestamptz := now();
  v_submission_id uuid;
  v_new_version int;
  v_affected int;
  v_stage constant text := 'quick_result';
  v_incompatible_statuses constant text[] := array['cancelled', 'abandoned', 'void', 'bye'];
begin
  -- ==========================================================================
  -- 0. Cheap input-shape validation — no row dependency, safe before the lock.
  -- ==========================================================================
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED: idempotencyKey is required';
  end if;
  if p_home_score < 0 then
    raise exception 'HOME_SCORE_NEGATIVE_SCORE: home score must be a non-negative integer';
  end if;
  if p_away_score < 0 then
    raise exception 'AWAY_SCORE_NEGATIVE_SCORE: away score must be a non-negative integer';
  end if;

  -- ==========================================================================
  -- 1. Lock the target Match FIRST — mandatory ordering. Held for the rest of
  --    this transaction, so no concurrent submit_quick_result call for this
  --    same match (same or different idempotency key) can interleave with
  --    anything below.
  -- ==========================================================================
  select * into v_match
  from tournament.tournament_matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'MATCH_NOT_FOUND: match % not found', p_match_id;
  end if;
  if v_match.deleted_at is not null then
    raise exception 'MATCH_DELETED: match % has been deleted', p_match_id;
  end if;
  if v_match.tournament_id <> p_tournament_id then
    raise exception 'TOURNAMENT_MISMATCH: match % does not belong to tournament %', p_match_id, p_tournament_id;
  end if;

  select deleted_at into v_tournament_deleted_at
  from tournament.tournaments
  where id = p_tournament_id;
  if not found or v_tournament_deleted_at is not null then
    raise exception 'TOURNAMENT_MISMATCH: tournament % not found or deleted', p_tournament_id;
  end if;

  -- ==========================================================================
  -- 2. Idempotency check — only after the Match lock is held (see header
  --    comment for why this ordering is what makes it race-free).
  --
  --    Canonical payload = every REQUEST-derived field that must match for
  --    two calls with the same idempotency_key to be considered "the same
  --    request": home_score, away_score, venue_id, the expected/before
  --    version, session_id, device_metadata. Deliberately NOT just
  --    home_score/away_score — a caller retrying with the same key but a
  --    different venue, expected version, session, or device context is a
  --    different request and must be rejected, not silently treated as a
  --    duplicate of the original.
  -- ==========================================================================
  v_canonical_payload := jsonb_build_object(
    'home_score', p_home_score,
    'away_score', p_away_score,
    'venue_id', p_venue_id,
    'match_version_before', p_expected_version,
    'session_id', p_session_id,
    'device_metadata', coalesce(p_device_metadata, 'null'::jsonb)
  );

  select * into v_existing
  from tournament.tournament_result_submissions
  where match_id = p_match_id
    and stage = v_stage
    and idempotency_key = p_idempotency_key;

  if found then
    v_stored_payload := v_existing.payload;
    v_existing_request_payload := v_stored_payload - 'match_version_after';

    if v_existing_request_payload <> v_canonical_payload then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: idempotency key % was already used with a different request', p_idempotency_key;
    end if;

    -- Same key, same canonical request: idempotent success. Zero writes.
    -- Return the values the ORIGINAL successful submission actually stored,
    -- not values re-derived from this retry's request.
    return jsonb_build_object(
      'submissionId', v_existing.id,
      'matchId', p_match_id,
      'matchCode', v_match.match_code,
      'homeScore', (v_stored_payload->>'home_score')::int,
      'awayScore', (v_stored_payload->>'away_score')::int,
      'previousMatchVersion', (v_stored_payload->>'match_version_before')::int,
      'newMatchVersion', (v_stored_payload->>'match_version_after')::int,
      'status', 'submitted',
      'idempotent', true
    );
  end if;

  -- ==========================================================================
  -- 3. Genuinely new submission — full authoritative eligibility validation,
  --    all before any write. The Preview Token itself was already verified
  --    in the TypeScript service layer (its HMAC secret lives there, not
  --    here); this RPC re-validates every other piece of match state from
  --    scratch and never trusts the caller.
  -- ==========================================================================
  if p_venue_id is not null and v_match.venue_id is distinct from p_venue_id then
    raise exception 'VENUE_MATCH_MISMATCH: match % does not belong to venue %', p_match_id, p_venue_id;
  end if;
  if v_match.status = any (v_incompatible_statuses) then
    raise exception 'MATCH_STATUS_INCOMPATIBLE: match status "%" is not eligible for Quick Result', v_match.status;
  end if;
  if v_match.result_workflow_status = 'published' then
    raise exception 'RESULT_ALREADY_PUBLISHED: match % already has an official published result', p_match_id;
  end if;
  if v_match.home_team_id is null then
    raise exception 'HOME_TEAM_UNRESOLVED: home team placeholder is not yet resolved';
  end if;
  if v_match.away_team_id is null then
    raise exception 'AWAY_TEAM_UNRESOLVED: away team placeholder is not yet resolved';
  end if;
  if v_match.version <> p_expected_version then
    raise exception 'QUICK_RESULT_VERSION_CONFLICT: match has changed since Preview (expected version %, current version %)', p_expected_version, v_match.version;
  end if;

  -- ==========================================================================
  -- 4. Atomic write sequence. Every step below is inside this same
  --    transaction; an error at any point rolls back everything already
  --    done in this function call (ordinary unhandled-exception semantics —
  --    no nested exception handler swallows a write failure here).
  -- ==========================================================================

  -- 4a. Version claim. Conditional on the exact expected version and checked
  --     via ROW_COUNT as defense in depth (the FOR UPDATE lock already
  --     guarantees this, but fails closed instead of silently proceeding if
  --     that invariant is ever violated). Never touches result_workflow_status,
  --     result_type, schedule_status, status, official scores
  --     (regulation_home_score/regulation_away_score/penalty_*),
  --     winner_team_id, team ids, or source fields — Quick Result remains
  --     provisional and operational-only.
  update tournament.tournament_matches
  set version = p_expected_version + 1,
      updated_by = p_actor_id,
      updated_at = v_now
  where id = p_match_id
    and version = p_expected_version;
  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception 'QUICK_RESULT_APPLY_MISMATCH: expected to claim exactly 1 row for match %, affected %', p_match_id, v_affected;
  end if;
  v_new_version := p_expected_version + 1;

  -- 4b. Submission row. The stored payload is the canonical request payload
  --     plus the outcome-only match_version_after field.
  insert into tournament.tournament_result_submissions (
    match_id, stage, payload, status, version, idempotency_key, submitted_by, submitted_at
  ) values (
    p_match_id,
    v_stage,
    v_canonical_payload || jsonb_build_object('match_version_after', v_new_version),
    'submitted',
    1,
    p_idempotency_key,
    p_actor_id,
    v_now
  )
  returning id into v_submission_id;

  -- 4c. Result-version audit-history row — mandatory, not best-effort. If
  --     this fails, the version claim and submission insert above roll back
  --     with it.
  insert into tournament.tournament_result_versions (
    submission_id, version, payload, changed_by
  ) values (
    v_submission_id,
    1,
    v_canonical_payload || jsonb_build_object('match_version_after', v_new_version),
    p_actor_id
  );

  -- 4d. Audit log — mandatory, inside the same transaction. If this fails,
  --     everything above (version claim, submission, result-version) rolls
  --     back with it. No second, decoupled audit write happens in the route
  --     after this RPC returns.
  insert into tournament.tournament_audit_logs (
    tournament_id, admin_id, admin_email, action, entity_type, entity_id, entity_label, new_data
  ) values (
    p_tournament_id,
    p_actor_id,
    p_actor_email,
    'tournament.quick_result.submit',
    'tournament_match',
    p_match_id,
    v_match.match_code,
    jsonb_build_object(
      'tournament_id', p_tournament_id,
      'match_id', p_match_id,
      'match_code', v_match.match_code,
      'submission_id', v_submission_id,
      'venue_id', p_venue_id,
      'home_score', p_home_score,
      'away_score', p_away_score,
      'idempotency_key', p_idempotency_key,
      'previous_match_version', p_expected_version,
      'new_match_version', v_new_version,
      'actor_id', p_actor_id,
      'actor_email', p_actor_email,
      'session_id', p_session_id,
      'device_metadata', coalesce(p_device_metadata, 'null'::jsonb),
      'provisional', true
    )
  );

  return jsonb_build_object(
    'submissionId', v_submission_id,
    'matchId', p_match_id,
    'matchCode', v_match.match_code,
    'homeScore', p_home_score,
    'awayScore', p_away_score,
    'previousMatchVersion', p_expected_version,
    'newMatchVersion', v_new_version,
    'status', 'submitted',
    'idempotent', false
  );
end;
$$;

revoke all on function tournament.submit_quick_result(uuid, uuid, uuid, int, int, int, text, uuid, text, text, jsonb) from public;
revoke execute on function tournament.submit_quick_result(uuid, uuid, uuid, int, int, int, text, uuid, text, text, jsonb) from anon;
revoke execute on function tournament.submit_quick_result(uuid, uuid, uuid, int, int, int, text, uuid, text, text, jsonb) from authenticated;
grant execute on function tournament.submit_quick_result(uuid, uuid, uuid, int, int, int, text, uuid, text, text, jsonb) to service_role;

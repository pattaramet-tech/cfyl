-- Tournament V2 — Phase 1, Migration 013b: Rollback RPC concurrency + conflict-persistence fix
--
-- Repairs two verified bugs in tournament.rollback_schedule_import_batch() from
-- migration 013a (already applied to Staging — not modified retroactively; this is a
-- separate, additive repair migration, `create or replace function` only, no column
-- changes needed).
--
-- Bug 1 — TOCTOU / lost-update race: the conflict-check pass read each matched Match's
--   version/updated_at with a plain SELECT (no lock), then the apply pass mutated it in
--   a separate statement. Nothing prevented a concurrent write to that same Match from
--   landing in the gap between the two passes and being silently overwritten.
-- Bug 2 — conflict state never persisted: on conflict, the function did
--   `update ... set status = 'failed', rollback_failure_reason = ...` and then
--   `raise exception`. Since the whole function call is one Postgres transaction, the
--   unhandled exception rolled back that update along with everything else — the batch
--   silently reverted to 'saved' and the failure reason was never actually stored,
--   contradicting the migration's own documented behavior.
--
-- Fixes:
--   1. SELECT ... FOR UPDATE on every matched Match, acquired in deterministic
--      matched_match_id order (reduces deadlock risk against another concurrent
--      rollback/lock sequence touching overlapping Matches), held for the rest of the
--      transaction — closes the TOCTOU gap entirely. The apply pass's DELETE/UPDATE is
--      additionally made conditional on the exact expected version/updated_at, with a
--      GET DIAGNOSTICS ROW_COUNT check that fails closed (raises, aborting the whole
--      transaction) if the expected row was not the one mutated — defense in depth for
--      "should never happen given the lock, but if it does, do not proceed silently."
--   2. The conflict path no longer raises. It commits the 'failed' status + reason as
--      part of this function's own normal (non-erroring) return, and returns a
--      structured JSON payload the caller can act on. Only genuinely unexpected
--      database/system failures (including the ROW_COUNT mismatch above) still raise
--      and roll back atomically — that is the correct behavior for a true anomaly, as
--      opposed to a normal, already-persisted "this batch cannot be rolled back" result.
--   3. Claiming a batch (saved -> rolling_back) clears any stale
--      rollback_failure_reason/failed_at left over from an earlier failed attempt, so a
--      successful run's response is never confused by leftover diagnostic data.
--
-- Idempotent — safe to re-run after a partial failure (CREATE OR REPLACE FUNCTION plus
-- idempotent REVOKE/GRANT; no column changes).

create or replace function tournament.rollback_schedule_import_batch(
  p_batch_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = tournament, pg_temp
as $$
declare
  v_batch tournament.tournament_schedule_batches%rowtype;
  v_row tournament.tournament_schedule_import_rows%rowtype;
  v_match tournament.tournament_matches%rowtype;
  v_reverted_created int := 0;
  v_reverted_updated int := 0;
  v_conflicts jsonb := '[]'::jsonb;
  v_affected int;
begin
  -- Claim + clear any stale failure diagnostics from a previous failed attempt (defensive
  -- hygiene — 'failed' is currently a terminal state like Save's own 'failed', so this
  -- guards against future retry paths rather than one reachable today).
  update tournament.tournament_schedule_batches
  set status = 'rolling_back',
      rollback_failure_reason = null,
      failed_at = null
  where id = p_batch_id
    and status = 'saved'
  returning * into v_batch;

  if not found then
    select * into v_batch from tournament.tournament_schedule_batches where id = p_batch_id;

    if v_batch.id is null then
      raise exception 'SCHEDULE_ROLLBACK_BATCH_NOT_FOUND';
    end if;

    if v_batch.status = 'rolled_back' then
      return jsonb_build_object('batchId', p_batch_id, 'status', 'rolled_back', 'idempotent', true);
    end if;

    -- No mutation has happened yet in this branch — safe to raise directly.
    raise exception 'SCHEDULE_ROLLBACK_NOT_ELIGIBLE: batch status is "%"', v_batch.status;
  end if;

  -- Lock + conflict-check pass, in deterministic matched_match_id order. Each lock is
  -- held until this transaction ends (commit or rollback) — no other transaction can
  -- concurrently modify these rows from here on, closing the TOCTOU gap that let a
  -- concurrent edit slip between check and apply under migration 013a.
  for v_row in
    select * from tournament.tournament_schedule_import_rows
    where batch_id = p_batch_id
      and matched_match_id is not null
      and applied_match_version is not null
    order by matched_match_id
  loop
    select * into v_match from tournament.tournament_matches
    where id = v_row.matched_match_id and deleted_at is null
    for update;

    if v_match.id is null then
      v_conflicts := v_conflicts || jsonb_build_object(
        'row', v_row.row_no, 'match_code', v_row.match_code,
        'matched_match_id', v_row.matched_match_id, 'reason', 'MATCH_NOT_FOUND'
      );
      continue;
    end if;

    if v_match.version is distinct from v_row.applied_match_version
       or v_match.updated_at is distinct from v_row.applied_match_updated_at then
      v_conflicts := v_conflicts || jsonb_build_object(
        'row', v_row.row_no, 'match_code', v_row.match_code,
        'matched_match_id', v_row.matched_match_id, 'reason', 'MATCH_CHANGED_SINCE_IMPORT',
        'expected_version', v_row.applied_match_version, 'current_version', v_match.version
      );
      continue;
    end if;

    if v_match.schedule_status = 'published' then
      v_conflicts := v_conflicts || jsonb_build_object(
        'row', v_row.row_no, 'match_code', v_row.match_code,
        'matched_match_id', v_row.matched_match_id, 'reason', 'MATCH_CURRENTLY_PUBLISHED'
      );
      continue;
    end if;

    if v_match.result_workflow_status <> 'not_started'
       or v_match.status in ('finished', 'in_progress')
       or v_match.regulation_home_score is not null
       or v_match.regulation_away_score is not null then
      v_conflicts := v_conflicts || jsonb_build_object(
        'row', v_row.row_no, 'match_code', v_row.match_code,
        'matched_match_id', v_row.matched_match_id, 'reason', 'MATCH_RESULT_IN_PROGRESS'
      );
    end if;
  end loop;

  if jsonb_array_length(v_conflicts) > 0 then
    -- Persist the failure normally (no exception follows), so this write actually
    -- commits — the fix for migration 013a's bug 2.
    update tournament.tournament_schedule_batches
    set status = 'failed', rollback_failure_reason = v_conflicts::text, failed_at = now()
    where id = p_batch_id and status = 'rolling_back';

    return jsonb_build_object(
      'batchId', p_batch_id,
      'status', 'failed',
      'idempotent', false,
      'errorCode', 'SCHEDULE_ROLLBACK_CONFLICT',
      'conflicts', v_conflicts
    );
  end if;

  -- Apply pass. Every touched Match is still locked from the pass above, so nothing
  -- could have changed underneath us — but the DELETE/UPDATE below is still made
  -- conditional on the exact expected version/updated_at, and checked via ROW_COUNT, as
  -- defense in depth: if this ever affects zero rows despite holding the lock, that is
  -- a structural anomaly (not a normal conflict, which the pass above already would
  -- have caught), so it fails closed via an exception rather than silently proceeding.
  for v_row in
    select * from tournament.tournament_schedule_import_rows
    where batch_id = p_batch_id
      and matched_match_id is not null
      and applied_match_version is not null
    order by matched_match_id
  loop
    if v_row.before_payload is null then
      delete from tournament.tournament_matches
      where id = v_row.matched_match_id
        and version = v_row.applied_match_version
        and updated_at = v_row.applied_match_updated_at;
      get diagnostics v_affected = row_count;
      if v_affected <> 1 then
        raise exception 'SCHEDULE_ROLLBACK_APPLY_MISMATCH: expected to delete exactly 1 row for match_id %, affected %', v_row.matched_match_id, v_affected;
      end if;
      v_reverted_created := v_reverted_created + 1;
    else
      update tournament.tournament_matches m
      set
        category_id = r.category_id,
        group_id = r.group_id,
        stage = r.stage,
        match_code = r.match_code,
        match_no = r.match_no,
        match_date = r.match_date,
        match_time = r.match_time,
        venue_id = r.venue_id,
        court_id = r.court_id,
        home_team_id = r.home_team_id,
        away_team_id = r.away_team_id,
        home_source_type = r.home_source_type,
        home_source_ref = r.home_source_ref,
        away_source_type = r.away_source_type,
        away_source_ref = r.away_source_ref,
        sources_resolved_at = r.sources_resolved_at,
        result_policy = r.result_policy,
        result_type = r.result_type,
        status = r.status,
        note = r.note,
        schedule_batch_id = r.schedule_batch_id,
        schedule_status = r.schedule_status,
        version = r.version,
        updated_by = r.updated_by,
        updated_at = r.updated_at
      from jsonb_to_record(v_row.before_payload) as r(
        category_id uuid, group_id uuid, stage text, match_code text, match_no int,
        match_date date, match_time text, venue_id uuid, court_id uuid,
        home_team_id uuid, away_team_id uuid,
        home_source_type text, home_source_ref text, away_source_type text, away_source_ref text,
        sources_resolved_at timestamptz, result_policy text, result_type text,
        status text, note text, schedule_batch_id uuid, schedule_status text, version int,
        updated_by uuid, updated_at timestamptz
      )
      where m.id = v_row.matched_match_id
        and m.version = v_row.applied_match_version
        and m.updated_at = v_row.applied_match_updated_at;
      get diagnostics v_affected = row_count;
      if v_affected <> 1 then
        raise exception 'SCHEDULE_ROLLBACK_APPLY_MISMATCH: expected to update exactly 1 row for match_id %, affected %', v_row.matched_match_id, v_affected;
      end if;
      v_reverted_updated := v_reverted_updated + 1;
    end if;
  end loop;

  update tournament.tournament_schedule_batches
  set status = 'rolled_back', rolled_back_at = now(), rolled_back_by = p_actor_id
  where id = p_batch_id and status = 'rolling_back';

  insert into tournament.tournament_audit_logs (
    tournament_id, admin_id, action, entity_type, entity_id, entity_label, new_data
  ) values (
    v_batch.tournament_id, p_actor_id, 'schedule.import.rollback', 'schedule_batch', p_batch_id, v_batch.file_name,
    jsonb_build_object('revertedCreated', v_reverted_created, 'revertedUpdated', v_reverted_updated)
  );

  return jsonb_build_object(
    'batchId', p_batch_id,
    'status', 'rolled_back',
    'idempotent', false,
    'revertedCreated', v_reverted_created,
    'revertedUpdated', v_reverted_updated
  );
end;
$$;

revoke all on function tournament.rollback_schedule_import_batch(uuid, uuid) from public;
grant execute on function tournament.rollback_schedule_import_batch(uuid, uuid) to service_role;

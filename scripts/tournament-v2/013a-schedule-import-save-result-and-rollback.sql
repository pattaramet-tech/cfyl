-- Tournament V2 — Phase 1, Migration 013a: Schedule Import save_result + Rollback support
--
-- Repairs a gap left by migration 013: the Save route
-- (app/api/tournament/admin/schedule/import/save/route.ts) reads and writes
-- tournament_schedule_batches.save_result on every call, but no migration ever created
-- that column. Confirmed live against CFYL-Tournament-Staging (013 already applied
-- there): every other column Save/013 depend on is present, only save_result is
-- missing — this is a source-file gap, not a "not yet applied" gap.
--
-- Also adds the schema needed for a real, transactional Rollback workflow. Migration 011
-- added a 'rolled_back' status value and rolled_back_at/rolled_back_by columns, but no
-- rollback route, RPC, or per-row snapshot data has ever existed until this migration.
--
-- This is a separate, additive repair migration — migration 013 (already applied to
-- Staging) is not modified retroactively.
--
-- Idempotent — safe to re-run after a partial failure.

-- ============================================================================
-- tournament_schedule_batches: save_result, 'rolling_back' state, rollback failure reason
-- ============================================================================
alter table tournament.tournament_schedule_batches
  add column if not exists save_result jsonb;

alter table tournament.tournament_schedule_batches
  drop constraint if exists tournament_schedule_batches_status_check;

alter table tournament.tournament_schedule_batches
  add constraint tournament_schedule_batches_status_check
  check (status in ('preview', 'saving', 'saved', 'failed', 'rolling_back', 'rolled_back'));

alter table tournament.tournament_schedule_batches
  add column if not exists rollback_failure_reason text;

-- ============================================================================
-- tournament_schedule_import_rows: per-row rollback snapshot metadata
--
-- before_payload: the complete pre-mutation set of tournament_matches columns Save
--   writes (including updated_at/updated_by, so a restore is a true undo rather than a
--   new edit event — see the restore UPDATE below for why this matters), captured
--   immediately before an 'update' action mutates an existing Match. null for 'create'
--   actions (nothing existed before) and for rows Save did not actually mutate
--   (unchanged / skipped / failed during Save).
-- applied_match_version / applied_match_updated_at: the Match's version/updated_at
--   immediately AFTER Save wrote it. Rollback compares these against the Match's
--   CURRENT version/updated_at to detect edits made since this batch applied — if they
--   differ, rollback refuses (conflict) rather than silently overwriting newer data.
--   Both stay null for rows Save did not actually mutate, which rollback also treats as
--   "nothing to roll back" for that row.
-- ============================================================================
alter table tournament.tournament_schedule_import_rows
  add column if not exists before_payload jsonb;

alter table tournament.tournament_schedule_import_rows
  add column if not exists applied_match_version int;

alter table tournament.tournament_schedule_import_rows
  add column if not exists applied_match_updated_at timestamptz;

-- ============================================================================
-- Rollback RPC — single Postgres transaction, all-or-nothing.
--
-- SECURITY DEFINER + pinned search_path, matching the posture already established for
-- other privileged Tournament V2 write RPCs: only service_role may execute; anon and
-- authenticated cannot. The route itself still enforces tournament_super_admin at the
-- HTTP layer (requireTournamentSuperAdmin) before ever calling this function.
--
-- Behavior:
--   1. Atomically claims the batch: 'saved' -> 'rolling_back'. A second concurrent call
--      sees zero rows affected by the claiming UPDATE and is rejected (or, if the first
--      call already finished, returns the same idempotent 'rolled_back' response).
--   2. Conflict-check pass over every row this batch actually mutated (identified by
--      applied_match_version being non-null — see column comment above): the matched
--      Match must still exist, must not have been modified since (version/updated_at
--      both match what Save recorded), and must not have progressed past scheduling
--      (no result entered, not published, not in_progress/finished). Any conflict
--      aborts the whole rollback (batch marked 'failed' with the reason recorded) —
--      no partial restore.
--   3. Apply pass: rows with a null before_payload are 'create' rows — the Match Save
--      created is deleted. Rows with a non-null before_payload are 'update' rows — the
--      Match is restored to exactly the snapshot Save captured before it mutated it
--      (including version, so the optimistic-lock counter reflects the Match's real
--      edit history rather than jumping forward).
--   4. Finalizes the batch as 'rolled_back' and writes one audit log entry.
-- Everything above runs inside this single function invocation, so a failure at any
-- point rolls back the whole Postgres transaction — there is no best-effort partial
-- rollback path.
-- ============================================================================
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
begin
  update tournament.tournament_schedule_batches
  set status = 'rolling_back'
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

    raise exception 'SCHEDULE_ROLLBACK_NOT_ELIGIBLE: batch status is "%"', v_batch.status;
  end if;

  -- Conflict-check pass — no mutation yet.
  for v_row in
    select * from tournament.tournament_schedule_import_rows
    where batch_id = p_batch_id
      and matched_match_id is not null
      and applied_match_version is not null
    order by row_no
  loop
    select * into v_match from tournament.tournament_matches
    where id = v_row.matched_match_id and deleted_at is null;

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
    update tournament.tournament_schedule_batches
    set status = 'failed', rollback_failure_reason = v_conflicts::text, failed_at = now()
    where id = p_batch_id and status = 'rolling_back';

    raise exception 'SCHEDULE_ROLLBACK_CONFLICT: %', v_conflicts::text;
  end if;

  -- Apply pass — safe to mutate now that every touched Match has been verified untouched.
  for v_row in
    select * from tournament.tournament_schedule_import_rows
    where batch_id = p_batch_id
      and matched_match_id is not null
      and applied_match_version is not null
    order by row_no
  loop
    if v_row.before_payload is null then
      delete from tournament.tournament_matches where id = v_row.matched_match_id;
      v_reverted_created := v_reverted_created + 1;
    else
      -- Restores updated_at/updated_by from the snapshot as well as version, not a
      -- fresh now()/actor — a true undo, not a new edit event. This matters for
      -- composability: rolling back an EARLIER batch after a LATER batch on the same
      -- Match (in the correct reverse order) depends on the Match's version/updated_at
      -- exactly matching what that earlier batch's own applied_match_version /
      -- applied_match_updated_at recorded, which only holds if every rollback restores
      -- the full prior state rather than stamping the moment of the rollback itself.
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
      where m.id = v_row.matched_match_id;
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

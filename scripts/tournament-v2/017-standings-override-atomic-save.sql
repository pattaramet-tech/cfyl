-- Tournament V2 — Phase 1, Migration 017: Atomic Manual Standings Override save
--
-- Repairs a verified transactional-atomicity gap in the Manual Standings Override
-- feature (PR #10): saveStandingsOverride() previously performed its
-- scope/rank/duplicate validation, its pre-Preview-state check, its
-- tournament_standing_overrides UPSERT, and its tournament_audit_logs INSERT as
-- four separate, independent, sequential PostgREST calls with no wrapping
-- transaction, backstopped only by a best-effort compensating rollback if the
-- audit insert failed. That rollback narrowed the window but did not close it,
-- and — because none of those reads locked anything — could not prevent two
-- concurrent Saves for different teams in the same Group from both reading "no
-- rank conflict" before either wrote, producing two active overrides with the
-- same override_rank. Same class of bug as PR #6's migration 013b, PR #7's
-- migration 015, and PR #9's migration 016 — this migration applies the same
-- fix here: one SECURITY DEFINER Postgres transaction for the entire write path.
--
-- This is a separate, additive migration. Migrations 014 (Full Match Report),
-- 015 (save_qualification_draw_assignment, Qualification Draw), and 016
-- (submit_quick_result, Quick Result) are not renamed or modified. No new table
-- or column — this migration continues to reuse tournament_standing_overrides
-- (migration 007, including its existing unique (group_id, team_id) constraint)
-- and tournament_audit_logs (migration 008). No schema gap was found that would
-- require a new table or column.
--
-- One verified pre-existing schema-fit issue, fixed as part of moving this
-- write path here (not a new column/constraint): tournament_audit_logs.entity_id
-- is typed uuid, but the old TypeScript code passed the composite string
-- "<group_id>:<team_id>" as entity_id — not valid uuid syntax. Unit tests never
-- caught this because they run against a mock Supabase client with no column
-- typing; a real Postgres insert would have rejected it outright with
-- "invalid input syntax for type uuid" on the very first real Save. This
-- function instead stores p_team_id (already a genuine uuid) as entity_id and
-- keeps the full "group=<id> team=<id>" composite in entity_label (free text)
-- and in old_data/new_data — the same shape migration 016 uses (entity_id =
-- the single most relevant row's own uuid, full context in entity_label/data).
--
-- Locking order (mandatory, see inline comments below): the target Group row is
-- locked FIRST (SELECT ... FOR UPDATE), before any other authoritative read.
-- Overrides for different teams can collide on override_rank within the same
-- Group, so the Group is the correct serialization point — two concurrent
-- save_standings_override calls for the same Group (whether for the same team
-- or different teams) cannot interleave between "read existing overrides" and
-- "write a new one." The second caller's SELECT ... FOR UPDATE blocks until the
-- first caller's whole transaction (lock, validation, expected-state check,
-- both writes) has committed or rolled back. This is the identical technique
-- migration 015 used for its category-row lock and migration 016 used for its
-- Match-row lock.
--
-- Expected-before-state contract: the signed Preview Token (HMAC-SHA256,
-- lib/tournament/services/standingsOverridePreviewToken.ts) is NOT verified
-- here — its secret is application configuration
-- (TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET), not database state, and stays in
-- the TypeScript service layer exactly as before, same as migration 016's
-- Preview Token. After verifying the token, the service layer performs a
-- non-authoritative read of the current override and compares it against the
-- token's beforeStateHash, then passes the primitive expected-before values
-- (p_expected_row_exists / p_expected_override_rank / p_expected_reason) to
-- this function — never a hash. This function re-reads the target override
-- itself, under the Group lock, and compares the exact primitive state; a
-- mismatch (the row changed between the service layer's read and this lock
-- being acquired) fails closed with STANDINGS_OVERRIDE_STATE_CHANGED before any
-- write. Comparing primitives inside Postgres avoids re-implementing Node's
-- SHA-256-of-JSON.stringify hashing in SQL, which would be a fragile
-- serialization-format dependency for no safety benefit — the RPC's own
-- authoritative comparison is what actually matters under the lock.
--
-- Idempotent to re-run — CREATE OR REPLACE FUNCTION plus idempotent
-- REVOKE/GRANT, no column/table changes.

create or replace function tournament.save_standings_override(
  p_tournament_id uuid,
  p_group_id uuid,
  p_team_id uuid,
  p_override_rank int,
  p_reason text,
  p_actor_id uuid,
  p_actor_email text,
  p_expected_row_exists boolean,
  p_expected_override_rank int,
  p_expected_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = tournament, pg_temp
as $$
declare
  v_group tournament.tournament_groups%rowtype;
  v_tournament_status text;
  v_tournament_deleted_at timestamptz;
  v_team_tournament_id uuid;
  v_team_category_id uuid;
  v_team_deleted_at timestamptz;
  v_team_in_group boolean;
  v_resolved_team_count int;
  v_reason text := trim(p_reason);
  v_existing tournament.tournament_standing_overrides%rowtype;
  v_existing_found boolean;
  v_rank_conflict boolean;
  v_old_data jsonb;
  v_new_data jsonb;
  v_entity_label text;
begin
  -- ==========================================================================
  -- 0. Cheap input-shape validation — no row dependency, safe before the lock.
  -- ==========================================================================
  if v_reason = '' then
    raise exception 'STANDINGS_OVERRIDE_REASON_REQUIRED: reason is required for a manual standings override';
  end if;
  if p_override_rank is null or p_override_rank < 1 then
    raise exception 'STANDINGS_OVERRIDE_RANK_INVALID: override_rank must be a positive integer';
  end if;

  -- ==========================================================================
  -- 1. Lock the target Group FIRST — mandatory ordering. Held for the rest of
  --    this transaction, so no concurrent save_standings_override call for
  --    this same Group (same or different team) can interleave with anything
  --    below. This is what makes the rank-collision and expected-state checks
  --    race-free.
  -- ==========================================================================
  select * into v_group
  from tournament.tournament_groups
  where id = p_group_id
  for update;

  if not found then
    raise exception 'STANDINGS_OVERRIDE_GROUP_NOT_FOUND: group % not found', p_group_id;
  end if;
  if v_group.tournament_id <> p_tournament_id then
    raise exception 'STANDINGS_OVERRIDE_GROUP_TOURNAMENT_MISMATCH: group % does not belong to tournament %', p_group_id, p_tournament_id;
  end if;

  -- ==========================================================================
  -- 2. Re-validate every authoritative input under the lock — never trust the
  --    caller's prior (pre-lock, non-authoritative) validation for anything.
  -- ==========================================================================
  select status, deleted_at into v_tournament_status, v_tournament_deleted_at
  from tournament.tournaments
  where id = p_tournament_id;

  if not found or v_tournament_deleted_at is not null then
    raise exception 'STANDINGS_OVERRIDE_TOURNAMENT_NOT_FOUND: tournament % not found', p_tournament_id;
  end if;
  if v_tournament_status = 'archived' then
    raise exception 'STANDINGS_OVERRIDE_TOURNAMENT_NOT_ACTIVE: tournament % is archived and no longer accepts standings overrides', p_tournament_id;
  end if;

  select tournament_id, category_id, deleted_at
    into v_team_tournament_id, v_team_category_id, v_team_deleted_at
  from tournament.tournament_teams
  where id = p_team_id;

  if not found then
    raise exception 'STANDINGS_OVERRIDE_TEAM_NOT_FOUND: team % not found', p_team_id;
  end if;
  if v_team_deleted_at is not null then
    raise exception 'STANDINGS_OVERRIDE_TEAM_DELETED: team % has been deleted', p_team_id;
  end if;
  if v_team_tournament_id <> p_tournament_id then
    raise exception 'STANDINGS_OVERRIDE_TEAM_TOURNAMENT_MISMATCH: team % does not belong to tournament %', p_team_id, p_tournament_id;
  end if;
  if v_team_category_id <> v_group.category_id then
    raise exception 'STANDINGS_OVERRIDE_TEAM_CATEGORY_MISMATCH: team % belongs to a different category than group %', p_team_id, p_group_id;
  end if;

  select exists (
    select 1 from tournament.tournament_group_members
    where group_id = p_group_id and team_id = p_team_id
  ) into v_team_in_group;
  if not v_team_in_group then
    raise exception 'STANDINGS_OVERRIDE_TEAM_NOT_IN_GROUP: team % is not a member of group %', p_team_id, p_group_id;
  end if;

  select count(*) into v_resolved_team_count
  from tournament.tournament_group_members
  where group_id = p_group_id and team_id is not null;

  if p_override_rank > v_resolved_team_count then
    raise exception 'STANDINGS_OVERRIDE_RANK_OUT_OF_RANGE: override_rank must be between 1 and % (the number of resolved teams in this group)', v_resolved_team_count;
  end if;

  select exists (
    select 1 from tournament.tournament_standing_overrides
    where group_id = p_group_id and team_id <> p_team_id and override_rank = p_override_rank
  ) into v_rank_conflict;
  if v_rank_conflict then
    raise exception 'STANDINGS_OVERRIDE_RANK_CONFLICT: override_rank % is already used by another team''s active override in group %', p_override_rank, p_group_id;
  end if;

  -- ==========================================================================
  -- 3. Expected-before-state check — under the lock, against the primitive
  --    values the service layer derived from its own (non-authoritative,
  --    pre-lock) read and already matched against the Preview Token's
  --    beforeStateHash. A mismatch here means the row genuinely changed
  --    between that read and this lock being acquired — fail closed before
  --    any write.
  -- ==========================================================================
  select * into v_existing
  from tournament.tournament_standing_overrides
  where group_id = p_group_id and team_id = p_team_id;
  v_existing_found := found;

  if p_expected_row_exists then
    if not v_existing_found then
      raise exception 'STANDINGS_OVERRIDE_STATE_CHANGED: the existing override for this team has changed since Preview — preview again';
    end if;
    if v_existing.override_rank <> p_expected_override_rank or v_existing.reason <> p_expected_reason then
      raise exception 'STANDINGS_OVERRIDE_STATE_CHANGED: the existing override for this team has changed since Preview — preview again';
    end if;
  else
    if v_existing_found then
      raise exception 'STANDINGS_OVERRIDE_STATE_CHANGED: the existing override for this team has changed since Preview — preview again';
    end if;
  end if;

  -- ==========================================================================
  -- 4. Atomic write sequence. Every step below is inside this same
  --    transaction; an error at any point rolls back everything already done
  --    in this function call (ordinary unhandled-exception semantics — no
  --    nested exception handler swallows a write failure here). Never
  --    mutates Group, Team, Match, Standings result source data,
  --    Qualification Draw, Quick Result, official result, bracket, or
  --    schedule data — only tournament_standing_overrides and
  --    tournament_audit_logs.
  -- ==========================================================================
  v_old_data := case when v_existing_found then
      jsonb_build_object('group_id', p_group_id, 'team_id', p_team_id, 'override_rank', v_existing.override_rank, 'reason', v_existing.reason)
    else null end;
  v_new_data := jsonb_build_object('group_id', p_group_id, 'team_id', p_team_id, 'override_rank', p_override_rank, 'reason', v_reason);
  v_entity_label := format('group=%s team=%s', p_group_id, p_team_id);

  insert into tournament.tournament_standing_overrides (group_id, team_id, override_rank, reason, created_by)
  values (p_group_id, p_team_id, p_override_rank, v_reason, p_actor_id)
  on conflict (group_id, team_id) do update
    set override_rank = excluded.override_rank,
        reason = excluded.reason,
        created_by = excluded.created_by;

  -- 4b. Audit log — mandatory, inside the same transaction. If this fails,
  --     the override write above rolls back with it. No compensating
  --     rollback needed — there is nothing to compensate for.
  insert into tournament.tournament_audit_logs (
    tournament_id, admin_id, admin_email, action, entity_type, entity_id, entity_label, old_data, new_data
  ) values (
    p_tournament_id,
    p_actor_id,
    p_actor_email,
    'standings.manual_override',
    'standing-override',
    p_team_id,
    v_entity_label,
    v_old_data,
    v_new_data
  );

  return jsonb_build_object(
    'groupId', p_group_id,
    'teamId', p_team_id,
    'overrideRank', p_override_rank,
    'reason', v_reason,
    'auditLogged', true
  );
end;
$$;

revoke all on function tournament.save_standings_override(uuid, uuid, uuid, int, text, uuid, text, boolean, int, text) from public;
revoke execute on function tournament.save_standings_override(uuid, uuid, uuid, int, text, uuid, text, boolean, int, text) from anon;
revoke execute on function tournament.save_standings_override(uuid, uuid, uuid, int, text, uuid, text, boolean, int, text) from authenticated;
grant execute on function tournament.save_standings_override(uuid, uuid, uuid, int, text, uuid, text, boolean, int, text) to service_role;

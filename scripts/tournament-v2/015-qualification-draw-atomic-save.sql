-- Tournament V2 — Phase 1, Migration 015: Atomic Qualification Draw save/correction
--
-- Repairs a verified transactional-atomicity gap in the Manual Qualification Draw
-- feature (PR #7): saveQualificationDrawSelections() previously performed its
-- supersede-previous-draw, insert-new-draw, insert-candidates, and per-Match
-- team_id-resolution updates as separate, independent, sequential PostgREST calls,
-- plus a further, fully decoupled audit-log write in the route handler — with no
-- wrapping transaction. A failure partway through could leave an active draw with
-- missing/incomplete candidates or partially-resolved Matches, with no audit trail
-- and no rollback of the prior successful writes. Same class of bug as migration
-- 013a's rollback_schedule_import_batch() TOCTOU/lost-update race, fixed there by
-- 013b's single-transaction RPC — this migration applies the same fix here.
--
-- This is a separate, additive migration. Migration 012 (draw_selected source-type
-- support, including uniq_tqualdraw_active_category_slot /
-- uniq_tqualcand_selected_order — both still load-bearing and unchanged) is not
-- modified retroactively. No column or constraint changes — CREATE OR REPLACE
-- FUNCTION only.
--
-- Concurrency: the category row is locked first (SELECT ... FOR UPDATE), so two
-- concurrent Save/correction calls for the same category fully serialize — the
-- second blocks until the first's transaction commits or rolls back. An optimistic
-- concurrency token, p_expected_active_draw_id, additionally protects against two
-- requests both built from the same stale Preview state: a correction must name the
-- exact currently-active draw id it read; an initial Save must pass null and
-- succeed only when no active draw exists yet. Any mismatch fails closed with
-- QUALIFICATION_DRAW_STALE_STATE before any write — no special persisted-failure
-- handling is needed (unlike 013b's rollback conflict path) because this check runs
-- before the first write statement, so an ordinary unhandled RAISE EXCEPTION rolls
-- back nothing but locks — "zero writes" holds trivially.
--
-- Affected Match rows are additionally locked individually, in deterministic id
-- order, before the set-based UPDATE that resolves them — defense in depth against
-- an unrelated, non-category-locked writer (e.g. the ordinary match editor)
-- touching the same row concurrently, mirroring 013b's Match-locking approach.
--
-- Idempotent — safe to re-run after a partial failure (CREATE OR REPLACE FUNCTION
-- plus idempotent REVOKE/GRANT).

create or replace function tournament.save_qualification_draw_assignment(
  p_tournament_id uuid,
  p_category_code text,
  p_candidate_team_ids uuid[],
  p_assignments jsonb,
  p_expected_active_draw_id uuid,
  p_note text,
  p_actor_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = tournament, pg_temp
as $$
declare
  v_category_code text := upper(trim(p_category_code));
  v_category_id uuid;
  v_tournament_status text;
  v_tournament_deleted_at timestamptz;
  v_rule_count int;
  v_rule_method text;
  v_expected_refs text[];
  v_submitted_refs text[];
  v_candidate_count int;
  v_distinct_candidate_count int;
  v_matched_candidate_count int;
  v_assignment_count int;
  v_distinct_assignment_ref_count int;
  v_distinct_assignment_team_count int;
  v_non_candidate_assignment_count int;
  v_active_draw_id uuid;
  v_active_draw_version int;
  v_previous_draw_id uuid;
  v_new_draw_id uuid;
  v_next_version int;
  v_now timestamptz := now();
  v_match_ids uuid[] := '{}';
  v_match_id uuid;
  v_updated_match_ids uuid[];
  v_qualification_slot text := 'group_third_place';
begin
  -- ==========================================================================
  -- 1. Tournament exists, not deleted, active.
  -- ==========================================================================
  select status, deleted_at into v_tournament_status, v_tournament_deleted_at
  from tournament.tournaments
  where id = p_tournament_id;

  if not found or v_tournament_deleted_at is not null then
    raise exception 'QUALIFICATION_DRAW_TOURNAMENT_NOT_FOUND: tournament % not found', p_tournament_id;
  end if;
  if v_tournament_status <> 'active' then
    raise exception 'QUALIFICATION_DRAW_TOURNAMENT_NOT_ACTIVE: tournament % has status "%"', p_tournament_id, v_tournament_status;
  end if;

  -- ==========================================================================
  -- 2. Category belongs to the tournament — resolved AND locked here. This lock
  --    is what serializes concurrent Save/correction calls for the same
  --    category: a second concurrent call blocks on this SELECT ... FOR UPDATE
  --    until the first transaction fully commits or rolls back.
  -- ==========================================================================
  select id into v_category_id
  from tournament.tournament_categories
  where tournament_id = p_tournament_id
    and upper(code) = v_category_code
    and deleted_at is null
  for update;

  if not found then
    raise exception 'QUALIFICATION_DRAW_CATEGORY_NOT_FOUND: category % not found in tournament %', v_category_code, p_tournament_id;
  end if;

  -- ==========================================================================
  -- 3. Category supports the draw_selected qualification rule.
  -- ==========================================================================
  select best_third_placed_count, best_third_placed_method
  into v_rule_count, v_rule_method
  from tournament.tournament_qualification_rules
  where tournament_id = p_tournament_id and category_id = v_category_id;

  if not found or v_rule_method <> 'draw' or v_rule_count <= 0 then
    raise exception 'QUALIFICATION_DRAW_CONFIG_NOT_FOUND: category % has no draw_selected qualification configuration', v_category_code;
  end if;

  select array_agg(v_category_code || '-THIRD-DRAW-' || gs order by gs)
  into v_expected_refs
  from generate_series(1, v_rule_count) as gs;

  -- ==========================================================================
  -- 4. Exactly 3 distinct candidate team IDs, all belonging to this category
  --    and tournament (not soft-deleted).
  -- ==========================================================================
  v_candidate_count := coalesce(array_length(p_candidate_team_ids, 1), 0);
  if v_candidate_count <> 3 then
    raise exception 'QUALIFICATION_DRAW_INVALID_CANDIDATE_COUNT: exactly 3 candidate teams are required (received %)', v_candidate_count;
  end if;

  select count(distinct x) into v_distinct_candidate_count from unnest(p_candidate_team_ids) as x;
  if v_distinct_candidate_count <> 3 then
    raise exception 'QUALIFICATION_DRAW_DUPLICATE_CANDIDATE: duplicate candidate team in candidate list';
  end if;

  select count(*) into v_matched_candidate_count
  from tournament.tournament_teams
  where id = any(p_candidate_team_ids)
    and category_id = v_category_id
    and tournament_id = p_tournament_id
    and deleted_at is null;

  if v_matched_candidate_count <> 3 then
    raise exception 'QUALIFICATION_DRAW_CANDIDATE_NOT_IN_CATEGORY: one or more candidate teams do not belong to category %', v_category_code;
  end if;

  -- ==========================================================================
  -- 5. Exactly 2 distinct assignments (or however many the category's
  --    configuration requires), referencing exactly the configured placeholder
  --    refs, each selecting a team from the confirmed 3 candidates, with no
  --    team occupying two placeholders.
  -- ==========================================================================
  v_assignment_count := jsonb_array_length(p_assignments);
  if v_assignment_count <> v_rule_count then
    raise exception 'QUALIFICATION_DRAW_INVALID_ASSIGNMENT_COUNT: exactly % assignments are required (received %)', v_rule_count, v_assignment_count;
  end if;

  select array_agg(distinct upper(trim(elem->>'source_ref')) order by upper(trim(elem->>'source_ref')))
  into v_submitted_refs
  from jsonb_array_elements(p_assignments) as elem;

  if v_submitted_refs is null or array_length(v_submitted_refs, 1) <> v_assignment_count then
    raise exception 'QUALIFICATION_DRAW_DUPLICATE_ASSIGNMENT_REF: duplicate draw_selected source_ref in assignments';
  end if;

  if v_submitted_refs <> v_expected_refs then
    raise exception 'QUALIFICATION_DRAW_UNKNOWN_ASSIGNMENT_REF: assignments must reference exactly %, got %', v_expected_refs, v_submitted_refs;
  end if;

  select count(distinct trim(elem->>'team_id')) into v_distinct_assignment_team_count
  from jsonb_array_elements(p_assignments) as elem;
  if v_distinct_assignment_team_count <> v_assignment_count then
    raise exception 'QUALIFICATION_DRAW_DUPLICATE_ASSIGNMENT_TEAM: the same team cannot occupy more than one placeholder';
  end if;

  select count(*) into v_non_candidate_assignment_count
  from jsonb_array_elements(p_assignments) as elem
  where trim(elem->>'team_id')::uuid <> all (p_candidate_team_ids);
  if v_non_candidate_assignment_count > 0 then
    raise exception 'QUALIFICATION_DRAW_ASSIGNMENT_NOT_CANDIDATE: a selected team is not among the 3 confirmed candidates';
  end if;

  -- ==========================================================================
  -- 6. Optimistic concurrency check — lock and re-read the current active draw,
  --    validate expected_active_draw_id. Nothing has been written yet, so a
  --    failure here leaves genuinely zero writes.
  -- ==========================================================================
  select id, version into v_active_draw_id, v_active_draw_version
  from tournament.tournament_qualification_draws
  where category_id = v_category_id
    and qualification_slot = v_qualification_slot
    and superseded_at is null
  for update;

  if v_active_draw_id is distinct from p_expected_active_draw_id then
    raise exception 'QUALIFICATION_DRAW_STALE_STATE: expected active draw % but found % — the draw changed since this was last read', p_expected_active_draw_id, v_active_draw_id;
  end if;

  v_previous_draw_id := v_active_draw_id;
  v_next_version := coalesce(v_active_draw_version, 0) + 1;

  -- ==========================================================================
  -- 7. Supersede the previous active draw (kept, not deleted) — append-only.
  -- ==========================================================================
  if v_previous_draw_id is not null then
    update tournament.tournament_qualification_draws
    set superseded_at = v_now
    where id = v_previous_draw_id;
  end if;

  -- ==========================================================================
  -- 8. Insert the new draw.
  -- ==========================================================================
  insert into tournament.tournament_qualification_draws (
    category_id, qualification_slot, slots_available, version, drawn_by, drawn_at, note
  ) values (
    v_category_id, v_qualification_slot, v_rule_count, v_next_version, p_actor_id, v_now, p_note
  )
  returning id into v_new_draw_id;

  -- ==========================================================================
  -- 9. Insert all 3 candidate rows in one set-based statement — is_selected /
  --    draw_order derived from the validated assignments.
  -- ==========================================================================
  insert into tournament.tournament_qualification_draw_candidates (
    draw_id, team_id, group_id, is_selected, draw_order
  )
  select
    v_new_draw_id,
    c.team_id,
    (
      select gm.group_id
      from tournament.tournament_group_members gm
      where gm.team_id = c.team_id
      limit 1
    ),
    (ar.team_id is not null),
    ar.draw_order
  from unnest(p_candidate_team_ids) as c(team_id)
  left join (
    select
      trim(elem->>'team_id')::uuid as team_id,
      (regexp_match(upper(trim(elem->>'source_ref')), '-THIRD-DRAW-([0-9]+)$'))[1]::int as draw_order
    from jsonb_array_elements(p_assignments) as elem
  ) as ar on ar.team_id = c.team_id;

  -- ==========================================================================
  -- 10. Lock affected Match rows in deterministic id order, then resolve them
  --     with one set-based UPDATE. Only home_team_id / away_team_id /
  --     sources_resolved_at / updated_by / updated_at are ever written;
  --     home/away_source_type and home/away_source_ref are never touched.
  --     Scoped to this category and exactly the configured placeholder refs.
  -- ==========================================================================
  for v_match_id in
    select id
    from tournament.tournament_matches
    where category_id = v_category_id
      and deleted_at is null
      and (
        (home_source_type = 'draw_selected' and upper(trim(home_source_ref)) = any (v_expected_refs))
        or (away_source_type = 'draw_selected' and upper(trim(away_source_ref)) = any (v_expected_refs))
      )
    order by id
    for update
  loop
    v_match_ids := array_append(v_match_ids, v_match_id);
  end loop;

  with assignment_rows as (
    select
      upper(trim(elem->>'source_ref')) as source_ref,
      trim(elem->>'team_id')::uuid as team_id
    from jsonb_array_elements(p_assignments) as elem
  )
  update tournament.tournament_matches m
  set
    home_team_id = case
      when m.home_source_type = 'draw_selected' then coalesce(
        (select ar.team_id from assignment_rows ar where ar.source_ref = upper(trim(m.home_source_ref))),
        m.home_team_id
      )
      else m.home_team_id
    end,
    away_team_id = case
      when m.away_source_type = 'draw_selected' then coalesce(
        (select ar.team_id from assignment_rows ar where ar.source_ref = upper(trim(m.away_source_ref))),
        m.away_team_id
      )
      else m.away_team_id
    end,
    sources_resolved_at = case
      when (m.home_source_type = 'draw_selected' and exists (select 1 from assignment_rows ar where ar.source_ref = upper(trim(m.home_source_ref))))
        or (m.away_source_type = 'draw_selected' and exists (select 1 from assignment_rows ar where ar.source_ref = upper(trim(m.away_source_ref))))
      then v_now
      else m.sources_resolved_at
    end,
    updated_by = p_actor_id,
    updated_at = v_now
  where m.id = any (v_match_ids);

  select array_agg(id) into v_updated_match_ids from unnest(v_match_ids) as id;

  -- ==========================================================================
  -- 11. Audit log — mandatory, inside the same transaction. If this insert
  --     fails, everything above (supersede, draw, candidates, Match updates)
  --     rolls back with it.
  -- ==========================================================================
  insert into tournament.tournament_audit_logs (
    tournament_id, admin_id, admin_email, action, entity_type, entity_id, entity_label, new_data
  ) values (
    p_tournament_id,
    p_actor_id,
    p_actor_email,
    'qualification-draws.confirm_manual_placeholder_assignment',
    'qualification-draw',
    v_new_draw_id,
    v_category_code || ' ' || array_to_string(v_expected_refs, ', '),
    jsonb_build_object(
      'category_code', v_category_code,
      'candidate_team_ids', to_jsonb(p_candidate_team_ids),
      'selections', p_assignments,
      'updated_match_ids', to_jsonb(coalesce(v_updated_match_ids, '{}'::uuid[])),
      'source', 'manual_candidate_confirmation',
      'draw_id', v_new_draw_id,
      'version', v_next_version,
      'previous_draw_id', v_previous_draw_id
    )
  );

  return jsonb_build_object(
    'drawId', v_new_draw_id,
    'version', v_next_version,
    'updatedMatchIds', to_jsonb(coalesce(v_updated_match_ids, '{}'::uuid[])),
    'selectedSourceRefs', to_jsonb(v_expected_refs),
    'previousDrawId', v_previous_draw_id
  );
end;
$$;

revoke all on function tournament.save_qualification_draw_assignment(uuid, text, uuid[], jsonb, uuid, text, uuid, text) from public;
revoke execute on function tournament.save_qualification_draw_assignment(uuid, text, uuid[], jsonb, uuid, text, uuid, text) from anon;
revoke execute on function tournament.save_qualification_draw_assignment(uuid, text, uuid[], jsonb, uuid, text, uuid, text) from authenticated;
grant execute on function tournament.save_qualification_draw_assignment(uuid, text, uuid[], jsonb, uuid, text, uuid, text) to service_role;

-- Tournament V2 — Migration 019: Qualification Cutoff Tie Draw within Group
-- Source of truth: TOURNAMENT_V2_DECISION_CHECKLIST.md D-30 (new decision,
-- directed by the system owner in this task — see the addendum added by
-- this PR). Reuses the SAME PATTERN as migrations 007/012/015 (versioned,
-- append-only draw + candidates tables, one active row at a time) but in
-- TWO NEW TABLES, not the existing tournament_qualification_draws/
-- tournament_qualification_draw_candidates (G-U16 cross-group best-third).
--
-- STATUS: DRAFT. Reviewed statically only. NOT applied to any environment
-- (Staging or Production) yet.
--
-- WHY NEW TABLES, NOT ADDITIVE COLUMNS ON THE EXISTING G-U16 DRAW TABLES
-- (verified from source, not assumed):
--   scripts/tournament-v2/012-draw-selected-source-support.sql creates
--     `create unique index uniq_tqualdraw_active_category_slot
--       on tournament.tournament_qualification_draws (category_id, qualification_slot)
--       where superseded_at is null;`
--   This enforces "at most one active draw per (category, slot)" with NO
--   group_id in the key. A Qualification Cutoff Tie Draw is scoped per
--   GROUP, not per category — a category with 4 groups can need 4
--   INDEPENDENT, SIMULTANEOUSLY-ACTIVE cutoff draws. Adding a group_id
--   column and a new qualification_slot value (e.g. 'group_cutoff') would
--   NOT work: every group's cutoff-draw row would still share the same
--   (category_id, 'group_cutoff') key, so the second group's insert would
--   violate this EXISTING index. The only way to make the existing table
--   safe for this scope would be to encode group_id into the
--   qualification_slot text itself (a hack) or modify/replace the index
--   from migration 012 (forbidden — "ห้ามแก้ Migration 007 หรือ Migration
--   เก่า"). Per the task's own instruction — "หรือสร้างตารางใหม่ หากพิสูจน์ได้ว่า
--   การเพิ่มคอลัมน์ลงตารางเดิมทำให้ Constraint/Uniqueness/Workflow ปะปนจนไม่ปลอดภัย" —
--   this migration creates two new tables instead, each independently and
--   correctly scoped by group_id from the start.
--
--   Similarly, tournament.save_qualification_draw_assignment (migration
--   015) resolves `tournament_matches`/`draw_selected` placeholders
--   directly (see its own body) — completely out of scope for a
--   score-cutoff-only feature that must never touch Knockout placeholders.
--   A new RPC is required regardless of table reuse.
--
-- SCOPE: decides which team(s) fill the REMAINING automatic-qualify slots
-- when multiple teams share the exact same points total straddling a
-- group's qualifyRankPerGroup cutoff (see
-- lib/tournament/standings/resolveQualificationCutoff.ts for the exact
-- rule and why H2H/GD/GF/Fair Play/FIFA-ranking must never be used to pick
-- the winner). Never selects a team itself (no randomization) — records
-- what an authorized tournament_super_admin manually confirms after a
-- physical draw conducted at the venue. Never touches
-- tournament_matches, draw_selected placeholders, Knockout structures,
-- goals, cards, reports, or Quick Result.
--
-- Idempotent — safe to re-run after a partial failure (CREATE TABLE IF NOT
-- EXISTS, CREATE OR REPLACE FUNCTION, idempotent REVOKE/GRANT).

-- ============================================================================
-- 19.1 tournament_qualification_cutoff_draws / _candidates
-- ============================================================================
create table if not exists tournament.tournament_qualification_cutoff_draws (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournament.tournaments(id) on delete cascade,
  category_id uuid not null references tournament.tournament_categories(id) on delete cascade,
  group_id uuid not null references tournament.tournament_groups(id) on delete cascade,
  cutoff_position int not null,        -- = qualify_rank_per_group at draw time
  available_slots int not null,        -- slots contested by this draw
  candidate_snapshot text not null,    -- deterministic fingerprint of the tied candidate pool at draw time — see resolveQualificationCutoff.ts buildCandidateSnapshot
  idempotency_key text not null,
  version int not null default 1,
  drawn_by uuid,
  drawn_at timestamptz not null default now(),
  note text,
  superseded_at timestamptz,           -- not null = superseded by a newer version (append-only, never deleted)
  created_at timestamptz not null default now()
);
create index if not exists idx_tqualcutoff_group on tournament.tournament_qualification_cutoff_draws (group_id, version desc);

-- Exactly one active (non-superseded) draw per group — correctly scoped by
-- group_id from the start (see header comment for why the EXISTING G-U16
-- draw table's index cannot express this).
create unique index if not exists uniq_tqualcutoff_active_group
  on tournament.tournament_qualification_cutoff_draws (group_id)
  where superseded_at is null;

create table if not exists tournament.tournament_qualification_cutoff_draw_candidates (
  id uuid primary key default gen_random_uuid(),
  draw_id uuid not null references tournament.tournament_qualification_cutoff_draws(id) on delete cascade,
  team_id uuid not null references tournament.tournament_teams(id) on delete cascade,
  points_at_draw int not null,
  is_selected boolean not null default false,
  draw_order int,
  created_at timestamptz not null default now(),
  unique (draw_id, team_id)
);
create index if not exists idx_tqualcutoffcand_draw on tournament.tournament_qualification_cutoff_draw_candidates (draw_id);

-- ============================================================================
-- RLS — internal audit-trail data, same posture as tournament_qualification_draws.
-- No public policy.
-- ============================================================================
alter table tournament.tournament_qualification_cutoff_draws enable row level security;
alter table tournament.tournament_qualification_cutoff_draw_candidates enable row level security;

-- ============================================================================
-- 19.2 tournament.save_qualification_cutoff_draw — atomic draw-result save RPC
-- ============================================================================
create or replace function tournament.save_qualification_cutoff_draw(
  p_tournament_id uuid,
  p_category_code text,
  p_group_code text,
  p_selected_team_ids uuid[],
  p_expected_active_draw_id uuid,
  p_expected_candidate_snapshot text,
  p_idempotency_key text,
  p_note text,
  p_actor_id uuid,
  p_actor_email text
  -- NOTE: deliberately no p_cutoff_position, p_available_slots, or
  -- p_candidate_team_ids parameter. The RPC computes the authoritative
  -- candidate pool, cutoff position, and available slots itself from
  -- current official (published) results — it never trusts a
  -- caller-supplied cutoff position or slot count (see "ห้ามเชื่อ
  -- availableSlots/cutoff position จาก Client" in the task brief).
)
returns jsonb
language plpgsql
security definer
set search_path = tournament, pg_temp
as $$
declare
  v_category_code text := upper(trim(p_category_code));
  v_group_code text := upper(trim(p_group_code));
  v_category_id uuid;
  v_group_id uuid;
  v_qualify_rank_per_group int;
  v_team_count int;
  v_cutoff_points int;
  v_cluster_team_ids uuid[];
  v_above_team_ids uuid[];
  v_available_slots int;
  v_candidate_snapshot text;
  v_official_match_count int;
  v_expected_match_count int;
  v_existing_draw tournament.tournament_qualification_cutoff_draws%rowtype;
  v_existing_selected uuid[];
  v_active_draw_id uuid;
  v_previous_draw_id uuid;
  v_next_version int;
  v_new_draw_id uuid;
  v_now timestamptz := now();
  v_selected_count int;
  v_distinct_selected_count int;
  v_non_candidate_selected_count int;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'QUALIFICATION_CUTOFF_DRAW_IDEMPOTENCY_KEY_REQUIRED: idempotency_key is required'
      using errcode = 'P0001';
  end if;

  -- ==========================================================================
  -- 1. Resolve category (tournament-scoped, not deleted).
  -- ==========================================================================
  select id into v_category_id
  from tournament.tournament_categories
  where tournament_id = p_tournament_id and upper(code) = v_category_code and deleted_at is null;

  if not found then
    raise exception 'QUALIFICATION_CUTOFF_DRAW_CATEGORY_NOT_FOUND: category % not found in tournament %', v_category_code, p_tournament_id
      using errcode = 'P0001';
  end if;

  -- ==========================================================================
  -- 2. Resolve AND LOCK the group row — this is the concurrency anchor. A
  --    second concurrent save for the SAME group blocks here until the
  --    first transaction commits or rolls back, exactly mirroring Migration
  --    014/015/018's row-lock-first pattern.
  -- ==========================================================================
  select id into v_group_id
  from tournament.tournament_groups
  where category_id = v_category_id and upper(code) = v_group_code
  for update;

  if not found then
    raise exception 'QUALIFICATION_CUTOFF_DRAW_GROUP_NOT_FOUND: group % not found in category %', v_group_code, v_category_code
      using errcode = 'P0001';
  end if;

  -- ==========================================================================
  -- 3. Idempotency — checked immediately after the group lock, BEFORE any
  --    further validation, so a genuine same-key retry short-circuits
  --    without re-deriving the candidate pool.
  -- ==========================================================================
  select * into v_existing_draw
  from tournament.tournament_qualification_cutoff_draws
  where group_id = v_group_id and idempotency_key = p_idempotency_key;

  if found then
    select array_agg(team_id order by team_id) into v_existing_selected
    from tournament.tournament_qualification_cutoff_draw_candidates
    where draw_id = v_existing_draw.id and is_selected = true;

    if coalesce(v_existing_selected, '{}') <> (select array_agg(x order by x) from unnest(p_selected_team_ids) as x) then
      raise exception 'QUALIFICATION_CUTOFF_DRAW_IDEMPOTENCY_PAYLOAD_MISMATCH: idempotency_key already used with a different selection'
        using errcode = 'P0001';
    end if;

    return jsonb_build_object(
      'drawId', v_existing_draw.id,
      'version', v_existing_draw.version,
      'availableSlots', v_existing_draw.available_slots,
      'selectedTeamIds', to_jsonb(coalesce(v_existing_selected, '{}'::uuid[])),
      'idempotent', true
    );
  end if;

  -- ==========================================================================
  -- 4. Qualification rule — qualify_rank_per_group is read from the
  --     approved rule, never accepted as a parameter.
  -- ==========================================================================
  select qualify_rank_per_group into v_qualify_rank_per_group
  from tournament.tournament_qualification_rules
  where tournament_id = p_tournament_id and category_id = v_category_id;

  if not found then
    v_qualify_rank_per_group := 2; -- same default as lib/tournament/services/standings.ts
  end if;

  -- ==========================================================================
  -- 5. Group completeness — round-robin must be fully played (official,
  --     published results only) before any cutoff decision is made.
  -- ==========================================================================
  select count(*) into v_team_count from tournament.tournament_group_members where group_id = v_group_id;
  v_expected_match_count := (v_team_count * (v_team_count - 1)) / 2;

  select count(*) into v_official_match_count
  from tournament.tournament_matches
  where group_id = v_group_id and status = 'finished' and result_workflow_status = 'published' and deleted_at is null;

  if v_official_match_count < v_expected_match_count then
    raise exception 'QUALIFICATION_CUTOFF_DRAW_GROUP_INCOMPLETE: group % has not completed its round-robin (% of % official matches)', v_group_code, v_official_match_count, v_expected_match_count
      using errcode = 'P0001';
  end if;

  -- ==========================================================================
  -- 6. Compute authoritative team points from official (published) results
  --     only — regulation-decided winner_team_id, exactly as
  --     lib/tournament/standings/calculateGroupStandings.ts does. Never
  --     reads tournament_result_submissions (Quick Result) or any draft/
  --     unpublished result.
  -- ==========================================================================
  create temporary table tmp_qualcutoff_points on commit drop as
  select
    gm.team_id,
    coalesce(sum(case when m.winner_team_id = gm.team_id then 3 else 0 end), 0)::int as points
  from tournament.tournament_group_members gm
  left join tournament.tournament_matches m
    on m.group_id = v_group_id
    and m.status = 'finished'
    and m.result_workflow_status = 'published'
    and m.deleted_at is null
    and (m.home_team_id = gm.team_id or m.away_team_id = gm.team_id)
  where gm.group_id = v_group_id
  group by gm.team_id;

  if v_team_count <= v_qualify_rank_per_group then
    raise exception 'QUALIFICATION_CUTOFF_DRAW_NOT_APPLICABLE: group % has no cutoff (team count <= quota)', v_group_code
      using errcode = 'P0001';
  end if;

  select points into v_cutoff_points
  from tmp_qualcutoff_points
  order by points desc, team_id asc
  offset (v_qualify_rank_per_group - 1) limit 1;

  select array_agg(team_id order by team_id) into v_cluster_team_ids from tmp_qualcutoff_points where points = v_cutoff_points;
  select array_agg(team_id order by team_id) into v_above_team_ids from tmp_qualcutoff_points where points > v_cutoff_points;
  v_available_slots := v_qualify_rank_per_group - coalesce(array_length(v_above_team_ids, 1), 0);

  if coalesce(array_length(v_cluster_team_ids, 1), 0) <= v_available_slots then
    raise exception 'QUALIFICATION_CUTOFF_DRAW_NOT_APPLICABLE: group % has no tie cluster straddling the cutoff — no draw is needed', v_group_code
      using errcode = 'P0001';
  end if;

  -- Canonical candidate snapshot — MUST match
  -- resolveQualificationCutoff.ts's buildCandidateSnapshot() format exactly
  -- (sorted, comma-joined team ids) for the staleness comparison below to
  -- mean anything.
  v_candidate_snapshot := 'v1|slots=' || v_available_slots || '|candidates=' ||
    coalesce((select string_agg(x::text, ',' order by x) from unnest(v_cluster_team_ids) as x), '');

  -- ==========================================================================
  -- 7. Stale candidate pool — fail closed BEFORE any write if the pool the
  --     Preview was built against no longer matches the freshly computed
  --     one (e.g. a Score Correction changed a team's points since Preview).
  -- ==========================================================================
  if p_expected_candidate_snapshot is distinct from v_candidate_snapshot then
    raise exception 'QUALIFICATION_CUTOFF_DRAW_STALE_CANDIDATES: candidate pool changed since Preview — expected %, got %', p_expected_candidate_snapshot, v_candidate_snapshot
      using errcode = 'P0001';
  end if;

  -- ==========================================================================
  -- 8. Validate the proposed selection against the authoritative pool —
  --     mirrors validateQualificationDrawSelection() in
  --     resolveQualificationCutoff.ts.
  -- ==========================================================================
  v_selected_count := coalesce(array_length(p_selected_team_ids, 1), 0);
  if v_selected_count <> v_available_slots then
    raise exception 'QUALIFICATION_CUTOFF_DRAW_SELECTION_COUNT_MISMATCH: exactly % team(s) must be selected (received %)', v_available_slots, v_selected_count
      using errcode = 'P0001';
  end if;

  select count(distinct x) into v_distinct_selected_count from unnest(p_selected_team_ids) as x;
  if v_distinct_selected_count <> v_selected_count then
    raise exception 'QUALIFICATION_CUTOFF_DRAW_DUPLICATE_SELECTION: duplicate team in the draw selection'
      using errcode = 'P0001';
  end if;

  select count(*) into v_non_candidate_selected_count
  from unnest(p_selected_team_ids) as x
  where x <> all (v_cluster_team_ids);
  if v_non_candidate_selected_count > 0 then
    raise exception 'QUALIFICATION_CUTOFF_DRAW_SELECTION_NOT_CANDIDATE: a selected team is not in the cutoff tie cluster candidate pool'
      using errcode = 'P0001';
  end if;

  -- ==========================================================================
  -- 9. Optimistic concurrency — lock and re-read the current active draw for
  --     this group, validate expected_active_draw_id. Nothing has been
  --     written yet, so a failure here leaves genuinely zero writes.
  -- ==========================================================================
  select id into v_active_draw_id
  from tournament.tournament_qualification_cutoff_draws
  where group_id = v_group_id and superseded_at is null
  for update;

  if v_active_draw_id is distinct from p_expected_active_draw_id then
    raise exception 'QUALIFICATION_CUTOFF_DRAW_STALE_STATE: expected active draw % but found % — the draw changed since this was last read', p_expected_active_draw_id, v_active_draw_id
      using errcode = 'P0001';
  end if;

  v_previous_draw_id := v_active_draw_id;
  v_next_version := 1;
  if v_previous_draw_id is not null then
    select version + 1 into v_next_version from tournament.tournament_qualification_cutoff_draws where id = v_previous_draw_id;
    update tournament.tournament_qualification_cutoff_draws set superseded_at = v_now where id = v_previous_draw_id;
  end if;

  -- ==========================================================================
  -- 10. Insert the new draw + every cluster member as a candidate row
  --     (is_selected reflects the validated selection).
  -- ==========================================================================
  insert into tournament.tournament_qualification_cutoff_draws (
    tournament_id, category_id, group_id, cutoff_position, available_slots,
    candidate_snapshot, idempotency_key, version, drawn_by, drawn_at, note
  ) values (
    p_tournament_id, v_category_id, v_group_id, v_qualify_rank_per_group, v_available_slots,
    v_candidate_snapshot, p_idempotency_key, v_next_version, p_actor_id, v_now, p_note
  )
  returning id into v_new_draw_id;

  insert into tournament.tournament_qualification_cutoff_draw_candidates (draw_id, team_id, points_at_draw, is_selected)
  select v_new_draw_id, tp.team_id, tp.points, (tp.team_id = any (p_selected_team_ids))
  from tmp_qualcutoff_points tp
  where tp.team_id = any (v_cluster_team_ids);

  -- ==========================================================================
  -- 11. Audit log — mandatory, inside the same transaction.
  -- ==========================================================================
  insert into tournament.tournament_audit_logs (
    tournament_id, admin_id, admin_email, action, entity_type, entity_id, entity_label, old_data, new_data
  ) values (
    p_tournament_id,
    p_actor_id,
    p_actor_email,
    'qualification-cutoff-draw.save',
    'tournament_group',
    v_group_id,
    v_category_code || ' / ' || v_group_code,
    jsonb_build_object('previous_draw_id', v_previous_draw_id),
    jsonb_build_object(
      'draw_id', v_new_draw_id,
      'version', v_next_version,
      'group_code', v_group_code,
      'category_code', v_category_code,
      'cutoff_position', v_qualify_rank_per_group,
      'available_slots', v_available_slots,
      'candidate_team_ids', to_jsonb(v_cluster_team_ids),
      'selected_team_ids', to_jsonb(p_selected_team_ids),
      'candidate_snapshot', v_candidate_snapshot
    )
  );

  return jsonb_build_object(
    'drawId', v_new_draw_id,
    'version', v_next_version,
    'availableSlots', v_available_slots,
    'selectedTeamIds', to_jsonb(p_selected_team_ids),
    'idempotent', false
  );
end;
$$;

comment on function tournament.save_qualification_cutoff_draw(
  uuid, text, text, uuid[], uuid, text, text, text, uuid, text
) is
  'Atomic save of a manual Qualification Cutoff Tie Draw result for one '
  'group (D-30). tournament_super_admin only — see REVOKE/GRANT below. '
  'Locks the target group row before checking idempotency and validating '
  'state. Computes the authoritative candidate pool/cutoff/available-slots '
  'itself from current official published results — never trusts a '
  'caller-supplied candidate list, cutoff position, or slot count. Never '
  'writes tournament_matches, draw_selected placeholders, Knockout '
  'structures, goals, cards, reports, or Quick Result — this function '
  'accepts no parameters describing any of those entities. All writes '
  '(supersede previous draw, insert new draw, insert candidates, audit '
  'log) happen in this single function invocation.';

-- ============================================================================
-- 19.3 RPC security — service_role only
-- ============================================================================
revoke all on function tournament.save_qualification_cutoff_draw(
  uuid, text, text, uuid[], uuid, text, text, text, uuid, text
) from public;

revoke all on function tournament.save_qualification_cutoff_draw(
  uuid, text, text, uuid[], uuid, text, text, text, uuid, text
) from anon;

revoke all on function tournament.save_qualification_cutoff_draw(
  uuid, text, text, uuid[], uuid, text, text, text, uuid, text
) from authenticated;

grant execute on function tournament.save_qualification_cutoff_draw(
  uuid, text, text, uuid[], uuid, text, text, text, uuid, text
) to service_role;

-- This function performs no dynamic SQL and returns only the small jsonb
-- summary object above.

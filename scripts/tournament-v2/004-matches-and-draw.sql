-- Tournament V2 — Phase 1, Migration 004: Matches (core) / Draw Assignments
-- Source of truth: TOURNAMENT_V2_DATA_MODEL.md §2.8, §2.8b. Decision Lock: D-09, D-16 (2026-07-14).
--
-- NOTE: schedule_batch_id has no inline FK here — tournament_schedule_batches doesn't
-- exist yet. The FK constraint is added by 011-scheduling-import-and-views.sql, exactly
-- as the Data Model doc itself specifies (§2.8 comment: "ประกาศ FK จริงหลังตารางนั้นถูกสร้าง").
--
-- Idempotent — safe to re-run after a partial failure.

-- ============================================================================
-- 2.8 tournament_matches (core — DECISION LOCKED D-09: no draw results, D-16: single-step default)
-- ============================================================================
create table if not exists tournament.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournament.tournaments(id) on delete cascade,
  category_id uuid not null references tournament.tournament_categories(id) on delete cascade,
  group_id uuid references tournament.tournament_groups(id) on delete set null,
  round_id uuid references tournament.tournament_knockout_rounds(id) on delete set null,
  stage text not null default 'group'
    check (stage in ('group','round_of_32','round_of_16','quarter_final','semi_final','third_place','final','custom')),
  match_code text not null,
  match_no int,
  matchday text,
  match_date date,
  match_time text,
  venue_id uuid references tournament.tournament_venues(id) on delete set null,
  court_id uuid references tournament.tournament_courts(id) on delete set null,
  home_team_id uuid references tournament.tournament_teams(id) on delete set null,
  away_team_id uuid references tournament.tournament_teams(id) on delete set null,
  home_source_type text
    check (home_source_type in ('team','group_slot','group_rank','match_winner','match_loser','best_ranked','bye','tbd')),
  home_source_ref text,
  away_source_type text
    check (away_source_type in ('team','group_slot','group_rank','match_winner','match_loser','best_ranked','bye','tbd')),
  away_source_ref text,
  sources_resolved_at timestamptz,
  regulation_home_score int,          -- DECISION LOCKED (D-09): separate from penalty score
  regulation_away_score int,
  penalty_home_score int,             -- DECISION LOCKED (D-09): renamed from home_penalty_score
  penalty_away_score int,
  decided_by text                     -- DECISION LOCKED (D-09): 'regulation' | 'penalty'
    check (decided_by in ('regulation','penalty')),
  winner_team_id uuid references tournament.tournament_teams(id) on delete set null,
  status text not null default 'scheduled'
    check (status in ('scheduled','ready','in_progress','finished','postponed','cancelled','abandoned','bye','void')),
  result_workflow_status text not null default 'not_started'   -- DECISION LOCKED (D-16): no approved/rejected, adds previewed
    check (result_workflow_status in
      ('not_started','draft','previewed','submitted','published','correction_requested','corrected')),
  schedule_status text not null default 'draft'
    check (schedule_status in ('draft','validated','published','revision_required','archived')),
  result_policy text not null default 'single_step'   -- DECISION LOCKED (D-16): single_step is the only policy used in practice
    check (result_policy in ('single_step','two_step','central_review')),
  result_type text not null default 'normal'
    check (result_type in ('normal','bye','walkover','penalty_decided')),
  note text,
  schedule_batch_id uuid,             -- FK added in 011-scheduling-import-and-views.sql (deferred, see note above)
  version int not null default 1,     -- optimistic lock for schedule/fixture edits (separate from result_submissions.version)
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tournament_id, match_code),
  check (home_team_id is not null or away_team_id is not null or status in ('scheduled','postponed','cancelled')),
  check (status <> 'finished' or winner_team_id is not null)  -- DECISION LOCKED (D-09): no draws — finished matches always have a winner
);
create index if not exists idx_tmatches_category_stage on tournament.tournament_matches (category_id, stage);
create index if not exists idx_tmatches_group on tournament.tournament_matches (group_id);
create index if not exists idx_tmatches_round on tournament.tournament_matches (round_id);
create index if not exists idx_tmatches_date on tournament.tournament_matches (match_date);
create index if not exists idx_tmatches_home_source on tournament.tournament_matches (home_source_type, home_source_ref) where home_team_id is null;
create index if not exists idx_tmatches_away_source on tournament.tournament_matches (away_source_type, away_source_ref) where away_team_id is null;

-- ============================================================================
-- 2.8b tournament_draw_assignments (append-only draw history)
-- ============================================================================
create table if not exists tournament.tournament_draw_assignments (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references tournament.tournament_categories(id) on delete cascade,
  group_id uuid not null references tournament.tournament_groups(id) on delete cascade,
  slot_code text not null,
  team_id uuid not null references tournament.tournament_teams(id) on delete cascade,
  draw_order int,
  version int not null default 1,
  note text,
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  superseded_at timestamptz            -- not null = superseded by a newer version (append-only, never updated in place)
);
create index if not exists idx_tdraw_group_slot on tournament.tournament_draw_assignments (group_id, slot_code, version desc);
create index if not exists idx_tdraw_category on tournament.tournament_draw_assignments (category_id);

-- ============================================================================
-- RLS
-- ============================================================================
alter table tournament.tournament_matches enable row level security;
alter table tournament.tournament_draw_assignments enable row level security;

-- tournament_matches has NO raw public policy: public visibility depends on
-- result_workflow_status ('published' or not-yet-played only, DATA_MODEL §4 point 2/5).
-- Public access is via tournament.public_matches_view only, created in
-- 011-scheduling-import-and-views.sql once all its dependent tables exist.

-- tournament_draw_assignments: explicitly NO public policy (DATA_MODEL §4 point 2 —
-- internal import-process data, not competition data). Service role only.

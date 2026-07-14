-- Tournament V2 — Phase 1, Migration 011: Schedule Batches/Import/Versions + Deferred FK + Public Views
-- Source of truth: TOURNAMENT_V2_DATA_MODEL.md §2.21, §4 (RLS Strategy).
-- This is the last migration file — it adds the FK deferred since 004-matches-and-draw.sql
-- and creates the two public views that everything else depends on.
-- Idempotent — safe to re-run after a partial failure (the ALTER TABLE guards against
-- re-adding a constraint that already exists).

-- ============================================================================
-- 2.21 tournament_schedule_batches / tournament_schedule_import_rows / tournament_schedule_versions
-- ============================================================================
create table if not exists tournament.tournament_schedule_batches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournament.tournaments(id) on delete cascade,
  batch_type text not null check (batch_type in ('fixture_import','draw_import')),
  file_name text,
  status text not null default 'preview' check (status in ('preview','saved','rolled_back')),
  total_rows int not null default 0,
  valid_rows int not null default 0,
  warning_rows int not null default 0,
  error_rows int not null default 0,
  uploaded_by uuid,
  uploaded_at timestamptz not null default now(),
  saved_at timestamptz,
  rolled_back_at timestamptz,
  rolled_back_by uuid
);

create table if not exists tournament.tournament_schedule_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references tournament.tournament_schedule_batches(id) on delete cascade,
  row_no int not null,
  raw_payload jsonb not null,
  match_code text,
  status text not null check (status in ('valid','warning','error')),
  messages jsonb not null default '[]',       -- [{severity, code, message}, ...]
  matched_match_id uuid references tournament.tournament_matches(id) on delete set null,
  action text check (action in ('create','update','skip')),
  created_at timestamptz not null default now()
);
create index if not exists idx_timportrow_batch on tournament.tournament_schedule_import_rows (batch_id, row_no);

create table if not exists tournament.tournament_schedule_versions (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references tournament.tournament_categories(id) on delete cascade,
  stage text not null,                         -- 'group', a stage enum value, or 'all'
  version int not null default 1,
  status text not null default 'draft'
    check (status in ('draft','validated','published','revision_required','archived')),
  published_at timestamptz,
  published_by uuid,
  batch_id uuid references tournament.tournament_schedule_batches(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  unique (category_id, stage, version)
);
create index if not exists idx_tschedver_category_stage on tournament.tournament_schedule_versions (category_id, stage, version desc);

-- Deferred FK from 004-matches-and-draw.sql, now that tournament_schedule_batches exists.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_tmatches_schedule_batch'
  ) then
    alter table tournament.tournament_matches
      add constraint fk_tmatches_schedule_batch
      foreign key (schedule_batch_id) references tournament.tournament_schedule_batches(id) on delete set null;
  end if;
end $$;

-- ============================================================================
-- RLS for the 3 tables above — DATA_MODEL §4 point 2: internal import-process
-- data, no public policy (same reasoning as tournament_draw_assignments).
-- ============================================================================
alter table tournament.tournament_schedule_batches enable row level security;
alter table tournament.tournament_schedule_import_rows enable row level security;
alter table tournament.tournament_schedule_versions enable row level security;

-- ============================================================================
-- Public views — DATA_MODEL §4 points 2 and 4.
--
-- These run with the view owner's privileges (default Postgres view behaviour,
-- no `security_invoker`), which is intentional here: tournament_matches and
-- tournament_players have NO public RLS policy on the raw table, so the view's
-- WHERE clause and column list ARE the entire security boundary for public access.
-- Do not add a raw public SELECT policy to either table — that would bypass this.
-- ============================================================================

-- Public sees a match only once its result is published, or before it's been played.
-- Exact condition as approved in the Phase 1 plan §5 (RLS Plan).
create or replace view tournament.public_matches_view as
select *
from tournament.tournament_matches
where deleted_at is null
  and (result_workflow_status = 'published' or status = 'scheduled');

grant select on tournament.public_matches_view to anon, authenticated;

-- Public roster view — excludes birth_date (DATA_MODEL §4 point 4: youth athlete data).
create or replace view tournament.public_players_view as
select
  id,
  tournament_id,
  category_id,
  team_id,
  player_code,
  full_name,
  shirt_no,
  active,
  created_at,
  updated_at
from tournament.tournament_players
where deleted_at is null;

grant select on tournament.public_players_view to anon, authenticated;

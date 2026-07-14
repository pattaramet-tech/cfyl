-- Tournament V2 — Phase 1, Migration 003: Groups / Group Members / Knockout Rounds
-- Source of truth: TOURNAMENT_V2_DATA_MODEL.md §2.7 and §2.15.
--
-- NOTE ON ORDERING: tournament_knockout_rounds is §2.15 in the Data Model doc (defined
-- after tournament_matches, §2.8) but tournament_matches.round_id references it — running
-- the doc's DDL in literal section order would fail with an undefined-table error.
-- This migration creates tournament_knockout_rounds here (before 004-matches-and-draw.sql)
-- so the FK resolves; the table definition itself is unchanged from §2.15.
--
-- Idempotent — safe to re-run after a partial failure.

-- ============================================================================
-- 2.7 tournament_groups / tournament_group_members (Group Slot model)
-- ============================================================================
create table if not exists tournament.tournament_groups (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournament.tournaments(id) on delete cascade,
  category_id uuid not null references tournament.tournament_categories(id) on delete cascade,
  name text not null,
  code text not null,                 -- required for group_code in Excel (e.g. "A")
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, code)
);
create index if not exists idx_tgroups_category on tournament.tournament_groups (category_id, sort_order);

create table if not exists tournament.tournament_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references tournament.tournament_groups(id) on delete cascade,
  slot_code text not null,             -- e.g. "A-S1" — position in group before the draw
  team_id uuid references tournament.tournament_teams(id) on delete set null,  -- nullable: empty before draw
  sort_order int not null default 0,
  draw_order int,                      -- cache of latest tournament_draw_assignments.draw_order
  assignment_version int not null default 1,  -- cache of latest tournament_draw_assignments.version (optimistic lock)
  resolved_at timestamptz,             -- when the real team was resolved into this slot (null = not drawn yet)
  resolved_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, slot_code),
  unique (group_id, team_id)
);
create index if not exists idx_tgroupmembers_team on tournament.tournament_group_members (team_id) where team_id is not null;

-- ============================================================================
-- 2.15 tournament_knockout_rounds (round labels only — matches live in tournament_matches)
-- ============================================================================
create table if not exists tournament.tournament_knockout_rounds (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournament.tournaments(id) on delete cascade,
  category_id uuid not null references tournament.tournament_categories(id) on delete cascade,
  name text not null,
  stage text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- RLS
-- ============================================================================
alter table tournament.tournament_groups enable row level security;
alter table tournament.tournament_group_members enable row level security;
alter table tournament.tournament_knockout_rounds enable row level security;

drop policy if exists tgroups_public_read on tournament.tournament_groups;
create policy tgroups_public_read on tournament.tournament_groups for select using (true);

-- Only resolved slots (team_id filled in) are public — unresolved Group Slots are
-- an internal scheduling concern per DATA_MODEL §4 point 2.
drop policy if exists tgroupmembers_public_read on tournament.tournament_group_members;
create policy tgroupmembers_public_read on tournament.tournament_group_members for select using (team_id is not null);

drop policy if exists tknockoutrounds_public_read on tournament.tournament_knockout_rounds;
create policy tknockoutrounds_public_read on tournament.tournament_knockout_rounds for select using (true);

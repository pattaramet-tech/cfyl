-- Tournament V2 — Phase 1, Migration 002: Teams / Players / Staff
-- Source of truth: TOURNAMENT_V2_DATA_MODEL.md §2.4-2.6. Decision Lock: D-04, D-05 (2026-07-14).
-- Idempotent — safe to re-run after a partial failure.

-- ============================================================================
-- 2.4 tournament_teams — DECISION LOCKED (D-04): no School/Team Master, no FK to League teams
-- ============================================================================
create table if not exists tournament.tournament_teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournament.tournaments(id) on delete cascade,
  category_id uuid not null references tournament.tournament_categories(id) on delete cascade,
  school_name text,                    -- no FK to any master registry (D-04) — duplicates across categories allowed
  name text not null,
  short_name text,
  team_code text not null,
  logo_url text,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (category_id, team_code)
);
create index if not exists idx_tteams_category on tournament.tournament_teams (category_id) where deleted_at is null;

-- ============================================================================
-- 2.5 tournament_players — DECISION LOCKED (D-05): no person_id, no cross-tournament link
-- ============================================================================
create table if not exists tournament.tournament_players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournament.tournaments(id) on delete cascade,
  category_id uuid not null references tournament.tournament_categories(id) on delete cascade,
  team_id uuid not null references tournament.tournament_teams(id) on delete cascade,
  player_code text not null,
  full_name text not null,
  birth_date date,
  shirt_no int,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tournament_id, player_code),
  unique (team_id, shirt_no)
);

-- ============================================================================
-- 2.6 tournament_staff
-- ============================================================================
create table if not exists tournament.tournament_staff (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournament.tournaments(id) on delete cascade,
  team_id uuid not null references tournament.tournament_teams(id) on delete cascade,
  full_name text not null,
  role text not null default 'coach',
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- RLS
-- ============================================================================
alter table tournament.tournament_teams enable row level security;
alter table tournament.tournament_players enable row level security;
alter table tournament.tournament_staff enable row level security;

drop policy if exists tteams_public_read on tournament.tournament_teams;
create policy tteams_public_read on tournament.tournament_teams for select using (deleted_at is null);

-- tournament_players has NO raw public policy: DATA_MODEL §4 point 4 requires
-- birth_date to stay hidden from public. Public access is via
-- tournament.public_players_view only, created in 011-scheduling-import-and-views.sql
-- once all its dependent tables exist. Service role bypasses RLS for admin reads.

-- tournament_staff not explicitly listed as public in DATA_MODEL §4; extended here
-- as non-sensitive roster data per the Phase 1 plan (same reasoning as venues/courts).
drop policy if exists tstaff_public_read on tournament.tournament_staff;
create policy tstaff_public_read on tournament.tournament_staff for select using (active = true);

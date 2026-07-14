-- Tournament V2 — Phase 1, Migration 009: RBAC (User Profiles / Role Assignments / Match Officials)
-- Source of truth: TOURNAMENT_V2_DATA_MODEL.md §2.17-2.18. Decision Lock: D-03 (2026-07-14).
--
-- Phase 1 only creates these tables — no rows are seeded here (no super_admin, no
-- venue_managers, no Dedicated Result-entry Account row). Seeding is Phase 3.
--
-- Idempotent — safe to re-run after a partial failure.

-- ============================================================================
-- 2.17 tournament_user_profiles / tournament_role_assignments
-- ============================================================================
create table if not exists tournament.tournament_user_profiles (
  id uuid primary key,                 -- = auth.uid() from League Supabase Identity Provider (Target Architecture §5)
  email text not null,
  full_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tournament.tournament_role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references tournament.tournament_user_profiles(id) on delete cascade,
  role text not null check (role in
    ('tournament_super_admin','central_control','venue_manager','result_operator','match_official','read_only')),
  tournament_id uuid references tournament.tournaments(id) on delete cascade,
  venue_id uuid references tournament.tournament_venues(id) on delete cascade,
  category_id uuid references tournament.tournament_categories(id) on delete cascade,
  match_id uuid references tournament.tournament_matches(id) on delete cascade,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_trole_user on tournament.tournament_role_assignments (user_id);
create index if not exists idx_trole_venue on tournament.tournament_role_assignments (venue_id) where venue_id is not null;
create index if not exists idx_trole_category on tournament.tournament_role_assignments (category_id) where category_id is not null;

-- DECISION LOCKED (D-03): `result_operator` is the Dedicated Shared Tournament
-- Result-entry Account — one tournament_user_profiles row (not per-individual) with a
-- role_assignments row scoped only to tournament_id (no fixed venue/category/match,
-- since it picks venue/match in-app every session). Non-repudiation is compensated by
-- audit logging session_id/venue_id/match_id/device metadata on every mutation.

-- ============================================================================
-- 2.18 tournament_match_officials
-- ============================================================================
create table if not exists tournament.tournament_match_officials (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references tournament.tournament_matches(id) on delete cascade,
  user_id uuid not null references tournament.tournament_user_profiles(id) on delete cascade,
  role_note text,
  created_at timestamptz not null default now(),
  unique (match_id, user_id)
);

-- ============================================================================
-- RLS — DATA_MODEL §4 point 5: no public policy at all for RBAC tables.
-- Accessible only via Service Role after authorizeVenueScope() passes (Phase 3+).
-- ============================================================================
alter table tournament.tournament_user_profiles enable row level security;
alter table tournament.tournament_role_assignments enable row level security;
alter table tournament.tournament_match_officials enable row level security;

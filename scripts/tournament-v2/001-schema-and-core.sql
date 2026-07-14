-- Tournament V2 — Phase 1, Migration 001: Schema + Core Entities
-- Run this in the Supabase SQL Editor of the TOURNAMENT project (never League).
-- Source of truth: TOURNAMENT_V2_DATA_MODEL.md §2.1-2.3c. Decision Lock: D-01 (2026-07-14).
-- Idempotent — safe to re-run after a partial failure.

create schema if not exists tournament;

-- ============================================================================
-- Schema-level grants — REQUIRED, easy to miss: unlike Supabase's built-in
-- `public` schema, a custom schema like `tournament` gets NO default grants for
-- anon/authenticated/service_role. Without this block, every RLS policy in every
-- migration file below would be unreachable (table-level GRANT SELECT is a
-- separate check from row-level RLS — you need both to actually see a row).
-- ALTER DEFAULT PRIVILEGES applies to tables created by this same role (the one
-- running these migrations, typically `postgres`/project owner) in all FILES
-- that follow, so this only needs to run once, here, before any table exists.
-- service_role already bypasses RLS at the Supabase platform level, but still
-- needs schema USAGE + table grants to reach the `tournament` schema at all.
-- ============================================================================
grant usage on schema tournament to anon, authenticated, service_role;
alter default privileges in schema tournament grant select on tables to anon, authenticated;
alter default privileges in schema tournament grant all on tables to service_role;
alter default privileges in schema tournament grant all on sequences to service_role;
alter default privileges in schema tournament grant usage on sequences to anon, authenticated;

-- ============================================================================
-- 2.1 tournaments
-- ============================================================================
create table if not exists tournament.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  status text not null default 'upcoming' check (status in ('upcoming','active','completed','archived')),
  start_date date,
  end_date date,
  organizer text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists tournaments_slug_key on tournament.tournaments (slug) where deleted_at is null;

-- ============================================================================
-- 2.2 tournament_categories (replaces age_groups, adds gender)
-- ============================================================================
create table if not exists tournament.tournament_categories (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournament.tournaments(id) on delete cascade,
  code text not null,                 -- e.g. U14B, U14G, U16-MIXED
  name text not null,
  gender text not null default 'mixed' check (gender in ('male','female','mixed')),
  sort_order int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tournament_id, code)
);

-- ============================================================================
-- 2.3 tournament_venues
-- ============================================================================
create table if not exists tournament.tournament_venues (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournament.tournaments(id) on delete cascade,
  name text not null,
  code text not null,                 -- short reference for Excel, e.g. "V1" (separate from slug)
  slug text not null,                 -- for /tournament/venues/[venueSlug]
  address text,
  sort_order int not null default 0,   -- display order "สนามที่ 1-4"
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, slug),
  unique (tournament_id, code)
);

-- ============================================================================
-- 2.3b tournament_courts
-- ============================================================================
create table if not exists tournament.tournament_courts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references tournament.tournament_venues(id) on delete cascade,
  code text not null,                -- e.g. "C1" for court_code in Excel
  name text not null,                -- e.g. "คอร์ต A", "คอร์ต B"
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (venue_id, code)
);

-- ============================================================================
-- 2.3c tournament_category_venues (Category <-> Venue mapping, config not hardcode)
-- ============================================================================
create table if not exists tournament.tournament_category_venues (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references tournament.tournament_categories(id) on delete cascade,
  venue_id uuid not null references tournament.tournament_venues(id) on delete cascade,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  unique (category_id, venue_id)
);

-- ============================================================================
-- RLS — all tables enabled, public SELECT only, no write policy anywhere
-- (writes go through the Tournament service-role client server-side only)
-- ============================================================================
alter table tournament.tournaments enable row level security;
alter table tournament.tournament_categories enable row level security;
alter table tournament.tournament_venues enable row level security;
alter table tournament.tournament_courts enable row level security;
alter table tournament.tournament_category_venues enable row level security;

drop policy if exists tournaments_public_read on tournament.tournaments;
create policy tournaments_public_read on tournament.tournaments for select using (deleted_at is null);

drop policy if exists tcategories_public_read on tournament.tournament_categories;
create policy tcategories_public_read on tournament.tournament_categories for select using (deleted_at is null);

-- tournament_venues/courts/category_venues have no deleted_at column and are not
-- explicitly listed as public in TOURNAMENT_V2_DATA_MODEL.md §4 — extended here as
-- non-sensitive schedule/roster data per the Phase 1 plan. Flag if any should be locked down.
drop policy if exists tvenues_public_read on tournament.tournament_venues;
create policy tvenues_public_read on tournament.tournament_venues for select using (true);

drop policy if exists tcourts_public_read on tournament.tournament_courts;
create policy tcourts_public_read on tournament.tournament_courts for select using (true);

drop policy if exists tcategory_venues_public_read on tournament.tournament_category_venues;
create policy tcategory_venues_public_read on tournament.tournament_category_venues for select using (true);

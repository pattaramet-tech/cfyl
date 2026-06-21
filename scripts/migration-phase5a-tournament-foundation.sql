-- Phase 5A: Tournament Mode Foundation
-- Run this in the Supabase SQL Editor.
-- Additive only — does NOT change any existing League behaviour.

-- 1) seasons.competition_type  (existing rows become 'league')
alter table public.seasons
  add column if not exists competition_type text not null default 'league';
-- allowed values: 'league' | 'tournament' | 'mixed'

-- 2) matches.stage  (nullable; null = league, unchanged). Forward-prep for 5B.
alter table public.matches
  add column if not exists stage text;
-- future values: group | round_of_16 | quarter_final | semi_final | final | third_place

-- 3) tournament_groups
create table if not exists public.tournament_groups (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  age_group_id uuid not null references public.age_groups(id) on delete cascade,
  name text not null,
  code text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tgroups_season_age
  on public.tournament_groups (season_id, age_group_id, sort_order);

-- 4) tournament_group_teams
create table if not exists public.tournament_group_teams (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.tournament_groups(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (group_id, team_id)
);
create index if not exists idx_tgroup_teams_group on public.tournament_group_teams (group_id);
create index if not exists idx_tgroup_teams_team on public.tournament_group_teams (team_id);

-- RLS: public read (like teams/matches); writes only via service role (no write policy)
alter table public.tournament_groups enable row level security;
alter table public.tournament_group_teams enable row level security;

drop policy if exists tgroups_public_read on public.tournament_groups;
create policy tgroups_public_read on public.tournament_groups for select using (true);

drop policy if exists tgroup_teams_public_read on public.tournament_group_teams;
create policy tgroup_teams_public_read on public.tournament_group_teams for select using (true);

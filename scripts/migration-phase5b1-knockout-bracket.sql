-- Phase 5B.1: Knockout bracket + advancement
-- Run this in the Supabase SQL Editor. Additive only; League Mode unaffected.

-- 1) knockout_rounds
create table if not exists public.knockout_rounds (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  age_group_id uuid not null references public.age_groups(id) on delete cascade,
  name text not null,
  stage text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_knockout_rounds_season_age on public.knockout_rounds (season_id, age_group_id, sort_order);

-- 2) bracket_matches
create table if not exists public.bracket_matches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  age_group_id uuid not null references public.age_groups(id) on delete cascade,
  round_id uuid not null references public.knockout_rounds(id) on delete cascade,
  match_id uuid references public.matches(id) on delete set null,
  bracket_position integer not null default 0,
  home_source_type text,
  home_source_ref text,
  away_source_type text,
  away_source_ref text,
  home_team_id uuid references public.teams(id) on delete set null,
  away_team_id uuid references public.teams(id) on delete set null,
  winner_to_bracket_match_id uuid references public.bracket_matches(id) on delete set null,
  winner_to_slot text check (winner_to_slot in ('home','away')),
  loser_to_bracket_match_id uuid references public.bracket_matches(id) on delete set null,
  loser_to_slot text check (loser_to_slot in ('home','away')),
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_bracket_matches_season_age on public.bracket_matches (season_id, age_group_id, bracket_position);
create index if not exists idx_bracket_matches_round on public.bracket_matches (round_id);

-- 3) matches.winner_team_id (penalty / draw decider for knockout)
alter table public.matches add column if not exists winner_team_id uuid references public.teams(id) on delete set null;

-- RLS: public read (for 5B.2 public pages); writes via service role only
alter table public.knockout_rounds enable row level security;
alter table public.bracket_matches enable row level security;
drop policy if exists kr_public_read on public.knockout_rounds;
create policy kr_public_read on public.knockout_rounds for select using (true);
drop policy if exists bm_public_read on public.bracket_matches;
create policy bm_public_read on public.bracket_matches for select using (true);

-- Tournament V2 — Phase 1, Migration 005: Match Goals / Cards / Reports
-- Source of truth: TOURNAMENT_V2_DATA_MODEL.md §2.9-2.11. Decision Lock: D-09 (2026-07-14).
-- Idempotent — safe to re-run after a partial failure.

-- ============================================================================
-- 2.9 tournament_match_goals — regulation play only, penalty shootout goals NOT recorded here (D-09)
-- ============================================================================
create table if not exists tournament.tournament_match_goals (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references tournament.tournament_matches(id) on delete cascade,
  player_id uuid references tournament.tournament_players(id) on delete set null,
  team_id uuid not null references tournament.tournament_teams(id),
  minute int,
  is_own_goal boolean not null default false,
  goals int not null default 1,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tgoals_match on tournament.tournament_match_goals (match_id);

-- ============================================================================
-- 2.10 tournament_match_cards
-- ============================================================================
create table if not exists tournament.tournament_match_cards (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references tournament.tournament_matches(id) on delete cascade,
  player_id uuid not null references tournament.tournament_players(id) on delete cascade,
  team_id uuid not null references tournament.tournament_teams(id),
  card_type text not null check (card_type in ('yellow','red','second_yellow')),
  minute int,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, player_id, card_type)
);
create index if not exists idx_tcards_match on tournament.tournament_match_cards (match_id);

-- ============================================================================
-- 2.11 tournament_match_reports
-- ============================================================================
create table if not exists tournament.tournament_match_reports (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references tournament.tournament_matches(id) on delete cascade,
  report text,
  submitted_by uuid,
  submitted_at timestamptz not null default now()
);

-- ============================================================================
-- RLS
-- ============================================================================
alter table tournament.tournament_match_goals enable row level security;
alter table tournament.tournament_match_cards enable row level security;
alter table tournament.tournament_match_reports enable row level security;

-- tournament_match_goals/tournament_match_cards: DATA_MODEL §4 point 2 says public
-- sees these "แบบสรุปนับจำนวน" (aggregate counts only) — that's a view/RPC shape, not
-- a raw row policy (raw rows expose per-player/per-minute detail). Deferred to Phase 9
-- (Public Pages, the first real consumer) per the Phase 1 plan. No public policy here.

-- tournament_match_reports: not listed as public anywhere in DATA_MODEL §4 — free-text
-- report content, kept service-role-only by default. No public policy here.

-- Tournament V2 — Phase 1, Migration 006: Discipline (Suspension Trigger / Serving)
-- Source of truth: TOURNAMENT_V2_DATA_MODEL.md §2.12. Decision Lock: D-06 (2026-07-14).
--
-- DECISION LOCKED (D-06): card-count/type based suspension rules (FIFA-derived reference
-- doc), NOT the League 2/4/6/8 points-threshold formula. Fair-play Score is a COMPUTED
-- value (read from tournament_match_cards by calculateFairPlayScore() in a later phase) —
-- it has no stored table/column and is intentionally not created here.
--
-- Idempotent — safe to re-run after a partial failure.

-- ============================================================================
-- 2.12 tournament_suspension_events / tournament_suspension_serving_matches
-- ============================================================================
create table if not exists tournament.tournament_suspension_events (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournament.tournaments(id) on delete cascade,
  category_id uuid not null references tournament.tournament_categories(id) on delete cascade,
  player_id uuid not null references tournament.tournament_players(id) on delete cascade,
  team_id uuid not null references tournament.tournament_teams(id),
  trigger_match_id uuid references tournament.tournament_matches(id) on delete set null,
  event_type text not null check (event_type in
    ('accumulated_two_yellow','second_yellow_same_match','direct_red','manual')),
  ban_matches int not null default 1,
  status text not null default 'pending' check (status in ('pending','active','served','cancelled','appealed')),
  is_manual_override boolean not null default false,
  created_by uuid,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tsusp_player on tournament.tournament_suspension_events (player_id, tournament_id);

create table if not exists tournament.tournament_suspension_serving_matches (
  id uuid primary key default gen_random_uuid(),
  suspension_event_id uuid not null references tournament.tournament_suspension_events(id) on delete cascade,
  match_id uuid not null references tournament.tournament_matches(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','served','skipped_bye','skipped_postponed','skipped_cancelled')),
  created_at timestamptz not null default now(),
  unique (suspension_event_id, match_id)
);

-- ============================================================================
-- RLS — no public policy: D-12 (public disclosure scope for discipline data) is
-- still an open, unanswered decision. Locked down (service role only) until answered.
-- ============================================================================
alter table tournament.tournament_suspension_events enable row level security;
alter table tournament.tournament_suspension_serving_matches enable row level security;

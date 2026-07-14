-- Tournament V2 — Phase 1, Migration 007: Standing Rules / Qualification / Qualification Draws
-- Source of truth: TOURNAMENT_V2_DATA_MODEL.md §2.13, §2.14, §2.14b.
-- Decision Lock: D-09 (tiebreak order, no draw), D-07/D-29 (best-third-place method + G-U16 draw override).
-- Idempotent — safe to re-run after a partial failure.

-- ============================================================================
-- 2.13 tournament_standing_rules
-- ============================================================================
create table if not exists tournament.tournament_standing_rules (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournament.tournaments(id) on delete cascade,
  category_id uuid references tournament.tournament_categories(id) on delete cascade, -- null = applies to all categories
  points_win int not null default 3,
  points_draw int not null default 1,       -- DECISION LOCKED (D-09): UNUSED — no draw results exist; kept for backward-compat only
  points_loss int not null default 0,
  tiebreak_order jsonb not null default
    '["points","head_to_head_points","head_to_head_goal_diff","head_to_head_goals_for","group_goal_diff","group_goals_for","fair_play","lot"]',
  fair_play_enabled boolean not null default true,
  lot_enabled boolean not null default true,
  mini_table_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 2.14 tournament_qualification_rules / tournament_standing_overrides
-- ============================================================================
create table if not exists tournament.tournament_qualification_rules (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournament.tournaments(id) on delete cascade,
  category_id uuid not null references tournament.tournament_categories(id) on delete cascade,
  qualify_rank_per_group int not null default 2,
  best_third_placed_count int not null default 0,
  best_third_placed_method text not null default 'ranked'   -- DECISION LOCKED (D-07/D-29): 'ranked' or 'draw' (Category Override, e.g. G-U16)
    check (best_third_placed_method in ('ranked','draw')),
  cross_group_comparison boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tournament.tournament_standing_overrides (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references tournament.tournament_groups(id) on delete cascade,
  team_id uuid not null references tournament.tournament_teams(id) on delete cascade,
  override_rank int not null,
  reason text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (group_id, team_id)
);

-- ============================================================================
-- 2.14b tournament_qualification_draws / tournament_qualification_draw_candidates (D-29)
-- ============================================================================
create table if not exists tournament.tournament_qualification_draws (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references tournament.tournament_categories(id) on delete cascade,
  qualification_slot text not null,          -- pool label, e.g. 'group_third_place'
  slots_available int not null,              -- how many advance from this pool, e.g. 2 (G-U16: draw 2 of 3)
  version int not null default 1,
  drawn_by uuid,
  drawn_at timestamptz not null default now(),
  note text,
  superseded_at timestamptz                  -- not null = superseded by a newer version (append-only)
);
create index if not exists idx_tqualdraw_category on tournament.tournament_qualification_draws (category_id, qualification_slot, version desc);

create table if not exists tournament.tournament_qualification_draw_candidates (
  id uuid primary key default gen_random_uuid(),
  draw_id uuid not null references tournament.tournament_qualification_draws(id) on delete cascade,
  team_id uuid not null references tournament.tournament_teams(id) on delete cascade,
  group_id uuid references tournament.tournament_groups(id) on delete set null,   -- source group, for audit
  is_selected boolean not null default false,   -- true = drawn, advances
  draw_order int,
  created_at timestamptz not null default now(),
  unique (draw_id, team_id)
);
create index if not exists idx_tqualcand_draw on tournament.tournament_qualification_draw_candidates (draw_id);

-- ============================================================================
-- RLS
-- ============================================================================
alter table tournament.tournament_standing_rules enable row level security;
alter table tournament.tournament_qualification_rules enable row level security;
alter table tournament.tournament_standing_overrides enable row level security;
alter table tournament.tournament_qualification_draws enable row level security;
alter table tournament.tournament_qualification_draw_candidates enable row level security;

-- standing_rules/qualification_rules: config, not sensitive — extended public read
-- per the Phase 1 plan (not explicitly listed in DATA_MODEL §4, same reasoning as venues).
drop policy if exists tstandingrules_public_read on tournament.tournament_standing_rules;
create policy tstandingrules_public_read on tournament.tournament_standing_rules for select using (true);

drop policy if exists tqualrules_public_read on tournament.tournament_qualification_rules;
create policy tqualrules_public_read on tournament.tournament_qualification_rules for select using (true);

-- tournament_standing_overrides, tournament_qualification_draws, tournament_qualification_draw_candidates:
-- internal audit-trail data (same reasoning as tournament_draw_assignments) — no public policy.

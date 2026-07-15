-- Tournament V2 — Phase 1, Migration 012: draw_selected source support
-- Source of truth: D-29 qualification draw workflow carried through schedule import.
-- Idempotent — safe to re-run after a partial failure.

-- ============================================================================
-- tournament_matches: allow draw_selected as a persisted source_type
-- ============================================================================
alter table tournament.tournament_matches
  drop constraint if exists tournament_matches_home_source_type_check;

alter table tournament.tournament_matches
  add constraint tournament_matches_home_source_type_check
  check (
    home_source_type in (
      'team',
      'group_slot',
      'group_rank',
      'draw_selected',
      'match_winner',
      'match_loser',
      'best_ranked',
      'bye',
      'tbd'
    )
  );

alter table tournament.tournament_matches
  drop constraint if exists tournament_matches_away_source_type_check;

alter table tournament.tournament_matches
  add constraint tournament_matches_away_source_type_check
  check (
    away_source_type in (
      'team',
      'group_slot',
      'group_rank',
      'draw_selected',
      'match_winner',
      'match_loser',
      'best_ranked',
      'bye',
      'tbd'
    )
  );

-- ============================================================================
-- qualification draws: keep one active draw per category/slot and unique orders
-- ============================================================================
create unique index if not exists uniq_tqualdraw_active_category_slot
  on tournament.tournament_qualification_draws (category_id, qualification_slot)
  where superseded_at is null;

create unique index if not exists uniq_tqualcand_selected_order
  on tournament.tournament_qualification_draw_candidates (draw_id, draw_order)
  where is_selected = true and draw_order is not null;

-- ============================================================================
-- G-U16 configuration backfill for existing environments
-- ============================================================================
insert into tournament.tournament_qualification_rules (
  tournament_id,
  category_id,
  qualify_rank_per_group,
  best_third_placed_count,
  best_third_placed_method,
  cross_group_comparison
)
select
  categories.tournament_id,
  categories.id,
  2,
  2,
  'draw',
  false
from tournament.tournament_categories categories
where categories.code = 'G-U16'
  and not exists (
    select 1
    from tournament.tournament_qualification_rules rules
    where rules.category_id = categories.id
  );

update tournament.tournament_qualification_rules rules
set
  qualify_rank_per_group = 2,
  best_third_placed_count = 2,
  best_third_placed_method = 'draw',
  cross_group_comparison = false,
  updated_at = now()
from tournament.tournament_categories categories
where rules.category_id = categories.id
  and categories.code = 'G-U16'
  and (
    rules.qualify_rank_per_group is distinct from 2
    or rules.best_third_placed_count is distinct from 2
    or rules.best_third_placed_method is distinct from 'draw'
    or rules.cross_group_comparison is distinct from false
  );

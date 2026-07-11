-- Phase 5.2C — Step 3: Idempotency and stale cleanup checks
-- Run AFTER running recalculation twice for the same player

-- ============================================================================
-- Idempotency: Count system events per player — should not increase on 2nd run
-- Replace :season_id, :age_group_id with real values
-- ============================================================================
select
  player_id,
  team_id,
  count(*) filter (where suspension_type in ('accumulated_points', 'second_yellow', 'direct_red', 'yellow_red')) as system_events,
  count(*) filter (where suspension_type is null or suspension_type in ('legacy', 'manual')) as legacy_manual_events,
  count(*) as total_events,
  array_agg(suspension_type order by suspension_type) as event_types
from public.suspensions
where season_id = :season_id and age_group_id = :age_group_id
group by player_id, team_id
order by system_events desc
limit 20;

-- ============================================================================
-- Stale cleanup: Any orphaned system events where trigger_match_id card no longer exists?
-- These should have been cleaned up by stale cleanup on the last recalc run
-- ============================================================================
with season_matches as (
  select id from public.matches
  where season_id = :season_id and age_group_id = :age_group_id
)
select
  s.id,
  s.player_id,
  s.team_id,
  s.suspension_type,
  s.trigger_match_id,
  s.source_card_ids,
  -- Check if any source card still exists
  exists (
    select 1 from public.cards c
    where c.id = any(s.source_card_ids)
      and c.player_id = s.player_id
  ) as has_valid_source_card,
  -- Check if trigger match still has cards for this player
  exists (
    select 1 from public.cards c
    where c.match_id = s.trigger_match_id
      and c.player_id = s.player_id
  ) as trigger_match_has_cards
from public.suspensions s
where s.season_id = :season_id
  and s.age_group_id = :age_group_id
  and s.suspension_type in ('accumulated_points', 'second_yellow', 'direct_red', 'yellow_red')
  and s.trigger_match_id is not null
order by s.player_id, s.suspension_type;
-- If has_valid_source_card=false AND trigger_match_has_cards=false → this is an orphaned stale record
-- After stale cleanup runs, there should be NO such records

-- ============================================================================
-- Legacy preservation check: verify legacy/null records still exist after recalc
-- ============================================================================
select
  id,
  player_id,
  team_id,
  suspension_type,
  legacy_migrated,
  ban_matches,
  total_points,
  updated_at
from public.suspensions
where season_id = :season_id
  and age_group_id = :age_group_id
  and (suspension_type is null or suspension_type in ('legacy', 'manual'))
order by updated_at desc;
-- These records should be untouched by recalculation

-- ============================================================================
-- Public/Admin field consistency check
-- Verify all 7 event-based fields are present and populated correctly
-- ============================================================================
select
  id,
  suspension_type,
  trigger_match_id is not null as has_trigger_match,
  accumulated_threshold,
  source_card_ids is not null as has_source_ids,
  array_length(source_card_ids, 1) as source_id_count,
  serving_match_ids is not null as has_serving_ids,
  array_length(serving_match_ids, 1) as serving_id_count,
  served_completed_at,
  legacy_migrated,
  ban_matches,
  total_points
from public.suspensions
where season_id = :season_id
  and age_group_id = :age_group_id
  and suspension_type in ('accumulated_points', 'second_yellow', 'direct_red', 'yellow_red')
order by player_id, suspension_type;

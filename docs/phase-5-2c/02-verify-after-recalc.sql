-- Phase 5.2C — Step 2: Verify suspension records after recalculation
-- Run AFTER calling recalculatePlayerSuspensionEventBased for the test player
-- Replace :player_id, :team_id, :season_id, :age_group_id with real values

-- ============================================================================
-- A: Full suspension record for this player
-- ============================================================================
select
  id,
  suspension_type,
  trigger_match_id,
  accumulated_threshold,
  source_card_ids,
  serving_match_ids,
  served_completed_at,
  legacy_migrated,
  ban_matches,
  total_points,
  suspended_from_match_id,
  suspension_reason,
  updated_at
from public.suspensions
where player_id = :player_id
  and team_id = :team_id
  and season_id = :season_id
  and age_group_id = :age_group_id
order by updated_at desc;

-- ============================================================================
-- B: Verify source_card_ids are actual card.id values
-- ============================================================================
with player_suspensions as (
  select
    id as suspension_id,
    suspension_type,
    source_card_ids
  from public.suspensions
  where player_id = :player_id
    and team_id = :team_id
    and season_id = :season_id
    and age_group_id = :age_group_id
    and suspension_type in ('accumulated_points', 'second_yellow', 'direct_red', 'yellow_red')
),
unnested as (
  select
    ps.suspension_id,
    ps.suspension_type,
    unnest(ps.source_card_ids) as claimed_card_id
  from player_suspensions ps
)
select
  u.suspension_id,
  u.suspension_type,
  u.claimed_card_id,
  c.id as verified_card_id,
  c.card_type as verified_card_type,
  m.id as card_match_id,
  case
    when c.id is not null then '✓ VALID card.id'
    else '✗ NOT a real card.id — may be match_id'
  end as check_result
from unnested u
left join public.cards c on c.id = u.claimed_card_id and c.player_id = :player_id
left join public.matches m on m.id = c.match_id;

-- ============================================================================
-- C: Verify serving_match_ids are scheduled matches
-- ============================================================================
with player_suspensions as (
  select
    id as suspension_id,
    suspension_type,
    serving_match_ids,
    ban_matches
  from public.suspensions
  where player_id = :player_id
    and team_id = :team_id
    and season_id = :season_id
    and age_group_id = :age_group_id
    and suspension_type in ('accumulated_points', 'second_yellow', 'direct_red', 'yellow_red')
),
unnested as (
  select
    ps.suspension_id,
    ps.suspension_type,
    ps.ban_matches,
    unnest(ps.serving_match_ids) as serving_match_id
  from player_suspensions ps
  where array_length(ps.serving_match_ids, 1) > 0
)
select
  u.suspension_id,
  u.suspension_type,
  u.ban_matches,
  u.serving_match_id,
  m.status as match_status,
  m.matchday,
  m.match_date,
  case
    when m.status = 'scheduled' then '✓ VALID scheduled match'
    when m.status is null then '✗ Match not found'
    else concat('✗ Non-scheduled status: ', m.status)
  end as check_result
from unnested u
left join public.matches m on m.id = u.serving_match_id;

-- ============================================================================
-- D: Verify suspended_from_match_id matches first serving_match_ids element
-- ============================================================================
select
  id,
  suspension_type,
  suspended_from_match_id,
  serving_match_ids[1] as first_serving_id,
  case
    when suspended_from_match_id = serving_match_ids[1] then '✓ MATCH'
    when serving_match_ids is null or array_length(serving_match_ids, 1) is null then '⚪ No serving matches (no future fixture)'
    else concat('✗ MISMATCH: from=', suspended_from_match_id, ' first=', serving_match_ids[1])
  end as check_result
from public.suspensions
where player_id = :player_id
  and team_id = :team_id
  and season_id = :season_id
  and age_group_id = :age_group_id
  and suspension_type in ('accumulated_points', 'second_yellow', 'direct_red', 'yellow_red');

-- ============================================================================
-- E: Check no duplicates (idempotency check — count per event key)
-- ============================================================================
select
  player_id,
  team_id,
  trigger_match_id,
  suspension_type,
  coalesce(accumulated_threshold, 0) as threshold,
  count(*) as event_count,
  case when count(*) = 1 then '✓ No duplicate' else '✗ DUPLICATE' end as check_result
from public.suspensions
where player_id = :player_id
  and team_id = :team_id
  and season_id = :season_id
  and age_group_id = :age_group_id
  and suspension_type in ('accumulated_points', 'second_yellow', 'direct_red', 'yellow_red')
group by player_id, team_id, trigger_match_id, suspension_type, coalesce(accumulated_threshold, 0)
having count(*) > 1;
-- Expect: 0 rows (no duplicates)

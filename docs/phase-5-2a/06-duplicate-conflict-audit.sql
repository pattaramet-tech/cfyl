-- PHASE 5.2A — Loop 6: Duplicate & Conflict Audit
-- ⚠️ READ-ONLY SCRIPT — No data modifications
-- Purpose: Identify duplicate records and potential migration conflicts

-- ============================================================================
-- Query 6.1: Duplicate Event-Based Records (Current)
-- Expected: Should return 0 rows if unique index is working
-- ============================================================================

select
  player_id,
  team_id,
  trigger_match_id,
  suspension_type,
  coalesce(accumulated_threshold, 0) as threshold_key,
  count(*) as duplicate_count,
  array_agg(id order by created_at) as suspension_ids,
  array_agg(created_at order by created_at) as created_dates,
  min(created_at) as oldest,
  max(created_at) as newest
from public.suspensions
where trigger_match_id is not null
  and suspension_type is not null
  and suspension_type <> 'legacy'
group by player_id, team_id, trigger_match_id, suspension_type, coalesce(accumulated_threshold, 0)
having count(*) > 1
order by duplicate_count desc;

-- Expected Result:
--   0 rows = GOOD (no duplicates, unique index is working)
--   >0 rows = BAD (duplicates exist, data corruption)
--
-- If duplicates found:
--   - Cannot proceed with migration
--   - Must clean up duplicates first
--   - Keep newest, delete older duplicates


-- ============================================================================
-- Query 6.2: Duplicate Legacy Records
-- Expected: Should return 0 rows (legacy = 1 record per player+team)
-- ============================================================================

select
  player_id,
  team_id,
  season_id,
  total_points,
  ban_matches,
  suspended_from_match_id,
  count(*) as duplicate_count,
  array_agg(id order by created_at) as suspension_ids,
  array_agg(created_at order by created_at) as created_dates,
  'Duplicate legacy record' as issue
from public.suspensions
where suspension_type is null or suspension_type = 'legacy'
group by player_id, team_id, season_id, total_points, ban_matches, suspended_from_match_id
having count(*) > 1
order by duplicate_count desc;

-- Expected Result:
--   0 rows = GOOD (legacy records are unique per player+team)
--   >0 rows = INDICATES (legacy system already had duplicates)
--
-- Action if found:
--   - Merge records (keep most recent, delete older)
--   - Or mark conflicting ones for manual review


-- ============================================================================
-- Query 6.3: Orphaned Trigger Match References
-- Expected: Should return 0 rows (all trigger matches should exist)
-- ============================================================================

select
  s.id as suspension_id,
  s.player_id,
  s.team_id,
  s.trigger_match_id,
  s.suspension_type,
  'Trigger match does not exist' as issue
from public.suspensions s
where s.trigger_match_id is not null
  and (s.suspension_type is not null and s.suspension_type <> 'legacy')
  and not exists (
    select 1 from public.matches m where m.id = s.trigger_match_id
  );

-- Expected Result:
--   0 rows = GOOD (all trigger matches exist)
--   >0 rows = DATA CORRUPTION (missing matches)
--
-- Action if found:
--   - Investigate which matches were deleted
--   - Mark suspensions as MANUAL_REVIEW
--   - May need to keep as legacy records


-- ============================================================================
-- Query 6.4: Potential Conflicts Between Legacy and Event-Based
-- Expected: Check if same player+team has both legacy and event-based records
-- ============================================================================

with legacy_players as (
  select distinct player_id, team_id
  from public.suspensions
  where suspension_type is null or suspension_type = 'legacy'
),
event_players as (
  select distinct player_id, team_id
  from public.suspensions
  where suspension_type is not null and suspension_type <> 'legacy'
)
select
  lp.player_id,
  lp.team_id,
  p.full_name,
  t.name as team_name,
  'Same player+team has both legacy and event records' as conflict
from legacy_players lp
join event_players ep on lp.player_id = ep.player_id and lp.team_id = ep.team_id
left join public.players p on p.id = lp.player_id
left join public.teams t on t.id = lp.team_id;

-- Expected Result:
--   0 rows = GOOD (clean separation)
--   >0 rows = MIXED STATE (both old and new records exist)
--
-- This is expected if partial migration has occurred
-- Action: Mark for review in migration strategy


-- ============================================================================
-- Query 6.5: Points/Ban Mismatch Before Migration
-- Expected: Check for records with inconsistent points/ban relationship
-- ============================================================================

select
  s.id,
  s.player_id,
  s.team_id,
  s.total_points,
  s.ban_matches,
  case
    when s.total_points = 0 and s.ban_matches = 1 then 'VALID: Ejection (1 match)'
    when s.total_points = 6 and s.ban_matches = 1 then 'VALID: Threshold 6 (1 match)'
    when s.total_points = 12 and s.ban_matches = 2 then 'VALID: Threshold 12 (2 matches)'
    when s.total_points = 18 and s.ban_matches = 3 then 'VALID: Threshold 18 (3 matches)'
    when s.total_points >= 24 and s.ban_matches = 4 then 'VALID: Threshold 24+ (4 matches)'
    when s.total_points = 0 and s.ban_matches = 0 then 'ANOMALY: No points, no ban'
    when s.total_points > 0 and s.ban_matches = 0 then 'ANOMALY: Points but no ban'
    when s.total_points = 0 and s.ban_matches > 1 then 'ANOMALY: Multi-match ejection'
    when s.total_points > 0 and s.ban_matches > 4 then 'ANOMALY: More than 4 bans'
    else 'ANOMALY: Unexpected combination'
  end as relationship_status
from public.suspensions s
where (s.suspension_type is null or s.suspension_type = 'legacy')
  and (
    (s.total_points = 0 and s.ban_matches = 0)
    or (s.total_points > 0 and s.ban_matches = 0)
    or (s.total_points = 0 and s.ban_matches > 1)
    or (s.total_points > 0 and s.ban_matches > 4)
  )
order by s.id;

-- Expected Result:
--   0 rows = GOOD (all records have valid relationships)
--   >0 rows = DATA QUALITY ISSUES (flag for manual review)


-- ============================================================================
-- Query 6.6: Conflict Summary Report
-- Expected: One row with all conflict counts
-- ============================================================================

select
  (select count(*) from public.suspensions s1
   where (s1.suspension_type is not null and s1.suspension_type <> 'legacy')
     and exists (select 1 from public.suspensions s2
                 where s2.trigger_match_id = s1.trigger_match_id
                   and s2.suspension_type = s1.suspension_type
                   and s2.id <> s1.id
                   and s2.player_id = s1.player_id
                   and s2.team_id = s1.team_id)) as event_duplicates,
  (select count(*) from (
    select player_id, team_id, season_id, total_points, ban_matches, suspended_from_match_id
    from public.suspensions
    where suspension_type is null or suspension_type = 'legacy'
    group by player_id, team_id, season_id, total_points, ban_matches, suspended_from_match_id
    having count(*) > 1
  ) x) as legacy_duplicates,
  (select count(*) from public.suspensions s
   where s.trigger_match_id is not null
     and (s.suspension_type is not null and s.suspension_type <> 'legacy')
     and not exists (select 1 from public.matches m where m.id = s.trigger_match_id)) as orphaned_triggers,
  (select count(*) from (
    select lp.player_id, lp.team_id
    from (select distinct player_id, team_id from public.suspensions where suspension_type is null or suspension_type = 'legacy') lp
    join (select distinct player_id, team_id from public.suspensions where suspension_type is not null and suspension_type <> 'legacy') ep
      on lp.player_id = ep.player_id and lp.team_id = ep.team_id
  ) x) as mixed_state_players;

-- Summary of all conflict counts
-- All should be close to 0 for clean migration

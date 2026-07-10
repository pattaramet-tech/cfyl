-- PHASE 5.2A — Loop 2: Production Record Inventory
-- ⚠️ READ-ONLY SCRIPT — No data modifications
-- Purpose: Get exact counts of all suspension records by type and status

-- ============================================================================
-- Query 2.1: Master Count Query
-- Expected: Returns 1 row with all aggregated counts
-- ============================================================================

select
  count(*) as total_suspensions,
  count(*) filter (where suspension_type is null) as null_type_count,
  count(*) filter (where suspension_type = 'legacy') as legacy_count,
  count(*) filter (
    where suspension_type is not null
      and suspension_type <> 'legacy'
  ) as event_based_count,
  count(*) filter (where trigger_match_id is null) as missing_trigger_match_id,
  count(*) filter (where serving_match_ids is null or array_length(serving_match_ids, 1) = 0) as missing_serving_match_ids,
  count(*) filter (where legacy_migrated = true) as marked_legacy_migrated,
  count(*) filter (where ban_matches > 0) as with_active_ban,
  count(*) filter (where ban_matches = 0) as no_ban
from public.suspensions;

-- Expected Output Columns:
--   total_suspensions: Total count of all records
--   null_type_count: Records with suspension_type = NULL (OLD SCHEMA)
--   legacy_count: Records with suspension_type = 'legacy'
--   event_based_count: Records with suspension_type IN (accumulated_points, direct_red, second_yellow, yellow_red, manual)
--   missing_trigger_match_id: Records without trigger_match_id
--   missing_serving_match_ids: Records without serving_match_ids array
--   marked_legacy_migrated: Records with legacy_migrated = true
--   with_active_ban: Records with ban_matches > 0
--   no_ban: Records with ban_matches = 0

-- Critical Interpretation:
-- null_type_count > 0  → Schema migration NOT applied (or old records exist)
-- event_based_count > 0 AND legacy_count > 0 → Already partially migrated
-- missing_trigger_match_id > 0 → Records need manual trigger identification


-- ============================================================================
-- Query 2.2: Breakdown by Suspension Type
-- Expected: Returns multiple rows, one per type
-- ============================================================================

select
  coalesce(suspension_type, 'NULL_TYPE') as suspension_type,
  count(*) as count,
  min(created_at) as oldest_record,
  max(created_at) as newest_record,
  avg(ban_matches) as avg_ban_matches,
  avg(total_points) as avg_total_points,
  count(*) filter (where trigger_match_id is null) as missing_trigger,
  count(*) filter (where serving_match_ids is null) as missing_serving
from public.suspensions
group by suspension_type
order by count desc;

-- Expected Output Columns:
--   suspension_type: Type of suspension (legacy, accumulated_points, direct_red, second_yellow, yellow_red, manual, NULL_TYPE)
--   count: Count of records with this type
--   oldest_record: Timestamp of oldest record
--   newest_record: Timestamp of newest record
--   avg_ban_matches: Average ban_matches value
--   avg_total_points: Average total_points value
--   missing_trigger: Count with null trigger_match_id
--   missing_serving: Count with null/empty serving_match_ids

-- Interpretation:
-- NULL_TYPE count → OLD SCHEMA records (need special handling)
-- legacy count → Already marked as legacy (can keep as-is)
-- event_based_count → Already migrated (do not re-migrate)


-- ============================================================================
-- Query 2.3: Records by Season
-- Expected: Shows distribution across seasons
-- ============================================================================

select
  coalesce(s.name, 'UNKNOWN_SEASON') as season_name,
  sp.season_id,
  count(*) as record_count,
  count(*) filter (where sp.suspension_type is null or sp.suspension_type = 'legacy') as legacy_or_old,
  count(*) filter (where sp.suspension_type is not null and sp.suspension_type <> 'legacy') as event_based,
  count(distinct sp.player_id) as unique_players,
  count(distinct sp.team_id) as unique_teams
from public.suspensions sp
left join public.seasons s on s.id = sp.season_id
group by sp.season_id, s.name
order by record_count desc;

-- Expected Output Columns:
--   season_name: Name of season (if season still exists)
--   season_id: Season ID
--   record_count: Total suspensions for this season
--   legacy_or_old: Count of legacy/old-schema records
--   event_based: Count of event-based records
--   unique_players: How many different players affected
--   unique_teams: How many different teams affected

-- Interpretation:
-- Allows migration to be done season-by-season if needed
-- Identifies seasons with no records (safe to skip)


-- ============================================================================
-- Query 2.4: Player and Team Coverage
-- Expected: Shows which players/teams have suspensions
-- ============================================================================

select
  count(distinct player_id) as unique_players_with_suspensions,
  count(distinct team_id) as unique_teams_with_suspensions,
  max(created_at) as most_recent_suspension,
  count(*) filter (where served_completed_at is not null) as served_count
from public.suspensions;

-- Expected Output Columns:
--   unique_players_with_suspensions: Count of unique players
--   unique_teams_with_suspensions: Count of unique teams
--   most_recent_suspension: Latest suspension record date
--   served_count: Count of suspensions marked as served

-- Interpretation:
-- Shows scale of migration impact


-- ============================================================================
-- Query 2.5: Data Completeness Summary
-- Expected: Shows what fields are populated
-- ============================================================================

select
  'ban_matches populated' as field_name,
  count(*) filter (where ban_matches is not null and ban_matches > 0) as count,
  round(100.0 * count(*) filter (where ban_matches is not null and ban_matches > 0) / count(*), 2) as percentage
from public.suspensions

union all

select
  'total_points populated',
  count(*) filter (where total_points is not null and total_points > 0),
  round(100.0 * count(*) filter (where total_points is not null and total_points > 0) / count(*), 2)
from public.suspensions

union all

select
  'suspension_reason populated',
  count(*) filter (where suspension_reason is not null),
  round(100.0 * count(*) filter (where suspension_reason is not null) / count(*), 2)
from public.suspensions

union all

select
  'suspension_details populated',
  count(*) filter (where suspension_details is not null),
  round(100.0 * count(*) filter (where suspension_details is not null) / count(*), 2)
from public.suspensions

union all

select
  'trigger_match_id populated',
  count(*) filter (where trigger_match_id is not null),
  round(100.0 * count(*) filter (where trigger_match_id is not null) / count(*), 2)
from public.suspensions

union all

select
  'serving_match_ids populated',
  count(*) filter (where serving_match_ids is not null and array_length(serving_match_ids, 1) > 0),
  round(100.0 * count(*) filter (where serving_match_ids is not null and array_length(serving_match_ids, 1) > 0) / count(*), 2)
from public.suspensions;

-- Expected Output Columns:
--   field_name: Name of field
--   count: How many records have this field populated
--   percentage: Percentage of total records

-- Interpretation:
-- Low percentage → Many records missing critical data for migration

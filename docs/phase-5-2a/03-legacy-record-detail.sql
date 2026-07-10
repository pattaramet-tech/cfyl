-- PHASE 5.2A — Loop 3: Legacy Record Details
-- ⚠️ READ-ONLY SCRIPT — No data modifications
-- Purpose: Inspect every legacy/old-schema suspension record in detail

-- ============================================================================
-- Query 3.1: All Legacy Suspension Records with Full Context
-- Expected: Returns ALL records where suspension_type IS NULL OR = 'legacy'
-- LIMIT 10000 ensures result doesn't explode, but captures all records
-- ============================================================================

select
  s.id as suspension_id,
  s.player_id,
  p.full_name as player_name,
  p.player_code,
  s.team_id,
  t.name as team_name,
  t.short_name as team_short_name,
  s.season_id,
  s.age_group_id,
  s.total_points,
  s.ban_matches,
  s.suspended_from_match_id,
  sm.match_code as suspended_match_code,
  sm.matchday as suspended_matchday,
  sm.match_date as suspended_match_date,
  sm.status as suspended_match_status,
  s.suspension_reason,
  s.suspension_details,
  s.suspension_type,
  s.trigger_match_id,
  s.accumulated_threshold,
  s.source_card_ids,
  s.serving_match_ids,
  s.served_completed_at,
  s.legacy_migrated,
  s.point_sources,
  s.created_at,
  s.updated_at
from public.suspensions s
left join public.players p on p.id = s.player_id
left join public.teams t on t.id = s.team_id
left join public.matches sm on sm.id = s.suspended_from_match_id
where s.suspension_type is null
   or s.suspension_type = 'legacy'
order by s.created_at desc, s.id
limit 10000;

-- Expected Output Columns:
--   suspension_id: UUID of suspension record
--   player_id, player_name, player_code: Player information
--   team_id, team_name, team_short_name: Team information
--   season_id, age_group_id: Season/age group
--   total_points: Total discipline points accumulated
--   ban_matches: Number of matches to ban
--   suspended_from_match_id: First serving match (legacy)
--   suspended_match_code, suspended_matchday, suspended_match_date, suspended_match_status: Details of serving match
--   suspension_reason: Text reason (e.g., "สะสมคะแนน 12 คะแนน")
--   suspension_details: JSON object with trigger_match_id, threshold_crossed, etc.
--   suspension_type: Should be null or 'legacy'
--   trigger_match_id: Match where card was given (if available)
--   accumulated_threshold: Threshold if accumulated_points (should be null for old schema)
--   source_card_ids: Card IDs (if populated)
--   serving_match_ids: Array of serving matches (if populated)
--   served_completed_at: When suspension was fully served (if applicable)
--   legacy_migrated: Whether marked as migrated
--   point_sources: Array of point accumulation events
--   created_at, updated_at: Timestamps

-- Critical Inspection Points:
-- 1. suspension_reason: Is it clear enough to determine type?
--    - "สะสมคะแนน 12 คะแนน" → accumulated_points, threshold=12
--    - "ใบแดงโดยตรง" → direct_red
--    - "ใบเหลืองที่ 2" → second_yellow
--    - "ใบเหลือง + ใบแดง" → yellow_red
--
-- 2. suspension_details: Does it contain trigger_match_id?
--    - If yes → Can be auto-migrated
--    - If no → Needs manual review
--
-- 3. suspended_from_match_id: Does it point to a valid, usable match?
--    - If null → Cannot determine serving matches
--    - If match status is not scheduled/finished → May need recalculation
--
-- 4. total_points and ban_matches: Do they match expected mapping?
--    - 6 points → 1 ban match
--    - 12 points → 2 ban matches
--    - 18 points → 3 ban matches
--    - 24+ points → 4 ban matches


-- ============================================================================
-- Query 3.2: Sample of Records with suspension_details (for inspection)
-- Expected: First 100 legacy records ordered by creation
-- ============================================================================

select
  s.id,
  s.player_id,
  s.team_id,
  s.total_points,
  s.ban_matches,
  s.suspension_reason,
  s.suspension_details,
  s.created_at
from public.suspensions s
where (s.suspension_type is null or s.suspension_type = 'legacy')
  and s.suspension_details is not null
order by s.created_at
limit 100;

-- Use this to inspect suspension_details JSON structure
-- Expected structure:
-- {
--   "trigger_match_id": "<uuid>",
--   "trigger_matchday": "<matchday number>",
--   "trigger_event": "<event text>",
--   "points_before": <number>,
--   "points_added": <number>,
--   "points_after": <number>,
--   "threshold_crossed": <number>,
--   "ban_matches_count": <number>,
--   "suspended_matches": [...]
-- }


-- ============================================================================
-- Query 3.3: Records with Missing suspension_reason
-- Expected: May return 0 or more records
-- These records CANNOT be auto-migrated (ambiguous type)
-- ============================================================================

select
  s.id,
  s.player_id,
  p.full_name,
  s.team_id,
  s.total_points,
  s.ban_matches,
  s.suspended_from_match_id,
  s.suspension_type,
  s.created_at,
  'CRITICAL: Missing suspension_reason' as issue
from public.suspensions s
left join public.players p on p.id = s.player_id
where (s.suspension_type is null or s.suspension_type = 'legacy')
  and (s.suspension_reason is null or s.suspension_reason = '')
  and s.ban_matches > 0;

-- Action: All these records MUST be reviewed manually


-- ============================================================================
-- Query 3.4: Records with Missing suspended_from_match_id
-- Expected: May return 0 or more records
-- These records have no serving match reference
-- ============================================================================

select
  s.id,
  s.player_id,
  p.full_name,
  s.team_id,
  s.total_points,
  s.ban_matches,
  s.suspension_type,
  s.created_at,
  'CRITICAL: Missing suspended_from_match_id' as issue
from public.suspensions s
left join public.players p on p.id = s.player_id
where (s.suspension_type is null or s.suspension_type = 'legacy')
  and s.suspended_from_match_id is null
  and s.ban_matches > 0;

-- Action: Cannot determine which match was used for serving
-- These records need manual investigation or should be kept as legacy


-- ============================================================================
-- Query 3.5: Records with Point/Ban Mismatch
-- Expected: May return 0 or more records
-- These indicate data quality issues
-- ============================================================================

select
  s.id,
  s.player_id,
  p.full_name,
  s.team_id,
  s.total_points,
  s.ban_matches,
  case
    when s.total_points = 0 and s.ban_matches = 1 then 'Ejection (1 match)'
    when s.total_points >= 6 and s.ban_matches = 0 then 'ANOMALY: Points but no ban'
    when s.total_points = 0 and s.ban_matches = 0 then 'ANOMALY: No points, no ban'
    when s.total_points = 0 and s.ban_matches > 1 then 'ANOMALY: Multi-match ejection (unusual)'
    else 'OK'
  end as status,
  s.created_at
from public.suspensions s
left join public.players p on p.id = s.player_id
where (s.suspension_type is null or s.suspension_type = 'legacy')
  and (
    (s.total_points >= 6 and s.ban_matches = 0)
    or (s.total_points = 0 and s.ban_matches = 0)
    or (s.total_points = 0 and s.ban_matches > 1)
  );

-- Action: Investigate these records for data quality issues

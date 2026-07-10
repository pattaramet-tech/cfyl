-- PHASE 5.2A — Loop 9: Migration Preview Template
-- ⚠️ READ-ONLY SCRIPT — PREVIEW ONLY, NOT FOR EXECUTION
-- Purpose: Show what event-based records WOULD be created (SELECT only)

-- ============================================================================
-- CRITICAL WARNING
-- ============================================================================
-- This query is for PREVIEW ONLY
-- It uses SELECT...VALUES to show what data would be inserted
-- It does NOT actually create any records
-- Do NOT convert to INSERT/UPDATE/DELETE


-- ============================================================================
-- Query 9.1: Preview of AUTO_MIGRATE Records
-- Expected: Returns virtual records that would be created
-- ============================================================================

-- PREVIEW: Accumulated Points Records That Will Be Created
select
  gen_random_uuid() as new_id,  -- Will be generated during actual migration
  s.id as source_suspension_id,
  s.player_id,
  s.team_id,
  s.season_id,
  s.age_group_id,
  (s.suspension_details->>'trigger_match_id')::uuid as trigger_match_id,
  'accumulated_points' as suspension_type,
  s.total_points as accumulated_threshold,
  s.suspension_details->'suspended_matches' as suspended_matches_data,
  s.ban_matches,
  s.suspended_from_match_id as suspended_from_match_id_fallback,
  'PREVIEW_ONLY' as status
from public.suspensions s
where (s.suspension_type is null or s.suspension_type = 'legacy')
  and s.player_id is not null
  and s.team_id is not null
  and s.season_id is not null
  and (s.suspension_details->>'trigger_match_id' is not null and (s.suspension_details->>'trigger_match_id') != '')
  and (s.suspension_reason is not null and s.suspension_reason != '')
  and s.suspended_from_match_id is not null
  and s.ban_matches > 0
  and s.total_points in (6, 12, 18, 24)
limit 100;

-- This shows first 100 records that would be migrated
-- Check if:
--   - trigger_match_id values look valid
--   - suspended_from_match_id values look valid
--   - accumulated_threshold values are 6, 12, 18, or 24


-- ============================================================================
-- Query 9.2: Preview of Ejection Records
-- Expected: Shows direct_red, second_yellow, yellow_red records
-- ============================================================================

-- PREVIEW: Ejection Records That Will Be Created
select
  gen_random_uuid() as new_id,
  s.id as source_suspension_id,
  s.player_id,
  s.team_id,
  s.season_id,
  s.age_group_id,
  s.suspended_from_match_id as trigger_match_id,  -- For ejections, trigger = serving match
  case
    when s.suspension_reason ilike '%แดง%' and s.suspension_reason ilike '%เหลือง%' then 'yellow_red'
    when s.suspension_reason ilike '%ที่ 2%' then 'second_yellow'
    when s.suspension_reason ilike '%แดง%' then 'direct_red'
    else 'manual'
  end as suspension_type,
  null as accumulated_threshold,  -- Null for ejections
  s.ban_matches,
  s.suspended_from_match_id as suspended_from_match_id_fallback,
  'PREVIEW_ONLY' as status
from public.suspensions s
where (s.suspension_type is null or s.suspension_type = 'legacy')
  and s.player_id is not null
  and s.team_id is not null
  and s.ban_matches > 0
  and s.total_points = 0
  and s.suspension_reason is not null
  and s.suspended_from_match_id is not null
limit 100;

-- This shows first 100 ejection records that would be migrated
-- Check if:
--   - suspension_type classifications are correct
--   - trigger_match_id (from suspended_from_match_id) is valid


-- ============================================================================
-- Query 9.3: Records That Will NOT Be Migrated
-- Expected: Shows records that remain legacy (MANUAL_REVIEW, KEEP_LEGACY, INVALID)
-- ============================================================================

-- PREVIEW: Records that will NOT be auto-migrated
select
  s.id,
  s.player_id,
  s.team_id,
  s.total_points,
  s.ban_matches,
  s.suspension_reason,
  case
    when s.player_id is null or s.team_id is null or s.season_id is null then 'INVALID_DATA: Missing FK'
    when s.total_points < 0 or s.ban_matches < 0 then 'INVALID_DATA: Negative values'
    when s.suspension_reason is null and s.ban_matches > 0 then 'MANUAL_REVIEW: Missing reason'
    when (s.suspension_details->>'trigger_match_id' is null or (s.suspension_details->>'trigger_match_id') = '') then 'MANUAL_REVIEW: No trigger'
    when s.suspended_from_match_id is null and s.ban_matches > 0 then 'MANUAL_REVIEW: No serving match'
    else 'KEEP_LEGACY'
  end as classification,
  'WILL_REMAIN_LEGACY' as action
from public.suspensions s
where (s.suspension_type is null or s.suspension_type = 'legacy')
  and not (
    -- AUTO_MIGRATE criteria
    s.player_id is not null
    and s.team_id is not null
    and s.season_id is not null
    and ((s.suspension_details->>'trigger_match_id' is not null and (s.suspension_details->>'trigger_match_id') != '')
         or (s.total_points = 0 and s.ban_matches = 1))
    and (s.suspension_reason is not null and s.suspension_reason != '')
    and s.suspended_from_match_id is not null
    and s.ban_matches > 0
  )
limit 100;

-- This shows first 100 records that will NOT be migrated
-- These will remain as legacy/keep their current type


-- ============================================================================
-- Query 9.4: Migration Statistics
-- Expected: Summary of what would be created/kept
-- ============================================================================

-- PREVIEW: Statistics of proposed migration
select
  (select count(*) from public.suspensions where suspension_type is null or suspension_type = 'legacy') as total_legacy,
  (select count(*) from public.suspensions s
   where (s.suspension_type is null or s.suspension_type = 'legacy')
     and s.player_id is not null
     and s.team_id is not null
     and s.season_id is not null
     and ((s.suspension_details->>'trigger_match_id' is not null and (s.suspension_details->>'trigger_match_id') != '')
          or (s.total_points = 0 and s.ban_matches = 1))
     and (s.suspension_reason is not null and s.suspension_reason != '')
     and s.suspended_from_match_id is not null
     and s.ban_matches > 0) as can_auto_migrate,
  (select count(*) from public.suspensions s
   where (s.suspension_type is null or s.suspension_type = 'legacy')
     and (s.player_id is null or s.team_id is null or s.total_points < 0 or s.ban_matches < 0)) as invalid_data,
  (select count(*) from public.suspensions s
   where (s.suspension_type is null or s.suspension_type = 'legacy')
     and not (s.player_id is null or s.team_id is null or s.total_points < 0 or s.ban_matches < 0)
     and not (s.player_id is not null
       and s.team_id is not null
       and s.season_id is not null
       and ((s.suspension_details->>'trigger_match_id' is not null and (s.suspension_details->>'trigger_match_id') != '')
            or (s.total_points = 0 and s.ban_matches = 1))
       and (s.suspension_reason is not null and s.suspension_reason != '')
       and s.suspended_from_match_id is not null
       and s.ban_matches > 0)) as manual_review_needed;

-- Summary showing:
--   total_legacy: Total legacy records in database
--   can_auto_migrate: Records ready for automatic migration
--   invalid_data: Records with data corruption
--   manual_review_needed: Records needing manual classification


-- ============================================================================
-- Query 9.5: Manual Review List
-- Expected: Detailed info for records needing manual review
-- ============================================================================

-- PREVIEW: Records marked for MANUAL_REVIEW
select
  s.id,
  s.player_id,
  p.full_name,
  s.team_id,
  t.name as team_name,
  s.total_points,
  s.ban_matches,
  s.suspension_reason,
  s.suspended_from_match_id,
  s.suspension_details->>'trigger_match_id' as has_trigger_in_details,
  case
    when s.suspension_reason is null or s.suspension_reason = '' then 'Missing suspension_reason'
    when s.suspension_details->>'trigger_match_id' is null then 'Missing trigger_match_id'
    when s.suspended_from_match_id is null then 'Missing suspended_from_match_id'
    else 'Other issue'
  end as reason_for_manual_review,
  'REQUIRES_MANUAL_REVIEW' as action
from public.suspensions s
left join public.players p on p.id = s.player_id
left join public.teams t on t.id = s.team_id
where (s.suspension_type is null or s.suspension_type = 'legacy')
  and s.ban_matches > 0
  and (
    s.suspension_reason is null
    or s.suspension_reason = ''
    or (s.suspension_details->>'trigger_match_id' is null or (s.suspension_details->>'trigger_match_id') = '')
    or s.suspended_from_match_id is null
  )
limit 100;

-- These records need manual review before migration
-- Export this list for manual classification


-- ============================================================================
-- IMPORTANT: This is a PREVIEW template
-- To see actual migration results, you would need to:
-- 1. Export the AUTO_MIGRATE results
-- 2. Manually classify MANUAL_REVIEW records
-- 3. Generate actual INSERT statements (Phase 5.2B)
-- ============================================================================

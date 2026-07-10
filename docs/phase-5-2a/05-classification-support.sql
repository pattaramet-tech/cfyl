-- PHASE 5.2A — Loop 5: Classification Support Queries
-- ⚠️ READ-ONLY SCRIPT — No data modifications
-- Purpose: Helper queries to classify each record for migration

-- ============================================================================
-- Query 5.1: Classification Decision Matrix
-- Expected: Shows each legacy record with classification indicators
-- ============================================================================

with legacy_analysis as (
  select
    s.id,
    s.player_id,
    s.team_id,
    s.total_points,
    s.ban_matches,
    s.suspension_reason,
    s.suspension_details,
    s.suspended_from_match_id,
    -- Check 1: Has complete suspension_details
    case when s.suspension_details is not null and (s.suspension_details->>'trigger_match_id') is not null then 'YES' else 'NO' end as has_trigger_in_details,
    -- Check 2: Suspension reason is clear
    case
      when s.suspension_reason is null or s.suspension_reason = '' then 'MISSING'
      when s.suspension_reason ilike '%แดง%' and s.suspension_reason ilike '%เหลือง%' then 'YELLOW_RED'
      when s.suspension_reason ilike '%ที่ 2%' then 'SECOND_YELLOW'
      when s.suspension_reason ilike '%แดง%' then 'DIRECT_RED'
      when s.suspension_reason ilike '%คะแนน%' then 'ACCUMULATED'
      else 'UNCLEAR'
    end as reason_category,
    -- Check 3: Serving match exists and is usable
    case
      when s.suspended_from_match_id is null then 'MISSING'
      when (select status from public.matches m where m.id = s.suspended_from_match_id) is null then 'ORPHANED'
      when (select status from public.matches m where m.id = s.suspended_from_match_id) in ('scheduled', 'finished') then 'USABLE'
      else 'UNUSABLE'
    end as serving_match_usability,
    -- Check 4: Has player and team
    case
      when (select id from public.players where id = s.player_id) is null then 'MISSING_PLAYER'
      when (select id from public.teams where id = s.team_id) is null then 'MISSING_TEAM'
      else 'EXISTS'
    end as player_team_status,
    -- Check 5: Valid points/ban relationship
    case
      when s.total_points = 0 and s.ban_matches = 1 then 'VALID_EJECTION'
      when s.total_points = 0 and s.ban_matches > 1 then 'UNUSUAL_MULTI_EJECTION'
      when s.total_points in (6, 12, 18, 24) and s.ban_matches > 0 then 'VALID_ACCUMULATED'
      when s.total_points >= 6 and s.ban_matches = 0 then 'INCONSISTENT'
      when s.total_points = 0 and s.ban_matches = 0 then 'EMPTY'
      else 'INVALID'
    end as points_ban_relationship
  from public.suspensions s
  where s.suspension_type is null or s.suspension_type = 'legacy'
)
select
  id,
  player_id,
  team_id,
  total_points,
  ban_matches,
  has_trigger_in_details,
  reason_category,
  serving_match_usability,
  player_team_status,
  points_ban_relationship,
  case
    when player_team_status = 'EXISTS'
      and has_trigger_in_details = 'YES'
      and reason_category in ('ACCUMULATED', 'DIRECT_RED', 'SECOND_YELLOW', 'YELLOW_RED')
      and serving_match_usability = 'USABLE'
      and points_ban_relationship in ('VALID_EJECTION', 'VALID_ACCUMULATED')
      then 'AUTO_MIGRATE'
    when player_team_status = 'EXISTS'
      and ban_matches > 0
      and (reason_category = 'UNCLEAR' or reason_category = 'MISSING' or has_trigger_in_details = 'NO')
      then 'MANUAL_REVIEW'
    when player_team_status != 'EXISTS'
      or points_ban_relationship = 'INVALID'
      then 'INVALID_DATA'
    else 'KEEP_LEGACY'
  end as suggested_classification
from legacy_analysis
order by id;

-- Use this query to help make classification decisions


-- ============================================================================
-- Query 5.2: Records Ready for Auto-Migration
-- Expected: Returns records that CAN be auto-migrated
-- ============================================================================

select
  s.id,
  s.player_id,
  s.team_id,
  s.season_id,
  s.total_points,
  s.ban_matches,
  s.suspended_from_match_id,
  s.suspension_details->>'trigger_match_id' as trigger_match_id,
  s.suspension_reason,
  case
    when s.suspension_reason ilike '%แดง%' and s.suspension_reason ilike '%เหลือง%' then 'yellow_red'
    when s.suspension_reason ilike '%ที่ 2%' then 'second_yellow'
    when s.suspension_reason ilike '%แดง%' then 'direct_red'
    else 'accumulated_points'
  end as inferred_type,
  case
    when s.total_points in (6, 12, 18, 24) then s.total_points
    else null
  end as threshold,
  'READY' as status
from public.suspensions s
where (s.suspension_type is null or s.suspension_type = 'legacy')
  and s.player_id is not null
  and s.team_id is not null
  and s.season_id is not null
  and (s.suspension_details->>'trigger_match_id' is not null or s.suspension_details->>'trigger_match_id' != '')
  and (s.suspension_reason is not null and s.suspension_reason != '')
  and s.suspended_from_match_id is not null
  and s.ban_matches > 0
  and (
    (s.total_points in (6, 12, 18, 24) and s.ban_matches > 0)
    or (s.total_points = 0 and s.ban_matches = 1)
  );

-- Expected count: Candidates for AUTO_MIGRATE classification


-- ============================================================================
-- Query 5.3: Records Needing Manual Review
-- Expected: Returns records with ambiguity/missing data
-- ============================================================================

select
  s.id,
  s.player_id,
  s.team_id,
  s.total_points,
  s.ban_matches,
  s.suspended_from_match_id,
  s.suspension_reason,
  case
    when s.suspension_reason is null or s.suspension_reason = '' then 'Missing suspension_reason'
    when s.suspension_details->>'trigger_match_id' is null then 'Missing trigger_match_id in details'
    when s.suspended_from_match_id is null then 'Missing suspended_from_match_id'
    when s.total_points = 0 and s.ban_matches > 1 then 'Unusual multi-match ejection'
    else 'Other ambiguity'
  end as reason_for_manual_review
from public.suspensions s
where (s.suspension_type is null or s.suspension_type = 'legacy')
  and s.ban_matches > 0
  and (
    s.suspension_reason is null
    or s.suspension_reason = ''
    or (s.suspension_details->>'trigger_match_id' is null or (s.suspension_details->>'trigger_match_id') = '')
    or s.suspended_from_match_id is null
    or (s.total_points = 0 and s.ban_matches > 1)
  );

-- Expected count: Candidates for MANUAL_REVIEW classification


-- ============================================================================
-- Query 5.4: Invalid Data Records
-- Expected: Returns records with data integrity issues
-- ============================================================================

select
  s.id,
  s.player_id,
  s.team_id,
  s.total_points,
  s.ban_matches,
  case
    when (select id from public.players p where p.id = s.player_id) is null then 'Player does not exist'
    when (select id from public.teams t where t.id = s.team_id) is null then 'Team does not exist'
    when s.total_points < 0 then 'Negative total_points'
    when s.ban_matches < 0 then 'Negative ban_matches'
    when (s.suspension_type = 'accumulated_points' and s.total_points not in (6, 12, 18, 24)) then 'Invalid accumulated threshold'
    when (s.total_points > 0 and s.ban_matches = 0) then 'Points but no ban (inconsistent)'
    else 'Other data issue'
  end as data_issue
from public.suspensions s
where (s.suspension_type is null or s.suspension_type = 'legacy')
  and (
    (select id from public.players p where p.id = s.player_id) is null
    or (select id from public.teams t where t.id = s.team_id) is null
    or s.total_points < 0
    or s.ban_matches < 0
    or (s.total_points > 0 and s.ban_matches = 0)
  );

-- Expected count: Candidates for INVALID_DATA classification


-- ============================================================================
-- Query 5.5: Summary of Classification Counts
-- Expected: One row per classification type
-- ============================================================================

with classifications as (
  select
    id,
    case
      when player_id is null or team_id is null or season_id is null then 'INVALID_DATA'
      when (suspension_details->>'trigger_match_id' is not null or (suspension_details->>'trigger_match_id') != '')
        and (suspension_reason is not null and suspension_reason != '')
        and suspended_from_match_id is not null
        and ban_matches > 0
        and (
          (total_points in (6, 12, 18, 24) and ban_matches > 0)
          or (total_points = 0 and ban_matches = 1)
        )
        then 'AUTO_MIGRATE'
      when ban_matches > 0 and (
        suspension_reason is null
        or suspension_reason = ''
        or (suspension_details->>'trigger_match_id' is null or (suspension_details->>'trigger_match_id') = '')
        or suspended_from_match_id is null
      ) then 'MANUAL_REVIEW'
      else 'KEEP_LEGACY'
    end as classification
  from public.suspensions
  where suspension_type is null or suspension_type = 'legacy'
)
select
  classification,
  count(*) as count,
  round(100.0 * count(*) / (select count(*) from classifications), 2) as percentage
from classifications
group by classification
order by count desc;

-- Summary of how many records fall into each category

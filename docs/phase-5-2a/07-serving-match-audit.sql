-- PHASE 5.2A — Loop 7: Serving Match Audit
-- ⚠️ READ-ONLY SCRIPT — No data modifications
-- Purpose: Verify suspended_from_match_id and serving_match_ids references are valid

-- ============================================================================
-- Query 7.1: Serving Match Status Verification
-- Expected: All suspended_from_match_id should point to valid matches
-- ============================================================================

select
  s.id as suspension_id,
  s.player_id,
  s.team_id,
  s.ban_matches,
  s.suspended_from_match_id,
  m.match_code,
  m.matchday,
  m.match_date,
  m.status as match_status,
  case
    when m.id is null then 'ORPHANED: Match does not exist'
    when m.status = 'scheduled' then 'USABLE: Scheduled'
    when m.status = 'finished' then 'COMPLETED: Already finished'
    when m.status = 'postponed' then 'UNUSABLE: Postponed'
    when m.status = 'cancelled' then 'UNUSABLE: Cancelled'
    else 'UNKNOWN: ' || m.status
  end as serving_match_usability,
  s.created_at
from public.suspensions s
left join public.matches m on m.id = s.suspended_from_match_id
where (s.suspension_type is null or s.suspension_type = 'legacy')
  and s.suspended_from_match_id is not null
order by s.id;

-- Expected Output:
--   USABLE or COMPLETED status for most records
--
-- Issues to flag:
--   - ORPHANED: Cannot proceed with migration
--   - UNUSABLE: May need to recalculate serving matches


-- ============================================================================
-- Query 7.2: Event-Based Serving Matches Verification
-- Expected: All serving_match_ids should point to valid matches
-- ============================================================================

select
  s.id as suspension_id,
  s.player_id,
  s.team_id,
  s.suspension_type,
  s.ban_matches,
  array_length(s.serving_match_ids, 1) as serving_count,
  m.id as match_id,
  m.match_code,
  m.status as match_status,
  case
    when m.id is null then 'ORPHANED: Match does not exist'
    when m.status = 'scheduled' then 'USABLE: Scheduled'
    when m.status = 'finished' then 'COMPLETED: Already finished'
    when m.status in ('postponed', 'cancelled') then 'UNUSABLE: ' || m.status
    else 'UNKNOWN: ' || m.status
  end as usability
from public.suspensions s
cross join lateral unnest(s.serving_match_ids) as serving_id
left join public.matches m on m.id = serving_id
where s.suspension_type is not null
  and s.suspension_type <> 'legacy'
  and s.serving_match_ids is not null
order by s.id;

-- Expected Output:
--   Mostly USABLE or COMPLETED
--
-- Issues to flag:
--   - ORPHANED: Match referenced but doesn't exist
--   - UNUSABLE: Match is postponed/cancelled (shouldn't be in array)


-- ============================================================================
-- Query 7.3: Serving Match Count vs Ban Matches
-- Expected: serving_match_ids count should match or exceed ban_matches
-- ============================================================================

select
  s.id as suspension_id,
  s.player_id,
  s.team_id,
  s.suspension_type,
  s.ban_matches,
  array_length(s.serving_match_ids, 1) as serving_count,
  case
    when array_length(s.serving_match_ids, 1) >= s.ban_matches then 'OK'
    when array_length(s.serving_match_ids, 1) is null then 'MISSING_ARRAY'
    when array_length(s.serving_match_ids, 1) < s.ban_matches then 'INSUFFICIENT: ' || s.ban_matches || ' needed, ' || array_length(s.serving_match_ids, 1) || ' available'
    else 'UNKNOWN'
  end as adequacy,
  s.created_at
from public.suspensions s
where s.suspension_type is not null
  and s.suspension_type <> 'legacy'
  and s.ban_matches > 0
order by s.id;

-- Expected Output:
--   Mostly 'OK'
--
-- Acceptable:
--   - Fewer matches if season ending (acceptable with note)
--
-- Issues:
--   - MISSING_ARRAY: Cannot proceed
--   - INSUFFICIENT: Incomplete serving


-- ============================================================================
-- Query 7.4: Legacy Records Missing Serving Match
-- Expected: Identify records that cannot determine which match to use
-- ============================================================================

select
  s.id,
  s.player_id,
  s.team_id,
  s.total_points,
  s.ban_matches,
  s.suspended_from_match_id,
  'Cannot serve suspension: no serving match' as issue
from public.suspensions s
where (s.suspension_type is null or s.suspension_type = 'legacy')
  and s.suspended_from_match_id is null
  and s.ban_matches > 0;

-- Expected Result:
--   0 rows = GOOD
--   >0 rows = These records cannot be migrated


-- ============================================================================
-- Query 7.5: Serving Match Chronology Verification
-- Expected: Verify serving matches come AFTER trigger match
-- ============================================================================

with match_pairs as (
  select
    s.id as suspension_id,
    s.trigger_match_id,
    sm.id as serving_match_id,
    sm.match_code as serving_code,
    tm.match_code as trigger_code,
    tm.match_date as trigger_date,
    tm.match_time as trigger_time,
    sm.match_date as serving_date,
    sm.match_time as serving_time,
    case
      when sm.match_date > tm.match_date then 'VALID: Later date'
      when sm.match_date = tm.match_date and sm.match_time > tm.match_time then 'VALID: Same day, later time'
      when sm.id = tm.id then 'ERROR: Same match used for trigger and serving'
      when sm.match_date < tm.match_date then 'ERROR: Serving match is earlier'
      else 'UNKNOWN'
    end as chronology_check
  from public.suspensions s
  cross join lateral unnest(s.serving_match_ids) as serving_id
  left join public.matches sm on sm.id = serving_id
  left join public.matches tm on tm.id = s.trigger_match_id
  where s.suspension_type is not null
    and s.suspension_type <> 'legacy'
    and s.trigger_match_id is not null
)
select *
from match_pairs
where chronology_check like 'ERROR%';

-- Expected Result:
--   0 rows = GOOD (all chronology is correct)
--   >0 rows = DATA CORRUPTION (serving before trigger)


-- ============================================================================
-- Query 7.6: Serving Match Audit Summary
-- Expected: One row with all audit results
-- ============================================================================

select
  (select count(*) from public.suspensions s
   left join public.matches m on m.id = s.suspended_from_match_id
   where (s.suspension_type is null or s.suspension_type = 'legacy')
     and s.suspended_from_match_id is not null
     and m.id is null) as orphaned_serving_matches,
  (select count(*) from public.suspensions s
   left join public.matches m on m.id = s.suspended_from_match_id
   where (s.suspension_type is null or s.suspension_type = 'legacy')
     and s.suspended_from_match_id is not null
     and m.status in ('postponed', 'cancelled')) as unusable_serving_matches,
  (select count(*) from public.suspensions s
   where (s.suspension_type is null or s.suspension_type = 'legacy')
     and s.suspended_from_match_id is null
     and s.ban_matches > 0) as missing_serving_matches,
  (select count(*) from public.suspensions s
   where s.suspension_type is not null
     and s.suspension_type <> 'legacy'
     and s.serving_match_ids is not null
     and array_length(s.serving_match_ids, 1) < s.ban_matches) as insufficient_event_serving;

-- Summary of all serving match issues
-- Ideally all counts should be 0

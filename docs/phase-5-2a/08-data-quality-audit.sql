-- PHASE 5.2A — Loop 8: Data Quality Audit
-- ⚠️ READ-ONLY SCRIPT — No data modifications
-- Purpose: Overall data quality check before migration

-- ============================================================================
-- Query 8.1: Missing Required Fields
-- Expected: Check for NULL values in required fields
-- ============================================================================

select
  'Suspensions missing player_id' as check_name,
  count(*) as count
from public.suspensions
where player_id is null

union all

select
  'Suspensions missing team_id',
  count(*)
from public.suspensions
where team_id is null

union all

select
  'Suspensions missing season_id',
  count(*)
from public.suspensions
where season_id is null

union all

select
  'Suspensions missing age_group_id',
  count(*)
from public.suspensions
where age_group_id is null

union all

select
  'Suspensions with negative ban_matches',
  count(*)
from public.suspensions
where ban_matches < 0

union all

select
  'Suspensions with negative total_points',
  count(*)
from public.suspensions
where total_points < 0;

-- Expected Result:
--   All counts = 0 (no issues)
--   >0 counts = Data corruption


-- ============================================================================
-- Query 8.2: Foreign Key Integrity
-- Expected: All player_id, team_id, season_id should reference existing records
-- ============================================================================

select
  'Suspensions with non-existent player' as check_name,
  count(*) as count
from public.suspensions s
where s.player_id is not null
  and not exists (select 1 from public.players p where p.id = s.player_id)

union all

select
  'Suspensions with non-existent team',
  count(*)
from public.suspensions s
where s.team_id is not null
  and not exists (select 1 from public.teams t where t.id = s.team_id)

union all

select
  'Suspensions with non-existent season',
  count(*)
from public.suspensions s
where s.season_id is not null
  and not exists (select 1 from public.seasons s2 where s2.id = s.season_id)

union all

select
  'Suspensions with non-existent suspended_from_match',
  count(*)
from public.suspensions s
where s.suspended_from_match_id is not null
  and not exists (select 1 from public.matches m where m.id = s.suspended_from_match_id);

-- Expected Result:
--   All counts = 0 (all references exist)
--   >0 counts = Orphaned records


-- ============================================================================
-- Query 8.3: Points/Ban Consistency
-- Expected: Points and ban_matches should follow expected mapping
-- ============================================================================

select
  'Invalid point threshold (not 6, 12, 18, 24)' as check_name,
  count(*) as count
from public.suspensions
where total_points > 0
  and total_points not in (6, 12, 18, 24)
  and (suspension_type is null or suspension_type = 'legacy' or suspension_type = 'accumulated_points')

union all

select
  'Points but no ban_matches',
  count(*)
from public.suspensions
where total_points > 0 and ban_matches = 0

union all

select
  'Ban matches but no total_points and no ban_reason',
  count(*)
from public.suspensions
where ban_matches > 0
  and total_points = 0
  and (suspension_reason is null or suspension_reason = '')

union all

select
  'Mismatched points and bans',
  count(*)
from public.suspensions
where (
  (total_points = 6 and ban_matches <> 1)
  or (total_points = 12 and ban_matches <> 2)
  or (total_points = 18 and ban_matches <> 3)
  or (total_points >= 24 and ban_matches <> 4)
);

-- Expected Result:
--   All counts = 0
--   >0 counts = Data quality issues


-- ============================================================================
-- Query 8.4: Text Field Quality
-- Expected: Check for suspicious values in reason/details fields
-- ============================================================================

select
  s.id,
  s.player_id,
  s.suspension_reason,
  length(s.suspension_reason) as reason_length,
  case
    when s.suspension_reason is null then 'MISSING'
    when s.suspension_reason = '' then 'EMPTY_STRING'
    when length(s.suspension_reason) > 1000 then 'SUSPICIOUSLY_LONG'
    when s.suspension_reason like '%<script%' then 'POSSIBLE_INJECTION'
    when s.suspension_reason like '%';'%' then 'POSSIBLE_SQL'
    else 'OK'
  end as reason_quality
from public.suspensions s
where (s.suspension_type is null or s.suspension_type = 'legacy')
  and (
    s.suspension_reason is null
    or s.suspension_reason = ''
    or length(s.suspension_reason) > 1000
    or s.suspension_reason like '%<script%'
    or s.suspension_reason like '%';'%'
  );

-- Expected Result:
--   0 rows (no quality issues)
--   >0 rows = Investigate


-- ============================================================================
-- Query 8.5: Complete Data Quality Report
-- Expected: One row summarizing all checks
-- ============================================================================

select
  count(*) as total_suspensions,
  count(*) filter (where player_id is null or team_id is null or season_id is null) as missing_fk,
  count(*) filter (where ban_matches < 0 or total_points < 0) as invalid_numbers,
  count(*) filter (where total_points > 0 and total_points not in (6, 12, 18, 24)) as invalid_thresholds,
  count(*) filter (where total_points > 0 and ban_matches = 0) as points_no_ban,
  count(*) filter (where ban_matches > 0 and total_points = 0 and (suspension_reason is null or suspension_reason = '')) as ban_no_reason,
  count(*) filter (where suspension_reason is null or suspension_reason = '') as missing_reason,
  case
    when count(*) filter (where player_id is null or team_id is null or season_id is null) > 0 then 'FAIL'
    when count(*) filter (where ban_matches < 0 or total_points < 0) > 0 then 'FAIL'
    when count(*) filter (where total_points > 0 and total_points not in (6, 12, 18, 24)) > 0 then 'WARNING'
    when count(*) filter (where points_no_ban > 0) > 0 then 'WARNING'
    else 'PASS'
  end as overall_quality
from public.suspensions;

-- Overall quality check
-- PASS = Ready for migration
-- WARNING = Proceed with caution
-- FAIL = Stop, fix data issues first

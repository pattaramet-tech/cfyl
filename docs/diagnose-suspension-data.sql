-- Diagnostic: Inspect suspension data before migration
-- Run these queries to understand current state and identify issues
-- DO NOT run any UPDATE/DELETE statements here - inspect only

-- 1) Find duplicate suspension records (same player+team)
-- These should not exist after migration with proper unique index
select
  player_id,
  team_id,
  count(*) as duplicate_count,
  array_agg(id order by created_at) as suspension_ids,
  array_agg(created_at order by created_at) as created_dates
from public.suspensions
group by player_id, team_id
having count(*) > 1
order by duplicate_count desc;

-- 2) Suspensions pointing to non-scheduled serving match
-- These violate the rule: only scheduled matches can be suspension-serving matches
select
  s.id as suspension_id,
  s.player_id,
  s.team_id,
  s.ban_matches,
  s.total_points,
  s.suspended_from_match_id,
  m.match_code,
  m.matchday,
  m.status as match_status,
  m.match_date,
  m.match_time
from public.suspensions s
join public.matches m
  on m.id = s.suspended_from_match_id
where m.status <> 'scheduled'
order by m.match_date desc, m.match_time desc;

-- 3) Suspensions that appear to be already served
-- Match is finished → suspension should not be active anymore
select
  s.id as suspension_id,
  s.player_id,
  s.team_id,
  s.ban_matches,
  s.total_points,
  s.suspended_from_match_id,
  m.match_code,
  m.matchday,
  m.status as match_status,
  m.match_date,
  m.match_time,
  s.created_at,
  s.updated_at,
  (now() - m.match_date::timestamp) as time_since_match
from public.suspensions s
join public.matches m
  on m.id = s.suspended_from_match_id
where m.status = 'finished'
order by m.match_date desc, m.match_time desc
limit 50;

-- 4) Check for potential points overflow
-- Players with very high total_points that might indicate calculation errors
select
  player_id,
  team_id,
  total_points,
  ban_matches,
  created_at,
  updated_at,
  p.full_name,
  t.name as team_name
from public.suspensions s
join public.players p on p.id = s.player_id
join public.teams t on t.id = s.team_id
where total_points > 24
order by total_points desc;

-- 5) Count current suspensions by presumed type (before migration)
-- After migration, these will be properly categorized
select
  count(*) as total_suspensions,
  count(case when total_points >= 6 then 1 end) as likely_accumulated_points,
  count(case when total_points < 6 then 1 end) as likely_ejection_or_manual,
  count(case when suspended_from_match_id is null then 1 end) as missing_trigger_match
from public.suspensions;

-- 6) Summary statistics
select
  'Total suspensions' as metric,
  count(*)::text as value
from public.suspensions
union all
select
  'Suspensions with ban_matches > 0' as metric,
  count(*)::text as value
from public.suspensions
where ban_matches > 0
union all
select
  'Suspensions missing suspended_from_match_id' as metric,
  count(*)::text as value
from public.suspensions
where suspended_from_match_id is null;

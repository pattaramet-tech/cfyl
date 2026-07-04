-- Check teams in a division and whether they are active
-- Use this to verify which teams are inactive and should not appear in standings

-- Check teams in U17 Division 2 by name
select
  t.id,
  t.name,
  t.short_name,
  t.active,
  t.season_id,
  t.age_group_id,
  t.division_id,
  t.created_at
from public.teams t
where t.division_id = '<DIVISION_ID>'
order by t.active desc, t.name;

-- Find Nong Hiang team specifically
select
  t.id,
  t.name,
  t.short_name,
  t.active,
  t.season_id,
  t.age_group_id,
  t.division_id,
  t.created_at,
  t.updated_at
from public.teams t
where t.name ilike '%หนองเหียง%'
order by t.created_at desc;

-- Count active vs inactive teams by division
select
  d.id,
  d.name,
  count(*) filter (where t.active = true) as active_teams,
  count(*) filter (where t.active = false) as inactive_teams,
  count(*) as total_teams
from public.divisions d
left join public.teams t on t.division_id = d.id
group by d.id, d.name
order by d.name;

-- Optional: if you need to deactivate the extra team, run:
-- update public.teams
-- set active = false, updated_at = now()
-- where id = '<TEAM_ID_OF_อบต_หนองเหียง>';

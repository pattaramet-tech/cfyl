-- Phase 5.2C — Step 1: Find test players matching each scenario
-- Run in Supabase SQL Editor to identify real players to test against
-- These are READ-ONLY queries — no data is modified

-- ============================================================================
-- Get active season & age group IDs for context
-- ============================================================================
select
  s.id as season_id,
  s.name as season_name,
  ag.id as age_group_id,
  ag.code as age_group_code
from public.seasons s
join public.age_groups ag on ag.season_id = s.id
order by s.created_at desc, ag.sort_order asc
limit 5;

-- ============================================================================
-- SCENARIO 1: Player with 3 normal yellow cards → 6 accumulated pts → 1-match ban
-- Replace :season_id and :age_group_id with real values from query above
-- ============================================================================
with match_ids as (
  select id from public.matches
  where season_id = :season_id and age_group_id = :age_group_id
),
player_cards as (
  select
    c.player_id,
    c.team_id,
    c.match_id,
    c.card_type,
    c.id as card_id
  from public.cards c
  where c.match_id in (select id from match_ids)
),
per_player as (
  select
    player_id,
    team_id,
    count(*) filter (where card_type = 'yellow') as yellow_count,
    count(*) filter (where card_type = 'red') as red_count,
    count(*) filter (where card_type = 'second_yellow') as sy_count
  from player_cards
  group by player_id, team_id
)
select
  pp.player_id,
  pp.team_id,
  p.full_name,
  t.name as team_name,
  pp.yellow_count,
  pp.red_count,
  pp.sy_count,
  pp.yellow_count * 2 as accumulated_points
from per_player pp
join public.players p on p.id = pp.player_id
join public.teams t on t.id = pp.team_id
-- Exactly 3 yellows, no reds, no second_yellows → 6 pts threshold
where pp.yellow_count = 3 and pp.red_count = 0 and pp.sy_count = 0
limit 5;

-- ============================================================================
-- SCENARIO 2: Player with a direct red (no yellow in same match)
-- ============================================================================
with match_ids as (
  select id from public.matches
  where season_id = :season_id and age_group_id = :age_group_id
),
per_player_match as (
  select
    player_id,
    team_id,
    match_id,
    count(*) filter (where card_type = 'yellow') as yellow_count,
    count(*) filter (where card_type = 'red') as red_count,
    count(*) filter (where card_type = 'second_yellow') as sy_count
  from public.cards
  where match_id in (select id from match_ids)
  group by player_id, team_id, match_id
)
select distinct on (ppm.player_id)
  ppm.player_id,
  ppm.team_id,
  ppm.match_id as trigger_match_id,
  p.full_name,
  t.name as team_name
from per_player_match ppm
join public.players p on p.id = ppm.player_id
join public.teams t on t.id = ppm.team_id
where ppm.red_count >= 1 and ppm.yellow_count = 0 and ppm.sy_count = 0
limit 5;

-- ============================================================================
-- SCENARIO 3: Player with second_yellow ejection (2 yellows OR second_yellow card)
-- ============================================================================
with match_ids as (
  select id from public.matches
  where season_id = :season_id and age_group_id = :age_group_id
),
per_player_match as (
  select
    player_id,
    team_id,
    match_id,
    count(*) filter (where card_type = 'yellow') as yellow_count,
    count(*) filter (where card_type = 'red') as red_count,
    count(*) filter (where card_type = 'second_yellow') as sy_count
  from public.cards
  where match_id in (select id from match_ids)
  group by player_id, team_id, match_id
)
select distinct on (ppm.player_id)
  ppm.player_id,
  ppm.team_id,
  ppm.match_id as trigger_match_id,
  p.full_name,
  t.name as team_name,
  ppm.yellow_count,
  ppm.sy_count
from per_player_match ppm
join public.players p on p.id = ppm.player_id
join public.teams t on t.id = ppm.team_id
where ppm.red_count = 0 and (ppm.sy_count >= 1 or ppm.yellow_count >= 2)
limit 5;

-- ============================================================================
-- SCENARIO 4: Player with yellow + red in same match
-- ============================================================================
with match_ids as (
  select id from public.matches
  where season_id = :season_id and age_group_id = :age_group_id
),
per_player_match as (
  select
    player_id,
    team_id,
    match_id,
    count(*) filter (where card_type = 'yellow') as yellow_count,
    count(*) filter (where card_type = 'red') as red_count
  from public.cards
  where match_id in (select id from match_ids)
  group by player_id, team_id, match_id
)
select distinct on (ppm.player_id)
  ppm.player_id,
  ppm.team_id,
  ppm.match_id as trigger_match_id,
  p.full_name,
  t.name as team_name
from per_player_match ppm
join public.players p on p.id = ppm.player_id
join public.teams t on t.id = ppm.team_id
where ppm.red_count >= 1 and ppm.yellow_count >= 1
limit 5;

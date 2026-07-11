-- Phase 5.3 — READ-ONLY SQL Audit
-- Run in Supabase SQL Editor after each recalculation or match schedule change
-- Replace :season_id and :age_group_id with real values

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 1: Counts by type
-- ══════════════════════════════════════════════════════════════════════
select
  coalesce(suspension_type, 'NULL (legacy)') as type,
  count(*) as count
from public.suspensions
where season_id = :season_id
  and age_group_id = :age_group_id
group by suspension_type
order by count desc;

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 2: EVENT_DUPLICATE_KEY
-- Expect: 0 rows
-- ══════════════════════════════════════════════════════════════════════
select
  player_id, team_id, trigger_match_id, suspension_type,
  coalesce(accumulated_threshold, 0) as threshold,
  count(*) as duplicate_count
from public.suspensions
where season_id = :season_id
  and age_group_id = :age_group_id
  and suspension_type in ('accumulated_points','second_yellow','direct_red','yellow_red')
group by player_id, team_id, trigger_match_id, suspension_type, coalesce(accumulated_threshold, 0)
having count(*) > 1;

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 3: SOURCE_CARD_NOT_FOUND
-- Expect: 0 rows
-- ══════════════════════════════════════════════════════════════════════
with unnested_cards as (
  select
    s.id as suspension_id,
    s.player_id,
    s.suspension_type,
    unnest(s.source_card_ids) as card_id
  from public.suspensions s
  where s.season_id = :season_id
    and s.age_group_id = :age_group_id
    and s.suspension_type in ('accumulated_points','second_yellow','direct_red','yellow_red')
)
select
  u.suspension_id,
  u.player_id,
  u.suspension_type,
  u.card_id,
  case when c.id is null then '✗ CARD NOT FOUND' else '✓ OK' end as check_result
from unnested_cards u
left join public.cards c on c.id = u.card_id
where c.id is null;

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 4: SERVING_MATCH_POSTPONED / CANCELLED
-- Expect: 0 rows
-- ══════════════════════════════════════════════════════════════════════
with unnested_serving as (
  select
    s.id as suspension_id,
    s.player_id,
    s.team_id,
    s.suspension_type,
    unnest(s.serving_match_ids) as serving_match_id
  from public.suspensions s
  where s.season_id = :season_id
    and s.age_group_id = :age_group_id
    and s.suspension_type in ('accumulated_points','second_yellow','direct_red','yellow_red')
)
select
  u.suspension_id,
  u.player_id,
  u.suspension_type,
  u.serving_match_id,
  m.status,
  case
    when m.id is null       then 'SERVING_MATCH_NOT_FOUND'
    when m.status = 'postponed'  then 'SERVING_MATCH_POSTPONED'
    when m.status = 'cancelled'  then 'SERVING_MATCH_CANCELLED'
    else 'OK'
  end as issue
from unnested_serving u
left join public.matches m on m.id = u.serving_match_id
where m.id is null
   or m.status in ('postponed','cancelled');

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 5: ACTIVE_BAN_WITHOUT_REMAINING_SCHEDULED_MATCH
-- ══════════════════════════════════════════════════════════════════════
with serving_counts as (
  select
    s.id,
    s.player_id,
    s.team_id,
    s.suspension_type,
    s.ban_matches,
    count(m.id) filter (where m.status = 'scheduled') as scheduled_count,
    count(m.id) filter (where m.status = 'finished')  as served_count
  from public.suspensions s
  left join lateral unnest(s.serving_match_ids) as sid on true
  left join public.matches m on m.id = sid
  where s.season_id = :season_id
    and s.age_group_id = :age_group_id
    and s.suspension_type in ('accumulated_points','second_yellow','direct_red','yellow_red')
    and s.ban_matches > 0
    and s.served_completed_at is null
  group by s.id, s.player_id, s.team_id, s.suspension_type, s.ban_matches
)
select *
from serving_counts
where scheduled_count = 0;

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 6: Legacy records preserved
-- ══════════════════════════════════════════════════════════════════════
select count(*) as legacy_count
from public.suspensions
where season_id = :season_id
  and age_group_id = :age_group_id
  and (suspension_type is null or suspension_type in ('legacy','manual'));

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 7: SERVED_COMPLETED_AT_INCONSISTENT
-- ══════════════════════════════════════════════════════════════════════
with slot_check as (
  select
    s.id,
    s.player_id,
    s.suspension_type,
    s.ban_matches,
    s.served_completed_at,
    count(m.id) filter (where m.status = 'finished') as finished_slots
  from public.suspensions s
  left join lateral unnest(s.serving_match_ids) as sid on true
  left join public.matches m on m.id = sid
  where s.season_id = :season_id
    and s.age_group_id = :age_group_id
    and s.suspension_type in ('accumulated_points','second_yellow','direct_red','yellow_red')
    and s.ban_matches > 0
  group by s.id, s.player_id, s.suspension_type, s.ban_matches, s.served_completed_at
)
select *,
  case
    when served_completed_at is not null and finished_slots < ban_matches
      then 'served_completed_at SET but not all slots finished'
    when served_completed_at is null and finished_slots >= ban_matches
      then 'all slots finished but served_completed_at is NULL'
    else 'OK'
  end as issue
from slot_check
where (served_completed_at is not null and finished_slots < ban_matches)
   or (served_completed_at is null and finished_slots >= ban_matches and ban_matches > 0);

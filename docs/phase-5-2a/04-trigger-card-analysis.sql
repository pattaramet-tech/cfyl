-- PHASE 5.2A — Loop 4: Trigger Card Analysis
-- ⚠️ READ-ONLY SCRIPT — No data modifications
-- Purpose: Find potential trigger matches (where cards were given) for legacy suspensions

-- ============================================================================
-- Query 4.1: All Cards for Players with Legacy Suspensions
-- Expected: Returns ALL cards for players that have legacy suspensions
-- ============================================================================

select
  c.id as card_id,
  c.player_id,
  p.full_name as player_name,
  c.team_id,
  t.name as team_name,
  c.match_id,
  m.match_code,
  m.matchday,
  m.match_date,
  m.match_time,
  m.status as match_status,
  c.card_type,
  c.unit as card_count,
  c.minute,
  c.note as card_note,
  c.created_at as card_created_at,
  m.created_at as match_created_at
from public.cards c
join public.matches m on m.id = c.match_id
left join public.players p on p.id = c.player_id
left join public.teams t on t.id = c.team_id
where c.player_id in (
  select distinct player_id
  from public.suspensions
  where suspension_type is null
     or suspension_type = 'legacy'
)
order by c.player_id, m.match_date, m.match_time, c.minute, c.created_at;

-- Expected Output Columns:
--   card_id: UUID of card
--   player_id, player_name: Player information
--   team_id, team_name: Team information
--   match_id: Which match the card was given
--   match_code, matchday, match_date, match_time: Match details
--   match_status: scheduled, finished, postponed, cancelled
--   card_type: Yellow, Red, second_yellow
--   card_count: Number of cards (usually 1)
--   minute: Minute card was given
--   card_note, card_created_at: Additional card details
--   match_created_at: When match was recorded

-- Critical Inspection:
-- For EACH legacy suspension, identify the trigger match:
--   1. Find the most likely match where card(s) were given
--   2. Total points calculation:
--      - 1 yellow = 2 points
--      - 2 yellows or 1 second_yellow = 4 points
--      - 1 red = 6 points
--      - 1 yellow + 1 red = 8 points
--   3. Match to suspension's total_points
--   4. Determine suspension_type:
--      - If card_type = 'Red' → direct_red
--      - If card_type = 'second_yellow' → second_yellow
--      - If both Yellow and Red → yellow_red
--      - If multiple yellows only → accumulated_points


-- ============================================================================
-- Query 4.2: Aggregated Cards by Player & Match
-- Expected: Shows card summary per match for each player
-- ============================================================================

select
  c.player_id,
  p.full_name as player_name,
  c.team_id,
  c.match_id,
  m.match_code,
  m.matchday,
  m.match_date,
  m.status as match_status,
  count(*) as card_count,
  count(*) filter (where c.card_type = 'Yellow') as yellow_count,
  count(*) filter (where c.card_type = 'Red') as red_count,
  count(*) filter (where c.card_type = 'second_yellow') as second_yellow_count,
  case
    when count(*) filter (where c.card_type = 'Red') > 0
      and (count(*) filter (where c.card_type = 'Yellow') > 0
           or count(*) filter (where c.card_type = 'second_yellow') > 0)
      then 'yellow_red_ejection'
    when count(*) filter (where c.card_type = 'Red') > 0
      then 'direct_red_ejection'
    when count(*) filter (where c.card_type = 'second_yellow') > 0
      then 'second_yellow_ejection'
    when count(*) filter (where c.card_type = 'Yellow') >= 2
      or count(*) filter (where c.card_type = 'second_yellow') >= 1
      then 'multiple_yellow'
    else 'single_yellow'
  end as card_pattern,
  case
    when count(*) filter (where c.card_type = 'Red') > 0
      and (count(*) filter (where c.card_type = 'Yellow') > 0
           or count(*) filter (where c.card_type = 'second_yellow') > 0)
      then 8
    when count(*) filter (where c.card_type = 'Red') > 0
      then 6
    when count(*) filter (where c.card_type = 'second_yellow') > 0
      then 4
    when count(*) filter (where c.card_type = 'Yellow') >= 2
      or count(*) filter (where c.card_type = 'second_yellow') >= 1
      then 4
    when count(*) filter (where c.card_type = 'Yellow') = 1
      then 2
    else 0
  end as calculated_points
from public.cards c
join public.matches m on m.id = c.match_id
left join public.players p on p.id = c.player_id
where c.player_id in (
  select distinct player_id
  from public.suspensions
  where suspension_type is null
     or suspension_type = 'legacy'
)
group by c.player_id, p.full_name, c.team_id, c.match_id, m.match_code, m.matchday, m.match_date, m.status
order by c.player_id, m.match_date, m.match_time;

-- Use this to match against legacy suspensions:
--   1. Find suspension with matching total_points
--   2. Verify the match came before suspended_from_match_id
--   3. Confirm card_pattern matches suspension_reason


-- ============================================================================
-- Query 4.3: Suspension + Potential Trigger Match Candidates
-- Expected: Returns suspensions with potential trigger matches
-- ============================================================================

select
  s.id as suspension_id,
  s.player_id,
  s.team_id,
  s.total_points,
  s.ban_matches,
  s.suspended_from_match_id,
  sm.match_code as serving_match_code,
  sm.match_date as serving_match_date,
  -- Try to find trigger match from suspension_details
  coalesce(
    s.suspension_details->>'trigger_match_id',
    (
      select c.match_id
      from public.cards c
      where c.player_id = s.player_id
        and c.team_id = s.team_id
      order by c.created_at desc
      limit 1
    )::text
  ) as inferred_trigger_match_id,
  s.suspension_reason,
  s.created_at
from public.suspensions s
left join public.matches sm on sm.id = s.suspended_from_match_id
where (s.suspension_type is null or s.suspension_type = 'legacy')
  and s.ban_matches > 0
order by s.created_at desc;

-- Helps identify trigger matches even if not explicitly stored


-- ============================================================================
-- Query 4.4: Missing Trigger Matches (Cannot be Auto-Migrated)
-- Expected: May return 0 or more records
-- ============================================================================

select
  s.id as suspension_id,
  s.player_id,
  p.full_name,
  s.team_id,
  s.total_points,
  s.ban_matches,
  s.suspended_from_match_id,
  s.suspension_details->>'trigger_match_id' as detail_trigger_match,
  'CRITICAL: No clear trigger match' as issue,
  count(c.id) as matching_card_count
from public.suspensions s
left join public.players p on p.id = s.player_id
left join public.cards c on (
  c.player_id = s.player_id
  and c.team_id = s.team_id
  and c.created_at < s.created_at
)
where (s.suspension_type is null or s.suspension_type = 'legacy')
  and s.ban_matches > 0
  and (s.suspension_details->>'trigger_match_id' is null or s.suspension_details->>'trigger_match_id' = '')
group by s.id, s.player_id, p.full_name, s.team_id, s.total_points, s.ban_matches, s.suspended_from_match_id, s.suspension_details
having count(c.id) = 0;

-- These records will require manual review to identify trigger match

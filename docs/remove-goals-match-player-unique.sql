-- Allow multiple goal events per player in the same match.
-- Needed for separate goal minutes, e.g. same player scores at 15', 19', 30'.
--
-- Run this in Supabase SQL Editor or your migration process.

alter table public.goals
drop constraint if exists goals_match_id_player_id_key;

-- Verify constraint was removed:
-- select conname
-- from pg_constraint
-- where conrelid = 'public.goals'::regclass
-- and conname like 'goals_%key';

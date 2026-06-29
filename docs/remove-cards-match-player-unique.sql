-- Allow multiple card events per player in the same match.
-- Needed for yellow + second_yellow / red / multiple incidents.
--
-- Error fixed:
-- duplicate key value violates unique constraint "cards_match_id_player_id_key"
--
-- Run this in Supabase SQL Editor after deploying/pulling the latest code.

alter table public.cards
  drop constraint if exists cards_match_id_player_id_key;

-- Optional check:
-- select conname
-- from pg_constraint
-- where conrelid = 'public.cards'::regclass
-- order by conname;

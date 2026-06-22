-- Phase 5A.3: make players.division_id and matches.division_id optional
-- Run this in the Supabase SQL Editor.
--
-- League players/matches keep their division_id (data unchanged); FKs stay in place.
-- Tournament/mixed players (on division-less teams) and tournament group-stage
-- matches may now have division_id = NULL.

alter table public.players alter column division_id drop not null;
alter table public.matches alter column division_id drop not null;

-- Phase 5A.2 Hotfix: make teams.division_id optional (for tournament seasons)
-- Run this in the Supabase SQL Editor.
--
-- League teams keep their division_id (data unchanged); the FK stays in place.
-- Tournament/mixed teams may now have division_id = NULL and be organised via
-- tournament_groups instead.

alter table public.teams alter column division_id drop not null;

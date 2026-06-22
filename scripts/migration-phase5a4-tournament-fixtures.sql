-- Phase 5A.4: Tournament fixtures (manual + import)
-- Run this in the Supabase SQL Editor.
--
-- Adds a link from a match to its tournament group, and a free-text venue.
-- `stage` already exists (Phase 5A). Existing league matches are unaffected.

alter table public.matches
  add column if not exists tournament_group_id uuid references public.tournament_groups(id) on delete set null;

alter table public.matches
  add column if not exists venue text;

create index if not exists idx_matches_tournament_group on public.matches (tournament_group_id);

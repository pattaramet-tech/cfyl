-- Phase 5A.2: Allow flexible age-group codes (U12, U16, U18, ...)
-- Run this in the Supabase SQL Editor.
--
-- The original schema restricted age_groups.code to ('U14','U17'), which blocks
-- tournament seasons that use other age groups. We drop that CHECK so any code is
-- allowed. The UNIQUE(season_id, code) constraint stays (no duplicates per season).

alter table public.age_groups drop constraint if exists age_groups_code_check;

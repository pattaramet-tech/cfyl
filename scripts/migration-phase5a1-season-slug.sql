-- Phase 5A.1: Season slug + allow multiple seasons per year
-- IMPORTANT: deploy the Phase 5A.1 code FIRST, then run this in Supabase SQL Editor.
-- (Dropping the year-unique constraint is safe only once the code resolves seasons
--  by slug-or-year and validates slug uniqueness.)

-- 1) add slug column
alter table public.seasons add column if not exists season_slug text;

-- 2) backfill from name: "CFYL 2026" -> "cfyl-2026"
update public.seasons
set season_slug = trim(both '-' from lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')))
where season_slug is null or season_slug = '';

-- 3) unique slug
create unique index if not exists seasons_season_slug_key on public.seasons (season_slug);

-- 4) drop the old year-unique constraint so multiple seasons can share a year
alter table public.seasons drop constraint if exists seasons_year_key;

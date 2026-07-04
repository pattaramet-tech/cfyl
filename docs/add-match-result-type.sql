-- Add result_type column for bye/normal match results
-- This allows matches to be marked as 'home_win_by_bye' or 'away_win_by_bye'
-- without needing goal records or player scoring data

-- Step 1: Add column with default 'normal'
alter table public.matches
add column if not exists result_type text not null default 'normal';

-- Step 2: Add constraint to restrict values
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'matches_result_type_check'
  ) then
    alter table public.matches
    add constraint matches_result_type_check
    check (result_type in ('normal', 'home_win_by_bye', 'away_win_by_bye'));
  end if;
end $$;

-- Step 3: Add column comment
comment on column public.matches.result_type is
'Match result type: normal = ผลแข่งขันปกติ, home_win_by_bye = ทีมเหย้าชนะบาย, away_win_by_bye = ทีมเยือนชนะบาย';

-- Usage:
-- - normal: score can be anything, may have goal records
-- - home_win_by_bye: status=finished, home_score>away_score, no goal records needed
-- - away_win_by_bye: status=finished, away_score>home_score, no goal records needed
--
-- Default bye scores:
-- - home_win_by_bye: 2-0
-- - away_win_by_bye: 0-2

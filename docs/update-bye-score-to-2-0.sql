-- Optional migration: update existing bye result scores from 3-0 / 0-3 to 2-0 / 0-2
-- Run only if there are already bye matches saved with the old 3-0 rule.
-- This updates both the score and recalculates standings if needed.

-- Update home_win_by_bye scores from 3-0 to 2-0
update public.matches
set
  home_score = 2,
  away_score = 0,
  updated_at = now()
where result_type = 'home_win_by_bye'
  and home_score = 3
  and away_score = 0;

-- Update away_win_by_bye scores from 0-3 to 0-2
update public.matches
set
  home_score = 0,
  away_score = 2,
  updated_at = now()
where result_type = 'away_win_by_bye'
  and home_score = 0
  and away_score = 3;

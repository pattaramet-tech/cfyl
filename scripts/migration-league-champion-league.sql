-- CFYL League: post-league Champion League phase support.
-- Existing NULL values remain backward-compatible regular-league matches.

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS league_phase TEXT;

ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_league_phase_check;

ALTER TABLE matches
  ADD CONSTRAINT matches_league_phase_check
  CHECK (
    league_phase IS NULL
    OR league_phase IN ('regular', 'champion_league', 'final', 'third_place')
  );

CREATE INDEX IF NOT EXISTS idx_matches_league_phase_scope
  ON matches (season_id, age_group_id, division_id, league_phase, status);

COMMENT ON COLUMN matches.league_phase IS
  'League competition phase. NULL/regular=regular league; champion_league=top-4 round robin; final=rank 1-2 final; third_place=rank 3-4 playoff. Tournament V2 does not use this column.';

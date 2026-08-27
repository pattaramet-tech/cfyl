-- CFYL League: generated Champion League and placement fixture invariants.
-- Additive only. Do not execute automatically in production.
-- Tournament V2 does not use matches.league_phase and is unaffected.

-- At most one placement fixture of each phase per League scope.
-- This closes concurrent generate races for Final / Third Place at the DB layer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_matches_league_placement_phase_scope
  ON matches (season_id, age_group_id, division_id, league_phase)
  WHERE league_phase IN ('final', 'third_place');

COMMENT ON INDEX uq_matches_league_placement_phase_scope IS
  'League only: at most one Final and one Third Place fixture per season/age-group/division. Tournament V2 is unaffected.';

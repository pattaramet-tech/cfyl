-- CFYL League: post-league Champion League phase support.
-- Existing NULL values remain backward-compatible regular-league matches.
-- This migration is additive and is NOT used by Tournament V2.

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

ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_post_league_division_check;
ALTER TABLE matches
  ADD CONSTRAINT matches_post_league_division_check
  CHECK (
    league_phase IS NULL
    OR league_phase = 'regular'
    OR division_id IS NOT NULL
  );

-- Concurrency-safe invariant: one unordered Champion League pairing per League scope.
-- LEAST/GREATEST canonicalize home/away so A-v-B and B-v-A collide at the DB layer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_matches_champion_league_pair_scope
  ON matches (
    season_id,
    age_group_id,
    division_id,
    LEAST(home_team_id, away_team_id),
    GREATEST(home_team_id, away_team_id)
  )
  WHERE league_phase = 'champion_league';

COMMENT ON COLUMN matches.league_phase IS
  'League competition phase. NULL/regular=regular league; champion_league=top-4 round robin; final=rank 1-2 final; third_place=rank 3-4 playoff. Tournament V2 does not use this column.';

-- One immutable activation snapshot per League scope. The qualifiers JSON stores
-- the frozen final regular-league Top 4 and their league ranks. Public/API logic
-- must read this snapshot rather than recalculating qualifiers after activation.
CREATE TABLE IF NOT EXISTS league_champion_league_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  age_group_id UUID NOT NULL REFERENCES age_groups(id) ON DELETE CASCADE,
  division_id UUID NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  qualifiers JSONB NOT NULL,
  regular_match_count INT NOT NULL CHECK (regular_match_count > 0),
  activated_by UUID,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT league_champion_league_snapshot_qualifiers_check CHECK (
    jsonb_typeof(qualifiers) = 'array'
    AND jsonb_array_length(qualifiers) = 4
  ),
  CONSTRAINT league_champion_league_snapshot_scope_unique
    UNIQUE (season_id, age_group_id, division_id)
);

CREATE INDEX IF NOT EXISTS idx_league_champion_league_snapshot_scope
  ON league_champion_league_snapshots (season_id, age_group_id, division_id);

ALTER TABLE league_champion_league_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read Champion League snapshots"
  ON league_champion_league_snapshots;
CREATE POLICY "Public can read Champion League snapshots"
  ON league_champion_league_snapshots
  FOR SELECT
  USING (true);

COMMENT ON TABLE league_champion_league_snapshots IS
  'Immutable League Champion League activation snapshot. One row per season/age-group/division. Writes are server-side service-role only.';

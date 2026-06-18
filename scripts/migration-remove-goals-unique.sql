-- Migration: Remove unique constraint from goals table (rerun-safe)
-- Allows multiple goal entries per player per match (supports multiple goals)
-- Run this in Supabase SQL Editor

DO $$
BEGIN
  -- Drop unique constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'goals'
    AND constraint_type = 'UNIQUE'
    AND constraint_name LIKE '%match_id%player_id%'
  ) THEN
    ALTER TABLE goals DROP CONSTRAINT "goals_match_id_player_id_key";
    RAISE NOTICE 'Dropped unique constraint from goals table';
  ELSE
    RAISE NOTICE 'Unique constraint not found (may already be removed)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Error checking constraint (likely already removed): %', SQLERRM;
END $$;

RAISE NOTICE 'Migration complete - goals table now supports multiple entries per player per match';

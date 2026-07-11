-- ============================================================================
-- Phase 5.2C BLOCKER FIX: Drop legacy single-row-per-player unique constraint
-- ============================================================================
-- Problem:
--   The original suspensions table has:
--     UNIQUE(season_id, age_group_id, player_id, team_id)
--   This enforced one record per player per season — correct for the old system.
--   The event-based system creates MULTIPLE records per player per season
--   (one per ejection event, one per threshold crossing), which violates this constraint.
--
-- Safety:
--   - DROP CONSTRAINT IF EXISTS — idempotent, safe to run again
--   - Does NOT drop any data
--   - Does NOT change any existing records
--   - The new event-based uniqueness is enforced by the partial index
--     uniq_suspension_event_trigger:
--       (player_id, team_id, trigger_match_id, suspension_type, coalesce(accumulated_threshold,0))
--       WHERE trigger_match_id IS NOT NULL AND suspension_type IS NOT NULL
--   - Legacy records (suspension_type IS NULL) are excluded from all unique constraints
--
-- Prerequisite: Phase 5.2A migration (add 7 event columns) must already be applied.
-- ============================================================================

BEGIN;

-- Drop the old single-record-per-player constraint
ALTER TABLE public.suspensions
  DROP CONSTRAINT IF EXISTS suspensions_season_id_age_group_id_player_id_team_id_key;

COMMIT;

-- ============================================================================
-- POST-MIGRATION VERIFICATION
-- ============================================================================

-- Verify constraint is gone
SELECT
  'Constraint removed' AS check_name,
  CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.suspensions'::regclass
        AND conname = 'suspensions_season_id_age_group_id_player_id_team_id_key'
    )
    THEN '✓ PASS: Legacy unique constraint does not exist'
    ELSE '✗ FAIL: Constraint still exists'
  END AS status;

-- Verify partial unique index for event-based records still exists
SELECT
  'Event unique index present' AS check_name,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'suspensions'
        AND indexname = 'uniq_suspension_event_trigger'
    )
    THEN '✓ PASS: uniq_suspension_event_trigger index exists'
    ELSE '✗ FAIL: uniq_suspension_event_trigger index missing'
  END AS status;

-- Count existing records (should be unchanged)
SELECT
  'Record count preserved' AS check_name,
  COUNT(*) AS total_records,
  COUNT(*) FILTER (WHERE suspension_type IS NULL) AS legacy_null_records
FROM public.suspensions;

-- Show all remaining constraints on suspensions table
SELECT
  conname AS constraint_name,
  contype AS type,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.suspensions'::regclass
ORDER BY conname;

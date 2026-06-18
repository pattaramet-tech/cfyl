-- Phase 3A Migration: Add suspension_details column for rich ban information
-- Run this in Supabase SQL Editor BEFORE deploying Phase 3A code
--
-- This adds the suspension_details JSONB column which stores:
--   - trigger_match_id: which match caused the ban threshold to be crossed
--   - trigger_event: what happened (แดงโดยตรง, เหลือง 2 ใบ, ฯลฯ)
--   - points_before / points_added / points_after
--   - threshold_crossed: 6 / 12 / 18 / 24
--   - suspended_matches: array of match(es) the player is banned for

ALTER TABLE suspensions
ADD COLUMN IF NOT EXISTS suspension_details jsonb DEFAULT NULL;

COMMENT ON COLUMN suspensions.suspension_details IS
  'Rich suspension detail: trigger match, event, points breakdown, and list of banned matches';

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'suspensions'
ORDER BY ordinal_position;

-- Phase 3C Migration: Add team_color column for team branding
-- Run this in Supabase SQL Editor BEFORE deploying Phase 3C code

ALTER TABLE teams
ADD COLUMN IF NOT EXISTS team_color TEXT DEFAULT NULL;

COMMENT ON COLUMN teams.team_color IS 'Hex color code e.g. #FF0000 for team branding';

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'teams'
ORDER BY ordinal_position;

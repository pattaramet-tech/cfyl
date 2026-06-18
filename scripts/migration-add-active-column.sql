-- Migration: Add active column to admin_profiles (rerun-safe)
-- Run this in Supabase SQL Editor if admin_profiles already exists without active column
-- This script is idempotent and safe to run multiple times

-- Check if active column exists, if not add it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='admin_profiles' AND column_name='active'
  ) THEN
    ALTER TABLE admin_profiles
    ADD COLUMN active BOOLEAN DEFAULT true;

    RAISE NOTICE 'Added active column to admin_profiles';
  ELSE
    RAISE NOTICE 'Column active already exists in admin_profiles';
  END IF;
END $$;

-- Add index if it doesn't exist (safe to run multiple times)
CREATE INDEX IF NOT EXISTS idx_admin_profiles_active
ON admin_profiles(active);

-- Mark all existing admin profiles as active (if any don't have it set)
UPDATE admin_profiles
SET active = true
WHERE active IS NULL;

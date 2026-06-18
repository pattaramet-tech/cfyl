-- Migration: Add active column and fix RLS policies (rerun-safe)
-- Run this in Supabase SQL Editor
-- This script is idempotent and safe to run multiple times

-- 1. Check if active column exists, if not add it
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

-- 2. Add index if it doesn't exist (safe to run multiple times)
CREATE INDEX IF NOT EXISTS idx_admin_profiles_active
ON admin_profiles(active);

-- 3. Mark all existing admin profiles as active
UPDATE admin_profiles
SET active = true
WHERE active IS NULL;

-- 4. Drop problematic recursive policy if it exists
-- (This policy caused infinite recursion)
DO $$
BEGIN
  DROP POLICY IF EXISTS "Superadmins can read all profiles" ON admin_profiles;
  RAISE NOTICE 'Dropped recursive RLS policy';
EXCEPTION WHEN UNDEFINED_OBJECT THEN
  RAISE NOTICE 'Recursive policy not found (OK)';
END $$;

-- 5. Ensure simple non-recursive policy exists
-- (Only allows user to read their own profile)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'admin_profiles'
    AND policyname = 'Authenticated users can read their own profile'
  ) THEN
    CREATE POLICY "Authenticated users can read their own profile"
      ON admin_profiles FOR SELECT
      USING (auth.uid() = id);

    RAISE NOTICE 'Created non-recursive RLS policy';
  ELSE
    RAISE NOTICE 'Non-recursive policy already exists';
  END IF;
END $$;

RAISE NOTICE 'Migration complete';

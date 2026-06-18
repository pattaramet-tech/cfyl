-- Phase 2: Admin Backend Schema
-- Run this in Supabase SQL Editor to setup admin authentication and RLS policies

-- ============================================================================
-- 1. ADMIN PROFILES TABLE
-- ============================================================================

CREATE TABLE admin_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'superadmin')),
  can_edit_matches BOOLEAN DEFAULT true,
  can_edit_goals BOOLEAN DEFAULT true,
  can_edit_cards BOOLEAN DEFAULT true,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Enable RLS
ALTER TABLE admin_profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. RLS POLICIES FOR admin_profiles
-- ============================================================================
-- NOTE: admin_profiles queries only via service role (server-side)
-- RLS policies are minimal to avoid recursion

CREATE POLICY "Authenticated users can read their own profile"
  ON admin_profiles FOR SELECT
  USING (auth.uid() = id);

-- DISABLED: Superadmin policy caused infinite recursion
-- (queries admin_profiles from within admin_profiles policy)
-- Instead: Server-side code uses service role to bypass RLS

-- ============================================================================
-- 3. RLS POLICIES FOR EXISTING TABLES (matches, goals, cards)
-- ============================================================================

-- === MATCHES TABLE ===

-- Public: Read-only access
CREATE POLICY "Public can read matches"
  ON matches FOR SELECT
  USING (true);

-- Admin: Can update match scores and status
CREATE POLICY "Admin can update match scores"
  ON matches FOR UPDATE
  USING (
    auth.uid() IN (
      SELECT id FROM admin_profiles
      WHERE active = true AND can_edit_matches = true
    )
  )
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM admin_profiles
      WHERE active = true AND can_edit_matches = true
    )
  );

-- === GOALS TABLE ===

-- Public: Read-only access
CREATE POLICY "Public can read goals"
  ON goals FOR SELECT
  USING (true);

-- Admin: Can insert goals
CREATE POLICY "Admin can insert goals"
  ON goals FOR INSERT
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM admin_profiles
      WHERE active = true AND can_edit_goals = true
    )
  );

-- Admin: Can update goals
CREATE POLICY "Admin can update goals"
  ON goals FOR UPDATE
  USING (
    auth.uid() IN (
      SELECT id FROM admin_profiles
      WHERE active = true AND can_edit_goals = true
    )
  )
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM admin_profiles
      WHERE active = true AND can_edit_goals = true
    )
  );

-- Admin: Can delete goals
CREATE POLICY "Admin can delete goals"
  ON goals FOR DELETE
  USING (
    auth.uid() IN (
      SELECT id FROM admin_profiles
      WHERE active = true AND can_edit_goals = true
    )
  );

-- === CARDS TABLE ===

-- Public: Read-only access
CREATE POLICY "Public can read cards"
  ON cards FOR SELECT
  USING (true);

-- Admin: Can insert cards
CREATE POLICY "Admin can insert cards"
  ON cards FOR INSERT
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM admin_profiles
      WHERE active = true AND can_edit_cards = true
    )
  );

-- Admin: Can update cards
CREATE POLICY "Admin can update cards"
  ON cards FOR UPDATE
  USING (
    auth.uid() IN (
      SELECT id FROM admin_profiles
      WHERE active = true AND can_edit_cards = true
    )
  )
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM admin_profiles
      WHERE active = true AND can_edit_cards = true
    )
  );

-- Admin: Can delete cards
CREATE POLICY "Admin can delete cards"
  ON cards FOR DELETE
  USING (
    auth.uid() IN (
      SELECT id FROM admin_profiles
      WHERE active = true AND can_edit_cards = true
    )
  );

-- ============================================================================
-- 4. INDEXES FOR PERFORMANCE
-- ============================================================================

CREATE INDEX idx_admin_profiles_email ON admin_profiles(email);
CREATE INDEX idx_admin_profiles_active ON admin_profiles(active);
CREATE INDEX idx_admin_profiles_role ON admin_profiles(role);

-- ============================================================================
-- 5. INITIAL SETUP NOTES
-- ============================================================================

/*
After running this script:

1. Go to Supabase Authentication (https://app.supabase.com)
2. Create admin user(s) manually via Auth dashboard
3. Get the user ID from Auth → Users list
4. Insert into admin_profiles table:

INSERT INTO admin_profiles (id, email, full_name, role, active)
VALUES (
  '<user-id-from-auth>',
  'admin@example.com',
  'Admin Name',
  'superadmin',
  true
);

Or use the admin panel to manage users (Phase 2c).
*/

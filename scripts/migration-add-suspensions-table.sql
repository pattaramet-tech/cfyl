-- Migration: Add suspensions table for CFYL card management system
-- This table tracks player suspensions based on accumulated card points
-- Safe to run multiple times (uses IF NOT EXISTS)

-- Drop old suspensions table if it exists (safer for migration)
DROP TABLE IF EXISTS public.suspensions CASCADE;

-- Create suspensions table
CREATE TABLE public.suspensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign keys
  season_id UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  age_group_id UUID NOT NULL REFERENCES public.age_groups(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,

  -- Point accumulation tracking
  total_points INT NOT NULL DEFAULT 0,
  point_sources JSONB NOT NULL DEFAULT '[]', -- [{match_id, points, reason}, ...]

  -- Suspension details
  ban_matches INT NOT NULL DEFAULT 0,
  suspended_from_match_id UUID REFERENCES public.matches(id) ON DELETE SET NULL,
  suspension_reason TEXT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),

  -- Ensure one suspension record per player per season per age_group per team
  UNIQUE(season_id, age_group_id, player_id, team_id)
);

-- Create indexes for performance
CREATE INDEX idx_suspensions_player ON public.suspensions(player_id);
CREATE INDEX idx_suspensions_season_age ON public.suspensions(season_id, age_group_id);
CREATE INDEX idx_suspensions_team ON public.suspensions(team_id);
CREATE INDEX idx_suspensions_match ON public.suspensions(suspended_from_match_id);

-- Enable RLS
ALTER TABLE public.suspensions ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Public read-only (for /discipline page)
CREATE POLICY "Suspensions readable by public"
  ON public.suspensions
  FOR SELECT
  USING (true);

-- RLS Policy: Only admins can update suspensions (via API)
CREATE POLICY "Only authenticated admins can update suspensions"
  ON public.suspensions
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- RLS Policy: Only admins can insert suspensions
CREATE POLICY "Only authenticated admins can insert suspensions"
  ON public.suspensions
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- RLS Policy: Only admins can delete suspensions
CREATE POLICY "Only authenticated admins can delete suspensions"
  ON public.suspensions
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- Confirmation
SELECT 'Suspensions table created successfully' AS status;

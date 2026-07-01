-- Add Own Goal support to goals table
-- Run this migration in Supabase SQL editor

-- Step 1: Make player_id nullable to support Own Goals
ALTER TABLE public.goals
ALTER COLUMN player_id DROP NOT NULL;

-- Step 2: Add is_own_goal column
ALTER TABLE public.goals
ADD COLUMN IF NOT EXISTS is_own_goal BOOLEAN NOT NULL DEFAULT false;

-- Step 3: Add note column for additional information
ALTER TABLE public.goals
ADD COLUMN IF NOT EXISTS note TEXT;

-- Step 4: Add constraint to validate own goal logic
ALTER TABLE public.goals
DROP CONSTRAINT IF EXISTS goals_own_goal_validation;

ALTER TABLE public.goals
ADD CONSTRAINT goals_own_goal_validation
CHECK (
  -- Either: normal goal with player_id, OR: own goal without player_id
  (is_own_goal = false AND player_id IS NOT NULL) OR
  (is_own_goal = true AND player_id IS NULL)
);

-- Add comments
COMMENT ON COLUMN public.goals.is_own_goal IS 'True if this is an own goal (player scored against their own team)';
COMMENT ON COLUMN public.goals.note IS 'Optional note/description, e.g. Own Goal, ทำเข้าประตูตัวเอง';

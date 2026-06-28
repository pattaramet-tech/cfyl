-- Add minute column to goals table
-- Run this migration in Supabase SQL editor

ALTER TABLE public.goals
ADD COLUMN IF NOT EXISTS minute integer;

COMMENT ON COLUMN public.goals.minute IS 'Minute of match when the goal was scored (0-120)';

-- Add constraint to ensure minute is within valid range
ALTER TABLE public.goals
DROP CONSTRAINT IF EXISTS goals_minute_range;

ALTER TABLE public.goals
ADD CONSTRAINT goals_minute_range
CHECK (minute IS NULL OR (minute >= 0 AND minute <= 120));

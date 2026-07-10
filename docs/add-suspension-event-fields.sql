-- Migration: Add suspension event tracking fields
-- Purpose: Enable event-based suspension tracking (1 suspension = 1 event)
-- Separates ejection suspensions from accumulated points suspensions
-- Backward compatible with existing data

-- Add new columns for event tracking
alter table public.suspensions
add column if not exists suspension_type text;

alter table public.suspensions
add column if not exists trigger_match_id uuid references public.matches(id);

alter table public.suspensions
add column if not exists accumulated_threshold integer;

alter table public.suspensions
add column if not exists source_card_ids uuid[];

alter table public.suspensions
add column if not exists serving_match_ids uuid[];

alter table public.suspensions
add column if not exists served_completed_at timestamptz;

alter table public.suspensions
add column if not exists legacy_migrated boolean not null default false;

-- Add constraint on suspension_type values
alter table public.suspensions
drop constraint if exists suspensions_suspension_type_check;

alter table public.suspensions
add constraint suspensions_suspension_type_check
check (
  suspension_type is null
  or suspension_type in (
    'accumulated_points',
    'second_yellow',
    'direct_red',
    'yellow_red',
    'manual',
    'legacy'
  )
);

-- Add constraint on accumulated_threshold values
alter table public.suspensions
drop constraint if exists suspensions_accumulated_threshold_check;

alter table public.suspensions
add constraint suspensions_accumulated_threshold_check
check (
  accumulated_threshold is null
  or accumulated_threshold in (6, 12, 18, 24)
);

-- Create unique index to prevent duplicate event-based suspensions
-- This ensures: 1 player + 1 team + 1 trigger match + 1 suspension type = at most 1 record
create unique index if not exists uniq_suspension_event_trigger
on public.suspensions (
  player_id,
  team_id,
  trigger_match_id,
  suspension_type,
  coalesce(accumulated_threshold, 0)
)
where trigger_match_id is not null
  and suspension_type is not null;

-- Create indexes for common queries
create index if not exists idx_suspensions_trigger_match_id
on public.suspensions(trigger_match_id);

create index if not exists idx_suspensions_serving_match_ids
on public.suspensions using gin(serving_match_ids);

create index if not exists idx_suspensions_type_threshold
on public.suspensions(suspension_type, accumulated_threshold);

-- Note: This migration does NOT modify existing data
-- All existing records are marked as 'legacy' in a separate step
-- Allows rollback if needed before logic changes deployed

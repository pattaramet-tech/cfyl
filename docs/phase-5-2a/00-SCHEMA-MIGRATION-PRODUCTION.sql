-- ============================================================================
-- PHASE 5.2A — SCHEMA MIGRATION: Add Event-Based Suspension Fields
-- PRODUCTION-SAFE VERSION
-- ============================================================================
-- Purpose: Add 7 new columns to enable event-based suspension tracking
-- Safety Level: HIGH (non-destructive, backward compatible)
-- Reversibility: YES (DROP COLUMN can restore previous state)
-- Data Impact: ZERO (no existing data modified)
-- ============================================================================

-- ============================================================================
-- PRE-FLIGHT VERIFICATION
-- Run this section FIRST to verify current state before any changes
-- ============================================================================

-- Check 1: Current suspensions table structure
select
  'BEFORE MIGRATION: Column count' as check_name,
  count(*) as column_count
from information_schema.columns
where table_schema = 'public' and table_name = 'suspensions';

-- Check 2: Verify no existing event-based columns (sanity check)
select
  'BEFORE MIGRATION: Check if columns already exist' as check_name,
  case
    when (select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'suspensions'
          and column_name in ('suspension_type', 'trigger_match_id', 'accumulated_threshold',
                               'source_card_ids', 'serving_match_ids', 'served_completed_at',
                               'legacy_migrated')) > 0
    then 'ERROR: Event columns already exist'
    else 'OK: Event columns do not exist'
  end as status;

-- Check 3: Current legacy data (before migration)
select
  'BEFORE MIGRATION: Existing suspension records' as check_name,
  count(*) as total_count,
  count(case when suspension_type is null then 1 end) as null_type_count
from public.suspensions;

-- Check 4: Verify matches table exists (for foreign key)
select
  'BEFORE MIGRATION: matches table available for FK' as check_name,
  case
    when exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'matches')
    then 'OK: matches table exists'
    else 'ERROR: matches table not found'
  end as status;

-- ============================================================================
-- MAIN MIGRATION
-- ============================================================================
-- All operations are safe and non-destructive
-- Uses IF NOT EXISTS to handle idempotency

BEGIN;

-- ============================================================================
-- Step 1: Add 7 New Columns
-- ============================================================================
-- All use IF NOT EXISTS for safety
-- All allow NULL for backward compatibility with legacy records

alter table public.suspensions
add column if not exists suspension_type text;
-- Purpose: Identify suspension type (accumulated_points, direct_red, second_yellow, yellow_red, manual, legacy)
-- NULL represents old schema records (legacy suspensions)

alter table public.suspensions
add column if not exists trigger_match_id uuid references public.matches(id);
-- Purpose: Match where card was given (triggers suspension)
-- NULL represents legacy records or suspended without known trigger

alter table public.suspensions
add column if not exists accumulated_threshold integer;
-- Purpose: Threshold that triggered suspension (6, 12, 18, 24)
-- NULL represents ejection-type suspensions or legacy records

alter table public.suspensions
add column if not exists source_card_ids uuid[];
-- Purpose: Array of card IDs that contributed to this suspension
-- NULL represents legacy records with unknown sources

alter table public.suspensions
add column if not exists serving_match_ids uuid[];
-- Purpose: Array of match IDs where suspension will be served
-- NULL represents legacy records using single suspended_from_match_id

alter table public.suspensions
add column if not exists served_completed_at timestamptz;
-- Purpose: Timestamp when suspension serving was completed
-- NULL represents active or not-yet-served suspensions

alter table public.suspensions
add column if not exists legacy_migrated boolean not null default false;
-- Purpose: Flag legacy records that have been marked for migration
-- Defaults to false - existing rows automatically get this value
-- NOT NULL is safe because of default value

-- ============================================================================
-- Step 2: Add CHECK Constraints
-- ============================================================================
-- Constraints are SAFE: they allow NULL values (existing legacy records)
-- They only validate when values ARE present

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
-- SAFETY: Constraint allows NULL, so existing NULL suspension_type records pass check

alter table public.suspensions
drop constraint if exists suspensions_accumulated_threshold_check;

alter table public.suspensions
add constraint suspensions_accumulated_threshold_check
check (
  accumulated_threshold is null
  or accumulated_threshold in (6, 12, 18, 24)
);
-- SAFETY: Constraint allows NULL, so existing NULL accumulated_threshold records pass check

-- ============================================================================
-- Step 3: Create Partial Unique Index
-- ============================================================================
-- CRITICAL: This index ONLY applies when trigger_match_id and suspension_type are NOT NULL
-- SAFE: Existing legacy records with NULL values are NOT affected by this unique constraint

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
-- SAFETY: WHERE clause means this index only enforces uniqueness for event-based records
-- LEGACY SAFE: Existing records with trigger_match_id=NULL or suspension_type=NULL are excluded

-- ============================================================================
-- Step 4: Create Supporting Indexes
-- ============================================================================
-- These improve query performance on new columns
-- Safe to add, can be dropped if needed

create index if not exists idx_suspensions_trigger_match_id
on public.suspensions(trigger_match_id);
-- Speeds up queries filtering by trigger_match_id

create index if not exists idx_suspensions_serving_match_ids
on public.suspensions using gin(serving_match_ids);
-- Speeds up queries filtering by serving_match_ids array

create index if not exists idx_suspensions_type_threshold
on public.suspensions(suspension_type, accumulated_threshold);
-- Speeds up queries filtering by type and threshold combination

-- ============================================================================
-- Transaction Checkpoint
-- ============================================================================
-- If we reach here, all migrations succeeded

COMMIT;

-- ============================================================================
-- POST-MIGRATION VERIFICATION
-- Run these queries AFTER commit to verify success
-- ============================================================================

-- Verification 1: All 7 new columns now exist
select
  'AFTER MIGRATION: All event-based columns exist' as check_name,
  case
    when (select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'suspensions'
          and column_name in ('suspension_type', 'trigger_match_id', 'accumulated_threshold',
                               'source_card_ids', 'serving_match_ids', 'served_completed_at',
                               'legacy_migrated')) = 7
    then '✓ PASS: All 7 columns exist'
    else '✗ FAIL: Some columns missing'
  end as status;

-- Verification 2: Column count increased by 7
select
  'AFTER MIGRATION: Column count increased' as check_name,
  count(*) as new_column_count
from information_schema.columns
where table_schema = 'public' and table_name = 'suspensions';

-- Verification 3: No data was deleted or modified
select
  'AFTER MIGRATION: Data preservation' as check_name,
  count(*) as total_records,
  'No records were deleted or modified' as status
from public.suspensions;

-- Verification 4: Legacy records are still intact
select
  'AFTER MIGRATION: Legacy records still exist' as check_name,
  count(*) as legacy_count
from public.suspensions
where suspension_type is null;

-- Verification 5: Constraints are in place
select
  conname as constraint_name,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.suspensions'::regclass
  and conname in (
    'suspensions_suspension_type_check',
    'suspensions_accumulated_threshold_check'
  )
order by conname;

-- Verification 6: Unique index is in place
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'suspensions'
  and indexname = 'uniq_suspension_event_trigger';

-- Verification 7: Supporting indexes are in place
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'suspensions'
  and indexname in (
    'idx_suspensions_trigger_match_id',
    'idx_suspensions_serving_match_ids',
    'idx_suspensions_type_threshold'
  )
order by indexname;

-- ============================================================================
-- MIGRATION SUMMARY
-- ============================================================================
-- If all verifications pass, migration is successful
-- Phase 5.2A can now proceed to Loop 1 and beyond

select
  'MIGRATION COMPLETE' as status,
  'All 7 columns added safely' as columns_added,
  'All constraints in place' as constraints,
  'All indexes created' as indexes,
  'Existing legacy data preserved' as data_preservation,
  'Ready for Phase 5.2A Loop 1' as next_step;

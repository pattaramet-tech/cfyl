-- Migration: Mark existing suspensions as legacy
-- Purpose: Identify old records that haven't been classified by new logic
-- Safe operation - only sets flags, no data deletion

-- Mark all suspensions without suspension_type as 'legacy'
-- This preserves existing data while allowing new logic to create typed suspensions
update public.suspensions
set
  suspension_type = 'legacy',
  legacy_migrated = true,
  updated_at = now()
where suspension_type is null;

-- Verify the update
select
  count(*) as total_legacy_marked,
  count(case when legacy_migrated then 1 end) as legacy_flag_set,
  count(case when suspension_type = 'legacy' then 1 end) as suspension_type_set
from public.suspensions
where suspension_type = 'legacy' or legacy_migrated;

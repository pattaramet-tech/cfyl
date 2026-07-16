-- Tournament V2 — Phase 1, Migration 013: Atomic schedule batch save states
-- Source of truth: Merge-gate requirement — Save API must claim a batch atomically
-- (preview -> saving -> saved) so two concurrent Save requests cannot both write.
-- Idempotent — safe to re-run after a partial failure.

-- ============================================================================
-- tournament_schedule_batches: add 'saving' and 'failed' states
-- ============================================================================
alter table tournament.tournament_schedule_batches
  drop constraint if exists tournament_schedule_batches_status_check;

alter table tournament.tournament_schedule_batches
  add constraint tournament_schedule_batches_status_check
  check (status in ('preview', 'saving', 'saved', 'failed', 'rolled_back'));

-- ============================================================================
-- Failure metadata for recoverable/terminal failed state
-- ============================================================================
alter table tournament.tournament_schedule_batches
  add column if not exists failed_at timestamptz;

alter table tournament.tournament_schedule_batches
  add column if not exists failure_reason text;

-- Tournament V2 — Phase 1, Migration 008: Audit Logs
-- Source of truth: TOURNAMENT_V2_DATA_MODEL.md §2.16.
-- Same shape as League's admin_audit_logs (scripts/migration-phase4f-audit-logs.sql) —
-- shared pattern, not a shared instance (Target Architecture §7).
-- Idempotent — safe to re-run after a partial failure.

create table if not exists tournament.tournament_audit_logs (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references tournament.tournaments(id) on delete set null,
  admin_id uuid,
  admin_email text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  entity_label text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_taudit_created on tournament.tournament_audit_logs (created_at desc);
create index if not exists idx_taudit_entity on tournament.tournament_audit_logs (entity_type, action);

-- ============================================================================
-- RLS — audit trail is internal-only, no public policy.
-- ============================================================================
alter table tournament.tournament_audit_logs enable row level security;

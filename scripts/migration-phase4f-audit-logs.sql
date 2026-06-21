-- Phase 4F: Admin Audit Log
-- Run this in the Supabase SQL Editor.
-- Adds ONE new table; does not modify any existing schema.

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
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

create index if not exists idx_audit_logs_created_at on public.admin_audit_logs (created_at desc);
create index if not exists idx_audit_logs_entity on public.admin_audit_logs (entity_type, action);
create index if not exists idx_audit_logs_admin on public.admin_audit_logs (admin_email);

-- Lock it down: enable RLS with NO policies, so anon/auth clients cannot read or
-- write. The server uses the service-role key, which bypasses RLS.
alter table public.admin_audit_logs enable row level security;

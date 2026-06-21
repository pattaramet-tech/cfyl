-- Phase 4B: Notification settings (Discord webhook)
-- Run this in the Supabase SQL Editor. Adds ONE new table; nothing else changes.

create table if not exists public.notification_settings (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique,
  webhook_url text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Server-only: enable RLS with NO policies. The service-role key bypasses RLS;
-- anon/auth clients can never read the webhook URL.
alter table public.notification_settings enable row level security;

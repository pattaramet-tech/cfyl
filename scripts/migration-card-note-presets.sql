-- CFYL-007: Configurable League card note presets
-- Run manually in Supabase SQL Editor. This does not modify existing cards rows.

create table if not exists public.card_note_presets (
  id uuid primary key default gen_random_uuid(),
  note text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_note_presets_note_not_blank check (char_length(btrim(note)) between 1 and 200)
);

create unique index if not exists uq_card_note_presets_note_normalized
  on public.card_note_presets (lower(btrim(note)));

-- Server-only settings data: service role bypasses RLS; no anon/auth policies are added.
alter table public.card_note_presets enable row level security;

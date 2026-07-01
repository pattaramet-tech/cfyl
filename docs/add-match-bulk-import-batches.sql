-- Match Bulk Import Batch Logging Tables
-- Purpose: Track all bulk import operations for history and future undo/replay functionality

-- Table 1: Batch headers
create table if not exists public.match_bulk_import_batches (
  id uuid primary key default gen_random_uuid(),

  batch_no text unique not null,
  file_name text,
  import_mode text not null default 'append_only',

  season_id uuid not null references public.seasons(id) on delete cascade,
  age_group_id uuid not null references public.age_groups(id) on delete cascade,
  division_id uuid references public.divisions(id) on delete set null,

  status text not null default 'success',
  -- success / partial / failed

  summary jsonb not null default '{}'::jsonb,
  warnings_count integer not null default 0,
  errors_count integer not null default 0,

  matches_updated integer not null default 0,
  goals_inserted integer not null default 0,
  cards_inserted integer not null default 0,
  staff_discipline_inserted integer not null default 0,
  players_updated integer not null default 0,
  suspensions_recalculated integer not null default 0,

  affected_match_ids uuid[] not null default '{}',
  affected_player_ids uuid[] not null default '{}',
  affected_team_ids uuid[] not null default '{}',

  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now()
);

-- Table 2: Batch row details
create table if not exists public.match_bulk_import_batch_rows (
  id uuid primary key default gen_random_uuid(),

  batch_id uuid not null references public.match_bulk_import_batches(id) on delete cascade,

  sheet_name text not null,
  row_number integer,
  action text not null,
  status text not null default 'success',
  -- success / warning / failed / skipped

  message text,
  raw_data jsonb not null default '{}'::jsonb,
  resolved_data jsonb not null default '{}'::jsonb,
  error text,

  entity_type text,
  entity_id uuid,
  match_id uuid,
  player_id uuid,
  team_id uuid,

  created_at timestamptz not null default now()
);

-- Indexes for batch table
create index if not exists idx_match_bulk_import_batches_created_at
  on public.match_bulk_import_batches(created_at desc);

create index if not exists idx_match_bulk_import_batches_scope
  on public.match_bulk_import_batches(season_id, age_group_id, division_id);

create index if not exists idx_match_bulk_import_batches_status
  on public.match_bulk_import_batches(status);

create index if not exists idx_match_bulk_import_batches_batch_no
  on public.match_bulk_import_batches(batch_no);

-- Indexes for batch rows table
create index if not exists idx_match_bulk_import_batch_rows_batch
  on public.match_bulk_import_batch_rows(batch_id);

create index if not exists idx_match_bulk_import_batch_rows_entity
  on public.match_bulk_import_batch_rows(entity_type, entity_id);

create index if not exists idx_match_bulk_import_batch_rows_match
  on public.match_bulk_import_batch_rows(match_id);

create index if not exists idx_match_bulk_import_batch_rows_player
  on public.match_bulk_import_batch_rows(player_id);

create index if not exists idx_match_bulk_import_batch_rows_status
  on public.match_bulk_import_batch_rows(status);

-- Enable RLS (security layer)
alter table public.match_bulk_import_batches enable row level security;
alter table public.match_bulk_import_batch_rows enable row level security;

-- Note: Admin API uses service role with elevated privileges
-- No public policies needed for app use; add if needed for specific user access

comment on table public.match_bulk_import_batches is 'Batch-level tracking for bulk match data imports';
comment on table public.match_bulk_import_batch_rows is 'Row-level details for each import operation within a batch';

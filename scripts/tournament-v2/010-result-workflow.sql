-- Tournament V2 — Phase 1, Migration 010: Match Attachments / Result Workflow
-- Source of truth: TOURNAMENT_V2_DATA_MODEL.md §2.19-2.20. Decision Lock: D-16 (2026-07-14).
-- Idempotent — safe to re-run after a partial failure.

-- ============================================================================
-- 2.19 tournament_match_attachments
-- ============================================================================
create table if not exists tournament.tournament_match_attachments (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references tournament.tournament_matches(id) on delete cascade,
  report_id uuid references tournament.tournament_match_reports(id) on delete set null,
  file_url text not null,
  file_type text not null default 'image' check (file_type in ('image','document')),
  uploaded_by uuid references tournament.tournament_user_profiles(id) on delete set null,
  uploaded_at timestamptz not null default now()
);
create index if not exists idx_tattach_match on tournament.tournament_match_attachments (match_id);

-- ============================================================================
-- 2.20 tournament_result_submissions / tournament_result_versions / tournament_result_approvals
-- DECISION LOCKED (D-16): Single-step with Mandatory Preview — status enum drops
-- approved/rejected, adds previewed. tournament_result_approvals is Correction-only.
-- ============================================================================
create table if not exists tournament.tournament_result_submissions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references tournament.tournament_matches(id) on delete cascade,
  stage text not null check (stage in ('quick_result','full_report')),
  payload jsonb not null,
  status text not null default 'not_started'
    check (status in ('not_started','draft','previewed','submitted','published','correction_requested','corrected')),
  version int not null default 1,
  idempotency_key text,
  submitted_by uuid references tournament.tournament_user_profiles(id) on delete set null,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, stage, idempotency_key)
);
create index if not exists idx_tresultsub_match on tournament.tournament_result_submissions (match_id, stage);

create table if not exists tournament.tournament_result_versions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references tournament.tournament_result_submissions(id) on delete cascade,
  version int not null,
  payload jsonb not null,
  changed_by uuid references tournament.tournament_user_profiles(id) on delete set null,
  change_reason text,
  created_at timestamptz not null default now(),
  unique (submission_id, version)
);

create table if not exists tournament.tournament_result_approvals (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references tournament.tournament_result_submissions(id) on delete cascade,
  action text not null check (action in ('request_correction','corrected')),   -- DECISION LOCKED (D-16): no approve/reject — Correction Workflow only
  actor_id uuid not null references tournament.tournament_user_profiles(id),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_tapproval_submission on tournament.tournament_result_approvals (submission_id);

-- ============================================================================
-- RLS — DATA_MODEL §4 point 5: no public policy for any of these (draft/internal
-- workflow data). Service Role only, after authorizeVenueScope() passes (Phase 3+).
-- ============================================================================
alter table tournament.tournament_match_attachments enable row level security;
alter table tournament.tournament_result_submissions enable row level security;
alter table tournament.tournament_result_versions enable row level security;
alter table tournament.tournament_result_approvals enable row level security;

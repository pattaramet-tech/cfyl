-- Add staff management and discipline system
-- Tables: team_staffs, staff_discipline_events
-- Run this in Supabase SQL Editor

-- Create team_staffs table
create table if not exists public.team_staffs (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  age_group_id uuid not null references public.age_groups(id) on delete cascade,
  division_id uuid references public.divisions(id) on delete set null,
  team_id uuid not null references public.teams(id) on delete cascade,

  full_name text not null,
  position text not null,
  phone text,
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_team_staffs_team_id on public.team_staffs(team_id);
create index if not exists idx_team_staffs_season_age on public.team_staffs(season_id, age_group_id);
create index if not exists idx_team_staffs_name on public.team_staffs(full_name);

create unique index if not exists team_staffs_unique_person_role_team
on public.team_staffs(team_id, full_name, position);


-- Create staff_discipline_events table
create table if not exists public.staff_discipline_events (
  id uuid primary key default gen_random_uuid(),

  season_id uuid not null references public.seasons(id) on delete cascade,
  age_group_id uuid not null references public.age_groups(id) on delete cascade,
  division_id uuid references public.divisions(id) on delete set null,
  match_id uuid references public.matches(id) on delete cascade,

  team_id uuid not null references public.teams(id) on delete cascade,
  staff_id uuid not null references public.team_staffs(id) on delete cascade,

  discipline_type text not null,
  minute integer,
  reason text,
  note text,

  suspended_matches integer not null default 0,
  suspended_from_matchday text,
  status text not null default 'active',

  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint staff_discipline_type_check
  check (discipline_type in ('warning', 'caution', 'ejection', 'ban')),

  constraint staff_discipline_status_check
  check (status in ('active', 'served', 'cancelled')),

  constraint staff_discipline_minute_check
  check (minute is null or (minute >= 0 and minute <= 120))
);

create index if not exists idx_staff_discipline_match_id on public.staff_discipline_events(match_id);
create index if not exists idx_staff_discipline_staff_id on public.staff_discipline_events(staff_id);
create index if not exists idx_staff_discipline_team_id on public.staff_discipline_events(team_id);
create index if not exists idx_staff_discipline_season_age on public.staff_discipline_events(season_id, age_group_id);

-- Discipline type mapping:
-- warning = คาดโทษ
-- caution = เตือน
-- ejection = ไล่ออก
-- ban = แบน / ห้ามคุมทีม

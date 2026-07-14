# Tournament V2 — Phase 1 Database Foundation

Draft migration files for `TOURNAMENT_V2_IMPLEMENTATION_PHASES.md` Phase 1. **Not run
against any project yet.** Source of truth for every column/constraint is
`TOURNAMENT_V2_DATA_MODEL.md` §2.1–2.21, decided in `TOURNAMENT_V2_DECISION_CHECKLIST.md`.

## Prerequisites (you do these — see the approved plan §10)

1. Create a **Tournament Production** Supabase project, fully separate from League's
   project (D-01 — Option A).
2. Create a second **Tournament Staging/Preview** Supabase project for Vercel Preview
   deploys.
3. Have the SQL Editor (or `psql`/Supabase CLI) open against the project you're
   applying these to.

## Run order

Run all 11 files **in order**, once per project (Staging first, then Production). Each
file is idempotent (`create table if not exists`, `create index if not exists`,
`drop policy if exists` before `create policy`), so a partial failure can be fixed and
the same file re-run safely.

| # | File | Creates |
|---|---|---|
| 1 | `001-schema-and-core.sql` | `tournament` schema + grants, `tournaments`, `tournament_categories`, `tournament_venues`, `tournament_courts`, `tournament_category_venues` |
| 2 | `002-teams-players-staff.sql` | `tournament_teams`, `tournament_players`, `tournament_staff` |
| 3 | `003-groups-and-knockout-rounds.sql` | `tournament_groups`, `tournament_group_members`, `tournament_knockout_rounds` |
| 4 | `004-matches-and-draw.sql` | `tournament_matches` (core), `tournament_draw_assignments` |
| 5 | `005-match-events-and-reports.sql` | `tournament_match_goals`, `tournament_match_cards`, `tournament_match_reports` |
| 6 | `006-discipline.sql` | `tournament_suspension_events`, `tournament_suspension_serving_matches` |
| 7 | `007-standings-and-qualification.sql` | `tournament_standing_rules`, `tournament_qualification_rules`, `tournament_standing_overrides`, `tournament_qualification_draws`, `tournament_qualification_draw_candidates` |
| 8 | `008-audit-logs.sql` | `tournament_audit_logs` |
| 9 | `009-rbac.sql` | `tournament_user_profiles`, `tournament_role_assignments`, `tournament_match_officials` |
| 10 | `010-result-workflow.sql` | `tournament_match_attachments`, `tournament_result_submissions`, `tournament_result_versions`, `tournament_result_approvals` |
| 11 | `011-scheduling-import-and-views.sql` | `tournament_schedule_batches`, `tournament_schedule_import_rows`, `tournament_schedule_versions`, deferred FK on `tournament_matches.schedule_batch_id`, `tournament.public_matches_view`, `tournament.public_players_view` |

**Why this order, not the Data Model doc's own section order**: `tournament_matches`
(Data Model §2.8) references `tournament_knockout_rounds` (§2.15), so §2.15 is created
here in file 3, before matches in file 4. `tournament_matches.schedule_batch_id`
references `tournament_schedule_batches` (§2.21), created last in file 11 — its FK is
added via a deferred `ALTER TABLE` at the end of file 11, exactly as the Data Model doc
itself specifies for that one column.

## Expose the `tournament` schema to the API (required, easy to miss)

Supabase's REST/client-library access (PostgREST) only serves schemas explicitly listed
in **Project Settings → Data API → Exposed schemas** (older UI: **API Settings →
Schema**). `public` is there by default; a custom schema like `tournament` is **not**,
even after running all 11 migration files and even with the grants in
`001-schema-and-core.sql` correctly in place. Without this step, every call from
`lib/tournament/db/supabase-tournament.ts` (which sets `db: { schema: 'tournament' }`)
will fail at the API layer regardless of how correct the SQL is underneath.

Do this once per project, any time after running `001-schema-and-core.sql` (the schema
must exist first) and before testing anything through the client or `verify-foundation.ts`:

1. Supabase Dashboard → **Project Settings → Data API**
2. Add `tournament` to **Exposed schemas**
3. Save

## After running all 11 files

1. Confirm the `tournament` schema is in Exposed Schemas (previous section) — do this
   before the next two steps, or they'll fail with a schema-not-found error unrelated
   to RLS or grants.
2. Table Editor → spot-check RLS: public tables (`tournaments`, `tournament_teams`,
   `tournament_venues`, etc.) should be readable as `anon`; RBAC/result-workflow tables
   (`tournament_user_profiles`, `tournament_result_submissions`, etc.) should return zero
   rows as `anon`.
3. Set `TOURNAMENT_SUPABASE_URL` / `TOURNAMENT_SUPABASE_ANON_KEY` /
   `TOURNAMENT_SUPABASE_SERVICE_ROLE_KEY` in `.env.local` for the project you just ran
   these against.
4. From the repo root: `npm run verify:tournament-foundation` — confirms connectivity
   and that all 34 tables are queryable (see `verify-foundation.ts` in this folder).

## What's deliberately NOT here

- No data — Tournament V2 starts fresh (D-02). No migration from Tournament V1.
- No RBAC seed rows (no `tournament_super_admin`, no venue managers, no Dedicated
  Result-entry Account row) — that's Phase 3.
- No League table or League Supabase project is touched by any of these files.
- Two RLS gaps flagged explicitly for your review in the migration comments: which
  tables beyond the Data Model doc's literal public-read list should be public
  (`tournament_venues`, `tournament_courts`, `tournament_staff`, `tournament_standing_rules`,
  `tournament_qualification_rules` — extended by judgment call, not literal spec), and
  the exact aggregate shape for public goal/card counts (deferred to Phase 9).

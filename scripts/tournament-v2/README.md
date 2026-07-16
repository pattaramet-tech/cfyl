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

Run all 13 files **in order**, once per project (Staging first, then Production). Each
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
| 12 | `012-draw-selected-source-support.sql` | `draw_selected` source-type support on `tournament_matches`, qualification draw uniqueness guards (`uniq_tqualdraw_active_category_slot`, `uniq_tqualcand_selected_order`), G-U16 qualification-rule backfill |
| 13 | `013-schedule-batch-atomic-save.sql` | Adds `'saving'`/`'failed'` to `tournament_schedule_batches.status`, adds `failed_at`/`failure_reason` columns |

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

## After running all 13 files

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

## Schedule Import runtime verification (against CFYL-Tournament-Staging)

`npm run verify:tournament-schedule-import-runtime`
(`scripts/tournament-v2/verify-schedule-import-runtime.ts`) is a disposable-data runtime
verifier for the Schedule Import feature (migrations 011–013 and
`app/api/tournament/admin/schedule/import/{preview,save}/route.ts`). Same safety guard as
`verify-full-report-runtime.ts`: it refuses to run unless
`TOURNAMENT_RUNTIME_VERIFY_CONFIRM=CFYL-Tournament-Staging` is set, and every row it
creates is uniquely tagged and cleaned up at the end of the run (confirmed via its own
post-cleanup verification queries).

**Design note**: the preview/save logic lives entirely inside the two route files (there
is no separate service module), and both routes require a real League Supabase Auth
bearer token via `requireTournamentSuperAdmin`. To avoid creating throwaway users in
League's shared production Auth system, this verifier does not call the route `POST`
handlers directly — it calls the exact same underlying real functions the routes call
(`validateScheduleImportRow`, `buildDrawSelectedConfigs`, `resolveScheduleSourceTeamId`,
`buildScheduleImportDiff`) and replicates the routes' persistence orchestration
(identical tables, columns, status values, and the same atomic `preview -> saving`
claim `UPDATE`) directly against the real service client. The `requireTournamentSuperAdmin`
HTTP/auth wrapper itself is intentionally out of scope for this runtime check.

**Results of the last run against CFYL-Tournament-Staging:**

| Check | Result |
|---|---|
| `uniq_tqualdraw_active_category_slot` exists (migration 012) | **✓ Confirmed** — verified functionally: a second active (non-superseded) draw for the same `(category_id, qualification_slot)` was rejected by Postgres, naming this exact index in the error |
| `uniq_tqualcand_selected_order` exists (migration 012) | **✓ Confirmed** — verified functionally: a second selected candidate at the same `draw_order` within a draw was rejected by Postgres, naming this exact index in the error |
| Preview two `draw_selected` rows (`G-U16-THIRD-DRAW-1`, `G-U16-THIRD-DRAW-2`) | **✓ Passed** — both rows validate as `warning` (code `W8`, unresolved placeholder), never `error` |
| Save the batch | **✗ Blocked — real schema bug, not a Staging-application gap** (see below) |
| Saved Match preserves `home/away_source_type`/`home/away_source_ref` | Not reached (depends on Save) |
| Unresolved `draw_selected` `team_id` stays `null` | Not reached (depends on Save) |
| Retry Save is idempotent, no duplicate Match | Not reached (depends on Save) |
| No batch remains stuck in `saving` | Not reached (depends on Save) |
| Rollback workflow | **✗ Blocked — not implemented** (see below) |
| Complete cleanup of all disposable rows | **✓ Confirmed** — zero disposable rows remained, re-verified independently |

**Bug found: `tournament_schedule_batches.save_result` does not exist in any migration.**
`app/api/tournament/admin/schedule/import/save/route.ts` reads and writes a
`save_result` column (used for the idempotent-retry response and the final `status:
'saved'` update) on every call, but **no migration file — 011, 012, or 013 — ever
creates that column**. Migration 013 ("Atomic schedule batch save states") adds
`failed_at`/`failure_reason` and the `saving`/`failed` status values, but not
`save_result`; confirmed against a live `CFYL-Tournament-Staging` (which has 013 fully
applied — `status`, `failed_at`, `failure_reason`, `saved_at`, `rolled_back_at`,
`rolled_back_by` all present) by directly querying each column: every one of them
resolves except `save_result`, which fails with `column
tournament_schedule_batches.save_result does not exist`. This means **Save currently
cannot succeed against any database with the current migration set applied** — this is
not a "migration not yet applied" gap, it is a missing column definition in the source
SQL itself. The existing mocked unit tests
(`app/api/tournament/admin/schedule/import/save/__tests__/route.test.ts`) never caught
this because their in-memory mock DB accepts any column the code writes to, regardless
of whether a real migration defines it — this is exactly the class of bug real-database
runtime verification exists to catch. Fixing this (adding a `save_result jsonb` column
via a new migration) is a schema change and was not made here — out of scope for a
verification-only pass; flagged for the owner to fix and apply.

**Gap found: no rollback workflow is implemented anywhere in the codebase.**
`app/api/tournament/admin/schedule/` contains only `template/`, `import/preview/`, and
`import/save/` routes — no rollback route file exists. `tournament_schedule_batches` has
a `rolled_back` status value and `rolled_back_at`/`rolled_back_by` columns (schema-only,
from migration 011, never written by any code), and
`TOURNAMENT_V2_SCHEDULING_AND_IMPORT.md` §9 documents an intended future `POST
/schedule/import/batches/{id}/rollback` endpoint that has not been built. Building it was
out of scope for this verification task (it would be starting a new feature); the
verifier's own cleanup therefore uses direct disposable-row deletion rather than a
rollback endpoint, matching the precedent already used by `verify-foundation.ts` and
`verify-full-report-runtime.ts`.

---

# Phase 2 — Core Domain CRUD + Seed Data

## Prerequisites

1. Phase 1 migrations (001–012) must be applied to the Tournament Supabase project.
2. The `tournament` schema must be in **Project Settings → Data API → Exposed schemas**.
3. `.env.local` must have:
   - `TOURNAMENT_SUPABASE_URL`
   - `TOURNAMENT_SUPABASE_ANON_KEY`
   - `TOURNAMENT_SUPABASE_SERVICE_ROLE_KEY` (for bootstrap and seed scripts)

## Phase 2 Scripts

### 1. Bootstrap super_admin (one-time)

```bash
export TOURNAMENT_BOOTSTRAP_ADMIN_USER_ID='<your-league-auth-uid>'
export TOURNAMENT_BOOTSTRAP_ADMIN_EMAIL='your-email@example.com'
npm run bootstrap:tournament-super-admin
```

**What it does**: Creates one `tournament_user_profiles` row and assigns the
`tournament_super_admin` role (global scope) for that user. Idempotent — re-running
is a no-op if the role already exists.

**Where to find your League auth.uid**:
1. Supabase Dashboard → Authentication → Users
2. Find your user, click it, copy the `UUID` from the **User ID** field
3. Set both env vars in `.env.local` (never commit them)

### 2. Seed core domain data

```bash
npm run seed:tournament-phase2 -- --tournament-slug=cfyl-2025 --tournament-name="CFYL 2025"
```

**What it does**: Idempotently upserts:
- 1 tournament record (`tournaments`)
- 4 venues: V1, V2, V3, V4 (`tournament_venues`)
- 7 categories: B-U12, G-U14, B-U14, G-U16, B-U16, G-U18, B-U18 (`tournament_categories`)
- 7 category-venue mappings per the Phase 2 spec (`tournament_category_venues`)

All mappings can be changed later via the admin UI without rerunning this script.

### 3. Verify Phase 2 CRUD (optional, integration test)

```bash
npm run verify:tournament-phase2-crud
```

**What it does**: Exercises the Phase 2 API endpoints against a live Tournament DB
to verify CRUD, unique constraints, cross-tenant checks, and audit logging.

## Admin Setup UI

After bootstrap and seed, navigate to `/admin/tournament` to manage:
- Tournaments (create/edit/soft-delete)
- Categories (create/edit/soft-delete, tied to a tournament)
- Venues (create/edit/deactivate, tied to a tournament)
- Courts (create/edit/deactivate, tied to a venue)
- Category-Venue Mappings (create/update venue/delete, grid UI)

All mutations are logged to `tournament_audit_logs` with admin id/email and old/new data.

## Auth for Phase 2 Admin

- Admin API endpoints (`/api/tournament/admin/**`) require `Authorization: Bearer <token>`
  header with a valid League Supabase JWT.
- The JWT is verified against the League Supabase project (League is the Identity Provider).
- Authorization is checked via a `tournament_user_profiles` + `tournament_role_assignments`
  lookup in the Tournament project.
- Phase 2 only supports `tournament_super_admin` role (global scope). Other roles
  (`venue_manager`, `result_operator`, etc.) are Phase 3+.

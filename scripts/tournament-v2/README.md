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

Run all 16 files **in order**, once per project — **Staging first**, verify there,
**then Production only after Staging verification and explicit approval**. Each file is
idempotent (`create table if not exists`, `create index if not exists`, `drop policy if
exists` before `create policy`, `create or replace function`), so a partial failure can
be fixed and the same file re-run safely.

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
| 13a | `013a-schedule-import-save-result-and-rollback.sql` | Adds `tournament_schedule_batches.save_result` (missing from every prior migration despite the Save route depending on it), adds `'rolling_back'` to `status` and `rollback_failure_reason`, adds `tournament_schedule_import_rows.before_payload`/`applied_match_version`/`applied_match_updated_at`, and creates the `tournament.rollback_schedule_import_batch()` RPC. A separate, additive repair migration — does not modify the already-applied 013 retroactively. |
| 13b | `013b-schedule-rollback-concurrency-fix.sql` | `CREATE OR REPLACE FUNCTION` only, no column changes. Fixes two bugs verified in 013a's rollback RPC (see "Rollback workflow" below): a TOCTOU/lost-update race between its conflict-check and apply passes, and a conflict-triggered `status='failed'` write that a subsequent `RAISE EXCEPTION` silently rolled back. Does not modify the already-applied 013a retroactively. |
| 14 | `014-full-result-publish-transaction.sql` | `tournament.publish_full_match_report(...)` — atomic Official Full Match Report publish RPC (service-role only; see the file's own security comments) |

**Migration status as of this task**: 001–013b are applied to `CFYL-Tournament-Staging`
(see the Schedule Import and Qualification Draw sections below). **Migration 014 is also
applied to `CFYL-Tournament-Staging`**, and its disposable-data runtime verifier
(`npm run verify:tournament-full-report-runtime`) has passed all 10 scenarios there — see
"Migration 014 runtime verification" below for details. None of 001–014 have been applied
to Production yet. **Migration 014 is required before Official Publish can operate at
all** — the API fails closed with `FULL_REPORT_PUBLISH_RPC_UNAVAILABLE` if the RPC
function does not exist, and there is deliberately **no sequential-write fallback** for
Official Publish (unlike Quick Result and the Standings Override, both of which now also
have their own atomic RPCs — migrations 016 and 017 respectively — reachable via their
own runtime verifiers, documented separately from this table). Do not assume any
migration file in this folder is safe to run against a given database without first
reviewing its dependencies and the current state of that database — in particular, 014
assumes 001–013b are already applied (it only reads/writes existing tables) and does not
itself alter any table's schema.

### Migration 014 runtime verification (against CFYL-Tournament-Staging)

The owner manually applied Migration 014 to `CFYL-Tournament-Staging` and confirmed:
`tournament.publish_full_match_report` exists, `SECURITY DEFINER` is enabled,
`search_path` is `tournament, pg_temp`, `service_role` can execute it, `anon` cannot
execute it, `authenticated` cannot execute it, and `npm run verify:tournament-foundation`
passed.

`npm run verify:tournament-full-report-runtime`
(`scripts/tournament-v2/verify-full-report-runtime.ts`) was then run against
`CFYL-Tournament-Staging`, using only uniquely-named disposable rows (created and deleted
within the same run — verified with an independent zero-rows sweep afterward). **All 10
scenarios passed**: regulation publish, penalty-decided publish, concurrent same-key
idempotency (exactly one physical publication + one idempotent response), same-key
different-payload rejection, different-key already-published rejection (both via the
application layer and via a direct RPC call, bypassing the app layer entirely), full
transaction rollback after an injected real Postgres unique-constraint violation on
`tournament_match_cards`, every Preview Token failure mode (required/tampered/expired/
mismatch), Public Schedule showing only the published match with no internal field
leakage, Standings correctly using regulation scores while excluding penalty scores from
GF/GA/GD, and complete cleanup with zero disposable rows left behind.

**Schema gap found and worked around (not fixed, since fixing requires a new migration —
out of scope for this verification pass):** `tournament_match_goals.team_id` and
`tournament_match_cards.team_id` reference `tournament_teams(id)` with **no
`ON DELETE CASCADE`** (unlike their `match_id` FK, which does cascade). Deleting a
tournament triggers cascading deletes of both `tournament_teams` (via `tournament_id`)
and `tournament_matches` → `tournament_match_goals`/`tournament_match_cards` (via
`match_id`) in the same transaction, and Postgres does not guarantee the match-side
cascade completes before the team-side cascade is attempted — so a delete can fail with
`violates foreign key constraint tournament_match_cards_team_id_fkey` even though every
row involved is about to be deleted anyway. The runtime verifier works around this by
explicitly deleting `tournament_match_goals`/`tournament_match_cards` rows (by
`match_id`) before deleting the tournament. This is a real, reproducible gap in the
Phase 1 schema (migration 005), not specific to Migration 014 — worth a small follow-up
migration (`ON DELETE CASCADE` on both `team_id` columns) at some point, but that is a
new migration decision, not something this verification pass should silently apply. This
gap remains open and documented as of this synchronization pass — it has not been fixed
and no Migration 018 has been added; treat it as a separate, focused hardening PR unless a
new verified blocker requires otherwise.

**Migration 014 is required before Official Publish can operate at all** — the API fails
closed with `FULL_REPORT_PUBLISH_RPC_UNAVAILABLE` if the RPC function does not exist, and
there is deliberately **no sequential-write fallback** for Official Publish. Do not assume
any migration file in this folder is safe to run against a given database without first
reviewing its dependencies and the current state of that database. **Staging first,
always** — Migration 014 has been applied and runtime-verified on
`CFYL-Tournament-Staging`; Production application still requires explicit separate
approval and is not part of this task.

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

## After running all 16 files

1. Confirm the `tournament` schema is in Exposed Schemas (previous section) — do this
   before the next two steps, or they'll fail with a schema-not-found error unrelated
   to RLS or grants.
2. Table Editor → spot-check RLS: public tables (`tournaments`, `tournament_teams`,
   `tournament_venues`, etc.) should be readable as `anon`; RBAC/result-workflow tables
   (`tournament_user_profiles`, `tournament_result_submissions`, etc.) should return zero
   rows as `anon`.
3. Database → Functions → confirm `tournament.publish_full_match_report` exists and that
   `anon`/`authenticated` are NOT listed among its grantees — only `service_role`.
4. Set `TOURNAMENT_SUPABASE_URL` / `TOURNAMENT_SUPABASE_ANON_KEY` /
   `TOURNAMENT_SUPABASE_SERVICE_ROLE_KEY` in `.env.local` for the project you just ran
   these against.
5. From the repo root: `npm run verify:tournament-foundation` — confirms connectivity
   and that all tables are queryable (see `verify-foundation.ts` in this folder).

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
verifier for the Schedule Import feature (migrations 011–013a and
`app/api/tournament/admin/schedule/import/{preview,save}/route.ts` +
`app/api/tournament/admin/schedule/import/batches/[batchId]/rollback/route.ts`). Same
safety guard as `verify-full-report-runtime.ts`: it refuses to run unless
`TOURNAMENT_RUNTIME_VERIFY_CONFIRM=CFYL-Tournament-Staging` is set, and every row it
creates is uniquely tagged and cleaned up at the end of the run (confirmed via its own
post-cleanup verification queries).

**Design note**: the preview/save logic lives entirely inside the two route files (there
is no separate service module), and both require a real League Supabase Auth bearer
token via `requireTournamentSuperAdmin`. To avoid creating throwaway users in League's
shared production Auth system, this verifier does not call the `POST` handlers directly
— it calls the exact same underlying real functions the routes call
(`validateScheduleImportRow`, `buildDrawSelectedConfigs`, `resolveScheduleSourceTeamId`,
`buildScheduleImportDiff`) and replicates the routes' persistence orchestration
(identical tables, columns, status values, and the same atomic `preview -> saving` claim
`UPDATE`) directly against the real service client. Rollback is different: its entire
contract lives in one Postgres function
(`tournament.rollback_schedule_import_batch()`, migration 013a), so the verifier calls
that RPC directly (`ctx.client.rpc(...)`) — this exercises the real transactional logic,
not a reimplementation. The `requireTournamentSuperAdmin` HTTP/auth wrapper itself is
intentionally out of scope for this runtime check either way.

### Bug found and fixed: `tournament_schedule_batches.save_result` did not exist

An earlier run against Staging found that `app/api/tournament/admin/schedule/import/save/route.ts`
reads and writes a `save_result` column (used for the idempotent-retry response and the
final `status: 'saved'` update) on every call, but no migration — 011, 012, or 013 — ever
created that column. Confirmed live: with 013 fully applied to `CFYL-Tournament-Staging`,
`save_result` was the only column of the batch table that failed to resolve. This meant
**Save could not succeed against any database with the migration set that existed at the
time** — not a "migration not yet applied" gap, a missing column definition in the source
SQL itself. The existing mocked unit tests never caught it because their in-memory mock DB
accepts any column the code writes to, regardless of whether a real migration defines it.

**Fixed** via `scripts/tournament-v2/013a-schedule-import-save-result-and-rollback.sql` —
a separate, additive repair migration (013, already applied to Staging, is not modified
retroactively). Adds `save_result jsonb`. The Save route's own `save_result` read/write
code was already correct; it needed no changes.

### Rollback workflow — implemented

Migration 011 added a `'rolled_back'` status value and `rolled_back_at`/`rolled_back_by`
columns, but no rollback route, RPC, or per-row snapshot data ever existed until now.
Migration 013a adds:

- `tournament_schedule_batches`: `'rolling_back'` status, `rollback_failure_reason`
- `tournament_schedule_import_rows`: `before_payload` (the complete pre-mutation set of
  `tournament_matches` columns Save writes, including `updated_at`/`updated_by` — see
  below for why), `applied_match_version`, `applied_match_updated_at`
- `tournament.rollback_schedule_import_batch(p_batch_id, p_actor_id)` — `SECURITY
  DEFINER`, pinned `search_path`, `service_role`-only execute (same posture as other
  privileged Tournament V2 write RPCs). Single Postgres transaction, all-or-nothing:
  atomically claims `saved -> rolling_back`; runs a conflict-check pass over every row
  the batch actually mutated (Match must still exist, must not have changed since
  — version/updated_at both checked — must not be currently published, and must not
  already have a result entered); any conflict aborts the whole rollback with no partial
  restore; otherwise deletes `create`-action Matches and restores `update`-action Matches
  to their exact `before_payload` snapshot; finalizes as `rolled_back` and writes one
  audit log entry.
- New route: `POST /api/tournament/admin/schedule/import/batches/[batchId]/rollback`
  (`tournament_super_admin` only) — thin wrapper that calls the RPC and maps its errors
  to HTTP status codes (404 batch not found, 409 not eligible / conflict).

**Correctness note — why `before_payload` restores `updated_at`/`updated_by` exactly,
not a fresh timestamp/actor**: rolling back a batch is a true undo, not a new edit event.
This matters for composability — if a later batch touched a Match a rollback-of-an-earlier-
batch also needs to touch, rolling back the later batch first must restore the Match to
*exactly* the state the earlier batch's own `applied_match_version`/
`applied_match_updated_at` recorded, or the earlier batch's rollback would be falsely
rejected as "changed since import" against its own history. Covered by a dedicated test:
`app/api/tournament/admin/schedule/import/batches/[batchId]/rollback/__tests__/route.test.ts`
→ *"allows rolling back an earlier batch after a later batch on the same Match was
already rolled back."*

### Rollback concurrency + conflict-persistence fix (migration 013b)

A final review of PR #6 (after the "runtime gate passed" milestone below) found two real
bugs in 013a's `rollback_schedule_import_batch()`, both fixed by
`scripts/tournament-v2/013b-schedule-rollback-concurrency-fix.sql` (`CREATE OR REPLACE
FUNCTION` only — no column changes, does not modify 013a retroactively):

1. **TOCTOU / lost-update race.** The conflict-check pass read each matched Match's
   version/updated_at with a plain `SELECT` (no lock); the apply pass mutated it in a
   separate statement. Nothing prevented a concurrent write to that same Match (e.g. an
   ordinary admin edit via the regular match editor) from landing in the gap between the
   two passes and being silently overwritten. **Fixed**: every matched Match is now
   locked with `SELECT ... FOR UPDATE`, acquired in deterministic `matched_match_id`
   order (reduces deadlock risk against another concurrent rollback touching overlapping
   Matches) and held for the rest of the transaction — closing the gap entirely. The
   apply-pass `DELETE`/`UPDATE` is additionally made conditional on the exact expected
   `version`/`updated_at`, with a `GET DIAGNOSTICS ... ROW_COUNT` check that fails closed
   (raises, aborting the whole transaction) if the expected row was not the one mutated —
   defense in depth for "should never happen given the lock, but if it does, do not
   proceed silently."
2. **Conflict state never persisted.** On conflict, 013a did
   `UPDATE ... SET status = 'failed', rollback_failure_reason = ...` and then `RAISE
   EXCEPTION`. Since the whole function call is one Postgres transaction, the unhandled
   exception rolled back that same update — the batch silently reverted to `'saved'` and
   the failure reason was never actually stored, contradicting 013a's own documented
   behavior. **Fixed**: the conflict path no longer raises. It commits `status='failed'`
   + `rollback_failure_reason` + `failed_at` as part of the function's own normal,
   non-erroring return, and returns a structured JSON payload
   (`{status:'failed', errorCode:'SCHEDULE_ROLLBACK_CONFLICT', conflicts:[...]}`) instead
   — `app/api/tournament/admin/schedule/import/batches/[batchId]/rollback/route.ts` now
   detects this structured response and maps it to HTTP 409, the same as before. Only
   genuinely unexpected failures (batch not found, wrong status, the ROW_COUNT anomaly
   above) still raise and roll back atomically. Claiming a batch (`saved -> rolling_back`)
   also now clears any stale `rollback_failure_reason`/`failed_at` left over from an
   earlier failed attempt.

`mockRollbackRpc.ts` was updated to match: it now commits the failed batch state and
returns a structured conflict object instead of simulating the conflict by mutating state
and then returning a Postgres-style `error` (which would silently reintroduce exactly the
bug above into the test suite, since a real `error` from supabase-js means the whole
transaction was rolled back). New tests assert `status='failed'`,
`rollback_failure_reason`, and `failed_at` all persist after a conflict, that the route
maps the structured response to HTTP 409, and that no Match is partially
deleted/restored. Static tests
(`scripts/tournament-v2/__tests__/013bMigrationStatic.test.ts`) confirm the `FOR UPDATE`
lock, deterministic lock ordering, the conflict path returning rather than raising after
the failed-state update, and the conditional `DELETE`/`UPDATE` version/updated_at checks
are all present in the SQL source text.

The runtime verifier gained two new scenarios for this fix. **Migration 013b has now
been applied to `CFYL-Tournament-Staging` and both scenarios passed** — see the
15-scenario results below:

- **Conflict persistence**: create and update a disposable Match through Schedule
  Import, mutate that Match directly afterward (simulating an unrelated admin edit),
  call the real rollback RPC, and confirm it returns a structured conflict (not an
  exception), the batch's `status='failed'`/`rollback_failure_reason`/`failed_at` all
  persist on re-query, and the external edit survived completely untouched (no partial
  rollback).
- **Real concurrent race**: fires a real rollback call and a real, unconditional direct
  Match edit via `Promise.all` (no `await` between them, so both requests reach Postgres
  as genuinely independent, concurrent transactions — real locking arbitrates the
  outcome, nothing is simulated). Accepts either safe ordering (the concurrent edit
  commits first and rollback reports a conflict, or the rollback locks first and
  completes, with the edit applying afterward) — the only invariant asserted is that the
  concurrent edit's value is present in the *final* Match state in both cases, proving a
  committed concurrent edit is never silently overwritten.

### Results of the run against CFYL-Tournament-Staging before 013b existed — all 13 scenarios passed

Migration 013a is applied to `CFYL-Tournament-Staging`. With it (but not yet 013b) in
place, `npm run verify:tournament-schedule-import-runtime` passed end to end for every
scenario that existed at the time:

| Check | Result |
|---|---|
| `uniq_tqualdraw_active_category_slot` exists (migration 012) | **✓ Confirmed** — verified functionally: a second active (non-superseded) draw for the same `(category_id, qualification_slot)` was rejected by Postgres, naming this exact index in the error |
| `uniq_tqualcand_selected_order` exists (migration 012) | **✓ Confirmed** — verified functionally: a second selected candidate at the same `draw_order` within a draw was rejected by Postgres, naming this exact index in the error |
| Preview two `draw_selected` rows (`G-U16-THIRD-DRAW-1`, `G-U16-THIRD-DRAW-2`) | **✓ Passed** — both rows validate as `warning` (code `W8`, unresolved placeholder), never `error` |
| Save the batch successfully; batch status becomes `saved`; `save_result` stored | **✓ Passed** |
| Saved Match preserves `home/away_source_type`/`home/away_source_ref` | **✓ Passed** |
| Unresolved `draw_selected` `team_id` stays `null` | **✓ Passed** |
| Retry Save on the same batch is idempotent, no duplicate Match | **✓ Passed** |
| No batch remains stuck in `saving` | **✓ Passed** |
| Second batch updates the first batch's Match, capturing `before_payload` | **✓ Passed** |
| Rollback of the update batch restores the Match to its pre-update state (`match_time`, `version`, `schedule_status` all verified) | **✓ Passed** |
| Rollback of the original create batch removes both created Matches | **✓ Passed** |
| Rollback is idempotent on retry; exactly one audit log entry | **✓ Passed** |
| Complete cleanup of all disposable rows | **✓ Confirmed** — zero disposable rows remained |

**Bug fixed along the way (verifier-only, no migration/RPC changes)**:
`getMatchIdByCode()` compared the raw `RUN_TAG`-derived `match_code` (not uppercased)
directly against `tournament_matches.match_code`, which Save always persists uppercased
via `normalizeScheduleImportRow`'s `upper(raw.match_code)`. The exact-equality lookup
silently missed. Fixed by normalizing the lookup value the same way before querying.

**Status update — a subsequent final review found the two real Rollback bugs described
above, which this "all 13 scenarios passed" run predates and could not have caught (no
concurrency scenario existed yet, and the conflict-persistence assertions only checked
the in-memory response, not a re-query of the batch row).** Migration 013b and the two
new verifier scenarios covering exactly these bugs have since been applied and run
against real Staging — see the next section.

### Migration 013b applied to CFYL-Tournament-Staging — all 15 scenarios passed

The owner applied `scripts/tournament-v2/013b-schedule-rollback-concurrency-fix.sql` to
`CFYL-Tournament-Staging`. With it in place, `npm run verify:tournament-schedule-import-runtime`
passed end to end for all 15 scenarios (the 13 above, plus the 2 new ones this migration
was written to cover):

| Check | Result |
|---|---|
| All 13 scenarios listed above (indexes, preview/save, rollback lifecycle, idempotency, cleanup) | **✓ Passed** |
| Rollback conflict state persists correctly — `status='failed'`, `rollback_failure_reason`, and `failed_at` all survive a re-query after a conflict, with the external edit surviving untouched | **✓ Passed** |
| Concurrent rollback/edit never overwrites the committed edit — real `Promise.all` race between a rollback call and a direct Match edit, no `await` between them; the concurrent edit's value is present in the final Match state under either safe ordering | **✓ Passed** |
| Complete rollback lifecycle (create → update → rollback update → rollback create) | **✓ Passed** |
| Zero disposable rows remain after cleanup | **✓ Confirmed** |

**PR #6 runtime gate passed after Migration 013b; ready for final review.** Production
was not modified — only `CFYL-Tournament-Staging`.

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

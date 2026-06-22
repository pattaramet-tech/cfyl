# CHANGELOG

All notable changes to CFYL Youth League system are documented here.

## [Hotfix: Multi-age school teams — team display by code] - 2026-06-22 ✅ COMPLETE

### Same school across multiple age groups (U10/U12/U14/U16)

Investigation: duplicate scope + import resolution were **already correct** — every
admin view and import context is filtered by `season_id + age_group_id`, so:
- team_name may repeat across age groups; is unique within season+age
- team_code(short_name) is unique within season+age; may repeat across ages
- import (teams/players/fixtures) resolves teams within the selected season+age,
  by team_code first then team_name — never across age groups

UI-only changes so multi-age schools are distinguishable:
- Team dropdowns + lists now show the code: `ชื่อทีม (CODE)` in
  /admin/tournament-fixtures, /admin/players, /admin/tournament-groups
  (teams list already shows a short_name column)
- Teams import template sample updated to demonstrate age-specific codes
  (โรงเรียนหัวถนนวิทยา → HTN-U14 / HTN-U16)

No DB/validation/schema change. No change to teams/players/fixtures/groups logic,
League Mode, standings, goals/cards/suspensions, or backup.
- npm run build: ✅ PASSED

## [Phase 5A.5: Bulk add / import — teams + players] - 2026-06-22 ✅ COMPLETE

### Add many teams/players at once (editable grid or XLSX/CSV import)

No migration (reuses existing teams/players schema).

- `/admin/teams` + `/admin/players`: new collapsible **Bulk Add / Import** panel
  (shared `components/BulkImportPanel.tsx`): editable multi-row grid (+ add/clear),
  Download Template, Import .xlsx/.csv (client-parsed via `xlsx`), per-row preview
  (valid/warning/error + message), then "Save valid rows" → refreshes the list.
- Shared validation `lib/bulk-import.ts` (unit-verified):
  - Teams: season_slug/age must match selection; team_name required + unique per
    season+age; team_code(short_name) unique; league → division required (must exist
    in season+age), tournament/mixed → division optional/null.
  - Players: team matched by team_code(=short_name) first then team_name
    (ambiguous/not-found = error); full_name required; player_code unique per season
    (auto-generated `{AGE}-{TEAM}-NNN` when blank); duplicate name in same team =
    warning; division derived from team (null ok). shirt_no non-numeric = warning.
  - Duplicate protection vs DB and within the same batch; friendly errors only.
- API (auth): `POST teams/bulk/preview|save`, `GET teams/bulk/template`, and the
  same trio under `players/bulk/*` (xlsx templates with Thai-safe encoding).
- Audit: team.bulk_preview / team.bulk_create / player.bulk_preview /
  player.bulk_create (seasonId, ageGroupId, totalRows, validRows, errorRows,
  createdCount, createdIds).
- Backup teams/players already handle null division (no change).

No change to single add/edit, tournament groups/fixtures, League Mode, standings,
goals/cards/suspensions, clean URLs, backup, audit, or Discord.
- npm run build: ✅ PASSED

## [Phase 5A.4: Tournament fixtures — manual + XLSX/CSV import] - 2026-06-22 ✅ COMPLETE

### Build tournament programmes after the group draw (manual entry or Excel import)

⚠️ Run `scripts/migration-phase5a4-tournament-fixtures.sql` in Supabase
(adds `matches.tournament_group_id` + `matches.venue`; `stage` already exists).

- New page `/admin/tournament-fixtures` (filters: season / age / group / stage):
  - **Manual add**: group(optional)/stage/match_code/matchday/date/time/venue/home/away
  - **Import XLSX/CSV**: download template, pick file (parsed client-side via `xlsx`),
    preview with per-row valid/error + messages, then "Save valid rows"
  - fixtures list with delete (blocked if goals/cards exist)
- Shared validation (`lib/tournament-fixtures.ts`, unit-checked):
  - team match by code (= team short_name) first, else by name; ambiguous/not-found = error
  - group resolved by name/code; both teams must belong to the group; no auto-create
  - stage ∈ group/round_of_16/quarter_final/semi_final/final/third_place (default group)
  - division_id = null; season_slug/age_group must match the selected season/age
  - duplicate protection: match_code unique per season; pair A-vs-B == B-vs-A per
    stage+group; same date+time+venue — all errors (checked vs DB and within the batch)
  - venue stored as free text (no venues table); friendly errors only
- API (auth): GET/POST `/api/admin/tournament-fixtures`, PUT/DELETE `[matchId]`,
  POST `import/preview`, POST `import/save`, GET `template` (xlsx)
- Audit: tournament_fixture.create/update/delete/import_preview/import_save
- Backup matches export now includes `stage, group, venue` columns
- Optional auto-generator deferred to Phase 5A.5

No change to League Mode, fixtures, standings, top-scorers, discipline,
goals/cards/suspensions, tournament groups, season slug, clean URLs, or audit.
- npm run build: ✅ PASSED

## [Phase 5A.3: Tournament players + matches without required division] - 2026-06-22 ✅ COMPLETE

### players.division_id and matches.division_id are now optional

⚠️ Run `scripts/migration-phase5a3-players-matches-division-optional.sql` in Supabase
(`alter table players/matches alter column division_id drop not null`). FK + existing
league data unchanged.

- Players: POST /api/admin/players/manage and PUT /api/admin/players/[playerId]
  already derive division_id from the team — a division-less tournament team now
  yields player.division_id = NULL. Added friendly errors (no raw DB; 23502 →
  run-migration hint). player_code stays unique per season.
- /admin/matches: division is optional for tournament/mixed seasons — matches load
  by season+age (no division filter required) and null-division rows show a
  "Group Stage" badge. League path is unchanged (division still required). 0-0 safe.
- Matches API (GET/PUT), /api/public/matches, and backup (players/matches) were
  already null-safe (blank division cell); no change needed there.
- tournament_groups already validates by season+age only (no division dependency).
- types/db: Team/Player/Match `division_id` → `string | null`; schema.sql nullable.
- Tournament match *generation* and public tournament pages remain Phase 5B.

No change to League Mode, fixtures, standings, top-scorers, discipline,
goals/cards/suspensions, tournament groups, season slug, clean URLs, backup, or audit.
- npm run build: ✅ PASSED

## [Phase 5A.2 Hotfix: Tournament teams without required division] - 2026-06-22 ✅ COMPLETE

### Teams can belong to a tournament season without a Division

⚠️ Run `scripts/migration-phase5a2-teams-division-optional.sql` in Supabase
(`alter table teams alter column division_id drop not null`). FK + existing
league teams unchanged.

- POST/PUT /api/admin/teams resolve `season.competition_type`:
  - league → division_id required ("กรุณาเลือกดิวิชั่น")
  - tournament → division_id forced null (not required)
  - mixed → division_id optional
  - validates age_group ∈ season and (if given) division ∈ season+age_group
  - name-uniqueness is null-aware (`.is('division_id', null)`); friendly errors only
- `/admin/teams`: Division field is required for league, hidden+hint for tournament,
  optional+hint for mixed; team list shows a "Tournament" badge when division is null
- Backup teams export: null division already renders as a blank cell (no change)
- tournament_groups already validates by season+age only → null-division teams can be
  assigned to groups (no change)
- schema.sql: teams.division_id made nullable for fresh installs
- Note: players.division_id / matches.division_id are still NOT NULL (Phase 5A.3)

No change to League Mode, standings, fixtures, top-scorers, discipline,
goals/cards/suspensions, tournament groups, season slug, clean URLs, or backup.
- npm run build: ✅ PASSED

## [Phase 5A.1: Season slug + multiple seasons per year] - 2026-06-21 ✅ COMPLETE

### Multiple competitions in the same year (e.g. CFYL 2026 + Chonburi PAO 2026)

⚠️ Deploy this code FIRST, then run `scripts/migration-phase5a1-season-slug.sql`
(adds `seasons.season_slug` + backfills + unique index, then drops the old
`seasons_year_key` so a year can repeat). Existing CFYL 2026 → slug `cfyl-2026`.

- `seasons.season_slug` (unique). `slugify(name, year)` helper — auto-generates
  (e.g. "Chonburi PAO" + 2026 → `chonburi-pao-2026`; "CFYL 2026" → `cfyl-2026`)
- `POST /api/admin/seasons`: accepts `season_slug` + `competition_type`; slug
  unique (year may repeat); friendly errors (no raw DB messages; maps 23505/42703)
- `PUT /api/admin/seasons/[seasonId]`: accepts `season_slug` (unique, excl self)
- Seasons list GET uses `select('*')` (surfaces slug/type post-migration, safe before)
- `/admin/seasons` form: Season Slug field (auto-gen preview) + Competition Type
  select + hint that tournament needs a Division before adding teams
- **Clean URLs accept slug OR year**: `/standings/cfyl-2026/u14`,
  `/standings/chonburi-pao-2026/u14`, and old `/standings/2026/u14` still work
  (year falls back to active/first season of that year). Applies to fixtures /
  top-scorers / discipline too
- Navbar + all season/age/division/matchday selectors now build slug URLs when a
  slug exists (`seasonSeg = season_slug || year`); fall back to year otherwise
- `types/db.ts`: Season += `season_slug?`, `competition_type?`

Pre-migration safe: public/admin reads use `select('*')`; season edits only write
`season_slug` when provided. No change to League Mode, calculations, fixtures,
standings, top-scorers, discipline, tournament groups, backup, audit, or Discord.
- npm run build: ✅ PASSED

## [Phase 5A: Tournament Mode Foundation] - 2026-06-21 ✅ COMPLETE

### Group-stage foundation that coexists with League Mode (no League changes)

⚠️ Requires `scripts/migration-phase5a-tournament-foundation.sql` in Supabase
(additive: `seasons.competition_type` default 'league', `matches.stage` nullable,
new `tournament_groups` + `tournament_group_teams`; existing data unaffected).

- `competition_type` (league | tournament | mixed) — null/existing = league
- `matches.stage` (nullable) — forward-prep for 5B knockout; 5A does not depend on it
- Admin API (auth required):
  - `GET/POST /api/admin/tournament-groups`, `PUT/DELETE /api/admin/tournament-groups/[groupId]`
  - `GET/POST /api/admin/tournament-groups/[groupId]/teams`,
    `DELETE /api/admin/tournament-groups/[groupId]/teams/[teamId]`
  - `GET /api/admin/tournament-groups/[groupId]/standings`
  - team assignment rules: same season+age; not already in another group of the age;
    delete group with teams requires `?force=true`
  - `PUT /api/admin/seasons/[seasonId]` extended to accept optional `competition_type`
- Group standings reuse `calculateStandings()` — matches where **both teams are in
  the group** + `status='finished' && scores not null` (0-0 safe); sort pts→GD→GF→name
- `/admin/tournament-groups` page: season/age selectors, competition-type toggle,
  create/edit/delete groups, assign/remove teams, group standings preview modal
- AdminNav: 🏆 Tournaments link
- Audit (4F): `tournament_group.create/update/delete`, `tournament_group_team.add/remove`
- Backup Center: new `tournament-groups` export type (CSV/Excel + in "all")
- RLS: new tables have public-read policy; writes via service role only

Pre-migration safe: admin season GET/PUT use `select('*')` and only write
`competition_type` when provided, so existing /admin/seasons editing is unaffected
before the migration runs. No change to League Mode, fixtures, standings,
top-scorers, discipline, matches/goals/cards, clean URLs, Discord, or backup logic.
- npm run build: ✅ PASSED

## [Phase 4G: Admin Dashboard / Matchday Control Center] - 2026-06-21 ✅ COMPLETE

### /admin/dashboard rebuilt into a matchday control center

- `GET /api/admin/dashboard/summary` (NEW, auth required) — one call returns:
  - global stats: teams, players, matches, finishedMatches, pendingMatches,
    goals, cards, activeSuspensions
  - active season block (name/year/status + age groups + divisions) +
    `activeSeasonCount` (warn if >1)
  - recentMatches (finished, `status='finished' && scores not null` — 0-0 safe),
    upcomingMatches (not finished, by date)
  - matchdays[] per-MatchDay tally (total/finished/pending/goals/cards)
  - topScorers split U14 / U17, aggregated by **player.id** (not name)
  - activeSuspensions via `lib/suspension-status.ts` — only pending / active /
    no_next_match (never normal / warning / served)
- `app/admin/dashboard/page.tsx` rebuilt: overview stat cards, season card,
  recent + upcoming matches, MatchDay summary selector, Top 5 U14/U17, active
  suspensions table, and 8 quick-action shortcuts
- `/api/admin/stats` (old) left untouched
- Read-only dashboard (no audit needed); Discord/recalc still via /admin/suspensions

Verified vs production DB: stats 32 teams / 552 players / 224 matches (63 finished,
161 pending) / 148 goals / 63 cards; recent includes 0-0; top scorers by id;
active suspensions = 0 (warning 56 / normal 6 / served 1 correctly excluded).
No change to calculations, suspension/lifecycle, goals/cards, public URLs, backup,
or Discord logic.
- npm run build: ✅ PASSED

## [Phase 4B: Discord Suspension Notification] - 2026-06-21 ✅ COMPLETE

### Admin can push ban alerts to a Discord channel via webhook

⚠️ Requires running `scripts/migration-phase4b-notification-settings.sql` in
Supabase (adds ONE table `notification_settings`; no existing schema changed).

- `lib/discord.ts`: `getDiscordSettings`, `isValidDiscordWebhook`,
  `sendDiscordMessage` (server-side fetch), `packMessages` (split into parts
  ≤8 players, under Discord's 2000-char limit, with `Part x/y`)
- `GET/PUT /api/admin/settings/notifications` — load / upsert Discord webhook + enabled
- `POST /api/admin/notifications/discord/test` — send a test message
- `POST /api/admin/notifications/discord/suspensions` — body `{ seasonId,
  ageGroupId('all'|id), statusFilter('all'|pending|active|no_next_match) }`
  - derives lifecycle status via `lib/suspension-status.ts`; **sends only
    pending / active / no_next_match** (never warning / served / normal)
  - plain-text message grouped per รุ่น with trigger event, points, ban count,
    and each banned fixture; empty → "✅ ไม่มีนักกีฬาติดโทษแบนในรายการที่เลือก"
  - webhook sent **server-side only**
- `/admin/settings` (NEW page): Discord section — Webhook URL, Enabled, Save, Test Send
- `/admin/suspensions`: **📣 Send Discord Alert** button + confirm modal
  (Age Group All/U14/U17, Status filter, preview count) + result summary
- Audit (Phase 4F): logs `notification.discord.suspensions_send` /
  `notification.discord.test` with counts + success/error (never blocks sending)
- AdminNav already had ⚙️ Settings — now has a working page

Security: webhook URL stored server-side (RLS no-policy table), never exposed to
public/client; all endpoints auth-required; clear error when URL empty/disabled.
No change to suspension/discipline/cards/goals/standings logic.
- npm run build: ✅ PASSED

**Tested & verified (2026-06-21)** against production DB:
- Test Send → Discord OK (audit `notification.discord.test`, HTTP 204)
- Send Discord Alert OK (audit `notification.discord.suspensions_send`, success)
- Status filter confirmed: 0 sendable (pending/active/no_next_match) vs 63 excluded
  (warning/served/normal) → only ban-relevant statuses are ever sent; empty list
  correctly sends the "ไม่มีนักกีฬาติดโทษแบน" message
- Both audit log actions recorded ✅

## [Phase 4F: Audit Log + Backup Center] - 2026-06-21 ✅ COMPLETE

### Audit trail of admin actions + CSV/Excel backup export

⚠️ Requires running `scripts/migration-phase4f-audit-logs.sql` in Supabase
(adds ONE table `admin_audit_logs`; no existing schema changed).

**Audit Log**
- `lib/audit-log.ts`: `logAdminAction(...)` — writes to `admin_audit_logs` via
  service role; **never throws** (failed insert only logs, never breaks the action)
- Instrumented (core 8): match score/status update, goal create/update/delete,
  goal bulk, card create/update/delete, card bulk, suspension recalculate
- `GET /api/admin/audit-logs` — auth required; filters: page/limit/action/
  entityType/adminEmail/dateFrom/dateTo/search; latest first
- `/admin/audit-logs` — read-only UI: filters + paginated table + expandable
  old_data/new_data
- Table locked down: RLS enabled with NO policies (service role only)

**Backup / Export Center**
- `lib/csv.ts`: CSV builder with UTF-8 BOM (Thai opens correctly in Excel),
  proper escaping, keeps 0 / null handled
- `GET /api/admin/backup/export` — auth required; `seasonId` (required),
  `ageGroupId?`, `divisionId?`, `type`, `format?` (csv|xlsx)
- Types: teams, players, matches, goals, cards, suspensions, standings; `all`
  → multi-sheet Excel (via existing `xlsx` package). 0-0 / GD 0 render correctly
- `/admin/backup` — Season/Age/Division filters + per-type CSV/Excel buttons +
  Export All (confirm before download)
- Standings export reuses `calculateStandings` read-only (no logic change)

**`components/AdminNav.tsx`**: added 💾 Backup + 🧾 Audit Logs links.

No change to public logic, standings/suspension calculations, clean URL routing,
admin auth flow, or existing schema.
- npm run build: ✅ PASSED

## [Phase 4E: Clean URLs + Season Selector for all public pages] - 2026-06-21 ✅ COMPLETE

### Fixtures / Top Scorers / Discipline get clean URLs + a season selector

Extends the Phase 4D standings pattern to every public page. Slugs derived from
existing data (no DB column). Old query-string URLs still work.

Clean URLs:
- `/fixtures/{year}/{ageCode}` · `/fixtures/{year}/{ageCode}/md{n}`
- `/top-scorers/{year}/{ageCode}`
- `/discipline/{year}/{ageCode}`
- (standings from 4D: `/standings/{year}/{ageCode}[/dN]`)

**`lib/public-slugs.ts`**: `buildPath()` + `buildFixtures/TopScorers/DisciplinePath`,
matchday helpers (`matchdayNumber/toCode/fromCode`, client-safe — no suspension-calc
import), `resolvePublicSlug()`, and `resolveSeasonSwitchPath()` (keeps age + sub-filter
when switching season, if they exist in the new season).

**`lib/use-public-nav.ts`** (NEW): shared hook — loads seasons/age groups, `onSeasonChange`
(→ clean URL of new season, preserving age + division/matchday best-effort) and
`onAgeChange` (→ age-level clean URL).

**`components/PublicSeasonNav.tsx`** (NEW): shared season dropdown + age-group chips
(U14 amber / U17 blue) + Copy Link slot + sub-filter slot.

**New views**: `FixturesView` (matchday chips), `TopScorersView` (division = local filter),
`DisciplineView` (age-wide, lifecycle DisciplineTable). `StandingsView` refactored onto
the shared nav (division chips still push clean URLs).

**New routes**: `app/fixtures/[seasonYear]/[ageGroupCode]/(+[matchdayCode])`,
`app/top-scorers/[seasonYear]/[ageGroupCode]`, `app/discipline/[seasonYear]/[ageGroupCode]`.

**Query pages** (`/fixtures`, `/top-scorers`, `/discipline`) slimmed to use the views;
read query ids when present, else resolve the current season. **Old URLs unchanged.**

**`components/PublicChrome.tsx`**: all four menu items now resolve to current-season clean
URLs (fallback base paths). Bad slug → graceful not-found + link back.

No change to standings/top-scorers/discipline calculations, public APIs, schema, or admin.
- npm run build: ✅ PASSED (added fixtures/top-scorers/discipline dynamic routes)

## [Phase 4D Hotfix: Navbar & Standings selector use clean URLs] - 2026-06-21 ✅ COMPLETE

### Navigation now routes to short slugs (old query URLs still work)

- **`lib/public-slugs.ts`**: added `resolveCurrentSeasonSlug()` (active season → newest
  year fallback, + first age group by sort_order)
- **`components/PublicChrome.tsx`**: navbar "ตารางคะแนน" now resolves to the current-season
  clean URL (`/standings/2026/u14`); falls back to `/standings` if it can't resolve
- **`components/StandingsView.tsx`**: now self-contained with season / age-group / division
  selectors that **`router.push` clean URLs** (`/standings/{year}/{ageCode}[/dN]`,
  "ทุกดิวิชั่น" → age-group URL). No more query-string pushes from the selector.
- **`app/standings/page.tsx`**: dropped the shared `SeasonSelector`; reads query ids when
  present (backward compatible) else resolves the current season; renders `StandingsView`.
- Clean route pages simplified (StandingsView owns the selectors now).

Backward compatible: `/standings`, `/standings?season=&ageGroup=`, and `&division=` all
still open. No change to standings calculation, public APIs, or admin pages.
- npm run build: ✅ PASSED

## [Phase 4D: Clean Public URLs / Short Slugs (Standings)] - 2026-06-21 ✅ COMPLETE

### Shareable short URLs for standings — old query-string URLs still work

Slugs are **derived** from existing data (no DB slug column):
`/standings/{seasonYear}/{ageGroupCode}/{divisionCode}` — e.g. `/standings/2026/u14/d1`

**`lib/public-slugs.ts`** (NEW): client helpers
- `resolveStandingsSlug(year, ageCode, divCode?)` → resolves slugs to ids via existing
  public APIs (seasons by `year`, age group by `code`, division `dN` by `sort_order` index, name fallback)
- `buildStandingsPath()` / `divisionToCode()` / `divisionFromCode()`

**`components/StandingsView.tsx`** (NEW): shared render component (extracted from the page)
- Single-division mode (chips + table) or `allDivisions` mode (every division stacked)
- Province rep shown only on the top division; optional 🔗 **Copy Link** button
  copies the clean URL of the selected division

**Routes:**
- `app/standings/[seasonYear]/[ageGroupCode]/page.tsx` (NEW) → all divisions of the age group
- `app/standings/[seasonYear]/[ageGroupCode]/[divisionCode]/page.tsx` (NEW) → single division
- `app/standings/page.tsx` (query string) → slimmed to use `StandingsView`; now also
  reads an optional `division` query param (additive). **Old URLs unchanged.**
- Bad slug → graceful "ไม่พบหน้าที่ระบุ" + link back to `/standings` (no hard crash)

Public nav keeps pointing at `/standings`. No change to standings calculation, public
APIs, or admin pages. Verified d1/d2 → ดิวิชั่น 1/2 by sort_order for U14 & U17 (2026).

- npm run build: ✅ PASSED (added 2 dynamic routes)

## [Phase 4C: Public UI/UX Polish + Admin Access Button] - 2026-06-21 ✅ COMPLETE

### Official, clean, mobile-first redesign (CSS / layout only — no logic touched)

**Font**: switched whole site to **Prompt** via `next/font/google`
(weights 400/500/600/700, `thai`+`latin` subsets). Removed the old Arial override.

**`app/globals.css`** (Tailwind v4 theme):
- Navy/royal-blue brand tokens; light slate background; removed dark-mode override
- Reusable component classes via `@layer components`:
  `.cfyl-card .cfyl-section .cfyl-section-title .cfyl-btn-primary .cfyl-btn-secondary
  .cfyl-chip(.cfyl-chip-active) .cfyl-select .cfyl-badge .cfyl-table .cfyl-empty
  .cfyl-loading .cfyl-error .cfyl-spinner`

**`components/PublicChrome.tsx`** (NEW, client):
- Responsive public header — sticky navy bar, desktop inline nav + **outline "Admin"
  button (top-right)**, mobile **hamburger dropdown** with Admin link at the end
- Owns `<main>` container + footer; **returns children untouched on `/admin*`**
  (fixes the old double-header where the public bar wrapped admin pages)
- Admin link → `/admin` (existing auth redirects to login if not signed in)

**`app/layout.tsx`**: loads Prompt, renders `<PublicChrome>` shell (header/footer removed from layout).

**Public pages polished (mobile-first):**
- `/` — official hero (title + Season 2026 + primary buttons + quick links) + restyled preview cards
- `/fixtures` — match cards in responsive grid; chip filters; **fixed matchday filter** (was reading stale `matches` state instead of fetched `data`)
- `/standings` — compact table, horizontal scroll, sticky team column, rank badges (cols: #/Team/P/ช/ส/พ/+−/คะแนน); EPL-style zone strips + legend: **blue = Champions League (top 4), 🏆 rank 1 = ตัวแทนจังหวัด, red = relegation (bottom 2)**. Champions take priority over relegation in small divisions; counts configurable via constants. ตัวแทนจังหวัด (rank 1) shows only in the top division (Division 1), hidden in Division 2 via `showProvinceRep` prop
- `/top-scorers` — clean ranked list layout
- `/discipline` — **mobile card layout** + desktop table; soft status badges (warning amber / pending·active red / no_next_match gray); served+normal still hidden per lifecycle logic
- `SeasonSelector` — restyled; subtle age-group accent (U14 amber, U17 blue)

**Components restyled**: `MatchCard`, `StandingsTable`, `TopScorersTable`, `DisciplineTable` — navy palette, lighter shadows, larger tap targets, 0-0 / GD 0 / PTS 0 render correctly (no truthy checks).

**Admin**: inherits Prompt font globally; no longer wrapped by the public header; sidebar/pages unchanged (no risky refactor).

- No change to API / DB / standings / suspension / goals / cards / auth / export logic
- npm run build: ✅ PASSED

## 🏁 Phase 3 Closeout - 2026-06-21 ✅ COMPLETE

**Phase 3G tested and passed in production.** The Cards and Suspensions
workflows are verified working correctly end-to-end (card entry → point
scoring → suspension calculation → public display).

**The system is now production-ready as a standalone admin system** — full
CRUD over Seasons / Age Groups / Divisions / Teams / Players / Matches /
Goals / Cards, automatic CFYL suspension calculation with live lifecycle
status, persistent admin login, and a Canva standings export tool.

Phase 3 delivered: Suspension Management · Player Management · Team
Management · Season Management · Goals & Cards UX · Persistent Admin Login ·
Cards Page Full UI Redesign · Suspension Lifecycle Status.

## [Phase 4A Hotfix: Table / TSV Copy Format] - 2026-06-21 ✅ COMPLETE

### Tab-separated copy for pasting into Canva Table / Google Sheets

**`app/admin/exports/page.tsx`** (client-side only — no API change):
- Added third format option to the toggle: **Detailed** / **Compact** / **Table / TSV**
- `formatTSV(group)`: one row per team, **tab (`\t`) separated**, data rows only —
  no header, no rank, no labels. Columns in order:
  `Team Name · P · W · D · L · +/- (GD, plain signed) · PTS`
  - GD shown as plain signed number (`7`, `0`, `-1`) — not `+7`
  - 0 / GD 0 / PTS 0 render correctly
- Per-table Copy button copies real tab-separated text → paste splits into columns
  directly in Canva Table / Google Sheets
- "Copy All Standings" in TSV mode separates each table with a blank line + its
  label heading; UI hints that per-table copy is recommended for Canva
- Preview `<textarea>` now sizes to actual line count + `whitespace-pre` so tabs
  are visible
- Detailed / Compact formats unchanged
- `/standings` public + API + `lib/calculations.ts` untouched
- npm run build: ✅ PASSED

## [Suspension Lifecycle Status] - 2026-06-21 ✅ COMPLETE

### Live ban status: pending → active → served (no cron, no DB column)

**Problem**: status badge was static — a player kept showing 🔴 ติดโทษแบน
forever, even after the banned match was already played.

**`lib/suspension-status.ts`** (NEW):
- `getSuspensionStatus(record, today)` derives one of: `normal` / `warning` /
  `pending` / `active` / `served` / `no_next_match`
- Computed live against today's date in Asia/Bangkok (UTC+7) — status advances
  on its own each day, no recalculate / cron / DB column needed
- A banned match counts as played when `status === 'finished'` **OR**
  `match_date < today` — guards against the snapshot status inside
  `suspension_details` being stale between recalcs
- Suspension records are never mutated or deleted (history preserved)

**`components/DisciplineTable.tsx`** (public `/discipline`):
- Hides `served` + `normal` (0 pts) — shows only still-relevant players
  (warning / pending / active / no_next_match)
- Uses the shared helper (removed duplicated local `getStatus`)

**`app/admin/suspensions/page.tsx`**:
- Uses the shared helper; shows all statuses including `served` for historical review
- New summary card "✅ พ้นโทษแล้ว" + status filter chips (all / active / served /
  warning / no_next_match / normal)

- No change to yellow / second_yellow / red point logic
- npm run build: ✅ PASSED

### Hotfix: second_yellow scored 2 pts instead of 4 (pre-lifecycle)
- `lib/suspension-calc.ts` `calculateMatchPoints`: `second_yellow` was folded
  into the yellow count → 1 yellow → 2 pts. Now checks `hasSecondYellow`
  explicitly → 4 pts. Reason string uses `effectiveYellows` for correct display.
- Cards stored correctly all along (`card_type = 'second_yellow'`); only the
  cached `suspensions.total_points` was stale → fixed by re-running recalculate.

## [Phase 4A: Standings Copy for Canva] - 2026-06-20 ✅ COMPLETE

### Canva Standings Export Tool

**`app/api/admin/exports/standings/route.ts`** (NEW):
- Auth required via `verifyAdminAuth` (Bearer JWT)
- Params: `seasonId` (required), `matchday` (optional integer — filter "up to matchday N")
- Fetches all age_groups → sorted by `sort_order ASC, code ASC` (U14 before U17)
- Per age_group: fetches divisions → sorted by `sort_order ASC, name ASC` (Division 1 before Division 2)
- Per division: fetches all matches + teams → filters `status === 'finished' && home_score !== null && away_score !== null` (handles 0-0 correctly, no truthy check)
- Matchday filter: `parseMatchdayNumber(match.matchday) <= matchdayFilter` — imported from `lib/suspension-calc.ts` (already exported)
- Standings calculated via `calculateStandings()` from `lib/calculations.ts` (unchanged)
- Sort: pts DESC → GD DESC → GF DESC → teamName ASC (localeCompare th)
- Returns: `{ season, matchdayFilter, groups: [{ label, ageGroupName, divisionName, standings: [{rank, teamName, P W D L GD PTS}] }] }`

**`app/admin/exports/page.tsx`** (NEW):
- Season selector (auto-loads, auto-fetches on change)
- Optional MatchDay input — if blank = all finished matches; if set = up to that matchday
- "โหลดข้อมูล" button for manual re-fetch
- Format toggle: **Detailed** / **Compact** — client-side only, no refetch
- 4 preview cards (one per ageGroup×division) in 2-column desktop grid; each has read-only `<textarea>` + Copy button
- "Copy All Standings" button (combines all 4 in one clipboard with `──────────` divider)
- Clipboard API with fallback state if unavailable
- Detailed format: header block (STANDINGS / season / division / matchday) + ranked rows with `P W D L GD PTS`
- Compact format: single-line header + ranked rows as `1. ทีม — P2 W2 D0 L0 GD+6 PTS6`
- GD always signed: `+6`, `0`, `-3`

**`components/AdminNav.tsx`** (MODIFY):
- Added `📋 Exports` link → `/admin/exports`

Public `/standings` page and `lib/calculations.ts` unchanged.

- npm run build: ✅ PASSED (52 routes)

## [Phase 3G: Cards Page Full UI Redesign] - 2026-06-20 ✅ COMPLETE

### Cards Page Full Redesign with 2-Column Layout

**`app/admin/cards/page.tsx`** — full rewrite:
- Cascading selectors: Season → Age Group → Division → Match (4-column responsive grid)
- Match dropdown label: `[match_code] MD{matchday} | {time} | {home} score {away}`
- `refreshCards` via `useCallback` — passed to all child components; called after any add/edit/delete
- 2-column desktop layout (`lg:grid-cols-5`): left col-span-2 (Quick Add + Bulk Add), right col-span-3 (Cards List + Suspension Impact)
- Shows "เลือก Match เพื่อจัดการใบโทษ" hint when division is selected but no match chosen

**5 new components** (`components/cards/`):
- **`MatchSummaryCard.tsx`**: match_code badge, division, matchday, date/time, home vs away (with score), card count badges (🟨/🟨🟥/🟥)
- **`QuickAddCardForm.tsx`**: `PlayerSelector` reuse; 3 card type toggle buttons (Yellow/2nd Yellow/Red) with emoji+pts; optional minute (null if empty); optional note (→ DB `note`); POST `/api/admin/cards`
- **`BulkAddCardForm.tsx`**: multi-row grid (player+type+minute+note+remove); players grouped by home/away with optgroup; minute→null if empty; "ล้างทั้งหมด" clear button; POST `/api/admin/cards/bulk`; shows `suspensionWarnings[]`
- **`CardsInMatchPanel.tsx`**: table with columns นาที/ผู้เล่น/ทีม/ประเภท/เหตุผล/จัดการ; null minutes sort last; compact dashed empty state; inline edit modal (read-only player + type toggle + optional minute + optional note); PUT `/api/admin/cards/[cardId]`; confirm-before-delete
- **`SuspensionImpactPanel.tsx`**: client-side only, no API; yellow=2pts/second_yellow=4pts/red=6pts; groups by player, sums from this match's cards; warning badge if ≥6pts ("อาจติดโทษแบน"); disclaimer "เป็นการประเมินจากใบในแมตช์นี้เท่านั้น"; link to /admin/suspensions

**API changes**:
- `GET /api/admin/cards`: `.select()` now includes `note` + nested `team:team_id(name, short_name)` inside player
- `POST /api/admin/cards`: `minute` now optional (null if omitted); `note` field added to insert
- `PUT /api/admin/cards/[cardId]`: allows `minute: null` (clears minute); allows `note` update

**DB constraint**: `note` maps directly to existing `note` column in `cards` table — no migration required.

Old components (`CardForm.tsx`, `CardsList.tsx`, `BulkCardForm.tsx`) preserved in place.

- npm run build: ✅ PASSED (50 routes)

## [Phase 3F: Persistent Admin Session] - 2026-06-20 ✅ COMPLETE

### Persistent Admin Login with Supabase Browser Session
- **Root cause fixed**: Previous login flow called `/api/admin/auth/login` (server-side), returning only `access_token` — no refresh_token on client, causing forced re-login after 1 hour
- **`lib/supabase-browser.ts`** (NEW): singleton browser Supabase client with `persistSession: true, autoRefreshToken: true, detectSessionInUrl: true`
- **Login page**: now calls `supabase.auth.signInWithPassword` client-side — SDK stores full session (access + refresh tokens) in localStorage and auto-refreshes transparently
- **Login page**: added "จดจำการเข้าสู่ระบบ (Remember me)" checkbox
- **"Remember me" = true**: Supabase session persists in localStorage across browser restarts — re-opens stay logged in
- **"Remember me" = false**: sets `sessionStorage.admin_active_session = '1'`; layout detects missing flag on browser restart and signs out (acceptable: new tabs also require re-login in this mode)
- **`app/admin/layout.tsx`**: uses `supabase.auth.getSession()` (auto-refreshes expired tokens via SDK); syncs fresh `access_token` to `localStorage.admin_token` on every mount — all existing admin pages continue reading from localStorage without changes
- **`app/admin/layout.tsx`**: `onAuthStateChange` listener syncs `localStorage.admin_token` live whenever SDK silently refreshes the token (prevents 401 on long-running pages)
- **`components/AdminNav.tsx`**: logout now calls `getSupabaseBrowser().auth.signOut()` — properly invalidates the browser Supabase session and clears all flags (`admin_token`, `admin_remember_me`, `admin_active_session`)
- All existing admin API routes (`verifyAdminAuth` via Bearer token) unchanged — backward compatible
- Public pages unaffected

## [Phase 3E Hotfix] - 2026-06-20 ✅ COMPLETE

### Edit Goal Validation + Bulk Card UI
- **Fix Edit Goal validation**: `GoalForm.tsx` submit handler still blocked edit with "Please select a player" — fixed `if (!playerId)` guard to `if (!isEditing && !playerId)`, and added `if (isEditing && !goalId)` guard; edit mode now validates only `goalId` + `goals`, not `playerId`
- **Bulk Card UI redesign** (`BulkCardForm.tsx`): desktop uses wider grid (`minmax(280px,2fr) 160px 120px minmax(220px,1fr) 48px`); mobile uses card-per-row vertical layout with labelled fields; inputs use `py-2 px-3 rounded-lg` for easier tapping; Remove button shows label on mobile; Save/Add Row buttons use `py-2.5` for better click targets; logic and suspension recalculation unchanged

## [Phase 3E] - 2026-06-19 ✅ COMPLETE

### Goals & Cards UX Improvement
- **Fix Edit Goal bug**: `GoalForm.tsx` button was always disabled in edit mode because `playerId` was empty (not passed). Fixed `disabled` condition to skip player check when `isEditing=true`
- **PlayerSelector**: option label changed to `#เบอร์ ชื่อ — ชื่อทีม`; search now includes team name; optgroup uses full team name
- **Goals table**: Team column now shows `team.name` (full name) instead of `short_name`
- **Bulk Add Goals** (`BulkGoalForm`): multi-row UI in `/admin/goals`; duplicate player rows auto-merge; if merged total > 10 the API splits into multiple records (e.g. 12 → 10+2), no data lost
- **Bulk Add Cards** (`BulkCardForm`): multi-row UI in `/admin/cards`; minute is `null` if not entered (not 0); suspension recalculated per distinct player after all inserts; suspension errors surfaced as `suspensionWarnings[]` in response (not silent)
- **New API** `POST /api/admin/goals/bulk`: auth+`can_edit_goals`; validates match, players; merges duplicates; splits records > 10
- **New API** `POST /api/admin/cards/bulk`: auth+`can_edit_cards`; validates match, players, card_type; minute=null if omitted; bulk insert then recalculate suspension per player
- **CardsList**: minute column now shows `—` if null (instead of `null'`)
- Public pages (`/top-scorers`, `/discipline`, `/standings`, `/fixtures`) unaffected
- Suspension logic (`lib/suspension-calc.ts`) untouched

## [Phase 3D] - 2026-06-19 ✅ COMPLETE

### Season Management
- `/admin/seasons` tabbed page: 3 tabs — Seasons, Age Groups, Divisions
- **Seasons tab**: list all seasons with status badge and age-group count; full add/edit/delete
- **Age Groups tab**: select season → list age groups (division_count, team_count); add/edit/delete
- **Divisions tab**: select season+ageGroup → list divisions (team_count, match_count); add/edit/delete
- Active season constraint: only 1 active season allowed; confirm dialog warns which season(s) will be auto-completed
- API auto-completes other active seasons (sets to "completed") and returns deactivated[] in response
- Input validation: year must be 4-digit integer; age group code trimmed+uppercased; division name trimmed; status enum enforced
- Delete safety (409 with readable message):
  - Season: blocked if has teams/matches/players
  - Age Group: blocked if has teams/matches/players; deletes empty child divisions first
  - Division: blocked if has teams/matches
- New admin APIs: `/api/admin/seasons` (GET/POST), `/api/admin/seasons/[seasonId]` (GET/PUT/DELETE)
- New admin APIs: `/api/admin/age-groups` (GET/POST), `/api/admin/age-groups/[ageGroupId]` (PUT/DELETE)
- New admin APIs: `/api/admin/divisions` (GET/POST), `/api/admin/divisions/[divisionId]` (PUT/DELETE)
- Public APIs (`/api/public/seasons`, `/api/public/age-groups`, `/api/public/divisions`) unaffected
- AdminNav: 🗓️ Seasons link added

## [Phase 3C] - 2026-06-18 ✅ COMPLETE

### Team Management
- `/admin/teams` CRUD page: add, edit, toggle active, delete (soft/hard)
- New `team_color` field (hex color picker) — requires migration-phase3c-team-color.sql
- `logo_url` text input with live preview
- Color swatch / logo thumbnail shown in team table
- Name uniqueness validated per season+ageGroup+division on create and edit
- Delete blocked (409) if team has players, matches, goals, cards, or suspensions
- Player count badge shown per team row (2-query approach, no N+1)
- New admin APIs: `/api/admin/teams` (GET/POST), `/api/admin/teams/[teamId]` (GET/PUT/DELETE)
- Public pages (standings, fixtures) unaffected — they query by divisionId, not active status

## [Phase 3B] - 2026-06-18 ✅ COMPLETE

### Player Management
- `/admin/players` CRUD page: add, edit, toggle active, delete (soft/hard)
- Cascading season → age group → team selectors
- Client-side search by name / PlayerID / shirt number
- player_code uniqueness validated per season on create and edit
- Deactivate (active=false) always allowed; hard delete blocked if player has goals/cards
- New public API: `/api/public/teams` for team list by season+ageGroup
- New admin APIs: `/api/admin/players/manage` (GET/POST), `/api/admin/players/[playerId]` (GET/PUT/DELETE)
- AdminNav: 👤 Players link

## [Phase 3A Bug Fix] - 2026-06-18 ✅ FIXED

### Suspension Next Match Detection Bug Fixes
- **Bug**: Player banned in MatchDay 2 showed "ไม่พบโปรแกรมแข่งขันนัดถัดไป" instead of MatchDay 3
- **Root cause 1**: `matchday` column stored as text "MatchDay 2" — `Number("MatchDay 2")` = NaN → 0 → `.gt('matchday', 0)` with text column fails
- **Root cause 2**: Was passing `triggerMatchday` (numeric, often wrong) to `findNextMatchesForSuspension` — now passes `triggerMatchId` and looks up the match date
- **Root cause 3**: Ordering was by `matchday` column (text, alpha-sorted wrong) — now uses `match_date ASC → match_time ASC → matchday ASC`
- **Fix**: Added `parseMatchdayNumber()` helper to extract number from any format ("MatchDay 2", "MD2", "2", 2)
- **Fix**: `findNextMatchesForSuspension` now fetches trigger match date first, filters by date (client-side), sorts properly
- **Fix**: `getSeasonCards` now selects `match_date, match_time` and sorts by date/time/matchday
- **Added**: `recalculateSeasonSuspensions()` function to batch recalculate all players
- **Added**: `/api/admin/suspensions/recalculate` POST endpoint (auth-required)
- **Added**: "🔄 คำนวณใหม่ทั้งหมด" button in `/admin/suspensions` page

## [Phase 3A] - 2026-06-18 ✅ COMPLETE

### Suspension Management (Initial Release)
- Rich `suspension_details` JSONB: trigger match, event, points breakdown, banned matches
- `/admin/suspensions` read-only page with expandable detail rows
- `/api/admin/suspensions` admin read API (auth-required)
- Public `/discipline` page: next match column + status badges
- Status logic: 0pts=ปกติ, ban=0=สะสมคะแนน, ban>0+match=ติดโทษแบน, ban>0+no match=ไม่พบโปรแกรม
- AdminNav: 🚨 Suspensions link

## [Phase 2e] - 2026-06-18 ✅ COMPLETE

### Polish & Testing Complete
- Console logs cleanup: [TAG] prefix added to all 9 files
- Mobile responsive: sm: breakpoints, responsive padding/text for 10 pages
- Performance monitoring: timing logs for API endpoints
- Testing verified: session/logout OK, card save 100-200ms, build passed
- Fixed: responsive grids, button sizes, font sizes for mobile

## [Phase 2d] - 2026-06-18 ✅ COMPLETE

### Card Management & CFYL Suspensions
- Card management: add/edit/delete with real-time updates
- CFYL suspension system: Y=2pts, YY=4pts, R=6pts, Y+R=8pts
- Auto-suspensions: 6pts=1ban, 12+pts=2bans
- Performance: N+1 query fix (10-50x faster, 50-150ms)

## [Phase 2c] - 2026-06-17 ✅ COMPLETE

### Goal Management
- Multiple goals per player per match support
- Goal add/edit/delete with UI
- Real-time /top-scorers updates

## [Phase 2b] - 2026-06-16 ✅ COMPLETE

### Match Management
- Match edit page with score/status input
- Auto-calculated standings from matches

## [Phase 2a] - 2026-06-15 ✅ COMPLETE

### Admin Authentication & Dashboard
- Email/password authentication
- Admin dashboard with statistics

## [Phase 1] - 2026-06-10 ✅ COMPLETE

### Public Website & Data Import
- Home, fixtures, standings, top-scorers, discipline pages
- Imported 224 matches, 668 players, 89 goals, 38 cards

Last Updated: 2026-06-18

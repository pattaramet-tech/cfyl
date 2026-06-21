# CHANGELOG

All notable changes to CFYL Youth League system are documented here.

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

# CHANGELOG

All notable changes to CFYL Youth League system are documented here.

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

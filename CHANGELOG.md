# CHANGELOG

All notable changes to CFYL Youth League system are documented here.

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

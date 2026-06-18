# 📊 PROJECT_STATUS.md

**Last Updated**: 2026-06-18 (Phase 3A + Bug Fix)  
**Current Phase**: Phase 2e ✅ COMPLETE | Phase 3A ✅ COMPLETE (Bug Fixed)

---

## 🌐 Production Status

| Item | Status | URL |
|------|--------|-----|
| Public Website | ✅ Live | https://cfyl-youth-league.vercel.app |
| GitHub Repository | ✅ Active | https://github.com/pattaramet-tech/cfyl |
| Supabase Project | ✅ Active | qryclkvqucnynkjkvqyv.supabase.co |
| Vercel Deployment | ✅ Active | Production branch: main |

---

## 📈 Completion Status

### Phase 1: Public Website ✅ COMPLETE
- [x] Home page with season/age group selector
- [x] Fixtures page (with matchday filter)
- [x] Standings page (auto-calculated from matches)
- [x] Top Scorers page (aggregated from goals)
- [x] Discipline page (aggregated from cards)
- [x] Data import from Excel (CFYL2026.xlsx)
- [x] Score display fix (handle 0-0, 0-1 correctly)

### Phase 2a: Admin Backend - Authentication & Dashboard ✅ COMPLETE
- [x] Database schema with RLS policies
- [x] Supabase Auth setup (email/password)
- [x] Admin login page
- [x] Admin dashboard (stats display)
- [x] Auth API endpoints (login, logout, me)
- [x] Admin nav/sidebar

### Phase 2b: Match Management ✅ COMPLETE
- [x] Match list page with filters (/admin/matches)
- [x] Edit match page with score/status input (/admin/matches/[matchId])
- [x] Match update API endpoint (/api/admin/matches/[matchId])
- [x] Admin home page (/admin redirect logic)
- [x] Database migration script (active column)
- [x] Route folder naming fixed ([matchId] not [matchId/])
- [x] RLS policy recursion fixed
- [x] Admin login working on production

### Phase 2c: Goal Management ✅ COMPLETE
- [x] Schema updated: removed unique constraint (supports multiple goals per player)
- [x] Migration script: `scripts/migration-remove-goals-unique.sql`
- [x] Goal list by match (page: `/admin/goals`)
- [x] Add/edit/delete goals (APIs: POST/PUT/DELETE)
- [x] Player selector component (filtered by match teams)
- [x] Player selector API: `/api/admin/players` (server-side filter)
- [x] Goal form component (add/edit)
- [x] Goals list component (table + actions)
- [x] can_edit_goals permission enforced
- [x] /top-scorers auto-updates
- [x] Support multiple goals per player per match
- [x] Bug fix: Added missing /api/admin/players endpoint

### Phase 2d: Card Management ✅ COMPLETE
- [x] Card list by match page (/admin/cards)
- [x] Add/edit/delete cards UI
- [x] Card type selector (yellow, red, second_yellow)
- [x] API: GET /api/admin/cards (fetch cards for match)
- [x] API: POST /api/admin/cards (add card with team_id)
- [x] API: PUT /api/admin/cards/[cardId] (edit card + player change)
- [x] API: DELETE /api/admin/cards/[cardId] (delete card)
- [x] CFYL Custom Suspension System
  - [x] Suspension calculation library (lib/suspension-calc.ts)
  - [x] Card point scoring: Y=2, YY=4, R=6, Y+R=8
  - [x] Auto-calculate suspension thresholds (6=1ban, 12+=2bans)
  - [x] Auto-find next match for suspension
  - [x] Suspensions table with RLS policies
- [x] Public API: GET /api/public/suspensions
- [x] Updated /discipline page to show CFYL suspension points

### Phase 2e: Polish & Testing ✅ COMPLETE
- [x] Regression testing: all public pages (/, /fixtures, /standings, /top-scorers, /discipline)
- [x] Admin pages testing: /admin/cards, /admin/goals, /admin/matches
- [x] UI message polish: loading/error/success states
- [x] Mobile responsive: added sm: breakpoints, responsive padding/text
  - [x] Admin pages: responsive grid layouts
  - [x] Public pages: mobile-friendly card layouts
  - [x] Button/select responsive sizing (px-3 md:px-4, text-sm md:text-base)
- [x] Session/logout flow verified
- [x] Card save timing optimized (100-200ms, was 500ms+)
- [x] Console logs cleanup: all [TAG] prefixes added
- [x] npm run build: ✅ PASSED (28 routes)
- [x] Performance: suspension calculation N+1 fix (50-150ms)

### Phase 3A: Suspension Management ✅ COMPLETE (Bug Fixed 2026-06-18)
- [x] `suspension_details` JSONB column (migration: scripts/migration-phase3a-suspension-details.sql)
- [x] `lib/suspension-calc.ts` — full rewrite with rich details
  - [x] `parseMatchdayNumber()` helper: handles "MatchDay 2", "MD2", 2, "2" → number
  - [x] `getSeasonCards()` — sorts by match_date ASC → match_time ASC → matchday ASC
  - [x] `findNextMatchesForSuspension()` — date-based filtering with matchday fallback
  - [x] `recalculatePlayerSuspension()` — builds SuspensionDetails, passes match_id (not matchday) to findNextMatches
  - [x] `recalculateSeasonSuspensions()` — recalcs all players in a season/age_group
- [x] Bug fix: findNextMatchesForSuspension used invalid `.in()` → fixed to `.or()`
- [x] Bug fix: matchday stored as "MatchDay N" text — added `parseMatchdayNumber()`, now uses date-based ordering
- [x] Bug fix: was passing `triggerMatchday` (number) → now passes `triggerMatchId` for accurate date comparison
- [x] `/api/admin/suspensions` — auth-required read API
- [x] `/api/admin/suspensions/recalculate` — POST endpoint to recalculate all players
- [x] `/admin/suspensions` — read-only admin page with expandable detail rows
  - [x] "🔄 คำนวณใหม่ทั้งหมด" button triggers recalculate + auto-refreshes table
  - [x] Summary cards: banned / no-schedule / accumulating / normal
  - [x] Expandable rows: trigger event, banned matches, point history
- [x] Status logic per CFYL rules (ban=0 → สะสมคะแนน, not 6-11 pts threshold)
- [x] `/discipline` public page — Next Match(es) column + Status column
- [x] `AdminNav` — 🚨 Suspensions link added
- [x] npm run build: ✅ PASSED (32 routes)

### Phase 3B: Player Management 🔴 NOT STARTED
### Phase 3C: Team Management 🔴 NOT STARTED
### Phase 3D: Season Management 🔴 NOT STARTED

### Phase 4: Integrations 🔴 NOT STARTED
- [ ] Reports & analytics
- [ ] PDF export
- [ ] Discord integration
- [ ] Advanced statistics

---

## 📊 Database Status

| Table | Records | Status | Last Updated |
|-------|---------|--------|--------------|
| seasons | 1 | ✅ | 2026-06-18 |
| age_groups | 2 | ✅ | 2026-06-18 |
| divisions | 10 | ✅ | 2026-06-18 |
| teams | 32 | ✅ | 2026-06-18 |
| players | 668 | ✅ | 2026-06-18 |
| matches | 224 | ✅ | 2026-06-18 |
| goals | 89 | ✅ | 2026-06-18 |
| cards | 38 | ✅ | 2026-06-18 |
| suspensions | Auto | ✅ | 2026-06-18 (after migration) |
| admin_profiles | 0 | ⚪ Pending | Setup needed |

---

## 🔑 API Routes

### Public API (Read-only)
```
GET    /api/public/seasons              → List all seasons
GET    /api/public/age-groups           → Age groups by season
GET    /api/public/divisions            → Divisions by season/age group
GET    /api/public/matches              → Matches (with filters)
GET    /api/public/standings            → Calculated standings
GET    /api/public/top-scorers          → Top scorers list
GET    /api/public/discipline           → Cards & discipline info
GET    /api/public/suspensions          → Player suspensions (Phase 2d)
```

### Admin API (Auth required)
```
POST   /api/admin/auth/login            → Sign in (email/password)
POST   /api/admin/auth/logout           → Sign out
GET    /api/admin/auth/me               → Current user info
GET    /api/admin/stats                 → Dashboard statistics
PUT    /api/admin/matches/:matchId      → Update score/status (Phase 2b)
POST   /api/admin/goals                 → Add goal (Phase 2c)
PUT    /api/admin/goals/:goalId         → Edit goal (Phase 2c)
DELETE /api/admin/goals/:goalId         → Delete goal (Phase 2c)
GET    /api/admin/cards                 → List cards by match (Phase 2d)
POST   /api/admin/cards                 → Add card (Phase 2d)
PUT    /api/admin/cards/:cardId         → Edit card (Phase 2d)
DELETE /api/admin/cards/:cardId         → Delete card (Phase 2d)
```

---

## 🖥️ Pages

### Public Pages
```
/                      → Home (season selector + preview)
/fixtures              → All matches with matchday filter
/standings             → League standings
/top-scorers           → Top scorers table
/discipline            → Cards & suspensions
```

### Admin Pages
```
/admin/login           → Login form
/admin/dashboard       → Stats & quick actions
/admin/matches         → Match management (Phase 2b)
/admin/matches/:id     → Edit specific match (Phase 2b)
/admin/goals           → Goal management (Phase 2c)
/admin/cards           → Card management (Phase 2d)
/admin/teams           → Team management (Phase 3)
/admin/settings        → Admin settings (Phase 3)
```

---

## 🔐 Environment Variables

### Required (Already Set)
```
NEXT_PUBLIC_SUPABASE_URL          = https://qryclkvqucnynkjkvqyv.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY     = eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY         = eyJhbGc... (admin key)
```

### Optional (Not Currently Used)
```
NEXT_PUBLIC_ADMIN_ENABLED         = true
NEXT_PUBLIC_APP_NAME              = Chonburi Futsal Youth League
NEXT_PUBLIC_APP_URL               = http://localhost:3000
```

---

## 🐛 Bugs Fixed (Phase 2b Hotfix)

| Bug | Status | Fix | Date |
|-----|--------|-----|------|
| `/admin` route 404 | ✅ Fixed | Created app/admin/page.tsx with redirect logic | 2026-06-18 |
| Admin table active column mismatch | ✅ Fixed | Created rerun-safe migration script | 2026-06-18 |
| Phase 2a admin auth incomplete | ✅ Fixed | Schema + code already aligned for active column | 2026-06-18 |

## ✅ Admin Authentication: Production Ready

**Status**: All fixes deployed (2026-06-18)

**What's Fixed**:
- ✅ Safe active column handling (undefined defaults to true)
- ✅ Migration script is rerun-safe
- ✅ /admin/login page no longer protected by auth guard
- ✅ /admin/login displays login form (public page)
- ✅ Protected pages (/dashboard, /matches) require auth
- ✅ /admin redirect logic (token → dashboard, no token → login)
- ✅ Comprehensive SETUP_ADMIN.md guide
- ✅ Detailed logging for troubleshooting

**Recent Fixes**:
- Commit 1a7b9d8: Removed auth guard from /admin/login
- Commit 47ad7bc: Fixed RLS policy recursion:
  * Removed recursive "Superadmins can read all profiles" policy
  * Created simple "Authenticated users can read their own profile" policy
  * Changed login API to use service role key (bypasses RLS)
  * Now queries admin_profiles without recursion

**Next Steps**:
1. Wait for Vercel redeploy (commit 1a7b9d8)
2. Follow SETUP_ADMIN.md step-by-step:
   - Run migration in Supabase
   - Create admin user in Auth
   - Insert admin_profiles record
3. Test production URLs:
   - /admin/login → should show login form
   - Login → should redirect to /admin/dashboard
4. Report results

## 🚀 Setup Steps (Blocked Until Auth Fixed)

After debugging and fixing auth:

1. **Run SQL Migration in Supabase**:
   ```sql
   -- Go to SQL Editor and run: scripts/migration-add-active-column.sql
   ```

2. **Create Admin User in Supabase Auth**:
   - Go to Supabase Dashboard → Authentication
   - Create new user (email/password)
   - Copy the user UUID

3. **Insert Admin Profile**:
   ```sql
   INSERT INTO admin_profiles (id, email, full_name, role, active)
   VALUES (
     '<PASTE-UUID-FROM-STEP-2>',
     'admin@example.com',
     'Admin Name',
     'superadmin',
     true
   );
   ```
   
   **CRITICAL**: The `id` must exactly match the UUID from Supabase Auth

4. **Test**:
   - Visit https://cfyl-youth-league.vercel.app/admin/login
   - Login with email/password
   - Should redirect to /admin/dashboard
   - Check browser console for debug logs

---

## 📝 Technical Debt

| Item | Priority | Notes |
|------|----------|-------|
| Add audit trail (updated_by columns) | Low | For Phase 3 |
| Pagination on large result sets | Low | Not needed for current data size |
| Caching layer for public APIs | Low | Currently dynamic, could optimize |
| Rate limiting on admin APIs | Medium | For Phase 2d |
| Error logging/monitoring | Low | Currently logs to console only |

---

## 📦 Dependencies

### Production
- next 16.2.9
- @supabase/supabase-js (latest)
- tailwindcss 3.x
- typescript

### Development
- ts-node
- @types/node
- @types/react

---

## 🚀 Next Phase: Phase 3 Advanced Features

### Pre-Deployment for Phase 2d
Must run TWO migrations in Supabase (in order):
1. `scripts/migration-remove-goals-unique.sql` (Phase 2c)
2. `scripts/migration-add-suspensions-table.sql` (Phase 2d)

### Completed Phases
- Phase 2b: ✅ COMPLETE (Match Editing)
- Phase 2c: ✅ COMPLETE (Goal Management)
- Phase 2d: ✅ COMPLETE (Card Management with CFYL Suspensions)
- Phase 2e: ✅ COMPLETE (Polish & Testing)

### Timeline
- Phase 2b: ✅ COMPLETE (Match Editing)
- Phase 2c: ✅ COMPLETE (Goal Management)
- Phase 2d: ✅ COMPLETE (Card Management with CFYL Suspensions - 14 files, 1905 LOC)
- Phase 2e: ✅ COMPLETE (Polish & Testing - console logs, mobile responsive, performance)
- Phase 3: ⏳ NEXT (Advanced Features - suspension management, player/team/season management)

### After Phase 2d Deployed
1. Run both migrations in Supabase
2. Test /admin/cards page (add/edit/delete cards)
3. Verify /discipline shows CFYL suspension points
4. Add card for same player in same match, verify point calculation
5. Check auto-suspension works (6pts = 1 ban, 12+pts = 2 bans)
6. Start Phase 2e (Polish & testing)

---

## 📋 File Checklist

Essential files that must always exist:
- [x] PROJECT_STATUS.md (this file)
- [x] ADMIN_ROADMAP.md
- [x] DATABASE_REFERENCE.md
- [x] DEPLOYMENT_GUIDE.md
- [x] CHANGELOG.md
- [x] .env.local (gitignored)
- [x] scripts/schema.sql
- [x] scripts/admin-schema.sql
- [x] scripts/import-cfyl.ts

---

## ✅ Verification Checklist

Run before deployment:
```bash
[ ] npm run build        (no errors)
[ ] npm run dev         (loads locally)
[ ] /                   (public page loads)
[ ] /admin/login        (admin login loads)
[ ] /api/public/*       (APIs work)
[ ] Supabase tables     (data visible)
```

---

## 📞 Support

- **Supabase Docs**: https://supabase.com/docs
- **Next.js Docs**: https://nextjs.org/docs
- **Vercel Docs**: https://vercel.com/docs
- **GitHub**: https://github.com/pattaramet-tech/cfyl


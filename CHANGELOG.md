# 📋 CHANGELOG.md

Complete History of CFYL Project Changes

---

## Format

Each entry contains:
- **Date**: YYYY-MM-DD
- **Feature/Fix**: What was done
- **Files Modified**: List of changed files
- **Reason**: Why it was changed
- **Impact**: What it affects

---

## 2026-06-18 - Phase 2b: Fixed Edit Match Route

### Fix: Edit Match Page Returns 404

**Problem**: Clicking "Edit" on match list showed 404 error

**Root Cause**: Dynamic route folder was named incorrectly
- Was: `app/admin/matches/[matchId/]/page.tsx` (extra slash)
- Should: `app/admin/matches/[matchId]/page.tsx` (no slash)

**Solution**: Renamed folder from `[matchId/]` to `[matchId]`

**Result**:
- ✅ Edit Match page now accessible
- ✅ Route `/admin/matches/{matchId}` works
- ✅ Can edit match scores and status
- ✅ Can save changes to database
- ✅ Public standings update when match edited

**Build Status**: ✅ PASSED (21 routes + `/admin/matches/[matchId]` fixed)
**Commit**: 828b427

---

## 2026-06-18 - Admin Auth: Fixed RLS Policy Recursion

### Fix: Infinite Recursion in admin_profiles RLS Policy

**Problem**: "Superadmins can read all profiles" policy queries admin_profiles
- Policy: `SELECT id FROM admin_profiles WHERE role = 'superadmin'`
- Running this policy triggers the same policy → infinite recursion
- Error: "infinite recursion detected in policy for relation admin_profiles"

**Solution**: 
1. Remove recursive policy ("Superadmins can read all profiles")
2. Keep only simple policy ("Authenticated users can read their own profile")
3. Change login API to use service role key (bypasses RLS)
4. Update migration to fix existing databases

**Files Modified**:
- `scripts/admin-schema.sql` - Removed recursive policy, documented workaround
- `scripts/migration-add-active-column.sql` - Now includes policy fix
- `app/api/admin/auth/login/route.ts` - Use service role for admin_profiles queries

**Build Status**: ✅ PASSED (21 routes)
**Commit**: 47ad7bc

---

## 2026-06-18 - Admin Login: Fixed Public Access

### Fix: /admin/login Page Displayed "Authentication error"

**Problem**: /admin/login was protected by AdminLayout auth guard
- User goes to /admin/login
- AdminLayout checks for auth token (doesn't exist yet)
- Redirects to /admin/login → creates redirect loop
- Shows "Authentication error" instead of login form

**Solution**: Skip auth check for /admin/login in AdminLayout

**Files Modified**:
- `app/admin/layout.tsx`
  * Added usePathname hook
  * Check if pathname === "/admin/login"
  * For login page: render without auth check or sidebar
  * For other pages: keep auth requirement

**Result**:
- ✅ /admin/login displays login form immediately
- ✅ No "Authentication error" message
- ✅ Protected pages still require auth
- ✅ Redirect flow: no token → login, has token → dashboard

**Build Status**: ✅ PASSED (21 routes)
**Commit**: 1a7b9d8

---

## 2026-06-18 - Admin Auth: Production Setup Ready

### Fix: Production-Ready Admin Authentication

**Files Modified**:
- `app/api/admin/auth/login/route.ts` - Safe active column check
- `lib/admin-middleware.ts` - Safe active column check

**Files Added**:
- `SETUP_ADMIN.md` - Complete setup guide (5-step process)

**Changes**:
1. Active column checks now safe: `active !== false` instead of `!active`
   - Allows undefined values (treats as true)
   - Can run migration after deployment
   - No downtime needed

2. Complete SETUP_ADMIN.md guide:
   - Step 1: Run migration script (rerun-safe)
   - Step 2: Verify database schema
   - Step 3: Create admin user in Supabase Auth
   - Step 4: Insert admin_profiles record
   - Step 5: Test login
   - Troubleshooting section with SQL fixes

3. Migration script is idempotent:
   - Check if active column exists
   - Only add if missing
   - Create index if not exists
   - Safe to run multiple times

**Build Status**: ✅ PASSED (21 routes)
**Commit**: e629e6a
**Timeline**: Ready for production setup (no downtime needed)

---

## 2026-06-18 - Admin Auth Debug: Comprehensive Logging

### Fix: Add Detailed Logging to Auth Flow

**Files Modified**:
- `app/api/admin/auth/login/route.ts` - Log auth steps, profile lookup, active status
- `lib/admin-middleware.ts` - Log token verification, profile queries, errors
- `app/admin/dashboard/page.tsx` - Log token check, API requests, error details
- `app/api/admin/stats/route.ts` - Log request received, auth result, errors
- `app/admin/login/page.tsx` - Log submission, response, token storage, redirects

**Purpose**: Enable debugging production auth issues via console logs (Vercel Logs)

**Build Status**: ✅ PASSED

**Next Steps**:
1. Deploy to Vercel
2. Try login, check Vercel Logs for [LOGIN], [MIDDLEWARE], [DASHBOARD] messages
3. Verify admin_profiles record exists with correct UUID
4. If "Admin profile not found" - UUID mismatch (fix in DB)
5. If JWT error - token issue (check Supabase auth)

---

## 2026-06-18 - Phase 2b Hotfix: Production Issues

### Fix: Admin Backend Production Issues

**Files Added**:
- `app/admin/page.tsx` - Redirect page for /admin route
- `scripts/migration-add-active-column.sql` - Rerun-safe migration for active column

**Issues Fixed**:
1. `/admin` route returned 404 → Now redirects to /admin/dashboard (if logged in) or /admin/login
2. Admin authentication error → Schema already has active column, migration script provided for production DB
3. Incomplete Phase 2b deployment → All pieces now in place for production

**Build Status**: ✅ PASSED (21 routes registered)
**Deployment**: Requires running migration script in Supabase SQL Editor before first use

**Production Checklist**:
- [ ] Deploy to Vercel
- [ ] Run `scripts/migration-add-active-column.sql` in Supabase
- [ ] Create admin user in Supabase Auth
- [ ] Insert admin_profiles record
- [ ] Test /admin/login flow

---

## 2026-06-18 - Phase 2b Match Editing Complete

### Feature: Admin Match Editing

**Files Added**:
- `app/admin/matches/page.tsx` - Match list with filters
- `app/admin/matches/[matchId]/page.tsx` - Edit match page
- `app/api/admin/matches/[matchId]/route.ts` - Match update API

**Features**:
- List all matches with season/age group/division filters
- Edit match scores (0-99 validation)
- Change match status (scheduled/finished/postponed/cancelled)
- Score input validation
- Permission check (can_edit_matches)
- Success/error messages
- Logging for audit trail

**Build Status**: ✅ PASSED
**Git Commit**: 13b15b3 - "feat: Phase 2b - Match editing interface and API"

---

## 2026-06-18 - Phase 2a Admin Backend Complete

### Feature: Admin Authentication & Dashboard

**Files Added**:
- `scripts/admin-schema.sql` - Database schema with RLS policies
- `lib/admin-auth.ts` - Authentication helper functions
- `lib/admin-middleware.ts` - JWT verification and permission checking
- `app/api/admin/auth/login/route.ts` - Sign-in endpoint
- `app/api/admin/auth/logout/route.ts` - Sign-out endpoint
- `app/api/admin/auth/me/route.ts` - Get current user endpoint
- `app/api/admin/stats/route.ts` - Dashboard stats endpoint
- `app/admin/layout.tsx` - Admin layout with auth guard
- `app/admin/login/page.tsx` - Admin login form page
- `app/admin/dashboard/page.tsx` - Dashboard with statistics
- `components/AdminNav.tsx` - Navigation sidebar component
- `components/AdminGuard.tsx` - Auth guard component

**Files Modified**:
- `lib/admin-middleware.ts` - Fixed TypeScript error (line 145)

**Documentation Added**:
- `PROJECT_STATUS.md` - Project status tracker
- `ADMIN_ROADMAP.md` - Development roadmap
- `DATABASE_REFERENCE.md` - Database schema documentation
- `DEPLOYMENT_GUIDE.md` - Deployment instructions
- `CHANGELOG.md` - This file

**Reason**: Implement Phase 2a admin backend foundation before Phase 2b (match editing)

**Impact**:
- New /admin/login page
- New /admin/dashboard page
- New /api/admin/* routes
- New admin_profiles table with RLS
- No impact on public pages or API

**Build Status**: ✅ PASSED

---

## 2026-06-18 - Fix Score Display (0-0 Support)

### Fix: Handle zero scores in match data import

**Files Modified**:
- `scripts/import-cfyl.ts` - Lines 291-292

**Change**:
```typescript
// Before:
home_score: m.ScoreA || null,
away_score: m.ScoreB || null,

// After:
home_score: m.ScoreA != null ? m.ScoreA : null,
away_score: m.ScoreB != null ? m.ScoreB : null,
```

**Reason**: Score of 0 was falsy in JavaScript, causing 0-0, 0-1 matches to show no score on Fixtures page

**Impact**:
- Now correctly displays 0-0, 0-1, 1-0 scores
- Must re-import data or manually update database
- Data re-imported 2026-06-18 with correct scores

**Build Status**: ✅ PASSED
**Git Commit**: 677e5c0 - "fix: handle zero scores in match data import"

---

## 2026-06-18 - TypeScript/Build Fixes

### Fix: charset not valid in Next.js Metadata

**Files Modified**:
- `app/layout.tsx` - Removed invalid `charset` property

**Reason**: Next.js 16 Metadata type doesn't include `charset` field

**Impact**: Build now passes TypeScript checks

**Build Status**: ✅ PASSED

### Fix: MatchCard division type

**Files Modified**:
- `components/MatchCard.tsx` - Added optional `division` to interface

**Reason**: Component tried to access match.division?.name but type didn't include it

**Impact**: MatchCard component can now display division name

**Build Status**: ✅ PASSED

### Fix: Dynamic routing for useSearchParams

**Files Added**:
- `app/discipline/layout.tsx` - Mark route dynamic
- `app/fixtures/layout.tsx` - Mark route dynamic
- `app/standings/layout.tsx` - Mark route dynamic
- `app/top-scorers/layout.tsx` - Mark route dynamic

**Files Modified**:
- `app/layout.tsx` - Added `export const dynamic = 'force-dynamic'`
- `app/api/public/*/route.ts` - Changed from `revalidate` to `dynamic`

**Reason**: useSearchParams() in client components requires routes to be marked dynamic (can't be statically generated)

**Impact**: All pages properly configured for dynamic rendering, build completes successfully

**Build Status**: ✅ PASSED

---

## 2026-06-17 - Data Import Complete

### Feature: Excel Data Import

**Files Created**:
- `scripts/import-cfyl.ts` - Complete import script
- `RUN_IMPORT.md` - Import instructions
- `FIXES_SUMMARY.md` - Documentation of fixes

**Files Modified**:
- `scripts/schema.sql` - Added UNIQUE constraints
- `tsconfig.scripts.json` - Created for ts-node

**Data Imported**:
- 1 season (CFYL 2026)
- 2 age groups (U14, U17)
- 10 divisions
- 32 teams
- 668 players
- 224 matches
- 89 goals
- 38 cards

**Reason**: Import CFYL2026.xlsx data to populate database

**Impact**:
- Database now has all match/player/goal/card data
- Public website can display matches, standings, scorers, discipline

**Build Status**: ✅ PASSED

---

## 2026-06-16 - Phase 1 Public Website Complete

### Feature: Home Page

**Files Created**:
- `app/page.tsx` - Home page with season selector
- `components/SeasonSelector.tsx` - Season/age group selector

**Features**:
- Season and age group selector
- 5 latest matches preview
- Top 4 standings preview
- Top 5 scorers sidebar

**Build Status**: ✅ PASSED

### Feature: Fixtures Page

**Files Created**:
- `app/fixtures/page.tsx` - Fixtures page

**Features**:
- List all matches
- Filter by matchday
- Match cards with scores
- Status indicator (scheduled/finished)

**Build Status**: ✅ PASSED

### Feature: Standings Page

**Files Created**:
- `app/standings/page.tsx` - Standings page
- `components/StandingsTable.tsx` - Standings table

**Features**:
- Division selector
- League table with W/L/D/Pts
- Auto-calculated standings
- Ranking algorithm

**Build Status**: ✅ PASSED

### Feature: Top Scorers Page

**Files Created**:
- `app/top-scorers/page.tsx` - Top scorers page
- `components/TopScorersTable.tsx` - Scorers table

**Features**:
- Division filter
- Ranked list of scorers
- Goal count per player
- Player info display

**Build Status**: ✅ PASSED

### Feature: Discipline Page

**Files Created**:
- `app/discipline/page.tsx` - Discipline page
- `components/DisciplineTable.tsx` - Cards table

**Features**:
- Division filter
- Card records (yellow/red)
- Suspension status
- Discipline points

**Build Status**: ✅ PASSED

### Feature: API Routes (Public)

**Files Created**:
- `app/api/public/seasons/route.ts`
- `app/api/public/age-groups/route.ts`
- `app/api/public/divisions/route.ts`
- `app/api/public/matches/route.ts`
- `app/api/public/standings/route.ts`
- `app/api/public/top-scorers/route.ts`
- `app/api/public/discipline/route.ts`

**Features**:
- Dynamic standings calculation
- Aggregated goals/cards
- Filter support (season, age group, division, matchday)

**Build Status**: ✅ PASSED

---

## 2026-06-15 - Initial Project Setup

### Feature: Database Schema

**Files Created**:
- `scripts/schema.sql` - Database schema (9 tables)

**Tables**:
- seasons
- age_groups
- divisions
- teams
- players
- matches
- goals
- cards
- suspensions

**Features**:
- Foreign key relationships
- Default timestamps
- CHECK constraints
- Indexes for performance

**Reason**: Create database structure for futsal league management

**Impact**: Foundation for all data operations

**Build Status**: ✅ PASSED

### Feature: Supabase Integration

**Files Created**:
- `lib/supabase.ts` - Supabase client
- `lib/calculations.ts` - Helper functions
- `types/db.ts` - TypeScript interfaces

**Utilities**:
- excelDateToISO() - Convert Excel dates
- parseTaiTime() - Parse Thai time format
- calculateStandings() - Compute standings
- extractDivisionNumber() - Parse division number

**Reason**: Setup Supabase integration and utility functions

**Impact**: All API routes and calculations depend on these utilities

**Build Status**: ✅ PASSED

### Feature: Project Configuration

**Files Created**:
- `next.config.ts` - Next.js configuration
- `tsconfig.json` - TypeScript configuration
- `tailwind.config.ts` - Tailwind CSS configuration
- `.env.example` - Environment template
- `app/layout.tsx` - Root layout with header/footer
- `app/globals.css` - Global styles

**Reason**: Setup Next.js 16 project with Tailwind CSS

**Impact**: Foundation for all pages and styling

**Build Status**: ✅ PASSED

### Feature: Documentation

**Files Created**:
- `README.md` - Project overview
- `SETUP_GUIDE.md` - Setup instructions
- `QUICK_START.md` - 5-step quick start
- `MVP_SUMMARY.md` - MVP feature summary

**Reason**: Document project setup and features

**Impact**: Helps developers understand project structure

---

## Version History Summary

| Date | Phase | Status | Features |
|------|-------|--------|----------|
| 2026-06-18 | 2a | ✅ COMPLETE | Admin auth, dashboard, RLS policies |
| 2026-06-18 | 1 | ✅ COMPLETE | Score fix (0-0 support) |
| 2026-06-18 | 1 | ✅ COMPLETE | TypeScript/build fixes |
| 2026-06-17 | 1 | ✅ COMPLETE | Excel data import |
| 2026-06-16 | 1 | ✅ COMPLETE | Public website (all 5 pages) |
| 2026-06-15 | 1 | ✅ COMPLETE | Schema, Supabase, config |

---

## Commits Made

```
677e5c0 - fix: handle zero scores in match data import
[Previous commits from Phase 1 deployment]
```

---

## Pending Changes (Phase 2b+)

- [ ] Match editing page
- [ ] Match update API
- [ ] Goal management
- [ ] Card management
- [ ] Polish & testing

---

## Files Ever Created

**Total**: 45+ files

### Core Application (20+ files)
- 5 public pages
- 2 admin pages (1 planned for 2b)
- 7 API routes (public)
- 4 API routes (admin)
- 4 components
- 3 utility files
- 1 config files
- 1 layout

### Documentation (5 files)
- PROJECT_STATUS.md
- ADMIN_ROADMAP.md
- DATABASE_REFERENCE.md
- DEPLOYMENT_GUIDE.md
- CHANGELOG.md

### Database (2 files)
- schema.sql
- admin-schema.sql

### Scripts (3 files)
- import-cfyl.ts
- admin-schema.sql
- tsconfig.scripts.json

---

## Known Issues Fixed

| Issue | Fixed Date | Commit |
|-------|-----------|--------|
| charset in metadata | 2026-06-18 | Build fixes |
| MatchCard division type | 2026-06-18 | Build fixes |
| Dynamic routing errors | 2026-06-18 | Build fixes |
| Score 0 not displaying | 2026-06-18 | 677e5c0 |
| Duplicate players on import | 2026-06-17 | Import fixes |

---

## Next Milestones

| Milestone | ETA | Priority |
|-----------|-----|----------|
| Phase 2b (Match Editing) | 2026-06-20 | P0 |
| Phase 2c (Goal Management) | 2026-06-21 | P0 |
| Phase 2d (Card Management) | 2026-06-22 | P0 |
| Phase 2e (Testing & Polish) | 2026-06-23 | P0 |
| Phase 3 (Advanced Features) | 2026-07-07 | P1 |
| Phase 4 (Integrations) | TBD | P2 |


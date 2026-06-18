# 🗺️ ADMIN_ROADMAP.md

Complete Admin Backend Development Roadmap

---

## Phase 1: Public Website (✅ COMPLETE)

### ✅ 1.1 Homepage
- **Status**: ✅ COMPLETE
- **Priority**: P0
- **Dependencies**: None
- **Features**:
  - Season/age group selector
  - Recent matches preview
  - Top 4 standings preview
  - Top 5 scorers sidebar
  - Responsive design

### ✅ 1.2 Fixtures Page
- **Status**: ✅ COMPLETE
- **Priority**: P0
- **Dependencies**: Matches data
- **Features**:
  - Full match list
  - Matchday filter dropdown
  - Match score display (0-0 support)
  - Match status indicator

### ✅ 1.3 Standings Page
- **Status**: ✅ COMPLETE
- **Priority**: P0
- **Dependencies**: Matches data
- **Features**:
  - Auto-calculated standings
  - Division selector
  - W/L/D/Pts columns
  - Ranking algorithm

### ✅ 1.4 Top Scorers Page
- **Status**: ✅ COMPLETE
- **Priority**: P0
- **Dependencies**: Goals data
- **Features**:
  - Aggregated scorer rankings
  - Division filter
  - Player info display
  - Jersey number column

### ✅ 1.5 Discipline Page
- **Status**: ✅ COMPLETE
- **Priority**: P0
- **Dependencies**: Cards data
- **Features**:
  - Card aggregation (yellow/red)
  - Suspension status
  - Discipline points
  - Player info

### ✅ 1.6 Data Import
- **Status**: ✅ COMPLETE (with score fix)
- **Priority**: P0
- **Dependencies**: Database schema
- **Features**:
  - Import from CFYL2026.xlsx
  - 224 matches imported
  - 668 players imported
  - 89 goals imported
  - 38 cards imported
  - Deduplication logic
  - Score handling (0-0 support)

---

## Phase 2: Admin Backend (🟡 IN PROGRESS)

### Phase 2a: Authentication & Dashboard (🟢 ACTIVE)

#### 2a.1 ✅ Database Schema with RLS
- **Status**: ✅ COMPLETE
- **Priority**: P0 (Blocker)
- **Dependencies**: None
- **Components**:
  - `scripts/admin-schema.sql`
  - admin_profiles table
  - RLS policies for all tables
  - Index creation

#### 2a.2 ✅ Admin Login Page
- **Status**: ✅ COMPLETE
- **Priority**: P0
- **Dependencies**: Supabase Auth setup
- **File**: `app/admin/login/page.tsx`
- **Features**:
  - Email/password form
  - Error messages
  - Loading states
  - Redirect if already logged in
  - Link to public website

#### 2a.3 ✅ Auth API Endpoints
- **Status**: ✅ COMPLETE
- **Priority**: P0
- **Dependencies**: Supabase Auth
- **Files**:
  - `app/api/admin/auth/login/route.ts`
  - `app/api/admin/auth/logout/route.ts`
  - `app/api/admin/auth/me/route.ts`
- **Features**:
  - JWT token generation
  - User verification
  - Admin profile check
  - Token validation

#### 2a.4 ✅ Auth Libraries
- **Status**: ✅ COMPLETE
- **Priority**: P0
- **Dependencies**: Supabase SDK
- **Files**:
  - `lib/admin-auth.ts`
  - `lib/admin-middleware.ts`
- **Features**:
  - Sign in/out functions
  - Token management
  - Permission checking
  - Error responses

#### 2a.5 ✅ Admin Dashboard
- **Status**: ✅ COMPLETE
- **Priority**: P0
- **Dependencies**: Auth API
- **File**: `app/admin/dashboard/page.tsx`
- **Features**:
  - Total matches card
  - Finished matches card
  - Total goals card
  - Total cards card
  - Total teams card
  - Total players card
  - Quick actions links
  - Real-time stats

#### 2a.6 ✅ Admin Layout & Nav
- **Status**: ✅ COMPLETE
- **Priority**: P0
- **Dependencies**: Auth
- **Files**:
  - `app/admin/layout.tsx`
  - `components/AdminNav.tsx`
  - `components/AdminGuard.tsx`
- **Features**:
  - Sidebar navigation
  - User profile display
  - Logout button
  - Auth guard
  - Route protection

### Phase 2b: Match Management (🔴 PENDING)

#### 2b.1 ⬜ Match List Page
- **Status**: PENDING
- **Priority**: P0 (Next)
- **Dependencies**: Phase 2a complete
- **File**: `app/admin/matches/page.tsx`
- **Features**:
  - List all matches
  - Filter by season/age group/division
  - Display home/away teams
  - Show current score
  - Match status badge
  - Edit button per match

#### 2b.2 ⬜ Edit Match Page
- **Status**: PENDING
- **Priority**: P0
- **Dependencies**: Match list
- **File**: `app/admin/matches/[matchId]/page.tsx`
- **Features**:
  - Match details display
  - Home/away team info
  - Score input fields
  - Status selector (scheduled/finished/postponed/cancelled)
  - Validation (scores >= 0)
  - Save/cancel buttons
  - Goals section (preview)
  - Cards section (preview)

#### 2b.3 ⬜ Match Update API
- **Status**: PENDING
- **Priority**: P0
- **Dependencies**: Auth API
- **File**: `app/api/admin/matches/[matchId]/route.ts`
- **Features**:
  - PUT endpoint for updating match
  - Input validation
  - RLS enforcement
  - Auto-update `updated_at`
  - Error handling
  - 200 OK response with updated match

#### 2b.4 ⬜ Dashboard Stats API
- **Status**: ✅ COMPLETE (part of 2a.5)
- **Priority**: P0
- **Dependencies**: Database
- **File**: `app/api/admin/stats/route.ts`
- **Features**:
  - Count total matches
  - Count finished matches
  - Count goals
  - Count cards
  - Returns JSON stats

---

### Phase 2c: Goal Management (🔴 PENDING)

#### 2c.1 ⬜ Goals by Match Page
- **Status**: PENDING
- **Priority**: P1
- **Dependencies**: Phase 2b complete
- **File**: `app/admin/matches/[matchId]/goals/page.tsx`
- **Features**:
  - List current goals for match
  - Show player name, team, goal count
  - Edit button per goal
  - Delete button per goal
  - Add goal form section
  - Player dropdown selector
  - Goal count input

#### 2c.2 ⬜ Player Selector Component
- **Status**: PENDING
- **Priority**: P1
- **Dependencies**: Players data
- **File**: `components/PlayerSelector.tsx`
- **Features**:
  - Dropdown with player list
  - Filter by division
  - Show player name + jersey #
  - Show team name
  - Search capability

#### 2c.3 ⬜ Goal Management APIs
- **Status**: PENDING
- **Priority**: P1
- **Dependencies**: Auth API
- **Files**:
  - `app/api/admin/goals/route.ts` (POST)
  - `app/api/admin/goals/[goalId]/route.ts` (PUT, DELETE)
- **Features**:
  - POST: Create goal record
  - PUT: Update goal count
  - DELETE: Remove goal
  - Validation (player in match division)
  - Deduplication (match_id + player_id unique)
  - RLS enforcement

#### 2c.4 ⬜ Test Goal Management
- **Status**: PENDING
- **Priority**: P1
- **Dependencies**: All goals APIs
- **Tests**:
  - Add goal to match
  - Edit goal count
  - Delete goal
  - Public API still reads correctly
  - Can't duplicate goal (same match + player)

---

### Phase 2d: Card Management (🔴 PENDING)

#### 2d.1 ⬜ Cards by Match Page
- **Status**: PENDING
- **Priority**: P1
- **Dependencies**: Phase 2b complete
- **File**: `app/admin/matches/[matchId]/cards/page.tsx`
- **Features**:
  - List current cards for match
  - Show player, team, card type (badge)
  - Edit button per card
  - Delete button per card
  - Add card form section
  - Player dropdown
  - Card type selector (Yellow/Red)

#### 2d.2 ⬜ Card Management APIs
- **Status**: PENDING
- **Priority**: P1
- **Dependencies**: Auth API
- **Files**:
  - `app/api/admin/cards/route.ts` (POST)
  - `app/api/admin/cards/[cardId]/route.ts` (PUT, DELETE)
- **Features**:
  - POST: Issue card
  - PUT: Change card type
  - DELETE: Remove card
  - Validation (player in match division)
  - Deduplication (match_id + player_id unique)
  - RLS enforcement

#### 2d.3 ⬜ Test Card Management
- **Status**: PENDING
- **Priority**: P1
- **Dependencies**: All card APIs
- **Tests**:
  - Add yellow card to player
  - Add red card to player
  - Edit card type
  - Delete card
  - Public API still reads correctly
  - Can't duplicate card (same match + player)

---

### Phase 2e: Polish & Testing (🔴 PENDING)

#### 2e.1 ⬜ Error Handling
- **Status**: PENDING
- **Priority**: P2
- **Tasks**:
  - Toast notifications for errors
  - User-friendly error messages
  - Validation errors displayed inline
  - Network error handling
  - 401/403 error handling

#### 2e.2 ⬜ Loading States
- **Status**: PENDING
- **Priority**: P2
- **Tasks**:
  - Skeleton loading on pages
  - Button loading spinners
  - Disable form during submission
  - Loading indicators on tables

#### 2e.3 ⬜ Responsive Design
- **Status**: PENDING
- **Priority**: P2
- **Tasks**:
  - Mobile sidebar (collapse)
  - Mobile forms
  - Tablet breakpoints
  - Test on multiple devices

#### 2e.4 ⬜ Integration Testing
- **Status**: PENDING
- **Priority**: P1
- **Tests**:
  - Login → Dashboard → Edit Match → Logout flow
  - Add goals and verify in public API
  - Add cards and verify in public API
  - Verify calculations still work
  - No data corruption

#### 2e.5 ⬜ Build & Deploy
- **Status**: PENDING
- **Priority**: P0
- **Tasks**:
  - `npm run build` passes
  - Deploy to Vercel
  - Verify production works
  - Create git tags for releases

---

## Phase 3: Advanced Admin Features (🔴 NOT STARTED)

### 3.1 Suspension Management
- **Status**: PENDING
- **Priority**: P2
- **Dependencies**: Phase 2 complete
- **Features**:
  - Auto-calculate suspensions from cards
  - Manual suspension override
  - Ban/unban players
  - View suspension history

### 3.2 Player Registration
- **Status**: PENDING
- **Priority**: P2
- **Dependencies**: Phase 2 complete
- **Features**:
  - Add new players
  - Edit player info
  - Assign to teams
  - Update jersey numbers

### 3.3 Team Management
- **Status**: PENDING
- **Priority**: P2
- **Dependencies**: Phase 2 complete
- **Features**:
  - Create/edit teams
  - Assign coaches
  - View team rosters
  - Upload team logos

### 3.4 Season Management
- **Status**: PENDING
- **Priority**: P2
- **Dependencies**: Phase 2 complete
- **Features**:
  - Create new seasons
  - Configure age groups
  - Set divisions
  - Manage schedules

---

## Phase 4: Integrations (🔴 NOT STARTED)

### 4.1 Reports & Analytics
- **Status**: PENDING
- **Priority**: P3
- **Features**:
  - Team performance reports
  - Player statistics
  - League analytics
  - Trend analysis

### 4.2 PDF Export
- **Status**: PENDING
- **Priority**: P3
- **Features**:
  - Export standings to PDF
  - Export scorers to PDF
  - Export match report

### 4.3 Discord Integration
- **Status**: PENDING
- **Priority**: P3
- **Features**:
  - Post match results to Discord
  - Standings updates
  - Top scorer notifications

### 4.4 Advanced Statistics
- **Status**: PENDING
- **Priority**: P3
- **Features**:
  - Head-to-head records
  - Winning streaks
  - Home/away performance
  - Player consistency metrics

---

## 📊 Priority Levels

| Priority | Meaning | Timeline |
|----------|---------|----------|
| P0 | Blocker - MVP depends on it | Current sprint |
| P1 | High - Core feature | Next 1-2 weeks |
| P2 | Medium - Nice to have | Next month |
| P3 | Low - Future consideration | Next quarter |

---

## 📅 Estimated Timeline

| Phase | Duration | Status |
|-------|----------|--------|
| Phase 1 | 2 weeks | ✅ COMPLETE |
| Phase 2a | 1 week | ✅ COMPLETE |
| Phase 2b | 3-4 days | 🔴 NEXT |
| Phase 2c | 3-4 days | 🔴 PENDING |
| Phase 2d | 3-4 days | 🔴 PENDING |
| Phase 2e | 2-3 days | 🔴 PENDING |
| Phase 3 | 4 weeks | 🔴 FUTURE |
| Phase 4 | 6+ weeks | 🔴 FUTURE |

---

## 🎯 Next Immediate Actions

1. **TODAY**: Review Phase 2b requirements
2. **DAY 1-2**: Implement match list & edit pages
3. **DAY 2-3**: Implement match update API
4. **DAY 3**: Test & deploy Phase 2b
5. **DAY 4-5**: Implement Phase 2c (goals)
6. **DAY 5-6**: Implement Phase 2d (cards)
7. **DAY 6-7**: Polish & full testing (Phase 2e)
8. **DAY 7**: Final Vercel deployment


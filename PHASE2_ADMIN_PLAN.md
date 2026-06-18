# Phase 2: Admin Backend - Proposal & Architecture

## 📋 Overview

Admin dashboard untuk update match results, goals, dan cards tanpa merusak public website atau import data.

---

## 🏗️ Architecture

### A. Authentication (Supabase Auth)

**Flow:**
```
1. Admin login di /admin/login dengan email + password
2. Supabase Auth verifies credentials
3. JWT token stored di client (browser)
4. Token sent di API requests (Authorization header)
5. Backend validates token + checks RLS policies
```

**User Management:**
- Admin users stored di `auth.users` (Supabase managed)
- Tambahan: buat `admin_profiles` table untuk metadata

**Setup:**
```sql
-- admin_profiles table (baru)
CREATE TABLE admin_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'superadmin')),
  can_edit_matches BOOLEAN DEFAULT true,
  can_edit_goals BOOLEAN DEFAULT true,
  can_edit_cards BOOLEAN DEFAULT true,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- RLS Policy: Admin dapat melihat admin_profiles sendiri
ALTER TABLE admin_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read own profile"
  ON admin_profiles
  FOR SELECT
  USING (auth.uid() = id);
```

---

### B. API Endpoints (New)

#### Match Results Update
```
PUT /api/admin/matches/:matchId
Body: {
  home_score: number,
  away_score: number,
  status: 'finished' | 'postponed' | 'cancelled'
}

RLS: Only admin users via auth.uid() matching admin_profiles
```

#### Goals Management
```
POST /api/admin/goals
Body: {
  match_id: UUID,
  player_id: UUID,
  goals: number (default 1)
}

PUT /api/admin/goals/:goalId
Body: { goals: number }

DELETE /api/admin/goals/:goalId

RLS: Validate match_id exists + admin is authenticated
```

#### Cards Management
```
POST /api/admin/cards
Body: {
  match_id: UUID,
  player_id: UUID,
  card_type: 'Yellow' | 'Red'
}

PUT /api/admin/cards/:cardId
Body: { card_type: 'Yellow' | 'Red' }

DELETE /api/admin/cards/:cardId

RLS: Same as goals
```

#### Get Match for Editing
```
GET /api/admin/matches/:matchId
Returns: {
  ...match,
  goals: [...],
  cards: [...]
}
```

---

### C. Database Changes (RLS Policies)

#### Current Public Tables
```
- seasons: SELECT only (via public API)
- players: SELECT only (via public API)
- matches: SELECT only (public), UPDATE only (admin)
- goals: SELECT only (public), INSERT/UPDATE/DELETE (admin)
- cards: SELECT only (public), INSERT/UPDATE/DELETE (admin)
```

#### New RLS Policies

**matches table:**
```sql
-- Public: read-only
CREATE POLICY "Public can read matches"
  ON matches FOR SELECT
  USING (true);

-- Admin: can update scores
CREATE POLICY "Admin can update match scores"
  ON matches FOR UPDATE
  USING (auth.uid() IN (SELECT id FROM admin_profiles WHERE active = true))
  WITH CHECK (auth.uid() IN (SELECT id FROM admin_profiles WHERE active = true));
```

**goals table:**
```sql
-- Public: read-only
CREATE POLICY "Public can read goals"
  ON goals FOR SELECT
  USING (true);

-- Admin: can manage goals
CREATE POLICY "Admin can insert goals"
  ON goals FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT id FROM admin_profiles WHERE can_edit_goals = true));

CREATE POLICY "Admin can update goals"
  ON goals FOR UPDATE
  USING (auth.uid() IN (SELECT id FROM admin_profiles WHERE can_edit_goals = true));

CREATE POLICY "Admin can delete goals"
  ON goals FOR DELETE
  USING (auth.uid() IN (SELECT id FROM admin_profiles WHERE can_edit_goals = true));
```

**cards table:**
```sql
-- Same as goals but with can_edit_cards permission
```

---

### D. UI/UX Flow

#### 1. Admin Login Page (`/admin/login`)
```
Layout: Center form
Fields:
  - Email
  - Password
  - "Remember me" (optional)
  - Login button
  - Error messages

After login → redirect to /admin/dashboard
```

#### 2. Admin Dashboard (`/admin/dashboard`)
```
Sidebar:
  - Dashboard (stats)
  - Matches (list)
  - Teams (view only)
  - Settings
  - Logout

Stats:
  - Total matches
  - Finished matches
  - Total goals
  - Total cards
```

#### 3. Matches Management (`/admin/matches`)
```
Table:
  - Match (Team A vs Team B)
  - MatchDay
  - Date/Time
  - Current Score
  - Status
  - Actions: [Edit] [View Goals] [View Cards]

Edit Match Modal:
  - Home Score (input)
  - Away Score (input)
  - Status (select: scheduled/finished/postponed/cancelled)
  - [Save] [Cancel]
  - Auto-validate: both teams exist, scores >= 0
```

#### 4. Goals Management (`/admin/matches/:matchId/goals`)
```
Current Goals:
  - List: Player Name | Team | Goals
  - [Edit] [Delete] buttons

Add Goal Section:
  - Select Player (dropdown, filter by division)
  - Goals (input, default 1)
  - [Add] button
  - Validation: player must be from one of teams in match
```

#### 5. Cards Management (`/admin/matches/:matchId/cards`)
```
Current Cards:
  - List: Player | Team | Card Type (badge)
  - [Edit] [Delete] buttons

Add Card Section:
  - Select Player (dropdown)
  - Card Type (select: Yellow/Red)
  - [Add] button
  - Auto-calculate suspensions (future phase)
```

---

### E. Security Checklist

- [ ] **Auth**: Only authenticated users can access /admin/*
  - Implement middleware to check JWT token
  - Validate token on every admin API request

- [ ] **RLS**: Database-level security
  - All admin operations validated by RLS policies
  - Even if API is bypassed, DB rejects unauthorized changes

- [ ] **Input Validation**
  - Server-side validation for all inputs
  - Scores: must be >= 0 and <= 99
  - Players: must exist in correct division
  - Cards: must be Yellow or Red

- [ ] **Audit Trail**
  - Log who changed what and when (future: add `updated_by` columns)
  - For now: Supabase automatic `updated_at`

- [ ] **Public API Protection**
  - /api/public/* endpoints remain unchanged
  - /api/admin/* endpoints require auth
  - No shared logic that could expose data

- [ ] **CORS & Headers**
  - API is server-side rendered (Next.js)
  - No CORS issues with Supabase
  - All requests go through Next.js backend

---

### F. Implementation Phases

#### Phase 2a: Auth + Dashboard (Week 1)
- [ ] Supabase Auth configuration
- [ ] Admin login page
- [ ] Admin dashboard layout
- [ ] Basic RLS policies

#### Phase 2b: Match Editing (Week 2)
- [ ] API endpoint: PUT /api/admin/matches/:matchId
- [ ] Admin matches list
- [ ] Edit match modal
- [ ] Score validation

#### Phase 2c: Goals Management (Week 2)
- [ ] API endpoints: POST/PUT/DELETE /api/admin/goals
- [ ] Goals table in UI
- [ ] Player selector dropdown
- [ ] Add/Edit/Delete goals

#### Phase 2d: Cards Management (Week 3)
- [ ] API endpoints: POST/PUT/DELETE /api/admin/cards
- [ ] Cards table in UI
- [ ] Add/Edit/Delete cards

#### Phase 2e: Polish & Testing (Week 3)
- [ ] Error handling
- [ ] Loading states
- [ ] Validation messages
- [ ] Responsive design
- [ ] Integration tests

---

### G. File Structure

```
cfyl-web/
├── app/
│   ├── admin/
│   │   ├── layout.tsx          (Admin auth wrapper)
│   │   ├── login/
│   │   │   └── page.tsx        (Login form)
│   │   ├── dashboard/
│   │   │   └── page.tsx        (Stats dashboard)
│   │   ├── matches/
│   │   │   ├── page.tsx        (Matches list)
│   │   │   ├── [matchId]/
│   │   │   │   ├── page.tsx    (Edit match + goals + cards)
│   │   │   │   ├── goals/
│   │   │   │   │   └── page.tsx
│   │   │   │   └── cards/
│   │   │   │       └── page.tsx
│   │
│   ├── api/
│   │   ├── admin/
│   │   │   ├── auth/
│   │   │   │   ├── login.ts
│   │   │   │   └── logout.ts
│   │   │   ├── matches/
│   │   │   │   └── [matchId]/
│   │   │   │       └── route.ts
│   │   │   ├── goals/
│   │   │   │   └── route.ts
│   │   │   └── cards/
│   │   │       └── route.ts
│
├── lib/
│   ├── admin-auth.ts           (Auth helpers)
│   ├── admin-validation.ts     (Input validation)
│
├── components/
│   ├── AdminNav.tsx            (Admin sidebar)
│   ├── AdminGuard.tsx          (Auth middleware)
│   ├── MatchEditForm.tsx
│   ├── GoalsTable.tsx
│   ├── CardsTable.tsx
│   └── PlayerSelector.tsx
```

---

### H. Risk Mitigation

**Risk: Breaking public website**
- ✓ All public tables remain unchanged
- ✓ Admin endpoints separate from public API
- ✓ RLS ensures public users can't access admin features

**Risk: Corrupting import data**
- ✓ Import script uses service role (admin)
- ✓ Import is idempotent (upsert)
- ✓ Admin edits go to separate columns (not imported fields)

**Risk: Unauthorized access to admin panel**
- ✓ Supabase Auth enforces authentication
- ✓ RLS validates every database operation
- ✓ JWT token required for all admin APIs

---

### I. Approval Checklist

Sebelum mulai development:

- [ ] Approve authentication flow
- [ ] Approve API endpoint design
- [ ] Approve RLS policy strategy
- [ ] Approve UI/UX mockups
- [ ] Approve file structure
- [ ] Approve phased rollout plan

---

## 📌 Decision Points

1. **Admin User Management**
   - Option A: Supabase Auth UI (managed) ✓ Recommended
   - Option B: Custom admin panel (need more work)

2. **RLS vs API Validation**
   - Option A: RLS only (secure but hard to debug)
   - Option B: API validation + RLS (defense in depth) ✓ Recommended

3. **Audit Trail**
   - Option A: Full audit table (future phase)
   - Option B: Simple updated_at column (Phase 2)

---

## ✅ Next Steps

1. Review proposal
2. Approve changes
3. Start Phase 2a: Auth + Dashboard
4. Weekly sprints for remaining phases


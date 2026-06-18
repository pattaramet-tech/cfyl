# Phase 2a: Implementation Files Checklist

## 📝 Files to Create/Modify

### A. Database Schema (SQL)
**File**: `scripts/admin-schema.sql` ⭐ NEW
```sql
-- 1. admin_profiles table
-- 2. RLS Policies for admin operations
-- 3. Update RLS on existing tables (matches, goals, cards)
```

**What it adds**:
- `admin_profiles` table (auth.users reference)
- RLS SELECT policies on public tables
- RLS UPDATE on matches (admin only)
- RLS INSERT/UPDATE/DELETE on goals/cards (admin only)

---

### B. Authentication & Session
**File**: `lib/admin-auth.ts` ⭐ NEW
```typescript
// Functions:
// - createAdminClient() → Supabase client with auth
// - getCurrentUser() → Get authenticated user
// - signInAdmin(email, password) → Login
// - signOutAdmin() → Logout
// - getAdminProfile(userId) → Get admin permissions
// - isAdminAuthenticated() → Check auth status
```

**File**: `lib/admin-middleware.ts` ⭐ NEW
```typescript
// Functions:
// - verifyAdminAuth(request) → Verify JWT in API requests
// - requireAdminAuth(handler) → Middleware for API routes
// - withAdminAuth(Component) → HOC for pages
```

---

### C. Environment Variables
**File**: `.env.local` 🔧 MODIFY
Add (if not already present):
```
# Already have these:
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# New (optional, for admin):
NEXT_PUBLIC_ADMIN_ENABLED=true
```

---

### D. Admin Login Page
**File**: `app/admin/login/page.tsx` ⭐ NEW
```typescript
// Components:
// - Email input
// - Password input
// - Login button
// - Error message display
// - Loading state
// - Redirect to /admin/dashboard on success
// - Redirect to / if already logged in
```

**Styling**: Use existing Tailwind classes (match public site style)

---

### E. Admin Layout
**File**: `app/admin/layout.tsx` ⭐ NEW
```typescript
// Layout wrapper for all /admin/* pages
// - Check authentication
// - Redirect to /admin/login if not authenticated
// - Add sidebar navigation
// - Add logout button
// - Prevent public access
```

**Features**:
- Middleware to verify auth
- Sidebar with nav links (Dashboard, Matches, Settings)
- User info display
- Logout button

---

### F. Admin Dashboard Page
**File**: `app/admin/dashboard/page.tsx` ⭐ NEW
```typescript
// Display:
// - Welcome message (with admin name)
// - Stats cards:
//   - Total Matches
//   - Finished Matches
//   - Total Goals Recorded
//   - Total Cards Issued
// - Quick links to edit matches
// - Last updated matches list
```

**Data fetching**:
- `GET /api/admin/stats` → Return counts

---

### G. Admin Dashboard API
**File**: `app/api/admin/stats/route.ts` ⭐ NEW
```typescript
// GET handler:
// - Verify admin auth
// - Count total matches
// - Count finished matches
// - Count goals
// - Count cards
// - Return JSON: { totalMatches, finishedMatches, totalGoals, totalCards }
```

---

### H. Admin Auth API (Login/Logout)
**File**: `app/api/admin/auth/login/route.ts` ⭐ NEW
```typescript
// POST handler:
// - Get email, password from request body
// - Call supabase.auth.signInWithPassword()
// - Return { success, user, token } or { error }
// - Client stores token in localStorage
```

**File**: `app/api/admin/auth/logout/route.ts` ⭐ NEW
```typescript
// POST handler:
// - Clear auth session
// - Return { success: true }
```

**File**: `app/api/admin/auth/me/route.ts` ⭐ NEW
```typescript
// GET handler:
// - Verify JWT token from Authorization header
// - Return current admin user info
// - Used by frontend to check auth status
```

---

### I. Admin Navigation Component
**File**: `components/AdminNav.tsx` ⭐ NEW
```typescript
// Sidebar component for admin pages
// - Logo/branding
// - Nav links:
//   - Dashboard
//   - Matches
//   - Settings
// - User profile section
// - Logout button
// - Responsive (collapse on mobile)
```

---

### J. Admin Guard Component
**File**: `components/AdminGuard.tsx` ⭐ NEW
```typescript
// Higher-order component to protect admin pages
// - Check if user is authenticated
// - Show loading state while checking
// - Redirect to /admin/login if not authenticated
// - Wrap page content if authenticated
```

---

### K. Admin Styles (if needed)
**File**: `app/admin/admin.css` ⭐ NEW (optional)
```css
/* Admin-specific styles */
/* Sidebar, forms, etc. */
```

Or use Tailwind classes directly (preferred).

---

## 📊 File Summary

### Files to CREATE (10):
1. `scripts/admin-schema.sql`
2. `lib/admin-auth.ts`
3. `lib/admin-middleware.ts`
4. `app/admin/login/page.tsx`
5. `app/admin/layout.tsx`
6. `app/admin/dashboard/page.tsx`
7. `app/api/admin/stats/route.ts`
8. `app/api/admin/auth/login/route.ts`
9. `app/api/admin/auth/logout/route.ts`
10. `app/api/admin/auth/me/route.ts`
11. `components/AdminNav.tsx`
12. `components/AdminGuard.tsx`

### Files to MODIFY (1):
1. `.env.local` (add admin config if needed)

### Files to DELETE (0):
- None

### Files NOT touched:
- All `/app/page.tsx`, `/app/fixtures`, etc. (public pages)
- All `/app/api/public/*` (public API)
- All components used by public pages

---

## 🔄 Implementation Order

### Step 1: Database Schema
```bash
Run: scripts/admin-schema.sql in Supabase SQL Editor
```

### Step 2: Auth Libraries
```typescript
Create: lib/admin-auth.ts
Create: lib/admin-middleware.ts
```

### Step 3: Admin Auth API
```typescript
Create: app/api/admin/auth/login/route.ts
Create: app/api/admin/auth/logout/route.ts
Create: app/api/admin/auth/me/route.ts
```

### Step 4: Admin Components
```typescript
Create: components/AdminNav.tsx
Create: components/AdminGuard.tsx
```

### Step 5: Admin Pages
```typescript
Create: app/admin/layout.tsx
Create: app/admin/login/page.tsx
Create: app/admin/dashboard/page.tsx
Create: app/api/admin/stats/route.ts
```

### Step 6: Build & Test
```bash
npm run build
npm run dev
```

---

## ✅ Verification Checklist

After Phase 2a completion:

- [ ] SQL schema executed in Supabase (no errors)
- [ ] Admin user created in Supabase Auth
- [ ] `npm run build` passes ✓
- [ ] `/admin/login` page loads
- [ ] Can login with admin email/password
- [ ] Redirects to `/admin/dashboard` after login
- [ ] Dashboard shows stats
- [ ] Logout button works
- [ ] Redirect to login if no auth
- [ ] `/` (public home) still works
- [ ] `/fixtures`, `/standings`, etc. still work
- [ ] No TypeScript errors
- [ ] No console errors in browser

---

## 🔒 Security Checkpoints

- [ ] Password sent over HTTPS only (Supabase handles)
- [ ] JWT token in Authorization header (not URL)
- [ ] RLS policies prevent unauthorized access
- [ ] Admin pages require authentication
- [ ] Public pages don't require authentication
- [ ] Service role key not exposed to client

---

## 📌 Notes

1. **Don't modify public API routes** ✓
2. **Use existing Tailwind classes** ✓
3. **Keep public pages completely separate** ✓
4. **Build must pass after each change** ✓
5. **Test admin login locally before deploy** ✓


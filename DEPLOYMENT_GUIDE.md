# 🚀 DEPLOYMENT_GUIDE.md

Complete Guide to Deploy CFYL from Scratch

---

## 📋 Prerequisites

Before starting, ensure you have:
- Git account (GitHub)
- Node.js 18+ installed
- Supabase account (free tier OK)
- Vercel account (free tier OK)
- Excel file: CFYL2026.xlsx
- 30 minutes

---

## Phase 1: Local Setup

### 1.1 Clone Repository

```bash
git clone https://github.com/pattaramet-tech/cfyl.git
cd cfyl/cfyl-web
```

### 1.2 Install Dependencies

```bash
npm install
```

Expected: ~500MB, takes 2-3 minutes

### 1.3 Create Environment File

Create `.env.local` in the `cfyl-web/` directory:

```bash
cp .env.example .env.local
```

This file will store sensitive keys (gitignored).

### 1.4 Start Dev Server

```bash
npm run dev
```

Expected output:
```
▲ Next.js 16.2.9
- Local: http://localhost:3000
- Environments: .env.local
```

Open http://localhost:3000 in browser.

**Verify**: Home page loads with season selector ✓

---

## Phase 2: Supabase Setup

### 2.1 Create Supabase Project

1. Go to https://app.supabase.com
2. Click "New Project"
3. Enter:
   - **Organization**: Create new
   - **Project name**: "cfyl-2026"
   - **Region**: Choose closest to you
   - **Database password**: Strong password (save it!)
4. Wait 5-10 minutes for project creation

### 2.2 Get API Keys

1. Go to Project Settings → API
2. Copy these values and save to `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

**Warning**: 
- `NEXT_PUBLIC_*` can be exposed (public keys)
- `SUPABASE_SERVICE_ROLE_KEY` is secret - never commit!

### 2.3 Create Database Tables (Phase 1)

1. In Supabase Dashboard, go to SQL Editor
2. Click "New Query"
3. Copy entire content from `scripts/schema.sql`
4. Click "Run"
5. Verify: No errors ✓

**Expected tables**: 9 (seasons, players, matches, goals, cards, etc.)

### 2.4 Create Admin Schema (Phase 2a)

1. New SQL Query
2. Copy entire content from `scripts/admin-schema.sql`
3. Click "Run"
4. Verify: admin_profiles table created ✓

---

## Phase 3: Data Import

### 3.1 Prepare Excel File

Ensure `CFYL2026.xlsx` is in project root:
```
cfyl/
├── cfyl-web/
├── CFYL2026.xlsx    ← HERE
└── README.md
```

### 3.2 Run Import Script

```bash
cd cfyl-web

# Set environment variables
export NEXT_PUBLIC_SUPABASE_URL="https://xxxxx.supabase.co"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."
export SUPABASE_SERVICE_ROLE_KEY="eyJ..."

# Run import (Windows PowerShell):
$env:NEXT_PUBLIC_SUPABASE_URL="https://xxxxx.supabase.co"
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."
$env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."
npx ts-node --project tsconfig.scripts.json scripts/import-cfyl.ts
```

**Expected output**:
```
🚀 Starting CFYL data import...

✓ Read 224 matches
✓ Read 668 players
✓ Read 89 goal records
✓ Read 38 card records

...

✅ Import completed successfully!
```

### 3.3 Verify Import

In Supabase SQL Editor:
```sql
SELECT COUNT(*) FROM matches;    -- 224
SELECT COUNT(*) FROM players;    -- 668
SELECT COUNT(*) FROM goals;      -- 89
SELECT COUNT(*) FROM cards;      -- 38
```

---

## Phase 4: Admin User Setup

### 4.1 Create Admin User in Supabase Auth

1. Go to Supabase Dashboard → Authentication → Users
2. Click "Add User"
3. Enter:
   - **Email**: admin@cfyl.local
   - **Password**: Strong password (you'll use this to login)
4. Click "Create user"
5. Copy the User ID (long UUID string)

### 4.2 Add Admin Profile to Database

In Supabase SQL Editor:
```sql
INSERT INTO admin_profiles (id, email, full_name, role, active)
VALUES (
  '< PASTE USER ID HERE >',
  'admin@cfyl.local',
  'Admin User',
  'superadmin',
  true
);
```

Click "Run"

### 4.3 Verify Admin Setup

In your `.env.local`, verify you have:
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Restart dev server:
```bash
npm run dev
```

Go to http://localhost:3000/admin/login

Try logging in:
- Email: admin@cfyl.local
- Password: [password from step 4.1]

**Expected**: Dashboard appears with stats ✓

---

## Phase 5: Build & Test

### 5.1 Run TypeScript Check

```bash
npm run build
```

**Expected**:
```
✓ Compiled successfully
✓ Running TypeScript... Passed
✓ Generating static pages... Done
```

### 5.2 Test Locally

```bash
npm run dev
```

Test these routes:
- [ ] http://localhost:3000 (home page)
- [ ] http://localhost:3000/fixtures (matches)
- [ ] http://localhost:3000/standings (standings)
- [ ] http://localhost:3000/top-scorers (scorers)
- [ ] http://localhost:3000/discipline (cards)
- [ ] http://localhost:3000/admin/login (admin login)
- [ ] http://localhost:3000/admin/dashboard (dashboard - after login)

**Verify**: All pages load, no console errors ✓

---

## Phase 6: Vercel Deployment

### 6.1 Push to GitHub

```bash
cd cfyl
git add -A
git commit -m "Initial CFYL deployment with Phase 2a admin backend"
git push origin main
```

### 6.2 Create Vercel Project

1. Go to https://vercel.com/new
2. Select GitHub repository: "cfyl"
3. Choose root directory: `cfyl-web`
4. Click "Deploy"

Vercel will:
- Run `npm install`
- Run `npm run build`
- Deploy to production

**Expected**: First deployment in ~5 minutes

### 6.3 Add Environment Variables to Vercel

1. Go to Vercel Dashboard → Project Settings → Environment Variables
2. Add three variables:

| Name | Value | Scope |
|------|-------|-------|
| NEXT_PUBLIC_SUPABASE_URL | https://xxxxx.supabase.co | Production |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | eyJ... | Production |
| SUPABASE_SERVICE_ROLE_KEY | eyJ... | Production |

3. Click "Save"
4. Click "Redeploy" to rebuild with new vars

**Wait**: 3-5 minutes for redeploy

### 6.4 Verify Production

Go to your Vercel URL (example: https://cfyl-youth-league.vercel.app)

Test:
- [ ] Home page loads
- [ ] Season selector works
- [ ] Fixtures load
- [ ] Admin login works
- [ ] Dashboard shows stats

---

## 🔄 Backup Process

### Automatic Backups

Supabase provides daily backups. No action needed.

### Manual Backup

#### Export Database

1. Supabase Dashboard → SQL Editor
2. Run:
```sql
-- Export all tables (use Supabase UI to download)
SELECT * FROM matches;
SELECT * FROM players;
SELECT * FROM goals;
SELECT * FROM cards;
```

#### Backup Excel File

Keep CFYL2026.xlsx in version control or cloud storage.

---

## 🔧 Restore Process

### If Data Gets Corrupted

#### Option 1: Restore from Supabase Backup
1. Supabase Dashboard → Settings → Backups
2. Click "Restore" on desired date
3. Confirm restore
4. Wait 5-10 minutes

#### Option 2: Re-import Data

```bash
# 1. Clear existing data (if needed)
# In Supabase SQL Editor, run:
TRUNCATE matches CASCADE;
TRUNCATE players CASCADE;
TRUNCATE goals CASCADE;
TRUNCATE cards CASCADE;

# 2. Re-run import
npx ts-node --project tsconfig.scripts.json scripts/import-cfyl.ts
```

#### Option 3: Recreate Database

```bash
# 1. In Supabase, drop all tables (careful!)
# 2. Run schema.sql again
# 3. Run admin-schema.sql again
# 4. Import data
# 5. Recreate admin users
```

---

## 🔐 Security Checklist

Before going to production:

- [ ] `.env.local` is in `.gitignore`
- [ ] Never commit `SUPABASE_SERVICE_ROLE_KEY`
- [ ] Vercel environment variables are set
- [ ] Admin password is strong (18+ chars)
- [ ] RLS policies enabled on all tables
- [ ] Public API is read-only
- [ ] Admin API requires JWT token

---

## 🚨 Troubleshooting

### Build Fails

```bash
# Clear caches and reinstall
rm -rf node_modules .next
npm install
npm run build
```

### Environment Variables Not Loaded

```bash
# Verify .env.local exists
cat .env.local

# Verify values are correct (no extra spaces)
# Restart dev server
npm run dev
```

### Import Script Fails

```bash
# Check Excel file path
ls ../CFYL2026.xlsx

# Verify environment variables
echo $NEXT_PUBLIC_SUPABASE_URL

# Check Supabase tables exist
# In SQL Editor: SELECT * FROM matches LIMIT 1;
```

### Admin Login Doesn't Work

```bash
# 1. Verify admin user exists in Supabase Auth
# 2. Verify admin_profiles has correct user_id
# 3. Verify token in localStorage
# Browser DevTools → Application → Local Storage → admin_token

# 4. Check browser console for errors (F12)
```

### Public Pages Show No Data

```bash
# 1. Check Supabase RLS policies
# SELECT * FROM matches;
# If error: "new row violates row-level security policy"
# → RLS policies not set correctly

# 2. Re-run admin-schema.sql for RLS
# 3. Restart app
```

---

## 📞 Support Resources

- **Supabase Issues**: https://github.com/supabase/supabase/issues
- **Next.js Issues**: https://github.com/vercel/next.js/issues
- **Documentation**: https://supabase.com/docs, https://nextjs.org/docs

---

## ✅ Deployment Checklist

```
Pre-Deployment:
[ ] Node.js 18+ installed
[ ] Git repository cloned
[ ] npm install completed
[ ] CFYL2026.xlsx in project root

Supabase:
[ ] Project created
[ ] API keys obtained
[ ] schema.sql executed
[ ] admin-schema.sql executed
[ ] Data imported (224 matches, 668 players)
[ ] Admin user created
[ ] RLS policies verified

Local Testing:
[ ] npm run build passes
[ ] npm run dev works
[ ] Home page loads
[ ] Admin login works
[ ] Dashboard shows stats

GitHub:
[ ] Code pushed to main branch
[ ] .env.local in .gitignore
[ ] No secrets in commits

Vercel:
[ ] Project connected
[ ] Build completes
[ ] Environment variables set
[ ] Production URL accessible
[ ] All pages load

Production:
[ ] Admin can login
[ ] Public pages work
[ ] Data displays correctly
[ ] No console errors
[ ] Performance acceptable
```

---

## 🎯 Next Steps After Deployment

1. **Monitor**: Watch Vercel dashboard for errors
2. **Test**: Have admin user test login
3. **Document**: Update admin password in secure place
4. **Backup**: Set up daily backup reminders
5. **Phase 2b**: Start implementing match editing

---

## 📖 Files Reference

| File | Purpose |
|------|---------|
| `.env.local` | Environment variables (local) |
| `scripts/schema.sql` | Create public tables |
| `scripts/admin-schema.sql` | Create admin tables & RLS |
| `scripts/import-cfyl.ts` | Import Excel data |
| `tsconfig.scripts.json` | TypeScript config for import |
| `PROJECT_STATUS.md` | Current project status |
| `ADMIN_ROADMAP.md` | Development roadmap |
| `DATABASE_REFERENCE.md` | Database documentation |


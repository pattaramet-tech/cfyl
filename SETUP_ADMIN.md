# 🔑 Admin Setup Guide

Complete step-by-step guide to set up admin users for production.

---

## 📋 Prerequisites

- ✅ Vercel deployment: active
- ✅ Supabase project: active
- ✅ Database migration: run migration script

---

## Step 1: Run Database Migration

**In Supabase SQL Editor** (https://app.supabase.com → SQL Editor):

```sql
-- Add active column to admin_profiles if it doesn't exist
-- This script is rerun-safe (idempotent)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='admin_profiles' AND column_name='active'
  ) THEN
    ALTER TABLE admin_profiles
    ADD COLUMN active BOOLEAN DEFAULT true;

    RAISE NOTICE 'Added active column to admin_profiles';
  ELSE
    RAISE NOTICE 'Column active already exists in admin_profiles';
  END IF;
END $$;

-- Create index if not exists
CREATE INDEX IF NOT EXISTS idx_admin_profiles_active
ON admin_profiles(active);

-- Mark all existing profiles as active
UPDATE admin_profiles
SET active = true
WHERE active IS NULL;
```

**Status**: ✅ Migration complete when you see the NOTICE messages.

---

## Step 2: Verify Database Schema

**In Supabase SQL Editor**, run this to verify:

```sql
-- Check admin_profiles columns
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'admin_profiles'
ORDER BY ordinal_position;
```

**Expected columns**:
- `id` (UUID, PRIMARY KEY)
- `email` (TEXT, UNIQUE)
- `full_name` (TEXT)
- `role` (TEXT, DEFAULT 'admin')
- `can_edit_matches` (BOOLEAN, DEFAULT true)
- `can_edit_goals` (BOOLEAN, DEFAULT true)
- `can_edit_cards` (BOOLEAN, DEFAULT true)
- `active` (BOOLEAN, DEFAULT true) ← NEW
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

---

## Step 3: Create Admin User in Supabase Auth

**In Supabase Dashboard** (https://app.supabase.com):

1. Go to **Authentication** → **Users**
2. Click **"Add user"** → **"Invite with email"**
3. Enter:
   - Email: `admin@example.com` (use your real email)
   - Password: (auto-generated or set your own)
4. Click **"Send invite"**

**Important**: Copy the **User UUID** from the list (looks like: `550e8400-e29b-41d4-a716-446655440000`)

---

## Step 4: Create Admin Profile

**Back in Supabase SQL Editor**, insert the admin profile:

```sql
-- Replace <USER-UUID> with the UUID from Step 3
INSERT INTO admin_profiles (
  id,
  email,
  full_name,
  role,
  can_edit_matches,
  can_edit_goals,
  can_edit_cards,
  active
) VALUES (
  '<USER-UUID>',
  'admin@example.com',
  'Admin Name',
  'superadmin',
  true,
  true,
  true,
  true
);
```

**Replace these values**:
- `<USER-UUID>`: Paste the UUID from Step 3
- `admin@example.com`: Email from Step 3
- `Admin Name`: Your name

**Verify it worked**:
```sql
SELECT id, email, role, active FROM admin_profiles WHERE email = 'admin@example.com';
```

---

## Step 5: Test Login

**Go to production**: https://cfyl-youth-league.vercel.app/admin/login

1. Enter email and password from Step 3
2. Should see one of these:
   - ✅ Redirects to `/admin/dashboard` (SUCCESS)
   - ❌ "Authentication error" → Check logs (see below)

---

## 🔍 Troubleshooting

### "Admin profile not found"

**Cause**: UUID mismatch or profile wasn't inserted

**Fix**:
1. Verify profile exists:
   ```sql
   SELECT id, email FROM admin_profiles WHERE email = 'admin@example.com';
   ```

2. Get exact UUID from auth.users:
   ```sql
   SELECT id, email FROM auth.users WHERE email = 'admin@example.com';
   ```

3. If UUIDs don't match, delete and re-insert:
   ```sql
   DELETE FROM admin_profiles WHERE id = '<OLD-UUID>';
   
   INSERT INTO admin_profiles (id, email, full_name, role, active)
   VALUES ('<CORRECT-UUID>', 'admin@example.com', 'Admin Name', 'superadmin', true);
   ```

### "Admin account is inactive"

**Cause**: `active` column is false

**Fix**:
```sql
UPDATE admin_profiles
SET active = true
WHERE email = 'admin@example.com';
```

### "Invalid token" or "Internal server error"

**Check Vercel Logs**:
1. Go to Vercel Dashboard → cfyl project
2. Click latest deployment
3. Go to **Logs** tab
4. Search for `[LOGIN]` or `[MIDDLEWARE]`
5. Look for error messages

### /admin returns 404 in production

**Fix**: Wait for Vercel to redeploy after code push

---

## 📝 Columns Reference

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `id` | UUID | - | Supabase Auth user ID |
| `email` | TEXT | - | User email (must match auth.users.email) |
| `full_name` | TEXT | NULL | Display name |
| `role` | TEXT | 'admin' | 'admin' or 'superadmin' |
| `can_edit_matches` | BOOLEAN | true | Permission to edit match scores |
| `can_edit_goals` | BOOLEAN | true | Permission to add/edit goals |
| `can_edit_cards` | BOOLEAN | true | Permission to add/edit cards |
| `active` | BOOLEAN | true | Account enabled/disabled |
| `created_at` | TIMESTAMP | now() | Profile creation time |
| `updated_at` | TIMESTAMP | now() | Last update time |

---

## ✅ Verification Checklist

After setup:

- [ ] Migration script ran in Supabase
- [ ] Admin user created in Supabase Auth
- [ ] admin_profiles record exists with matching UUID
- [ ] `active` column exists and is true
- [ ] Login page shows no errors
- [ ] Dashboard loads after login
- [ ] Match editing works
- [ ] Browser console has no errors

---

## 🚀 Next Steps

After admin login works:

1. Test match editing (Phase 2b verification)
2. Start Phase 2c (Goal Management)
3. Continue to Phase 2d (Card Management)

---

## 📞 Support

- **Supabase Dashboard**: https://app.supabase.com
- **Vercel Logs**: https://vercel.com/dashboard/projects
- **Database Reference**: See DATABASE_REFERENCE.md

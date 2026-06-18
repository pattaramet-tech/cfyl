# ⚽ Phase 2c Goal Management - Setup Guide

## ⚠️ IMPORTANT: Run Migration First

Before deploying Phase 2c code, **must remove unique constraint** from goals table.

### Step 1: Run Migration in Supabase

**In Supabase SQL Editor** (https://app.supabase.com → SQL Editor):

Run the script from: `scripts/migration-remove-goals-unique.sql`

```sql
-- Migration: Remove unique constraint from goals table (rerun-safe)
-- Allows multiple goal entries per player per match

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'goals'
    AND constraint_type = 'UNIQUE'
    AND constraint_name LIKE '%match_id%player_id%'
  ) THEN
    ALTER TABLE goals DROP CONSTRAINT "goals_match_id_player_id_key";
    RAISE NOTICE 'Dropped unique constraint from goals table';
  ELSE
    RAISE NOTICE 'Unique constraint not found (may already be removed)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Error checking constraint (likely already removed): %', SQLERRM;
END $$;
```

**Expected Output**:
```
NOTICE: Dropped unique constraint from goals table
NOTICE: Migration complete - goals table now supports multiple entries per player per match
```

---

## Why This Migration?

**Old Schema** (Phase 2b):
```sql
CREATE TABLE goals (
  ...
  UNIQUE(match_id, player_id)  ← Allows only 1 row per player per match
);
```

**Problem**: Can't record if player scored 2+ goals in same match

**New Schema** (Phase 2c):
```sql
CREATE TABLE goals (
  ...
  -- No unique constraint
);
```

**Solution**: Each goal entry is a separate row
- Player scores 2 goals → 2 rows in goals table
- goals.goals column = count (usually 1)
- Sum calculated in API: SUM(goals) per player

---

## Data Model Examples

### Single Goal
```
| id | match_id | player_id | goals |
|----|----------|-----------|-------|
| 1  | m1       | p1        | 1     |
```
Player p1 scored 1 goal in match m1

### Multiple Goals (Same Match)
```
| id | match_id | player_id | goals |
|----|----------|-----------|-------|
| 1  | m1       | p1        | 1     |
| 2  | m1       | p1        | 1     |
| 3  | m1       | p1        | 1     |
```
Player p1 scored 3 goals in match m1 (3 rows × 1 goal each)

OR

```
| id | match_id | player_id | goals |
|----|----------|-----------|-------|
| 1  | m1       | p1        | 3     |
```
Alternative: Single row with goals=3 (implementation choice)

---

## Phase 2c Features

After migration, can:

✅ Add multiple goals per player per match  
✅ Edit goal entries  
✅ Delete goal entries  
✅ /top-scorers auto-recalculates  
✅ Can_edit_goals permission enforced  

---

## After Migration

Deploy Phase 2c code:
- `/admin/goals` page
- Goal management APIs
- Player selector component
- Goal add/edit/delete forms

---

## Troubleshooting

**Error: "Constraint not found"**
- OK - means constraint already removed or doesn't exist
- Continue with Phase 2c deployment

**Error: "Permission denied"**
- Need Supabase SQL Editor access with admin role
- Try again or contact Supabase support

**Can't connect to Supabase**
- Check: NEXT_PUBLIC_SUPABASE_URL in .env
- Check: Network connectivity to Supabase dashboard

---

## Next Steps

1. ✅ Run this migration
2. ✅ Deploy Phase 2c code (coming next)
3. ✅ Test /admin/goals page
4. ✅ Verify /top-scorers updates
5. ✅ Start Phase 2d (Card Management)

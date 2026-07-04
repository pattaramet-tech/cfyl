# Regression Test: Suspension Serving Matches (P1 Fix)

## Issue Fixed
Suspension calculation now excludes postponed/cancelled matches from suspension-serving candidate list.

## Test Scenario

### Setup
Create test data with following structure:

```
Season: S1, Age Group: U17, Division: Div1
Team: Team A
Player: Player A (will get cards)

Matches:
- MD1: Team A vs Team B (finished) — TRIGGER
- MD2: Team A vs Team C (scheduled) — ELIGIBLE
- MD3: Team A vs Team D (postponed) — SKIP
- MD4: Team A vs Team E (cancelled) — SKIP
- MD5: Team A vs Team F (scheduled) — ELIGIBLE
```

### Test Steps

1. **Create Card in MD1**
   - Add red card to Player A in MD1
   - Trigger suspension calculation
   - Expected: ban_matches = 1 (single red = 6 points, threshold for 1 ban)

2. **Verify Suspended Matches**
   - Go to Admin > Suspensions
   - Find Player A suspension record
   - Check `suspension_details.suspended_matches`
   - **Expected**: Array should contain ONLY:
     - MD2 (scheduled)
     - NO MD3 (postponed should be skipped)
     - NO MD4 (cancelled should be skipped)
     - MD5 (scheduled) if ban_matches >= 2

3. **Check suspended_from_match_id**
   - Should point to MD2 (first scheduled match after trigger)
   - NOT MD3 (postponed)

4. **Verify Data Quality Check**
   - Run Data Quality audit
   - Check 7: "Suspension with ban but no suspended_from_match_id"
   - Player A should NOT appear in this check (should have valid suspended_from_match_id)

5. **Public Display**
   - Go to Public > Match Detail for MD2
   - Player A should show as "suspended" (if suspension is active)
   - Go to Public > Match Detail for MD3 (postponed)
   - Player A should NOT show as "suspended" (postponed doesn't consume ban)
   - Go to Public > Match Detail for MD5
   - Player A may or may not show depending on ban_matches value

### Expected Outcome

✅ Postponed/cancelled matches are skipped in suspension serving calculation
✅ Only scheduled matches consume the ban quota
✅ suspended_from_match_id points to first scheduled match
✅ Data Quality checks pass

### How to Debug

Check logs:
```
[SUSPENSION_CALC] Next scheduled matches found (X):
```

Should show only scheduled matches in the list.

If it shows postponed/cancelled, the fix didn't work.

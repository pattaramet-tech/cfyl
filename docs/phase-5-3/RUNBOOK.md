# Phase 5.3 Operational Runbook — Suspension Event-Based System

## Daily Operations

### Check health after match day
```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' \
  scripts/monitor-suspensions.ts \
  --season-id e93c2eb6-e7a2-4b26-b946-5dbfc98d35c2 \
  --age-group-id 00a4895f-39e7-4ac0-aacb-43765846a9c2
```
Exit 0 = healthy. Exit 1 = issues found (check output).

### Check via admin UI
```
GET /api/admin/suspensions/monitoring?seasonId=...&ageGroupId=...
```
Returns JSON with `summary.healthy` boolean and `issues[]` array.

---

## When a Match is Postponed or Cancelled

### Automatic (recommended)
After calling `PUT /api/admin/matches/:matchId` with `status=postponed` or `status=cancelled`,
the endpoint automatically calls `refreshSuspensionServingMatches` for both teams.
No manual action required.

Check the response for `serving_refresh_warning` — if present, run manual refresh below.

### Manual fallback
```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' \
  scripts/refresh-suspension-serving.ts \
  --season-id e93c2eb6-e7a2-4b26-b946-5dbfc98d35c2 \
  --changed-match-id <postponed-match-id> \
  --apply
```

Always check the backup file created before running `--apply`.

---

## When a Match Date Changes

Same flow as postponed. The match PUT endpoint auto-refreshes when `match_date` or `match_time` changes.

---

## After Season-wide Recalculation

Run the full serving refresh to ensure all events have up-to-date serving match assignments:

```bash
# Dry run first
scripts/refresh-suspension-serving.ts --season-id ... --dry-run

# Apply
scripts/refresh-suspension-serving.ts --season-id ... --apply
```

---

## Data Quality Audit

```
GET /api/admin/data-quality?seasonId=...&ageGroupId=...
```

The `Suspension Event` category contains 17 checks including:
- `EVENT_DUPLICATE_KEY` — deduplication needed
- `SERVING_MATCH_POSTPONED` / `SERVING_MATCH_CANCELLED` — run refresh
- `SOURCE_CARD_NOT_FOUND` — card was deleted, run recalculation
- `SERVED_COMPLETED_AT_INCONSISTENT` — run refresh or recalculation

---

## Safety Rules

1. Never delete legacy records (`suspension_type IS NULL`)
2. Never modify manual records (`suspension_type = 'manual'`)
3. All scripts default to `--dry-run`
4. Always check backup file before writing changes
5. Do not run full-season recalculation without prior backup

# PHASE 5.2A — Production Inspection Results Template

**Database**: CFYL  
**Date Inspected**: [INSERT DATE]  
**Inspected By**: [INSERT NAME]  
**Status**: ⬜ PENDING → ✅ PASS / ⚠️ WARNING / ❌ FAIL

---

## Schema Verification

### Loop 1: Schema Inspection

**Status**: ✅ PASS / ❌ FAIL

**Required Fields Present**:
- [ ] `suspension_type` (text)
- [ ] `trigger_match_id` (uuid)
- [ ] `accumulated_threshold` (integer)
- [ ] `source_card_ids` (uuid[])
- [ ] `serving_match_ids` (uuid[])
- [ ] `served_completed_at` (timestamp)
- [ ] `legacy_migrated` (boolean)

**Constraints Present**:
- [ ] suspensions_suspension_type_check
- [ ] suspensions_accumulated_threshold_check

**Unique Index Present**:
- [ ] uniq_suspension_event_trigger

**Notes**:
```
[Paste any observations about schema state]
```

---

## Record Counts

### Loop 2: Production Record Inventory

**Query 2.1 Results** (Master Count):
```
Total suspensions:           _______
Null type count:             _______
Legacy count:                _______
Event-based count:           _______
Missing trigger_match_id:    _______
Missing serving_match_ids:   _______
With active ban:             _______
No ban:                      _______
```

**Query 2.2 Results** (Breakdown by Type):
```
| suspension_type | count | avg_ban_matches | avg_total_points | missing_trigger | missing_serving |
|-----------------|-------|-----------------|------------------|-----------------|-----------------|
| [TYPE]          | _____ | ___             | ___              | ___             | ___             |
|                 |       |                 |                  |                 |                 |
```

**Query 2.3 Results** (By Season):
```
| season_name | record_count | legacy_or_old | event_based | unique_players | unique_teams |
|-------------|--------------|---------------|-------------|----------------|--------------|
| [SEASON]    | ______       | ______        | ______      | ______         | ______       |
|             |              |               |             |                |              |
```

**Query 2.5 Results** (Data Completeness):
```
| field_name                    | count | percentage |
|-------------------------------|-------|------------|
| ban_matches populated         | _____ | _____%     |
| total_points populated        | _____ | _____%     |
| suspension_reason populated   | _____ | _____%     |
| suspension_details populated  | _____ | _____%     |
| trigger_match_id populated    | _____ | _____%     |
| serving_match_ids populated   | _____ | _____%     |
```

---

## Legacy Records Inspection

### Loop 3: Legacy Record Details

**Query 3.1 Export Status**: 
- [ ] CSV exported: `legacy_records_full.csv` (shared)
- Total legacy records exported: _______

**Query 3.3 Results** (Missing suspension_reason):
```
Count: _______ records
Impact: CANNOT auto-migrate (ambiguous type)
Action: Flag for MANUAL_REVIEW
```

**Query 3.4 Results** (Missing suspended_from_match_id):
```
Count: _______ records
Impact: Cannot determine serving matches
Action: Flag for MANUAL_REVIEW
```

**Query 3.5 Results** (Point/Ban Mismatch):
```
Count: _______ records
Impact: Data quality issue
Action: Flag for manual investigation
```

---

## Trigger Card Analysis

### Loop 4: Trigger Card Analysis

**Query 4.4 Results** (Missing Trigger Matches):
```
Count: _______ records
Impact: Cannot auto-migrate without manual trigger identification
Action: Add to MANUAL_REVIEW
```

---

## Classification Results

### Loop 5: Classification Support

**Query 5.2 Results** (AUTO_MIGRATE Ready):
```
Count: _______ records
Percentage: _____%
Status: Ready to be automatically migrated to event-based
```

**Query 5.3 Results** (MANUAL_REVIEW Needed):
```
Count: _______ records
Percentage: _____%
Common reasons:
  - Missing suspension_reason: _____
  - Missing trigger_match_id: _____
  - Missing suspended_from_match_id: _____
  - Ambiguous classification: _____
Status: Require human review to classify before migration
```

**Query 5.4 Results** (INVALID_DATA):
```
Count: _______ records
Percentage: _____%
Issues found:
  - Missing player: _____
  - Missing team: _____
  - Negative values: _____
  - Other: _____
Status: Data corruption - must be cleaned before migration
```

**Query 5.5 Results** (Summary):
```
| classification  | count | percentage |
|-----------------|-------|------------|
| AUTO_MIGRATE    | _____ | _____%     |
| MANUAL_REVIEW   | _____ | _____%     |
| KEEP_LEGACY     | _____ | _____%     |
| INVALID_DATA    | _____ | _____%     |
| TOTAL           | _____ | 100%       |
```

---

## Conflict & Duplicate Audit

### Loop 6: Duplicate Conflict Audit

**Query 6.1 Results** (Duplicate Event-Based Records):
```
Count: _______ rows
Status: ✅ PASS (should be 0) / ⚠️ WARNING (found duplicates)
Action if duplicates: Must clean before proceeding
```

**Query 6.2 Results** (Duplicate Legacy Records):
```
Count: _______ rows
Status: ✅ PASS (should be 0) / ⚠️ WARNING (legacy already had duplicates)
Action: Merge or flag for manual review
```

**Query 6.3 Results** (Orphaned Trigger Matches):
```
Count: _______ rows
Status: ✅ PASS / ❌ FAIL
Action if found: Data corruption - investigate
```

**Query 6.5 Results** (Points/Ban Mismatch):
```
Count: _______ rows
Status: ✅ PASS / ⚠️ WARNING
Details:
  - Points no ban: _____
  - Ban no points: _____
  - Other mismatch: _____
```

**Query 6.6 Summary**:
```
event_duplicates:        _____
legacy_duplicates:       _____
orphaned_triggers:       _____
mixed_state_players:     _____
```

---

## Serving Match Audit

### Loop 7: Serving Match Audit

**Query 7.1 Results** (Suspended_from_match_id Status):
```
Orphaned matches:        _______ records
Unusable matches:        _______ records (postponed/cancelled)
Missing matches:         _______ records
Status: ⚠️ WARNING if > 0
```

**Query 7.3 Results** (Serving Count vs Ban Count):
```
Insufficient serving matches: _______ records
Status: Acceptable if season ending, otherwise investigate
```

**Query 7.4 Results** (Legacy Missing Serving Match):
```
Count: _______ records
Status: Cannot migrate - flag for MANUAL_REVIEW
```

**Query 7.6 Summary**:
```
orphaned_serving_matches:        _____
unusable_serving_matches:        _____
missing_serving_matches:         _____
insufficient_event_serving:      _____
```

---

## Data Quality Audit

### Loop 8: Data Quality Audit

**Query 8.1 Results** (Missing Required Fields):
```
Missing player_id:       _______ records
Missing team_id:         _______ records
Missing season_id:       _______ records
Missing age_group_id:    _______ records
Negative ban_matches:    _______ records
Negative total_points:   _______ records
Status: ✅ PASS (all 0) / ❌ FAIL (any > 0)
```

**Query 8.2 Results** (Foreign Key Integrity):
```
Non-existent players:    _______ records
Non-existent teams:      _______ records
Non-existent seasons:    _______ records
Non-existent matches:    _______ records
Status: ✅ PASS / ❌ FAIL
```

**Query 8.3 Results** (Points/Ban Consistency):
```
Invalid thresholds:      _______ records
Points no ban:           _______ records
Ban no reason:           _______ records
Mismatched ratios:       _______ records
Status: ✅ PASS / ⚠️ WARNING / ❌ FAIL
```

**Query 8.5 Results** (Complete Quality Report):
```
Total suspensions:       _______
Missing FK:              _______ (should be 0)
Invalid numbers:         _______ (should be 0)
Invalid thresholds:      _______ (should be 0)
Points no ban:           _______ (should be 0)
Ban no reason:           _______ (should be 0)
Missing reason:          _______

Overall Quality:         ✅ PASS / ⚠️ WARNING / ❌ FAIL
```

---

## Migration Preview

### Loop 9: Migration Preview

**Query 9.4 Results** (Statistics):
```
Total legacy records:           _______
Can auto-migrate:               _______
Invalid data:                   _______
Manual review needed:           _______

Migration feasibility:          _______ % can auto-migrate
```

**Query 9.5 Export Status**:
- [ ] CSV exported: `manual_review_list.csv` (shared)
- MANUAL_REVIEW records requiring human classification: _______

---

## Query Errors & Issues

**Any query errors or timeouts?**
```
[List any SQL errors encountered during inspection]
```

**Slow queries:**
```
[Note which queries took longer than expected]
```

**Data anomalies discovered:**
```
[Describe any unexpected findings]
```

---

## Summary Assessment

### Overall Readiness for Phase 5.2B Migration

**Schema Ready**: ✅ YES / ❌ NO

**Data Quality**: 
- ✅ PASS (ready to migrate)
- ⚠️ WARNING (proceed with caution, some manual work needed)
- ❌ FAIL (cannot migrate without data cleanup)

**Duplicate/Conflict Status**: ✅ CLEAN / ⚠️ SOME ISSUES / ❌ CRITICAL

**Records Ready for Auto-Migration**: _______ (________%)

**Records Requiring Manual Review**: _______ (________%)

**Records with Data Issues**: _______ (________%)

### Recommendations

```
[Your assessment of readiness and recommendations]

1. 
2. 
3.
```

### Next Steps

- [ ] Share this template and CSV exports with migration analyst
- [ ] Analyst will finalize MANUAL_REVIEW classifications
- [ ] Analyst will generate Phase 5.2B migration SQL
- [ ] Schedule Phase 5.2B execution window

---

## Sign-Off

**Inspection Completed**: [DATE]  
**Completed By**: [NAME]  
**Reviewed By**: [NAME] (optional)

**Status**: ✅ READY FOR PHASE 5.2B / ⚠️ PROCEED WITH CAUTION / ❌ REQUIRES DATA CLEANUP FIRST

---

**Files Attached/Exported**:
- [ ] `legacy_records_full.csv` - All legacy suspension records
- [ ] `manual_review_list.csv` - Records needing manual classification
- [ ] Screenshots of key query results (optional)


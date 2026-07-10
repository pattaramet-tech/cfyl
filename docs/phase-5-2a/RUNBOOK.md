# PHASE 5.2A — Production Inspection Runbook

**Status**: ✅ READ-ONLY - No database writes
**Duration**: ~30-45 minutes for all queries
**Date**: 2026-07-11

---

## Overview

This runbook guides you through running the Phase 5.2A production inspection package. The goal is to inspect real production suspension data and classify every record for migration readiness.

**Important**: All queries in this package are **READ-ONLY**. No data will be modified.

---

## Prerequisites

- Access to Supabase dashboard for your CFYL database
- Ability to run SQL queries in the SQL Editor
- Ability to export query results (CSV or screenshot)
- ~45 minutes of time
- This runbook document

---

## Execution Order & Instructions

### Phase 5.2A Loop 1: Schema Inspection (5 minutes)

**Goal**: Verify that the migration schema has been applied to your database.

**Action**:
1. Open Supabase SQL Editor
2. Copy the entire content from `01-schema-inspection.sql`
3. Paste into SQL Editor
4. **RUN QUERY 1.1 FIRST** (Suspensions Table Columns)
   - This will show all columns in the suspensions table
   - **Verify these columns exist:**
     - `suspension_type` (text)
     - `trigger_match_id` (uuid)
     - `accumulated_threshold` (integer)
     - `source_card_ids` (uuid[])
     - `serving_match_ids` (uuid[])
     - `served_completed_at` (timestamp)
     - `legacy_migrated` (boolean)
   
   **If ANY column is missing**:
   - ⛔ STOP - Schema migration not applied
   - Report to database owner
   - Return to Phase 4 to apply schema migration first
   - Do NOT proceed to Loop 2

5. **Run Query 1.2** (Check Constraints)
   - Verify constraints exist:
     - `suspensions_suspension_type_check`
     - `suspensions_accumulated_threshold_check`

6. **Run Query 1.3** (Indexes)
   - Verify unique index exists:
     - `uniq_suspension_event_trigger`
   - This index is CRITICAL for preventing duplicates

7. **Run Query 1.4** (Foreign Keys)
   - Verify all foreign keys exist
   - Should reference: players, teams, seasons, matches

**Result**: Export the results to a text file or screenshot for your records.

**Success Criteria**: ✅ All 7 required fields exist in table schema

---

### Phase 5.2A Loop 2: Record Inventory (5 minutes)

**Goal**: Get exact counts of all suspension records and their types.

**Action**:
1. Copy content from `02-record-inventory.sql`
2. **RUN Query 2.1** (Master Count Query)
   - This gives you the most important numbers
   - **Record these numbers:**
     - total_suspensions: _______
     - null_type_count: _______
     - legacy_count: _______
     - event_based_count: _______
     - missing_trigger_match_id: _______
     - missing_serving_match_ids: _______
     - with_active_ban: _______

   **If null_type_count > 0**: ⚠️ WARNING - Old schema records still exist

3. **RUN Query 2.2** (Breakdown by Type)
   - Shows distribution across suspension_type values
   - Will help you understand data composition

4. **RUN Query 2.3** (Records by Season)
   - Shows which seasons have suspensions
   - Useful for prioritizing migration

5. **RUN Query 2.4** (Player and Team Coverage)
   - Shows scale of data

6. **RUN Query 2.5** (Data Completeness)
   - Shows what percentage of records have each field populated
   - Low percentages indicate data quality issues

**Result**: Export results, fill in RESULT-TEMPLATE.md "Record Counts" section

**Success Criteria**: ✅ You have exact record counts for all suspension types

---

### Phase 5.2A Loop 3: Legacy Record Details (10 minutes)

**Goal**: Inspect the actual legacy suspension records in detail.

**Action**:
1. Copy content from `03-legacy-record-detail.sql`
2. **RUN Query 3.1** (All Legacy Records with Full Context)
   - This is a LARGE query - returns all legacy records
   - ⚠️ If there are thousands, consider adding LIMIT clause
   - **Export this to CSV file** - you'll need these for classification
   
   **While reviewing, note:**
   - Are suspension_reason values clear?
   - Are suspension_details populated?
   - Do suspended_from_match_id values make sense?

3. **RUN Query 3.2** (Sample with suspension_details)
   - Inspect JSON structure of suspension_details
   - Look for trigger_match_id in the JSON

4. **RUN Query 3.3** (Missing suspension_reason)
   - ⚠️ CRITICAL - These records CANNOT be auto-migrated
   - **Record count**: _______
   - These will need manual review

5. **RUN Query 3.4** (Missing suspended_from_match_id)
   - Another CRITICAL issue
   - **Record count**: _______

6. **RUN Query 3.5** (Point/Ban Mismatch)
   - Shows records with inconsistent data
   - **Record count**: _______

**Result**: Export Query 3.1 results to CSV (name it `legacy_records_export.csv`)

**Success Criteria**: ✅ You have CSV export of all legacy records for manual review

---

### Phase 5.2A Loop 4: Trigger Card Analysis (10 minutes)

**Goal**: Find the original cards that caused each suspension.

**Action**:
1. Copy content from `04-trigger-card-analysis.sql`
2. **RUN Query 4.1** (All Cards for Legacy Suspension Players)
   - Returns every card for every player that has a suspension
   - Large result set
   - Use this to match cards to suspensions

3. **RUN Query 4.2** (Aggregated Cards by Match)
   - Shows card summary per match
   - **Use this to calculate what trigger_match_id should be**
   - For each legacy suspension:
     - Find the match with matching total_points
     - That match is likely the trigger_match_id

4. **RUN Query 4.3** (Suspension + Trigger Candidates)
   - Shows suspensions with inferred trigger matches
   - Uses logic: suspension_details first, then last card before suspension

5. **RUN Query 4.4** (Missing Trigger Matches)
   - Records that cannot find any trigger match
   - **Record count**: _______
   - These go to MANUAL_REVIEW

**Result**: Use this data to help classify records

**Success Criteria**: ✅ You understand the card history for each player with suspensions

---

### Phase 5.2A Loop 5: Classification Support (5 minutes)

**Goal**: Get helper queries to assist with classification.

**Action**:
1. Copy content from `05-classification-support.sql`
2. **RUN Query 5.1** (Classification Decision Matrix)
   - Shows each record with classification indicators
   - Helps you decide: AUTO_MIGRATE vs MANUAL_REVIEW vs etc
   - **Review the suggested_classification column**

3. **RUN Query 5.2** (Records Ready for Auto-Migration)
   - These are confirmed AUTO_MIGRATE candidates
   - **Record count**: _______

4. **RUN Query 5.3** (Records Needing Manual Review)
   - Shows why each record needs manual review
   - **Record count**: _______

5. **RUN Query 5.4** (Invalid Data Records)
   - Data corruption (missing player/team, negative values, etc.)
   - **Record count**: _______

6. **RUN Query 5.5** (Classification Summary)
   - Final summary of counts by classification
   - **Copy these numbers**:
     - AUTO_MIGRATE: _______
     - MANUAL_REVIEW: _______
     - KEEP_LEGACY: _______
     - INVALID_DATA: _______

**Result**: You have classification suggestions for every record

**Success Criteria**: ✅ Classification counts are determined

---

### Phase 5.2A Loop 6: Duplicate Conflict Audit (5 minutes)

**Goal**: Check for duplicate records that would block migration.

**Action**:
1. Copy content from `06-duplicate-conflict-audit.sql`
2. **RUN Query 6.1** (Duplicate Event-Based Records)
   - Should return 0 rows
   - If returns rows: ⚠️ CRITICAL - Duplicates detected
   - **Result**: _______ rows (should be 0)

3. **RUN Query 6.2** (Duplicate Legacy Records)
   - Should return 0 rows
   - If returns rows: Legacy system already has duplicates
   - **Result**: _______ rows (should be 0)

4. **RUN Query 6.3** (Orphaned Trigger Matches)
   - Should return 0 rows
   - If returns rows: Data corruption (missing matches)
   - **Result**: _______ rows (should be 0)

5. **RUN Query 6.4** (Legacy + Event Mixed State)
   - Shows players with both legacy and event records
   - Expected if partial migration already done
   - **Result**: _______ player+team pairs

6. **RUN Query 6.5** (Points/Ban Mismatch)
   - Should return 0 rows
   - Shows data quality issues
   - **Result**: _______ rows (should be 0)

7. **RUN Query 6.6** (Conflict Summary)
   - One-row summary of all conflict counts
   - **Record all numbers**

**Result**: Conflict counts recorded

**Success Criteria**: 
- ✅ No event-based duplicates
- ✅ No orphaned references
- ✅ Points/ban consistency OK

---

### Phase 5.2A Loop 7: Serving Match Audit (5 minutes)

**Goal**: Verify all suspension serving matches are valid.

**Action**:
1. Copy content from `07-serving-match-audit.sql`
2. **RUN Query 7.1** (Serving Match Status)
   - Check each suspended_from_match_id status
   - Should all be USABLE or COMPLETED
   - **Count issues**: _______ records with status issues

3. **RUN Query 7.2** (Event-Based Serving Matches)
   - Check serving_match_ids array validity
   - Should all exist and be valid status
   - **Count issues**: _______ records with serving issues

4. **RUN Query 7.3** (Count vs Ban Matches)
   - Check if serving_match_ids count >= ban_matches
   - May be fewer if season ending (acceptable)
   - **Count issues**: _______ records with count issues

5. **RUN Query 7.4** (Legacy Missing Serving Match)
   - Records without suspended_from_match_id
   - Cannot be migrated
   - **Count**: _______ records

6. **RUN Query 7.5** (Chronology Verification)
   - Check serving matches come AFTER trigger match
   - Should return 0 rows
   - **Count errors**: _______ records

7. **RUN Query 7.6** (Serving Match Summary)
   - One-row summary
   - **Record all numbers**

**Result**: Serving match status recorded

**Success Criteria**: ✅ Most serving matches valid, any issues identified

---

### Phase 5.2A Loop 8: Data Quality Audit (5 minutes)

**Goal**: Final comprehensive data quality check.

**Action**:
1. Copy content from `08-data-quality-audit.sql`
2. **RUN Query 8.1** (Missing Required Fields)
   - Should return all 0s
   - If any > 0: ⚠️ CRITICAL data issues
   - **Record all counts**

3. **RUN Query 8.2** (Foreign Key Integrity)
   - Should return all 0s
   - If any > 0: Orphaned records
   - **Record all counts**

4. **RUN Query 8.3** (Points/Ban Consistency)
   - Should return all 0s
   - **Record all counts**

5. **RUN Query 8.4** (Text Field Quality)
   - Should return 0 rows
   - If returns rows: Investigate for injection/corruption
   - **Record count**: _______ suspicious fields

6. **RUN Query 8.5** (Complete Data Quality Report)
   - One-row comprehensive summary
   - **Record status**: PASS / WARNING / FAIL
   - **Record all counts**

**Result**: Overall data quality assessment completed

**Success Criteria**: ✅ Overall quality is PASS or WARNING (not FAIL)

---

### Phase 5.2A Loop 9: Migration Preview (5 minutes)

**Goal**: See what would be created (preview only, no actual changes).

**Action**:
1. Copy content from `09-migration-preview-template.sql`
2. **RUN Query 9.1** (Preview AUTO_MIGRATE Records)
   - Shows what accumulated_points records would look like
   - Review: Do trigger_match_id and serving matches look right?

3. **RUN Query 9.2** (Preview Ejection Records)
   - Shows what ejection records would look like
   - Review: Are suspension_type classifications correct?

4. **RUN Query 9.3** (Records Not Being Migrated)
   - Shows what will remain legacy
   - Review classifications

5. **RUN Query 9.4** (Migration Statistics)
   - Summary of proposed migration
   - **Record numbers**:
     - can_auto_migrate: _______
     - invalid_data: _______
     - manual_review_needed: _______

6. **RUN Query 9.5** (Manual Review List)
   - Export detailed list of all MANUAL_REVIEW records
   - **Export to CSV** for your manual review work

**Result**: Preview complete, manual review list exported

**Success Criteria**: ✅ You understand what will be migrated and what won't

---

## Result Data Export

After running all 9 loops, you should have exported:

1. **Query 3.1 Results** → `legacy_records_full.csv`
2. **Query 9.5 Results** → `manual_review_list.csv`

You should also have recorded in RESULT-TEMPLATE.md:
- All master counts (Loop 2, Query 2.1)
- All classification counts (Loop 5, Query 5.5)
- All conflict summary (Loop 6, Query 6.6)
- All data quality results (Loop 8, Query 8.5)
- All migration statistics (Loop 9, Query 9.4)

---

## Stopping Conditions

**STOP AND REPORT immediately if you encounter:**

1. ❌ Missing migration schema columns (Loop 1)
   - Contact database owner
   - Apply Phase 4 schema migration
   
2. ❌ High count of INVALID_DATA records (Loop 8)
   - May indicate data corruption
   - Investigate before proceeding

3. ❌ Orphaned references or duplicates (Loop 6)
   - Data integrity issues
   - Must be resolved before migration

4. ❌ Missing suspension_reason on records with bans > 0 (Loop 3, Query 3.3)
   - Cannot infer suspension type
   - Must manually review and classify

---

## Data Redaction

Before sharing results back to analyst:

1. **Remove personally identifiable information if needed**
   - Player names (if sensitive)
   - Exact dates (can mask as "within season X")

2. **You CAN share:**
   - Record counts and statistics
   - Aggregated data (by season, by type, etc.)
   - Classification summaries
   - Issue summaries

3. **Keep:**
   - Full CSV exports (needed for manual review and migration)
   - All query result details

---

## Expected Runtime

- Loop 1 (Schema): 2-3 minutes
- Loop 2 (Inventory): 2-3 minutes
- Loop 3 (Details): 3-5 minutes (depends on record count)
- Loop 4 (Cards): 2-3 minutes
- Loop 5 (Classification): 2-3 minutes
- Loop 6 (Duplicates): 2-3 minutes
- Loop 7 (Serving): 2-3 minutes
- Loop 8 (Quality): 2-3 minutes
- Loop 9 (Preview): 3-5 minutes
- **Total**: ~25-40 minutes

---

## Next Steps After Inspection

Once you've completed all 9 loops and exported results:

1. Share RESULT-TEMPLATE.md with analyst
2. Share CSV exports (legacy_records_full.csv, manual_review_list.csv)
3. Analyst will:
   - Review results
   - Finalize classification of MANUAL_REVIEW records
   - Generate Phase 5.2B migration SQL
   - Provide execution instructions

---

## Help & Troubleshooting

**Query runs very slowly or times out:**
- Add LIMIT 1000 to the query
- Run smaller date ranges if applicable
- Check Supabase performance metrics

**"Column does not exist" error:**
- Verify schema was applied (Loop 1, Query 1.1)
- May need to re-run migration schema script

**"Table does not exist" error:**
- Database name may be different
- Check table_schema and table_name in queries

**Large result sets (10,000+ rows):**
- Export to CSV instead of screenshot
- Use Supabase's CSV export feature
- Don't try to display in browser (will freeze)

---

**Document Version**: 1.0  
**Created**: 2026-07-11  
**Ready for Execution**: YES

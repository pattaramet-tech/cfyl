-- PHASE 5.2A — Loop 1: Schema Inspection
-- ⚠️ READ-ONLY SCRIPT — No data modifications
-- Purpose: Verify migration schema is applied and all required fields exist

-- ============================================================================
-- Query 1.1: Suspensions Table Column Definitions
-- Expected Columns: All migration fields should be present
-- ============================================================================

select
  column_name,
  data_type,
  is_nullable,
  column_default,
  ordinal_position
from information_schema.columns
where table_schema = 'public'
  and table_name = 'suspensions'
order by ordinal_position;

-- Expected Output Columns:
--   column_name: Field name (e.g., 'suspension_type', 'trigger_match_id', etc.)
--   data_type: PostgreSQL data type (text, uuid, integer[], etc.)
--   is_nullable: YES or NO
--   column_default: Default value if any
--   ordinal_position: Position in table

-- Interpretation:
-- Required fields must exist:
--   ✓ suspension_type (text, nullable)
--   ✓ trigger_match_id (uuid, nullable)
--   ✓ accumulated_threshold (integer, nullable)
--   ✓ source_card_ids (uuid[], nullable)
--   ✓ serving_match_ids (uuid[], nullable)
--   ✓ served_completed_at (timestamp, nullable)
--   ✓ legacy_migrated (boolean, default false)
--
-- If ANY field is missing → Schema migration NOT applied → STOP Phase 5.2B


-- ============================================================================
-- Query 1.2: Check Constraints on Suspensions Table
-- Expected: suspension_type and accumulated_threshold constraints exist
-- ============================================================================

select
  conname as constraint_name,
  pg_get_constraintdef(oid) as definition,
  contype as constraint_type
from pg_constraint
where conrelid = 'public.suspensions'::regclass
order by conname;

-- Expected Output Columns:
--   constraint_name: Name of constraint (e.g., 'suspensions_suspension_type_check')
--   definition: Constraint definition
--   constraint_type: c=check, pk=primary key, fk=foreign key, u=unique, etc.

-- Interpretation:
-- Required constraints:
--   ✓ suspensions_suspension_type_check
--   ✓ suspensions_accumulated_threshold_check
--
-- These prevent invalid values during migration


-- ============================================================================
-- Query 1.3: Unique and Non-Unique Indexes on Suspensions
-- Expected: uniq_suspension_event_trigger index exists
-- ============================================================================

select
  indexname,
  indexdef,
  case when ix.indisunique then 'UNIQUE' else 'NON-UNIQUE' end as index_type
from pg_indexes
left join pg_index ix on pg_indexes.indexname = ix.indexname::text
where schemaname = 'public'
  and tablename = 'suspensions'
order by indexname;

-- Expected Output Columns:
--   indexname: Index name
--   indexdef: Full index definition
--   index_type: UNIQUE or NON-UNIQUE

-- Interpretation:
-- Required unique index:
--   ✓ uniq_suspension_event_trigger: Prevents duplicate (player_id, team_id, trigger_match_id, suspension_type, accumulated_threshold)
--
-- This is CRITICAL for preventing duplicate records during migration


-- ============================================================================
-- Query 1.4: Foreign Key Relationships (Schema Integrity Check)
-- Expected: All foreign keys to players, teams, matches, seasons exist
-- ============================================================================

select
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name,
  rc.update_rule,
  rc.delete_rule
from information_schema.table_constraints as tc
join information_schema.key_column_usage as kcu
  on tc.constraint_name = kcu.constraint_name
join information_schema.constraint_column_usage as ccu
  on ccu.constraint_name = tc.constraint_name
join information_schema.referential_constraints as rc
  on rc.constraint_name = tc.constraint_name
where tc.table_schema = 'public'
  and tc.table_name = 'suspensions'
  and tc.constraint_type = 'FOREIGN KEY'
order by kcu.column_name;

-- Expected Output Columns:
--   constraint_name: Foreign key constraint name
--   column_name: Column in suspensions table
--   foreign_table_name: Referenced table (players, teams, matches, seasons)
--   foreign_column_name: Referenced column (usually 'id')
--   update_rule: UPDATE action
--   delete_rule: DELETE action

-- Interpretation:
-- All foreign keys should be present:
--   ✓ player_id → players(id)
--   ✓ team_id → teams(id)
--   ✓ season_id → seasons(id)
--   ✓ trigger_match_id → matches(id) [new]


-- ============================================================================
-- Query 1.5: Alternative Check if Schema Queries Fail
-- Fallback: List all constraints and indexes for manual inspection
-- ============================================================================

-- If above queries fail, run this for debugging:
select
  'constraints' as object_type,
  conname as name,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.suspensions'::regclass

union all

select
  'indexes',
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'suspensions';

-- This provides all objects in one output for easier troubleshooting

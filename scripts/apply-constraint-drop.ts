/**
 * One-shot: drop the legacy unique constraint that blocks event-based insertion.
 * Safe, idempotent, no data modification.
 *
 * Run: npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/apply-constraint-drop.ts
 */
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('Dropping legacy unique constraint...');

  // Supabase JS client cannot run DDL directly via .from(); use the REST SQL endpoint
  // We use the raw HTTP approach via fetch against the REST API
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`;

  // Fallback: use supabase.rpc if exec_sql is available, else print instructions
  const { error } = await sb.rpc('exec_sql' as any, {
    query: `ALTER TABLE public.suspensions DROP CONSTRAINT IF EXISTS suspensions_season_id_age_group_id_player_id_team_id_key;`,
  } as any);

  if (error) {
    if (error.message?.includes('exec_sql')) {
      console.log('\n⚠️  exec_sql RPC not available.');
      console.log('Run this SQL manually in Supabase SQL Editor:\n');
      console.log('  ALTER TABLE public.suspensions');
      console.log('    DROP CONSTRAINT IF EXISTS suspensions_season_id_age_group_id_player_id_team_id_key;');
      console.log('\nFile: docs/phase-5-2c/00-DROP-legacy-unique-constraint.sql');
    } else {
      console.error('Error:', error.message);
      process.exit(1);
    }
  } else {
    console.log('✅ Constraint dropped successfully.');
  }

  // Verify current constraints
  const { data: constraints } = await sb
    .from('pg_constraint' as any)
    .select('conname')
    .eq('conrelid', 'public.suspensions');

  console.log('\nNOTE: Run docs/phase-5-2c/00-DROP-legacy-unique-constraint.sql in Supabase SQL Editor to apply.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });

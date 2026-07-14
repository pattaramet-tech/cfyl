// Tournament V2 — Phase 1 verification script.
// NOT part of `npm run test` — requires real TOURNAMENT_SUPABASE_* credentials that
// don't exist in CI. Run manually after you've applied all 11 migration files
// (see README.md) against a real Tournament Supabase project:
//
//   npm run verify:tournament-foundation
//
// Checks: (1) all 34 tables are queryable via the service client, (2) a throwaway
// tournaments row is visible to the anon client immediately (public RLS policy
// works), and invisible after cleanup, (3) a locked-down RBAC table returns zero
// rows to the anon client regardless of content (no public policy leak).

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { loadEnvConfig } from '@next/env';
import { getTournamentServiceClient, getTournamentClient } from '../../lib/tournament/db/supabase-tournament';
loadEnvConfig(process.cwd());
const ALL_TABLES = [
  // 001
  'tournaments', 'tournament_categories', 'tournament_venues', 'tournament_courts', 'tournament_category_venues',
  // 002
  'tournament_teams', 'tournament_players', 'tournament_staff',
  // 003
  'tournament_groups', 'tournament_group_members', 'tournament_knockout_rounds',
  // 004
  'tournament_matches', 'tournament_draw_assignments',
  // 005
  'tournament_match_goals', 'tournament_match_cards', 'tournament_match_reports',
  // 006
  'tournament_suspension_events', 'tournament_suspension_serving_matches',
  // 007
  'tournament_standing_rules', 'tournament_qualification_rules', 'tournament_standing_overrides',
  'tournament_qualification_draws', 'tournament_qualification_draw_candidates',
  // 008
  'tournament_audit_logs',
  // 009
  'tournament_user_profiles', 'tournament_role_assignments', 'tournament_match_officials',
  // 010
  'tournament_match_attachments', 'tournament_result_submissions', 'tournament_result_versions', 'tournament_result_approvals',
  // 011
  'tournament_schedule_batches', 'tournament_schedule_import_rows', 'tournament_schedule_versions',
] as const;

async function checkAllTablesQueryable() {
  const service = getTournamentServiceClient();
  console.log(`\nChecking ${ALL_TABLES.length} tables are queryable via service client...`);
  let failures = 0;
  for (const table of ALL_TABLES) {
    const { error } = await service.from(table).select('id', { count: 'exact', head: true });
    if (error) {
      console.error(`  ✗ ${table}: ${error.message}`);
      failures++;
    } else {
      console.log(`  ✓ ${table}`);
    }
  }
  if (failures > 0) {
    throw new Error(`${failures}/${ALL_TABLES.length} tables failed — check migration files ran in full`);
  }
  console.log(`All ${ALL_TABLES.length} tables queryable.\n`);
}

async function checkPublicRlsRoundTrip() {
  console.log('Checking public RLS policy round-trip on tournaments...');
  const service = getTournamentServiceClient();
  const anon = getTournamentClient();

  const slug = `phase1-verify-${Date.now()}`;
  const { data: inserted, error: insertError } = await service
    .from('tournaments')
    .insert({ name: 'Phase 1 Verification (safe to delete)', slug, status: 'upcoming' })
    .select('id')
    .single();
  if (insertError || !inserted) {
    throw new Error(`Insert failed: ${insertError?.message ?? 'no row returned'}`);
  }

  const { data: seenByAnon, error: anonError } = await anon
    .from('tournaments')
    .select('id')
    .eq('id', inserted.id)
    .maybeSingle();
  if (anonError) throw new Error(`Anon select failed: ${anonError.message}`);
  if (!seenByAnon) throw new Error('Anon client could not see the public tournaments row — public RLS policy is broken');
  console.log('  ✓ anon client can see a public tournaments row');

  const { error: deleteError } = await service.from('tournaments').delete().eq('id', inserted.id);
  if (deleteError) throw new Error(`Cleanup delete failed: ${deleteError.message}`);

  const { data: seenAfterDelete } = await service.from('tournaments').select('id').eq('id', inserted.id).maybeSingle();
  if (seenAfterDelete) throw new Error('Throwaway row was not actually deleted — cleanup failed');
  console.log('  ✓ throwaway row cleaned up\n');
}

async function checkRbacTableLockedDown() {
  console.log('Checking tournament_user_profiles is not publicly readable...');
  const anon = getTournamentClient();
  const { data, error } = await anon.from('tournament_user_profiles').select('id').limit(1);
  if (error) throw new Error(`Unexpected error querying locked-down table: ${error.message}`);
  if (data && data.length > 0) {
    throw new Error('tournament_user_profiles returned rows to the anon client — RBAC table is NOT locked down');
  }
  console.log('  ✓ anon client sees zero rows (as expected — no public policy on this table)\n');
}

async function main() {
  await checkAllTablesQueryable();
  await checkPublicRlsRoundTrip();
  await checkRbacTableLockedDown();
  console.log('Phase 1 foundation verification passed.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\nPhase 1 foundation verification FAILED:', e instanceof Error ? e.message : e);
    process.exit(1);
  });

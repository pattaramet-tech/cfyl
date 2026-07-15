import { loadEnvConfig } from '@next/env';
import { getTournamentServiceClient } from '../../lib/tournament/db/supabase-tournament';

const args = process.argv.slice(2);

// Handle --help before loading env
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Tournament Super Admin Bootstrap

Usage: npm run bootstrap:tournament-super-admin

Required environment variables (set in .env.local, do not commit):
  TOURNAMENT_BOOTSTRAP_ADMIN_USER_ID    - User ID from League Auth (find in Supabase Auth dashboard)
  TOURNAMENT_BOOTSTRAP_ADMIN_EMAIL      - User email
  TOURNAMENT_SUPABASE_URL               - Tournament Supabase project URL
  TOURNAMENT_SUPABASE_SERVICE_ROLE_KEY  - Service role key (full permissions)

Example .env.local entry:
  TOURNAMENT_BOOTSTRAP_ADMIN_USER_ID=550e8400-e29b-41d4-a716-446655440000
  TOURNAMENT_BOOTSTRAP_ADMIN_EMAIL=admin@example.com
  TOURNAMENT_SUPABASE_URL=https://xxx.supabase.co
  TOURNAMENT_SUPABASE_SERVICE_ROLE_KEY=eyJh...

This script:
1. Creates a tournament_user_profiles row for the user
2. Creates a tournament_role_assignments row with role='tournament_super_admin'
3. Idempotent: safe to re-run (no error if already exists)
`);
  process.exit(0);
}

loadEnvConfig(process.cwd());

const userId = process.env.TOURNAMENT_BOOTSTRAP_ADMIN_USER_ID;
const email = process.env.TOURNAMENT_BOOTSTRAP_ADMIN_EMAIL;
const supabaseUrl = process.env.TOURNAMENT_SUPABASE_URL;
const serviceRoleKey = process.env.TOURNAMENT_SUPABASE_SERVICE_ROLE_KEY;

const missingVars: string[] = [];
if (!userId) missingVars.push('TOURNAMENT_BOOTSTRAP_ADMIN_USER_ID');
if (!email) missingVars.push('TOURNAMENT_BOOTSTRAP_ADMIN_EMAIL');
if (!supabaseUrl) missingVars.push('TOURNAMENT_SUPABASE_URL');
if (!serviceRoleKey) missingVars.push('TOURNAMENT_SUPABASE_SERVICE_ROLE_KEY');

if (missingVars.length > 0) {
  console.error('[BOOTSTRAP] Error: Missing required environment variables:');
  missingVars.forEach((v) => console.error(`  - ${v}`));
  console.error('[BOOTSTRAP] Set them in .env.local (do not commit)');
  console.error('[BOOTSTRAP] Run: npm run bootstrap:tournament-super-admin -- --help');
  process.exit(1);
}

async function bootstrap() {
  try {
    const client = getTournamentServiceClient();

    console.log('[BOOTSTRAP] Checking for existing profile...');
    const { data: existingProfile } = await client
      .from('tournament_user_profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (existingProfile) {
      console.log('[BOOTSTRAP] Profile already exists for this user. Checking role...');

      const { data: existingRole } = await client
        .from('tournament_role_assignments')
        .select('id')
        .eq('user_id', userId)
        .eq('role', 'tournament_super_admin')
        .maybeSingle();

      if (existingRole) {
        console.log('[BOOTSTRAP] Super admin role already exists. No action taken.');
        process.exit(0);
      }

      console.log('[BOOTSTRAP] Profile exists but no super_admin role. Adding role...');
      const { error: roleError } = await client.from('tournament_role_assignments').insert({
        user_id: userId,
        role: 'tournament_super_admin',
        tournament_id: null,
        venue_id: null,
        category_id: null,
        match_id: null,
        created_by: userId,
      });

      if (roleError) {
        throw new Error(`Failed to create role: ${roleError.message}`);
      }

      console.log('[BOOTSTRAP] ✓ Super admin role created');
      process.exit(0);
    }

    console.log('[BOOTSTRAP] Creating user profile and super_admin role...');
    const { error: profileError } = await client.from('tournament_user_profiles').insert({
      id: userId,
      email,
      active: true,
    });

    if (profileError) {
      throw new Error(`Failed to create profile: ${profileError.message}`);
    }

    const { error: roleError } = await client.from('tournament_role_assignments').insert({
      user_id: userId,
      role: 'tournament_super_admin',
      tournament_id: null,
      venue_id: null,
      category_id: null,
      match_id: null,
      created_by: userId,
    });

    if (roleError) {
      throw new Error(`Failed to create role: ${roleError.message}`);
    }

    console.log('[BOOTSTRAP] ✓ Bootstrap complete');
    console.log(`[BOOTSTRAP] User: ${email}`);
    console.log('[BOOTSTRAP] Role: tournament_super_admin (global scope)');
    process.exit(0);
  } catch (err) {
    console.error('[BOOTSTRAP] Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

bootstrap();

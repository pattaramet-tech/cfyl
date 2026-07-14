import { loadEnvConfig } from '@next/env';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';

loadEnvConfig(process.cwd());

const userId = process.env.TOURNAMENT_BOOTSTRAP_ADMIN_USER_ID;
const email = process.env.TOURNAMENT_BOOTSTRAP_ADMIN_EMAIL;

if (!userId || !email) {
  console.error(
    '[BOOTSTRAP] Error: TOURNAMENT_BOOTSTRAP_ADMIN_USER_ID and TOURNAMENT_BOOTSTRAP_ADMIN_EMAIL env vars are required'
  );
  console.error('[BOOTSTRAP] Set them in .env.local (do not commit)');
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

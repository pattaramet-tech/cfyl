import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { getTournamentServiceClient } from '../db/supabase-tournament';

export interface TournamentAdminAuthResult {
  authenticated: boolean;
  authorized: boolean;
  userId?: string;
  email?: string;
  error?: string;
}

const leagueUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const leagueServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!leagueUrl || !leagueServiceKey) {
  throw new Error('[TOURNAMENT_AUTH] Missing League Supabase environment variables');
}

const leagueServiceClient = createClient(leagueUrl, leagueServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Verify the caller's JWT against League's Supabase Auth (Identity Provider per D-03).
 * Then authorize by looking up their role in Tournament's own database.
 *
 * Returns fail-closed: missing profile or role row → authorized: false, no fallback.
 */
export async function requireTournamentSuperAdmin(
  request: NextRequest
): Promise<TournamentAdminAuthResult> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      authenticated: false,
      authorized: false,
      error: 'Missing or invalid Authorization header',
    };
  }

  const token = authHeader.slice(7);

  try {
    const {
      data: { user },
      error: authError,
    } = await leagueServiceClient.auth.getUser(token);

    if (authError || !user) {
      return {
        authenticated: false,
        authorized: false,
        error: 'Invalid or expired token',
      };
    }

    const userId = user.id;
    const userEmail = user.email || '';

    const tournamentClient = getTournamentServiceClient();

    const { data: profile, error: profileError } = await tournamentClient
      .from('tournament_user_profiles')
      .select('id, active')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      console.error('[TOURNAMENT_AUTH] profile lookup error:', profileError.message);
      return {
        authenticated: true,
        authorized: false,
        userId,
        email: userEmail,
        error: 'Failed to look up user profile',
      };
    }

    if (!profile) {
      return {
        authenticated: true,
        authorized: false,
        userId,
        email: userEmail,
        error: 'User profile not found in Tournament database',
      };
    }

    if (!profile.active) {
      return {
        authenticated: true,
        authorized: false,
        userId,
        email: userEmail,
        error: 'User profile is inactive',
      };
    }

    const { data: roleAssignment, error: roleError } = await tournamentClient
      .from('tournament_role_assignments')
      .select('id, role')
      .eq('user_id', userId)
      .eq('role', 'tournament_super_admin')
      .maybeSingle();

    if (roleError) {
      console.error('[TOURNAMENT_AUTH] role lookup error:', roleError.message);
      return {
        authenticated: true,
        authorized: false,
        userId,
        email: userEmail,
        error: 'Failed to look up user role',
      };
    }

    if (!roleAssignment) {
      return {
        authenticated: true,
        authorized: false,
        userId,
        email: userEmail,
        error: 'User does not have tournament_super_admin role',
      };
    }

    return {
      authenticated: true,
      authorized: true,
      userId,
      email: userEmail,
    };
  } catch (err) {
    console.error('[TOURNAMENT_AUTH] unexpected error:', err instanceof Error ? err.message : err);
    return {
      authenticated: false,
      authorized: false,
      error: 'Authentication check failed',
    };
  }
}

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

/**
 * Verify the caller's JWT, then authorize as either the Dedicated Shared
 * Result-entry Account (`result_operator`, D-03) scoped to `tournamentId`, or
 * `tournament_super_admin`. `result_operator` role_assignments rows are
 * scoped only to `tournament_id` (no fixed venue/category/match — the account
 * picks venue/match in-app every session per D-03), so this always requires a
 * tournamentId to check scope against.
 *
 * Returns fail-closed: missing profile or role row → authorized: false.
 */
export async function requireTournamentResultOperator(
  request: NextRequest,
  tournamentId: string
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
      return { authenticated: false, authorized: false, error: 'Invalid or expired token' };
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
      return { authenticated: true, authorized: false, userId, email: userEmail, error: 'Failed to look up user profile' };
    }
    if (!profile) {
      return { authenticated: true, authorized: false, userId, email: userEmail, error: 'User profile not found in Tournament database' };
    }
    if (!profile.active) {
      return { authenticated: true, authorized: false, userId, email: userEmail, error: 'User profile is inactive' };
    }

    const { data: roleAssignments, error: roleError } = await tournamentClient
      .from('tournament_role_assignments')
      .select('id, role, tournament_id')
      .eq('user_id', userId)
      .in('role', ['tournament_super_admin', 'result_operator']);

    if (roleError) {
      console.error('[TOURNAMENT_AUTH] role lookup error:', roleError.message);
      return { authenticated: true, authorized: false, userId, email: userEmail, error: 'Failed to look up user role' };
    }

    const hasScope = (roleAssignments || []).some(
      (assignment: { role: string; tournament_id: string | null }) =>
        assignment.tournament_id === null || assignment.tournament_id === tournamentId
    );

    if (!hasScope) {
      return {
        authenticated: true,
        authorized: false,
        userId,
        email: userEmail,
        error: 'User does not have result_operator or tournament_super_admin role for this tournament',
      };
    }

    return { authenticated: true, authorized: true, userId, email: userEmail };
  } catch (err) {
    console.error('[TOURNAMENT_AUTH] unexpected error:', err instanceof Error ? err.message : err);
    return { authenticated: false, authorized: false, error: 'Authentication check failed' };
  }
}

export interface AuthorizedTournamentScope {
  tournamentId: string | null; // null = every tournament (global tournament_super_admin)
}

/**
 * Authenticates the caller and returns the set of tournaments they may act
 * within as a `result_operator` or `tournament_super_admin`, without
 * requiring a tournamentId up front — used only by the Matchday
 * Tournament/Venue selector (Phase 5b), before a tournament has been picked.
 * Every subsequent read/write for a specific tournament/match must still go
 * through `requireTournamentResultOperator` with that tournament's id.
 */
export async function listAuthorizedTournamentScopes(
  request: NextRequest
): Promise<{ authenticated: boolean; userId?: string; email?: string; scopes: AuthorizedTournamentScope[]; error?: string }> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authenticated: false, scopes: [], error: 'Missing or invalid Authorization header' };
  }
  const token = authHeader.slice(7);

  try {
    const {
      data: { user },
      error: authError,
    } = await leagueServiceClient.auth.getUser(token);
    if (authError || !user) {
      return { authenticated: false, scopes: [], error: 'Invalid or expired token' };
    }

    const userId = user.id;
    const tournamentClient = getTournamentServiceClient();

    const { data: profile, error: profileError } = await tournamentClient
      .from('tournament_user_profiles')
      .select('id, active')
      .eq('id', userId)
      .maybeSingle();
    if (profileError || !profile || !profile.active) {
      return { authenticated: true, userId, email: user.email || '', scopes: [], error: 'User profile not found or inactive' };
    }

    const { data: roleAssignments, error: roleError } = await tournamentClient
      .from('tournament_role_assignments')
      .select('role, tournament_id')
      .eq('user_id', userId)
      .in('role', ['tournament_super_admin', 'result_operator']);
    if (roleError) {
      return { authenticated: true, userId, email: user.email || '', scopes: [], error: roleError.message };
    }

    const scopes = ((roleAssignments || []) as { role: string; tournament_id: string | null }[]).map((assignment) => ({
      tournamentId: assignment.tournament_id,
    }));

    return { authenticated: true, userId, email: user.email || '', scopes };
  } catch (err) {
    console.error('[TOURNAMENT_AUTH] unexpected error:', err instanceof Error ? err.message : err);
    return { authenticated: false, scopes: [], error: 'Authentication check failed' };
  }
}

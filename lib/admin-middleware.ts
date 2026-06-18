import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import type { AdminProfile } from './admin-auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

// Use service role to verify JWT tokens
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ============================================================================
// VERIFY ADMIN AUTH (for API routes)
// ============================================================================

export async function verifyAdminAuth(request: NextRequest) {
  try {
    // Get JWT token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        authenticated: false,
        error: 'Missing or invalid Authorization header',
      };
    }

    const token = authHeader.slice(7); // Remove "Bearer " prefix

    // Verify token with Supabase
    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data.user) {
      return {
        authenticated: false,
        error: 'Invalid or expired token',
      };
    }

    const userId = data.user.id;

    // Get admin profile to check permissions
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('admin_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return {
        authenticated: false,
        error: 'Admin profile not found',
      };
    }

    const adminProfile = profile as AdminProfile;

    if (!adminProfile.active) {
      return {
        authenticated: false,
        error: 'Admin account is inactive',
      };
    }

    return {
      authenticated: true,
      userId,
      profile: adminProfile,
    };
  } catch (error) {
    console.error('Auth verification error:', error);
    return {
      authenticated: false,
      error: 'Internal server error',
    };
  }
}

// ============================================================================
// MIDDLEWARE WRAPPER FOR API ROUTES
// ============================================================================

export function requireAdminAuth(
  handler: (
    request: NextRequest,
    context: { params: Record<string, string> }
  ) => Promise<NextResponse>
) {
  return async (request: NextRequest, context: { params: Record<string, string> }) => {
    // Allow GET requests to public endpoints without auth
    if (request.method === 'GET' && request.nextUrl.pathname.includes('/api/public/')) {
      return handler(request, context);
    }

    // Verify admin auth for all other requests
    const authResult = await verifyAdminAuth(request);

    if (!authResult.authenticated) {
      return NextResponse.json(
        { error: authResult.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    // Attach user info to request for handler to use
    const requestWithAuth = request as any;
    requestWithAuth.admin = {
      userId: authResult.userId,
      profile: authResult.profile,
    };

    return handler(request, context);
  };
}

// ============================================================================
// PERMISSION CHECKS
// ============================================================================

export function hasPermission(profile: AdminProfile, permission: keyof AdminProfile): boolean {
  if (profile.role === 'superadmin') return true;
  if (profile.role === 'admin') {
    return profile[permission] === true;
  }
  return false;
}

export async function checkPermission(
  request: NextRequest,
  permission: 'can_edit_matches' | 'can_edit_goals' | 'can_edit_cards'
): Promise<{ allowed: boolean; error?: string }> {
  const authResult = await verifyAdminAuth(request);

  if (!authResult.authenticated || !authResult.profile) {
    return { allowed: false, error: 'Unauthorized' };
  }

  if (!hasPermission(authResult.profile, permission)) {
    return { allowed: false, error: 'Insufficient permissions' };
  }

  return { allowed: true };
}

// ============================================================================
// ERROR RESPONSES
// ============================================================================

export function unauthorizedResponse(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbiddenResponse(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function badRequestResponse(message = 'Bad request') {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFoundResponse(message = 'Not found') {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function internalErrorResponse(message = 'Internal server error') {
  console.error('API error:', message);
  return NextResponse.json({ error: message }, { status: 500 });
}

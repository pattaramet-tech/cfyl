import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Verify admin is authenticated
    const authResult = await verifyAdminAuth(request);

    if (!authResult.authenticated) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Return admin profile information
    return NextResponse.json(
      {
        authenticated: true,
        user: {
          id: authResult.userId,
          email: authResult.profile?.email,
          full_name: authResult.profile?.full_name,
          role: authResult.profile?.role,
        },
        permissions: {
          can_edit_matches: authResult.profile?.can_edit_matches,
          can_edit_goals: authResult.profile?.can_edit_goals,
          can_edit_cards: authResult.profile?.can_edit_cards,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Get current user error:', error);
    return NextResponse.json(
      { error: 'Failed to get user info' },
      { status: 500 }
    );
  }
}

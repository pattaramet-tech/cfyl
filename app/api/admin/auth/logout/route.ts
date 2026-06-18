import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Verify admin is authenticated
    const authResult = await verifyAdminAuth(request);

    if (!authResult.authenticated) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Note: JWT token validation is handled by client
    // Client will clear localStorage on receiving 200 response

    return NextResponse.json(
      { success: true, message: 'Logged out successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: 'Logout failed' },
      { status: 500 }
    );
  }
}

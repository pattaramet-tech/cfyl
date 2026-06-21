import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
import { recalculateSeasonSuspensions } from '@/lib/suspension-calc';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { seasonId, ageGroupId } = body;

    if (!seasonId || !ageGroupId) {
      return NextResponse.json(
        { error: 'seasonId and ageGroupId are required' },
        { status: 400 }
      );
    }

    console.log(
      `[RECALCULATE_ALL] Starting recalculation season=${seasonId} age_group=${ageGroupId}`
    );

    const result = await recalculateSeasonSuspensions(seasonId, ageGroupId);

    console.log(`[RECALCULATE_ALL] Done:`, result);

    await logAdminAction({
      admin: { id: authResult.profile!.id, email: authResult.profile!.email },
      action: 'suspension.recalculate',
      entityType: 'suspension',
      entityId: null,
      entityLabel: `season=${seasonId} age_group=${ageGroupId}`,
      newData: result,
    });

    return NextResponse.json({
      success: true,
      processed: result.processed,
      succeeded: result.success,
      failed: result.failed,
      message: `คำนวณใหม่สำเร็จ ${result.success}/${result.processed} ผู้เล่น${result.failed > 0 ? ` (ล้มเหลว ${result.failed})` : ''}`,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[RECALCULATE_ALL] Error:', errorMsg);
    return NextResponse.json(
      { error: `Recalculate failed: ${errorMsg}` },
      { status: 500 }
    );
  }
}

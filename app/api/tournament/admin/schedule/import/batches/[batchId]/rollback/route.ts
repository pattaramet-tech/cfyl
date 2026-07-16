import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';

export const dynamic = 'force-dynamic';

interface RollbackRpcResult {
  batchId: string;
  status: string;
  idempotent: boolean;
  revertedCreated?: number;
  revertedUpdated?: number;
}

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const { batchId } = await params;
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }
  if (!asText(batchId)) {
    return NextResponse.json({ error: 'batchId is required' }, { status: 400 });
  }

  try {
    const client = getTournamentServiceClient();

    // Runs entirely inside tournament.rollback_schedule_import_batch() — a single
    // Postgres transaction, all-or-nothing. See migration 013a for the full contract:
    // atomic saved -> rolling_back claim, a conflict-check pass over every Match this
    // batch touched (must be untouched since, must not have progressed past
    // scheduling), then either deletes (create rows) or restores the pre-import
    // snapshot (update rows), finalizes as rolled_back, and writes one audit log entry.
    const { data, error } = await client.rpc('rollback_schedule_import_batch', {
      p_batch_id: batchId,
      p_actor_id: auth.userId || null,
    });

    if (error) {
      const message = error.message || '';

      if (message.includes('SCHEDULE_ROLLBACK_BATCH_NOT_FOUND')) {
        return NextResponse.json({ error: 'ไม่พบ Import Batch' }, { status: 404 });
      }
      if (message.includes('SCHEDULE_ROLLBACK_NOT_ELIGIBLE')) {
        return NextResponse.json(
          { error: 'Import Batch นี้ไม่อยู่ในสถานะที่ Rollback ได้ (ต้องเป็นสถานะ saved)', code: 'SCHEDULE_ROLLBACK_NOT_ELIGIBLE' },
          { status: 409 }
        );
      }
      if (message.includes('SCHEDULE_ROLLBACK_CONFLICT')) {
        return NextResponse.json(
          {
            error: 'ไม่สามารถ Rollback ได้: มี Match ที่ถูกแก้ไขหรือมีผลการแข่งขันแล้วหลังจาก Import นี้',
            code: 'SCHEDULE_ROLLBACK_CONFLICT',
            detail: message,
          },
          { status: 409 }
        );
      }

      console.error('[SCHEDULE_IMPORT_ROLLBACK] rpc error:', message);
      return NextResponse.json({ error: 'เกิดข้อผิดพลาดระหว่าง Rollback ตารางแข่งขัน' }, { status: 500 });
    }

    return NextResponse.json({ data: data as RollbackRpcResult });
  } catch (err) {
    console.error('[SCHEDULE_IMPORT_ROLLBACK] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดระหว่าง Rollback ตารางแข่งขัน' }, { status: 500 });
  }
}

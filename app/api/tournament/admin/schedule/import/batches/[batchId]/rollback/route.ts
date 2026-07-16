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
  errorCode?: string;
  conflicts?: unknown[];
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
    // Postgres transaction, all-or-nothing. See migration 013b for the full contract:
    // atomic saved -> rolling_back claim; a lock + conflict-check pass over every Match
    // this batch touched (SELECT ... FOR UPDATE in deterministic matched_match_id
    // order — the lock is held for the rest of this transaction, so nothing can change
    // underneath the checks below); then either deletes (create rows) or restores the
    // pre-import snapshot (update rows), each conditioned on the exact expected
    // version/updated_at; finalizes as rolled_back and writes one audit log entry.
    //
    // A conflict is NOT a Postgres error — the RPC commits status='failed' +
    // rollback_failure_reason normally and returns a structured payload (migration
    // 013a raised an exception here instead, which rolled back that same status write
    // it had just made; fixed in 013b). `error` below is therefore reserved for
    // genuinely unexpected failures (batch not found, wrong status, internal anomalies).
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

      console.error('[SCHEDULE_IMPORT_ROLLBACK] rpc error:', message);
      return NextResponse.json({ error: 'เกิดข้อผิดพลาดระหว่าง Rollback ตารางแข่งขัน' }, { status: 500 });
    }

    const result = data as RollbackRpcResult;

    if (result.status === 'failed' && result.errorCode === 'SCHEDULE_ROLLBACK_CONFLICT') {
      return NextResponse.json(
        {
          error: 'ไม่สามารถ Rollback ได้: มี Match ที่ถูกแก้ไขหรือมีผลการแข่งขันแล้วหลังจาก Import นี้',
          code: 'SCHEDULE_ROLLBACK_CONFLICT',
          conflicts: result.conflicts,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[SCHEDULE_IMPORT_ROLLBACK] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดระหว่าง Rollback ตารางแข่งขัน' }, { status: 500 });
  }
}

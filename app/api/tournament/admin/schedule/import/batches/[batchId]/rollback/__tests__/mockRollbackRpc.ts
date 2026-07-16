/**
 * Faithful JS re-implementation of tournament.rollback_schedule_import_batch()
 * (scripts/tournament-v2/013b-schedule-rollback-concurrency-fix.sql), mirroring its
 * exact contract: atomic saved -> rolling_back claim (clearing any stale failure
 * diagnostics from a previous attempt), a lock + conflict-check pass over every row
 * this batch actually mutated (identified by applied_match_version being non-null,
 * processed in deterministic matched_match_id order), then either deleting (create
 * rows, before_payload null) or restoring the pre-import snapshot (update rows),
 * finalizing as rolled_back, and writing one audit log entry.
 *
 * IMPORTANT: on conflict, the real RPC does NOT raise — an unhandled Postgres exception
 * would roll back the status='failed' write it had just made (migration 013a's bug,
 * fixed in 013b). It commits the failed state normally and RETURNS a structured
 * payload. This mock must do the same — mutating state and then returning an `error`
 * (simulating a raised exception) would silently reintroduce that exact bug into the
 * test suite, since a real Postgres `error` from supabase-js means the whole
 * transaction was rolled back, which is true for SCHEDULE_ROLLBACK_BATCH_NOT_FOUND /
 * SCHEDULE_ROLLBACK_NOT_ELIGIBLE (no mutation precedes those raises) but must NOT be
 * true for the conflict case.
 *
 * Same role as the sibling Full Match Report PR's mockPublishRpc.ts: proves the JS-side
 * contract the route relies on. Real Postgres transactional/locking behavior is proven
 * separately by scripts/tournament-v2/verify-schedule-import-runtime.ts against Staging.
 */
type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

interface RollbackResult {
  batchId: string;
  status: string;
  idempotent: boolean;
  revertedCreated?: number;
  revertedUpdated?: number;
  errorCode?: string;
  conflicts?: Row[];
}

interface RollbackOutcome {
  data: RollbackResult | null;
  error: { message: string } | null;
}

export function mockRollbackRpc(db: Db, batchId: string, actorId: string | null): RollbackOutcome {
  const batches = db.tournament_schedule_batches || [];
  const batch = batches.find((b) => b.id === batchId);

  if (!batch) {
    return { data: null, error: { message: 'SCHEDULE_ROLLBACK_BATCH_NOT_FOUND' } };
  }

  if (batch.status !== 'saved') {
    if (batch.status === 'rolled_back') {
      return { data: { batchId, status: 'rolled_back', idempotent: true }, error: null };
    }
    return { data: null, error: { message: `SCHEDULE_ROLLBACK_NOT_ELIGIBLE: batch status is "${batch.status}"` } };
  }

  batch.status = 'rolling_back';
  // Clear stale diagnostics from an earlier failed attempt, matching 013b's claim UPDATE.
  batch.rollback_failure_reason = null;
  batch.failed_at = null;

  const rows = (db.tournament_schedule_import_rows || [])
    .filter((r) => r.batch_id === batchId && r.matched_match_id != null && r.applied_match_version != null)
    .sort((a, b) => String(a.matched_match_id).localeCompare(String(b.matched_match_id)));
  const matches = db.tournament_matches || [];

  const conflicts: Row[] = [];
  for (const row of rows) {
    const match = matches.find((m) => m.id === row.matched_match_id && !m.deleted_at);

    if (!match) {
      conflicts.push({ row: row.row_no, match_code: row.match_code, reason: 'MATCH_NOT_FOUND' });
      continue;
    }
    if (match.version !== row.applied_match_version || match.updated_at !== row.applied_match_updated_at) {
      conflicts.push({
        row: row.row_no,
        match_code: row.match_code,
        reason: 'MATCH_CHANGED_SINCE_IMPORT',
        expected_version: row.applied_match_version,
        current_version: match.version,
      });
      continue;
    }
    if (match.schedule_status === 'published') {
      conflicts.push({ row: row.row_no, match_code: row.match_code, reason: 'MATCH_CURRENTLY_PUBLISHED' });
      continue;
    }
    const resultWorkflowStatus = (match.result_workflow_status as string | undefined) ?? 'not_started';
    if (
      resultWorkflowStatus !== 'not_started' ||
      ['finished', 'in_progress'].includes(match.status as string) ||
      match.regulation_home_score != null ||
      match.regulation_away_score != null
    ) {
      conflicts.push({ row: row.row_no, match_code: row.match_code, reason: 'MATCH_RESULT_IN_PROGRESS' });
    }
  }

  if (conflicts.length > 0) {
    // Commits normally — no thrown/returned `error` here. A real Postgres `error`
    // means the transaction rolled back, which would undo this exact write.
    batch.status = 'failed';
    batch.rollback_failure_reason = JSON.stringify(conflicts);
    batch.failed_at = new Date().toISOString();
    return {
      data: { batchId, status: 'failed', idempotent: false, errorCode: 'SCHEDULE_ROLLBACK_CONFLICT', conflicts },
      error: null,
    };
  }

  let revertedCreated = 0;
  let revertedUpdated = 0;

  for (const row of rows) {
    if (row.before_payload == null) {
      const idx = matches.findIndex((m) => m.id === row.matched_match_id);
      if (idx >= 0) matches.splice(idx, 1);
      revertedCreated += 1;
    } else {
      // Restores updated_at/updated_by from the snapshot too, not a fresh now()/actor —
      // see the SQL migration's comment: this is what makes rolling back an earlier
      // batch (after a later one already touched the same Match) composable, since the
      // earlier batch's own applied_match_version/applied_match_updated_at must still
      // match after this restore.
      const match = matches.find((m) => m.id === row.matched_match_id);
      if (match) {
        Object.assign(match, row.before_payload as Row);
      }
      revertedUpdated += 1;
    }
  }

  batch.status = 'rolled_back';
  batch.rolled_back_at = new Date().toISOString();
  batch.rolled_back_by = actorId;

  const auditLogs = (db.tournament_audit_logs = db.tournament_audit_logs || []);
  auditLogs.push({
    id: `audit-${Math.random().toString(36).slice(2)}`,
    tournament_id: batch.tournament_id,
    admin_id: actorId,
    action: 'schedule.import.rollback',
    entity_type: 'schedule_batch',
    entity_id: batchId,
    entity_label: batch.file_name,
    new_data: { revertedCreated, revertedUpdated },
    created_at: new Date().toISOString(),
  });

  return {
    data: { batchId, status: 'rolled_back', idempotent: false, revertedCreated, revertedUpdated },
    error: null,
  };
}

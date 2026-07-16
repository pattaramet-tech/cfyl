import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(path.join(__dirname, '../013b-schedule-rollback-concurrency-fix.sql'), 'utf-8');
const sql013a = fs.readFileSync(path.join(__dirname, '../013a-schedule-import-save-result-and-rollback.sql'), 'utf-8');

// Static/textual checks only — this proves the SQL source text contains the statements
// the fixed RPC and the Rollback route depend on. It cannot prove real Postgres
// concurrency/locking behavior; that is proven separately by
// scripts/tournament-v2/verify-schedule-import-runtime.ts against CFYL-Tournament-Staging
// once the owner applies this migration there (both the conflict-persistence scenario
// and the real concurrent-race scenario using Promise.all).
describe('013b-schedule-rollback-concurrency-fix.sql (static)', () => {
  it('does not modify migration 013a retroactively', () => {
    // 013a's own rollback function still contains its original (buggy) shape — proves
    // 013b is a separate CREATE OR REPLACE, not an edit of the 013a file.
    expect(sql013a).toMatch(/raise exception 'SCHEDULE_ROLLBACK_CONFLICT: %', v_conflicts::text;/);
    expect(sql013a).not.toMatch(/for update/i);
    expect(sql013a).not.toMatch(/SCHEDULE_ROLLBACK_APPLY_MISMATCH/);
  });

  it('locks every matched Match with SELECT ... FOR UPDATE before checking or mutating', () => {
    expect(sql).toMatch(/select \* into v_match from tournament\.tournament_matches[\s\S]*?for update;/i);
  });

  it('acquires Match locks in deterministic matched_match_id order', () => {
    const lockOrderMatches = sql.match(/order by matched_match_id/gi) || [];
    // Both the lock/conflict-check pass and the apply pass iterate the same
    // deterministically-ordered query.
    expect(lockOrderMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('holds the lock for the whole transaction (no COMMIT/savepoint release between passes)', () => {
    // A literal COMMIT/RELEASE SAVEPOINT statement (not just the English word in a
    // comment) would end the lock early — plpgsql function bodies can't normally issue
    // either without special autonomous-transaction support, but assert it explicitly.
    expect(sql).not.toMatch(/^\s*commit\s*;/im);
    expect(sql).not.toMatch(/release savepoint/i);
  });

  it('does not raise after persisting the failed conflict state — returns instead', () => {
    const failedUpdateIndex = sql.indexOf("set status = 'failed', rollback_failure_reason");
    expect(failedUpdateIndex).toBeGreaterThan(-1);

    const afterFailedUpdate = sql.slice(failedUpdateIndex);
    const nextReturnIndex = afterFailedUpdate.indexOf('return jsonb_build_object');
    const nextRaiseIndex = afterFailedUpdate.search(/raise exception 'SCHEDULE_ROLLBACK_CONFLICT/i);

    expect(nextReturnIndex).toBeGreaterThan(-1);
    // No RAISE EXCEPTION for the conflict case must appear before the RETURN — that
    // exact ordering (update-then-raise) is migration 013a's bug.
    expect(nextRaiseIndex === -1 || nextReturnIndex < nextRaiseIndex).toBe(true);
  });

  it('returns a structured conflict payload with errorCode and conflicts', () => {
    expect(sql).toMatch(/'errorCode',\s*'SCHEDULE_ROLLBACK_CONFLICT'/);
    expect(sql).toMatch(/'conflicts',\s*v_conflicts/);
    expect(sql).toMatch(/'status',\s*'failed'/);
  });

  it('clears stale rollback_failure_reason/failed_at when a saved batch is claimed', () => {
    expect(sql).toMatch(/set status = 'rolling_back',\s*\n\s*rollback_failure_reason = null,\s*\n\s*failed_at = null/);
  });

  it('makes the create-action DELETE conditional on expected version and updated_at, and checks ROW_COUNT', () => {
    expect(sql).toMatch(
      /delete from tournament\.tournament_matches\s*\n\s*where id = v_row\.matched_match_id\s*\n\s*and version = v_row\.applied_match_version\s*\n\s*and updated_at = v_row\.applied_match_updated_at;/
    );
    expect(sql).toMatch(/get diagnostics v_affected = row_count;/i);
  });

  it('makes the update-action UPDATE conditional on expected version and updated_at, and checks ROW_COUNT', () => {
    expect(sql).toMatch(/where m\.id = v_row\.matched_match_id\s*\n\s*and m\.version = v_row\.applied_match_version\s*\n\s*and m\.updated_at = v_row\.applied_match_updated_at;/);
    const rowCountChecks = sql.match(/get diagnostics v_affected = row_count;/gi) || [];
    expect(rowCountChecks.length).toBe(2);
  });

  it('fails closed (raises) if an apply-pass ROW_COUNT does not match the expected single row', () => {
    expect(sql).toMatch(/if v_affected <> 1 then/g);
    expect(sql).toMatch(/raise exception 'SCHEDULE_ROLLBACK_APPLY_MISMATCH/);
  });

  it('still fails closed with a raised exception for genuinely unexpected states (batch not found / not eligible)', () => {
    expect(sql).toMatch(/raise exception 'SCHEDULE_ROLLBACK_BATCH_NOT_FOUND'/);
    expect(sql).toMatch(/raise exception 'SCHEDULE_ROLLBACK_NOT_ELIGIBLE/);
  });

  it('defines the rollback RPC as SECURITY DEFINER with a pinned search_path, service_role-only execute', () => {
    expect(sql).toMatch(/create or replace function tournament\.rollback_schedule_import_batch/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = tournament, pg_temp/i);
    expect(sql).toMatch(/revoke all on function tournament\.rollback_schedule_import_batch\(uuid, uuid\) from public/i);
    expect(sql).toMatch(/grant execute on function tournament\.rollback_schedule_import_batch\(uuid, uuid\) to service_role/i);
    expect(sql).not.toMatch(/grant execute on function tournament\.rollback_schedule_import_batch.*to (anon|authenticated)/i);
  });

  it('does not add or alter any columns — function replacement only', () => {
    expect(sql).not.toMatch(/alter table/i);
  });
});

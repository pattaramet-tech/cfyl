import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(
  path.join(__dirname, '../013a-schedule-import-save-result-and-rollback.sql'),
  'utf-8'
);

// Static/textual checks only — this proves the SQL source text contains the statements
// the Save route and Rollback route depend on. It cannot prove real Postgres behavior;
// that is proven separately by scripts/tournament-v2/verify-schedule-import-runtime.ts
// against CFYL-Tournament-Staging once the owner applies this migration there.
describe('013a-schedule-import-save-result-and-rollback.sql (static)', () => {
  it('adds tournament_schedule_batches.save_result', () => {
    expect(sql).toMatch(/add column if not exists save_result jsonb/i);
  });

  it('extends the batch status constraint to include rolling_back', () => {
    expect(sql).toMatch(/check \(status in \('preview', 'saving', 'saved', 'failed', 'rolling_back', 'rolled_back'\)\)/);
  });

  it('adds tournament_schedule_batches.rollback_failure_reason', () => {
    expect(sql).toMatch(/add column if not exists rollback_failure_reason text/i);
  });

  it('adds the three tournament_schedule_import_rows snapshot columns', () => {
    expect(sql).toMatch(/add column if not exists before_payload jsonb/i);
    expect(sql).toMatch(/add column if not exists applied_match_version int/i);
    expect(sql).toMatch(/add column if not exists applied_match_updated_at timestamptz/i);
  });

  it('defines the rollback RPC as SECURITY DEFINER with a pinned search_path', () => {
    expect(sql).toMatch(/create or replace function tournament\.rollback_schedule_import_batch/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = tournament, pg_temp/i);
  });

  it('grants execute only to service_role, revoking from public first', () => {
    expect(sql).toMatch(/revoke all on function tournament\.rollback_schedule_import_batch\(uuid, uuid\) from public/i);
    expect(sql).toMatch(/grant execute on function tournament\.rollback_schedule_import_batch\(uuid, uuid\) to service_role/i);
    expect(sql).not.toMatch(/grant execute on function tournament\.rollback_schedule_import_batch.*to (anon|authenticated)/i);
  });

  it('atomically claims saved -> rolling_back before doing anything else', () => {
    expect(sql).toMatch(/set status = 'rolling_back'[\s\S]*where id = p_batch_id[\s\S]*and status = 'saved'/i);
  });

  it('checks version and updated_at drift before mutating anything', () => {
    expect(sql).toMatch(/v_match\.version is distinct from v_row\.applied_match_version/);
    expect(sql).toMatch(/v_match\.updated_at is distinct from v_row\.applied_match_updated_at/);
  });

  it('blocks rollback of a currently published or result-entered match', () => {
    expect(sql).toMatch(/MATCH_CURRENTLY_PUBLISHED/);
    expect(sql).toMatch(/MATCH_RESULT_IN_PROGRESS/);
  });

  it('does not modify migration 013 retroactively', () => {
    const migration013 = fs.readFileSync(path.join(__dirname, '../013-schedule-batch-atomic-save.sql'), 'utf-8');
    expect(migration013).not.toMatch(/save_result/);
    expect(migration013).not.toMatch(/rolling_back/);
  });
});

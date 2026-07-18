import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Static/textual review of Migration 018 — the atomic score-only Result
// Correction RPC. These tests prove structural properties of the SQL source
// text; they do NOT prove the function actually executes correctly against a
// live Postgres instance — that requires the owner applying Migration 018 to
// CFYL-Tournament-Staging and running
// scripts/tournament-v2/verify-result-correction-runtime.ts, neither of
// which has happened yet (see this PR's description).
//
// readSource() strips \r so these \n-anchored regexes are correct
// regardless of the checking-out machine's line-ending settings (Windows
// core.autocrlf=true converts LF -> CRLF on checkout).
const repoRoot = join(__dirname, '..', '..', '..', '..');

function readSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf-8').replace(/\r\n/g, '\n');
}

const MIGRATION_PATH = 'scripts/tournament-v2/018-score-only-result-correction.sql';

describe('Migration 018 — static structural review', () => {
  it('defines the tournament.correct_published_match_result function', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/create or replace function tournament\.correct_published_match_result\(/);
    expect(source).toMatch(/language plpgsql/);
  });

  it('sets an explicit, safe search_path', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/set search_path = tournament, pg_temp/);
  });

  it('is marked security definer', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/security definer/);
  });

  it('revokes broad execute permissions and grants only service_role', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/revoke all on function tournament\.correct_published_match_result\([\s\S]*?\) from public;/);
    expect(source).toMatch(/revoke all on function tournament\.correct_published_match_result\([\s\S]*?\) from anon;/);
    expect(source).toMatch(/revoke all on function tournament\.correct_published_match_result\([\s\S]*?\) from authenticated;/);
    expect(source).toMatch(/grant execute on function tournament\.correct_published_match_result\([\s\S]*?\) to service_role;/);
  });

  it('widens tournament_result_submissions.stage to allow correction, without touching any other old migration', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/alter table tournament\.tournament_result_submissions/);
    expect(source).toMatch(/add constraint tournament_result_submissions_stage_check/);
    expect(source).toMatch(/check \(stage in \('quick_result', 'full_report', 'correction'\)\)/);
    expect(source).not.toMatch(/create table/i);
  });

  it('performs the row lock, idempotency check, and every required write inside the single function body (between $$ ... $$)', () => {
    const source = readSource(MIGRATION_PATH);
    const bodyMatch = source.match(/as \$\$([\s\S]*?)\$\$;/);
    expect(bodyMatch).not.toBeNull();
    const body = bodyMatch ? bodyMatch[1] : '';

    expect(body).toMatch(/for update/);
    expect(body).toMatch(/idempotency_key = p_idempotency_key/);
    expect(body).toMatch(/p_expected_version/);

    expect(body).toContain('RESULT_CORRECTION_NOT_PUBLISHED');
    expect(body).toContain('RESULT_CORRECTION_MATCH_DELETED');
    expect(body).toContain('RESULT_CORRECTION_VERSION_CONFLICT');
    expect(body).toContain('RESULT_CORRECTION_REASON_REQUIRED');
    expect(body).toContain('RESULT_CORRECTION_NO_CHANGES');

    expect(body).toMatch(/insert into tournament\.tournament_result_submissions/);
    expect(body).toMatch(/insert into tournament\.tournament_result_versions/);
    expect(body).toMatch(/insert into tournament\.tournament_result_approvals/);
    expect(body).toMatch(/update tournament\.tournament_matches/);
    expect(body).toMatch(/version = version \+ 1/);
    expect(body).toMatch(/insert into tournament\.tournament_audit_logs/);
  });

  it('locks the match row (FOR UPDATE) BEFORE checking idempotency', () => {
    const source = readSource(MIGRATION_PATH);
    const bodyMatch = source.match(/as \$\$([\s\S]*?)\$\$;/);
    const body = bodyMatch ? bodyMatch[1] : '';
    const lockIndex = body.indexOf('for update');
    const idempotencyCheckIndex = body.indexOf('idempotency_key = p_idempotency_key');
    expect(lockIndex).toBeGreaterThan(-1);
    expect(idempotencyCheckIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeLessThan(idempotencyCheckIndex);
  });

  it('checks idempotency BEFORE the not-yet-published guard and BEFORE the version/reason/result-consistency checks', () => {
    const source = readSource(MIGRATION_PATH);
    const bodyMatch = source.match(/as \$\$([\s\S]*?)\$\$;/);
    const body = bodyMatch ? bodyMatch[1] : '';
    const idempotencyReturnIndex = body.indexOf("'idempotent', true");
    const notPublishedGuardIndex = body.indexOf("v_match.result_workflow_status <> 'published'");
    const versionGuardIndex = body.indexOf('RESULT_CORRECTION_VERSION_CONFLICT');
    const reasonGuardIndex = body.indexOf('RESULT_CORRECTION_REASON_REQUIRED');
    const noChangeGuardIndex = body.indexOf('RESULT_CORRECTION_NO_CHANGES');
    expect(idempotencyReturnIndex).toBeGreaterThan(-1);
    expect(idempotencyReturnIndex).toBeLessThan(notPublishedGuardIndex);
    expect(idempotencyReturnIndex).toBeLessThan(versionGuardIndex);
    expect(idempotencyReturnIndex).toBeLessThan(reasonGuardIndex);
    expect(idempotencyReturnIndex).toBeLessThan(noChangeGuardIndex);
  });

  it('has no old_data/new_data/p_payload parameter — the stored/idempotency/audit payloads are built by the function itself from validated parameters and the locked row', () => {
    const source = readSource(MIGRATION_PATH);
    const paramListMatch = source.match(/create or replace function tournament\.correct_published_match_result\(([\s\S]*?)\)\nreturns jsonb/);
    expect(paramListMatch).not.toBeNull();
    const paramList = paramListMatch ? paramListMatch[1] : '';
    expect(paramList).not.toMatch(/^\s*p_payload\s/m);
    expect(paramList).not.toMatch(/^\s*p_old_data\s/m);
    expect(paramList).not.toMatch(/^\s*p_new_data\s/m);
    expect(paramList).not.toMatch(/^\s*p_audit\s/m);
    expect(source).toMatch(/v_new_payload := jsonb_build_object/);
    expect(source).toMatch(/v_before_payload := jsonb_build_object/);
  });

  it('never references tournament_match_goals, tournament_match_cards, tournament_match_reports, or a quick_result stage anywhere in the function body', () => {
    const source = readSource(MIGRATION_PATH);
    const bodyMatch = source.match(/as \$\$([\s\S]*?)\$\$;/);
    const body = bodyMatch ? bodyMatch[1] : '';
    expect(body).not.toMatch(/tournament_match_goals/);
    expect(body).not.toMatch(/tournament_match_cards/);
    expect(body).not.toMatch(/tournament_match_reports/);
    expect(body).not.toMatch(/'quick_result'/);
  });

  it('never updates result_workflow_status or status — the match stays published/finished throughout', () => {
    const source = readSource(MIGRATION_PATH);
    const updateMatch = source.match(/update tournament\.tournament_matches[\s\S]*?where id = p_match_id/);
    expect(updateMatch).not.toBeNull();
    const updateStatement = updateMatch ? updateMatch[0] : '';
    expect(updateStatement).not.toMatch(/result_workflow_status\s*=/);
    expect(updateStatement).not.toMatch(/\bstatus\s*=/);
  });

  it('never updates or deletes an existing tournament_result_submissions or tournament_result_versions row — only inserts', () => {
    const source = readSource(MIGRATION_PATH);
    const bodyMatch = source.match(/as \$\$([\s\S]*?)\$\$;/);
    const body = bodyMatch ? bodyMatch[1] : '';
    expect(body).not.toMatch(/update tournament\.tournament_result_submissions/);
    expect(body).not.toMatch(/update tournament\.tournament_result_versions/);
    expect(body).not.toMatch(/delete from tournament\.tournament_result_submissions/);
    expect(body).not.toMatch(/delete from tournament\.tournament_result_versions/);
  });

  it('the D-09 result-consistency invariant is enforced inside the transaction (defense-in-depth)', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toContain('RESULT_CORRECTION_RESULT_INCONSISTENT');
    expect(source).toContain('RESULT_CORRECTION_WINNER_TEAM_INVALID');
    expect(source).toContain('RESULT_CORRECTION_RESULT_TYPE_INCONSISTENT');
  });

  it('the no-change guard compares against the LOCKED row, never a caller-supplied "previous result" argument', () => {
    const source = readSource(MIGRATION_PATH);
    const paramListMatch = source.match(/create or replace function tournament\.correct_published_match_result\(([\s\S]*?)\)\nreturns jsonb/);
    const paramList = paramListMatch ? paramListMatch[1] : '';
    expect(paramList).not.toMatch(/p_expected_prior|p_previous_/);
    expect(source).toMatch(/v_match\.regulation_home_score = p_regulation_home_score/);
  });

  it('has no exception handler that could swallow a write failure (no "exception when" block)', () => {
    const source = readSource(MIGRATION_PATH);
    const bodyMatch = source.match(/as \$\$([\s\S]*?)\$\$;/);
    const body = bodyMatch ? bodyMatch[1] : '';
    expect(body).not.toMatch(/exception\s+when/i);
  });

  it('is marked as a draft, not applied, in its own header comment', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/STATUS: DRAFT/);
    expect(source).toMatch(/NOT applied/);
  });
});

describe('No non-transactional Result Correction fallback exists in the API/service layer', () => {
  it('the result correction service calls the RPC and does not sequentially write match fields itself', () => {
    const source = readSource('lib/tournament/services/resultCorrection.ts');
    expect(source).toMatch(/\.rpc\(\s*['"]correct_published_match_result['"]/);
    expect(source).not.toMatch(/\.from\(['"]tournament_matches['"]\)\s*\.\s*update/);
  });

  it('fails closed with RESULT_CORRECTION_RPC_UNAVAILABLE when the RPC is missing, rather than falling back to sequential writes', () => {
    const source = readSource('lib/tournament/services/resultCorrection.ts');
    expect(source).toContain('RESULT_CORRECTION_RPC_UNAVAILABLE');
  });

  it('the result correction service never queries or mutates goals, cards, report text, or Quick Result tables (comments mentioning them by name for documentation purposes are fine)', () => {
    const source = readSource('lib/tournament/services/resultCorrection.ts');
    expect(source).not.toMatch(/\.from\(['"]tournament_match_goals['"]\)/);
    expect(source).not.toMatch(/\.from\(['"]tournament_match_cards['"]\)/);
    expect(source).not.toMatch(/\.from\(['"]tournament_match_reports['"]\)/);
    expect(source).not.toMatch(/\.from\(['"]tournament_result_submissions['"]\)\s*\.\s*(insert|update|upsert)/);
  });
});

describe('README migration run order', () => {
  it('lists Migration 018 after Migration 014, and documents it as not yet applied anywhere', () => {
    const source = readSource('scripts/tournament-v2/README.md');
    expect(source).toContain('014-full-result-publish-transaction.sql');
    expect(source).toContain('018-score-only-result-correction.sql');
    const index014 = source.indexOf('014-full-result-publish-transaction.sql');
    const index018 = source.indexOf('018-score-only-result-correction.sql');
    expect(index014).toBeGreaterThan(-1);
    expect(index018).toBeGreaterThan(index014);
    expect(source).toMatch(/Migration 018[\s\S]{0,400}(not (yet )?(been )?applied|has not been applied)/i);
  });
});

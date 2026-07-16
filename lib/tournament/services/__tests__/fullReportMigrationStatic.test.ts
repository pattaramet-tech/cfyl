import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Static/textual review of Migration 014 — the atomic Official Publish RPC.
// Per task instructions, this migration is a DRAFT: reviewed statically
// only, never applied to any environment (Staging or Production) during
// this PR. These tests prove structural properties of the SQL source text;
// they do NOT prove the function actually executes correctly against a
// live Postgres instance — that would require applying it to an isolated,
// disposable database, which was not done here (see the PR's final report).

const repoRoot = join(__dirname, '..', '..', '..', '..');

function readSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf-8');
}

const MIGRATION_PATH = 'scripts/tournament-v2/014-full-result-publish-transaction.sql';

describe('Migration 014 — static structural review (draft, not applied)', () => {
  it('defines the tournament.publish_full_match_report function', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/create or replace function tournament\.publish_full_match_report\(/);
    expect(source).toMatch(/language plpgsql/);
  });

  it('sets an explicit, safe search_path', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/set search_path = tournament, pg_temp/);
  });

  it('revokes broad execute permissions and grants only service_role', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/revoke all on function tournament\.publish_full_match_report\([\s\S]*?\) from public;/);
    expect(source).toMatch(/revoke all on function tournament\.publish_full_match_report\([\s\S]*?\) from anon;/);
    expect(source).toMatch(/revoke all on function tournament\.publish_full_match_report\([\s\S]*?\) from authenticated;/);
    expect(source).toMatch(/grant execute on function tournament\.publish_full_match_report\([\s\S]*?\) to service_role;/);
  });

  it('performs the idempotency check, row lock, and every required write inside the single function body (between $$ ... $$)', () => {
    const source = readSource(MIGRATION_PATH);
    const bodyMatch = source.match(/as \$\$([\s\S]*?)\$\$;/);
    expect(bodyMatch).not.toBeNull();
    const body = bodyMatch ? bodyMatch[1] : '';

    // Idempotency (step 4) and row lock/version claim (step 1).
    expect(body).toMatch(/idempotency_key = p_idempotency_key/);
    expect(body).toMatch(/for update/);
    expect(body).toMatch(/p_expected_version/);

    // Eligibility + already-published guard (steps 2-3).
    expect(body).toContain('FULL_REPORT_ALREADY_PUBLISHED_USE_CORRECTION');
    expect(body).toContain('FULL_REPORT_MATCH_DELETED');
    expect(body).toContain('FULL_REPORT_MATCH_STATUS_INELIGIBLE');
    expect(body).toContain('FULL_REPORT_TEAM_UNRESOLVED');
    expect(body).toContain('FULL_REPORT_VERSION_CONFLICT');

    // Steps 5-11: submission, result version, goals, cards, report, match
    // fields, audit log — all inside this same function body.
    expect(body).toMatch(/insert into tournament\.tournament_result_submissions/);
    expect(body).toMatch(/insert into tournament\.tournament_result_versions/);
    expect(body).toMatch(/insert into tournament\.tournament_match_goals/);
    expect(body).toMatch(/insert into tournament\.tournament_match_cards/);
    expect(body).toMatch(/insert into tournament\.tournament_match_reports/);
    expect(body).toMatch(/update tournament\.tournament_matches/);
    expect(body).toMatch(/result_workflow_status = 'published'/);
    expect(body).toMatch(/status = 'finished'/);
    expect(body).toMatch(/version = version \+ 1/);
    expect(body).toMatch(/insert into tournament\.tournament_audit_logs/);
  });

  it('never inserts penalty-shootout data into tournament_match_goals', () => {
    const source = readSource(MIGRATION_PATH);
    const goalsInsertMatch = source.match(/insert into tournament\.tournament_match_goals[\s\S]*?\);/);
    expect(goalsInsertMatch).not.toBeNull();
    expect(goalsInsertMatch ? goalsInsertMatch[0] : '').not.toMatch(/penalty/i);
  });

  it('does not create a duplicate result/goal/card/report/audit table', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).not.toMatch(/create table/i);
  });

  it('the D-09 result-consistency invariant is enforced a second time inside the transaction (defense-in-depth)', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toContain('FULL_REPORT_RESULT_INCONSISTENT');
    expect(source).toContain('FULL_REPORT_WINNER_TEAM_INVALID');
  });

  it('is marked as a draft, not applied, in its own header comment', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/STATUS: DRAFT/);
    expect(source).toMatch(/NOT applied/);
  });
});

describe('No non-transactional Official Publish fallback exists in the API/service layer', () => {
  it('the full match report service calls the RPC and does not sequentially write goals/cards/report/match fields itself', () => {
    const source = readSource('lib/tournament/services/fullMatchReport.ts');
    expect(source).toMatch(/\.rpc\(\s*['"]publish_full_match_report['"]/);
    // Must not contain a second, independent sequential-write code path for
    // the same official publish mutation (goals/cards/report/match-update)
    // outside of building the RPC's input payload.
    expect(source).not.toMatch(/\.from\(['"]tournament_match_goals['"]\)\s*\.\s*insert/);
    expect(source).not.toMatch(/\.from\(['"]tournament_match_cards['"]\)\s*\.\s*insert/);
    expect(source).not.toMatch(/\.from\(['"]tournament_match_reports['"]\)\s*\.\s*insert/);
  });

  it('fails closed with FULL_REPORT_PUBLISH_RPC_UNAVAILABLE when the RPC is missing, rather than falling back to sequential writes', () => {
    const source = readSource('lib/tournament/services/fullMatchReport.ts');
    expect(source).toContain('FULL_REPORT_PUBLISH_RPC_UNAVAILABLE');
  });
});

describe('README migration run order', () => {
  it('lists migrations 001 through 014 in order, including 013 and 014', () => {
    const source = readSource('scripts/tournament-v2/README.md');
    expect(source).toContain('013-schedule-batch-atomic-save.sql');
    expect(source).toContain('014-full-result-publish-transaction.sql');
    const index013 = source.indexOf('013-schedule-batch-atomic-save.sql');
    const index014 = source.indexOf('014-full-result-publish-transaction.sql');
    expect(index013).toBeGreaterThan(-1);
    expect(index014).toBeGreaterThan(index013);
  });

  it('states that 012/013/014 have not been applied during this task and Staging comes before Production', () => {
    const source = readSource('scripts/tournament-v2/README.md');
    expect(source.toLowerCase()).toMatch(/staging/);
    expect(source).toMatch(/not (been )?applied/i);
  });
});

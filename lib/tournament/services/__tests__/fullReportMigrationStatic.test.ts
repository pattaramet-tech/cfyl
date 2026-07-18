import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Static/textual review of Migration 014 — the atomic Official Publish RPC.
// These tests prove structural properties of the SQL source text; they do
// NOT prove the function actually executes correctly against a live
// Postgres instance — that is proven separately by
// scripts/tournament-v2/verify-full-report-runtime.ts, which the owner has
// since run against CFYL-Tournament-Staging (all 10 scenarios passed — see
// scripts/tournament-v2/README.md "Migration 014 runtime verification").
//
// readSource() strips \r so these \n-anchored regexes are correct
// regardless of the checking-out machine's line-ending settings
// (Windows core.autocrlf=true converts LF -> CRLF on checkout, which would
// otherwise silently break every literal \n pattern below without
// reflecting any real change to the SQL/doc content itself).
const repoRoot = join(__dirname, '..', '..', '..', '..');

function readSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf-8').replace(/\r\n/g, '\n');
}

const MIGRATION_PATH = 'scripts/tournament-v2/014-full-result-publish-transaction.sql';

describe('Migration 014 — static structural review', () => {
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

  it('locks the match row (FOR UPDATE) BEFORE checking idempotency — not the other way around', () => {
    const source = readSource(MIGRATION_PATH);
    const bodyMatch = source.match(/as \$\$([\s\S]*?)\$\$;/);
    const body = bodyMatch ? bodyMatch[1] : '';
    const lockIndex = body.indexOf('for update');
    const idempotencyCheckIndex = body.indexOf('idempotency_key = p_idempotency_key');
    expect(lockIndex).toBeGreaterThan(-1);
    expect(idempotencyCheckIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeLessThan(idempotencyCheckIndex);
  });

  it('checks idempotency BEFORE the already-published guard, so a same-key retry succeeds even though the match is now published', () => {
    const source = readSource(MIGRATION_PATH);
    const bodyMatch = source.match(/as \$\$([\s\S]*?)\$\$;/);
    const body = bodyMatch ? bodyMatch[1] : '';
    const idempotencyReturnIndex = body.indexOf("'idempotent', true");
    // The already-published RAISE (the actual guard in the function body,
    // not any mention of the error code in a comment) always follows "if
    // v_match.result_workflow_status = 'published' then".
    const alreadyPublishedGuardIndex = body.indexOf("v_match.result_workflow_status = 'published'");
    expect(idempotencyReturnIndex).toBeGreaterThan(-1);
    expect(alreadyPublishedGuardIndex).toBeGreaterThan(-1);
    expect(idempotencyReturnIndex).toBeLessThan(alreadyPublishedGuardIndex);
  });

  it('has no p_payload parameter — the stored/idempotency payload is built by the function itself from validated parameters', () => {
    const source = readSource(MIGRATION_PATH);
    // Extract just the CREATE FUNCTION parameter list, not the whole file —
    // the header/revision-note comments legitimately discuss "p_payload" as
    // the name of the parameter a PRIOR draft used to have and explain why
    // it was removed, so a whole-file substring check would false-positive.
    const paramListMatch = source.match(/create or replace function tournament\.publish_full_match_report\(([\s\S]*?)\)\nreturns jsonb/);
    expect(paramListMatch).not.toBeNull();
    const paramList = paramListMatch ? paramListMatch[1] : '';
    expect(paramList).not.toMatch(/^\s*p_payload\s/m);
    expect(source).toMatch(/v_canonical_payload := jsonb_build_object/);
    expect(source).toMatch(/tournament_result_submissions[\s\S]*?v_canonical_payload/);
  });

  it('validates result_type consistency with decided_by, not just decided_by/penalty-field presence', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toContain('FULL_REPORT_RESULT_TYPE_INCONSISTENT');
    expect(source).toMatch(/p_result_type <> 'normal'/);
    expect(source).toMatch(/p_result_type <> 'penalty_decided'/);
  });

  it('validates penalty scores are non-negative inside the transaction', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/p_penalty_home_score < 0 or p_penalty_away_score < 0/);
  });

  it('validates goal event scope (team, player tournament/category/team, minute, count) inside the transaction', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toContain('FULL_REPORT_GOAL_TEAM_INVALID');
    expect(source).toContain('FULL_REPORT_GOAL_PLAYER_NOT_FOUND');
    expect(source).toContain('FULL_REPORT_GOAL_PLAYER_DELETED');
    expect(source).toContain('FULL_REPORT_GOAL_PLAYER_TOURNAMENT_MISMATCH');
    expect(source).toContain('FULL_REPORT_GOAL_PLAYER_CATEGORY_MISMATCH');
    expect(source).toContain('FULL_REPORT_GOAL_PLAYER_TEAM_MISMATCH');
    expect(source).toContain('FULL_REPORT_GOAL_COUNT_INVALID');
    expect(source).toContain('FULL_REPORT_GOAL_MINUTE_INVALID');
  });

  it('validates card event scope (team, player tournament/category/team, type, minute, duplicates) inside the transaction', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toContain('FULL_REPORT_CARD_TEAM_INVALID');
    expect(source).toContain('FULL_REPORT_CARD_PLAYER_REQUIRED');
    expect(source).toContain('FULL_REPORT_CARD_PLAYER_NOT_FOUND');
    expect(source).toContain('FULL_REPORT_CARD_PLAYER_DELETED');
    expect(source).toContain('FULL_REPORT_CARD_PLAYER_TOURNAMENT_MISMATCH');
    expect(source).toContain('FULL_REPORT_CARD_PLAYER_CATEGORY_MISMATCH');
    expect(source).toContain('FULL_REPORT_CARD_PLAYER_TEAM_MISMATCH');
    expect(source).toContain('FULL_REPORT_CARD_TYPE_INVALID');
    expect(source).toContain('FULL_REPORT_CARD_MINUTE_INVALID');
    expect(source).toContain('FULL_REPORT_DUPLICATE_CARD');
  });

  it('skips the team-match check for own-goal events (documented, unresolved ambiguity) without weakening non-own-goal validation', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/not v_goal_is_own and v_player\.team_id <> v_goal_team_id/);
    expect(source).toMatch(/OWN-GOAL AMBIGUITY/);
  });

  it('does not perform goal-total-to-score reconciliation anywhere', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).not.toMatch(/sum\(.*goals.*\)\s*=\s*p_regulation/i);
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

  it('states that Migration 014 is applied to Staging, not Production, and documents the Staging-first policy', () => {
    const source = readSource('scripts/tournament-v2/README.md');
    expect(source.toLowerCase()).toMatch(/staging/);
    expect(source).toMatch(/CFYL-Tournament-Staging/);
    expect(source).toMatch(/Migration 014 is\s+(also\s+)?applied to\s*`?CFYL-Tournament-Staging/);
    // Production must never be silently reported as done — "None of ... have
    // been applied to Production" is this doc's own established phrasing for
    // that (see the identical construction already used for 001–013b above).
    expect(source).toMatch(/None of 001.*have been applied\s*\n?\s*to Production/);
  });
});

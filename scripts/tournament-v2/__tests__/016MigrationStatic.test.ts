import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(path.join(__dirname, '../016-quick-result-atomic-submit.sql'), 'utf-8');

// Static/textual checks only — this proves the SQL source text contains the
// statements the atomic RPC and the Submit route depend on. It cannot prove
// real Postgres locking/transaction behavior; that is proven separately by
// scripts/tournament-v2/verify-quick-result-runtime.ts against
// CFYL-Tournament-Staging once the owner applies this migration there.
describe('016-quick-result-atomic-submit.sql (static)', () => {
  it('does not rename or modify migration 014 (Full Match Report) or 015 (Qualification Draw)', () => {
    expect(sql).not.toMatch(/014-/);
    // May reference 015's function by name in an explanatory comment (as
    // prior-art context), but must never define/replace/drop it itself.
    expect(sql).not.toMatch(/create or replace function tournament\.save_qualification_draw_assignment/);
    expect(sql).not.toMatch(/drop function/i);
  });

  it('does not add or alter any columns or tables — function replacement only', () => {
    expect(sql).not.toMatch(/alter table/i);
    expect(sql).not.toMatch(/create table/i);
  });

  it('defines the RPC as SECURITY DEFINER with a pinned search_path, service_role-only execute', () => {
    expect(sql).toMatch(/create or replace function tournament\.submit_quick_result/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = tournament, pg_temp/i);
    expect(sql).toMatch(/revoke all on function tournament\.submit_quick_result.*from public/i);
    expect(sql).toMatch(/revoke execute on function tournament\.submit_quick_result.*from anon/i);
    expect(sql).toMatch(/revoke execute on function tournament\.submit_quick_result.*from authenticated/i);
    expect(sql).toMatch(/grant execute on function tournament\.submit_quick_result.*to service_role/i);
  });

  it('locks the Match with SELECT ... FOR UPDATE before any write', () => {
    const lockIndex = sql.search(/select \* into v_match\s*\n\s*from tournament\.tournament_matches\s*\n\s*where id = p_match_id\s*\n\s*for update;/i);
    expect(lockIndex).toBeGreaterThan(-1);

    const beforeLock = sql.slice(0, lockIndex);
    expect(beforeLock).not.toMatch(/^\s*(insert|update|delete)\s+(into\s+)?tournament\./im);
  });

  it('checks idempotency only AFTER the Match lock is acquired', () => {
    const lockIndex = sql.indexOf('for update;');
    const idempotencyCheckIndex = sql.indexOf('select * into v_existing');
    expect(lockIndex).toBeGreaterThan(-1);
    expect(idempotencyCheckIndex).toBeGreaterThan(lockIndex);
  });

  it('builds the canonical payload inside the function from primitive parameters, not a caller-supplied payload', () => {
    expect(sql).toMatch(/v_canonical_payload\s*:=\s*jsonb_build_object\(/);
    expect(sql).toMatch(/'home_score',\s*p_home_score/);
    expect(sql).toMatch(/'away_score',\s*p_away_score/);
    expect(sql).toMatch(/'venue_id',\s*p_venue_id/);
    expect(sql).toMatch(/'match_version_before',\s*p_expected_version/);
    expect(sql).toMatch(/'session_id',\s*p_session_id/);
    expect(sql).toMatch(/'device_metadata',\s*coalesce\(p_device_metadata/);
    // No jsonb parameter accepting an entire caller-built payload exists.
    expect(sql).not.toMatch(/p_payload\s+jsonb/);
  });

  it('rejects a payload-mismatched idempotency key before any write, and returns idempotent success without re-writing on a match', () => {
    const idempotencyCheckIndex = sql.indexOf('select * into v_existing');
    const mismatchIndex = sql.indexOf('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
    const firstWriteIndex = sql.search(/update tournament\.tournament_matches\s*\n\s*set version/i);
    expect(idempotencyCheckIndex).toBeGreaterThan(-1);
    expect(mismatchIndex).toBeGreaterThan(idempotencyCheckIndex);
    expect(mismatchIndex).toBeLessThan(firstWriteIndex);
    expect(sql).toMatch(/'idempotent',\s*true/);
  });

  it('validates the conditional expected-version check before any write, using QUICK_RESULT_VERSION_CONFLICT', () => {
    const versionCheckIndex = sql.indexOf('QUICK_RESULT_VERSION_CONFLICT');
    const firstWriteIndex = sql.search(/update tournament\.tournament_matches\s*\n\s*set version/i);
    expect(versionCheckIndex).toBeGreaterThan(-1);
    expect(versionCheckIndex).toBeLessThan(firstWriteIndex);
    expect(sql).toMatch(/v_match\.version <> p_expected_version/);
  });

  it('performs the version claim, submission insert, result-version insert, and audit insert all inside this one function', () => {
    const claimIndex = sql.search(/update tournament\.tournament_matches\s*\n\s*set version/i);
    const submissionIndex = sql.indexOf('insert into tournament.tournament_result_submissions');
    const resultVersionIndex = sql.indexOf('insert into tournament.tournament_result_versions');
    const auditIndex = sql.indexOf('insert into tournament.tournament_audit_logs');

    expect(claimIndex).toBeGreaterThan(-1);
    expect(submissionIndex).toBeGreaterThan(claimIndex);
    expect(resultVersionIndex).toBeGreaterThan(submissionIndex);
    expect(auditIndex).toBeGreaterThan(resultVersionIndex);
    expect(sql).toMatch(/'tournament\.quick_result\.submit'/);
    expect(sql).not.toMatch(/perform\s+tournament\./i);
  });

  it('the Match UPDATE never touches official-result, source, schedule, standings, or bracket fields', () => {
    const updateStart = sql.search(/update tournament\.tournament_matches\s*\n\s*set version/i);
    const updateEnd = sql.indexOf('where id = p_match_id', updateStart);
    expect(updateStart).toBeGreaterThan(-1);
    expect(updateEnd).toBeGreaterThan(updateStart);
    const updateClause = sql.slice(updateStart, updateEnd);

    expect(updateClause).toMatch(/version\s*=\s*p_expected_version \+ 1/);
    expect(updateClause).toMatch(/updated_by\s*=\s*p_actor_id/);
    expect(updateClause).toMatch(/updated_at\s*=\s*v_now/);
    expect(updateClause).not.toMatch(/result_workflow_status\s*=/);
    expect(updateClause).not.toMatch(/result_type\s*=/);
    expect(updateClause).not.toMatch(/schedule_status\s*=/);
    expect(updateClause).not.toMatch(/\bstatus\s*=/);
    expect(updateClause).not.toMatch(/regulation_home_score\s*=/);
    expect(updateClause).not.toMatch(/regulation_away_score\s*=/);
    expect(updateClause).not.toMatch(/penalty_home_score\s*=/);
    expect(updateClause).not.toMatch(/penalty_away_score\s*=/);
    expect(updateClause).not.toMatch(/winner_team_id\s*=/);
    expect(updateClause).not.toMatch(/home_team_id\s*=/);
    expect(updateClause).not.toMatch(/away_team_id\s*=/);
    expect(updateClause).not.toMatch(/home_source_type\s*=/);
    expect(updateClause).not.toMatch(/away_source_type\s*=/);
  });

  it('the Match UPDATE is conditional on the exact expected version and checked via ROW_COUNT', () => {
    expect(sql).toMatch(/where id = p_match_id\s*\n\s*and version = p_expected_version;/);
    expect(sql).toMatch(/get diagnostics v_affected = row_count;/i);
    expect(sql).toMatch(/QUICK_RESULT_APPLY_MISMATCH/);
  });

  it('validates tournament existence/deletion, match existence/deletion, venue match, status, published, and unresolved teams authoritatively', () => {
    expect(sql).toMatch(/MATCH_NOT_FOUND/);
    expect(sql).toMatch(/MATCH_DELETED/);
    expect(sql).toMatch(/TOURNAMENT_MISMATCH/);
    expect(sql).toMatch(/VENUE_MATCH_MISMATCH/);
    expect(sql).toMatch(/MATCH_STATUS_INCOMPATIBLE/);
    expect(sql).toMatch(/RESULT_ALREADY_PUBLISHED/);
    expect(sql).toMatch(/HOME_TEAM_UNRESOLVED/);
    expect(sql).toMatch(/AWAY_TEAM_UNRESOLVED/);
    expect(sql).toMatch(/from tournament\.tournaments\s*\n\s*where id = p_tournament_id;/);
  });

  it('validates non-negative scores and a non-empty idempotency key before the Match lock', () => {
    const idempotencyValidationIndex = sql.indexOf('IDEMPOTENCY_KEY_REQUIRED');
    const scoreValidationIndex = sql.indexOf('HOME_SCORE_NEGATIVE_SCORE');
    const lockIndex = sql.indexOf('for update;');
    expect(idempotencyValidationIndex).toBeGreaterThan(-1);
    expect(scoreValidationIndex).toBeGreaterThan(-1);
    expect(idempotencyValidationIndex).toBeLessThan(lockIndex);
    expect(scoreValidationIndex).toBeLessThan(lockIndex);
  });

  it('returns submissionId, matchId, matchCode, homeScore, awayScore, previousMatchVersion, newMatchVersion, status, and idempotent', () => {
    expect(sql).toMatch(/'submissionId'/);
    expect(sql).toMatch(/'matchId',\s*p_match_id/);
    expect(sql).toMatch(/'matchCode',\s*v_match\.match_code/);
    expect(sql).toMatch(/'homeScore'/);
    expect(sql).toMatch(/'awayScore'/);
    expect(sql).toMatch(/'previousMatchVersion'/);
    expect(sql).toMatch(/'newMatchVersion'/);
    expect(sql).toMatch(/'status',\s*'submitted'/);
    expect(sql).toMatch(/'idempotent'/);
  });

  it('does not catch or swallow a write failure — no EXCEPTION WHEN handler anywhere in the function', () => {
    // The only legitimate uses of the word "exception" in this file are
    // RAISE EXCEPTION statements (which propagate and roll back, the
    // desired behavior) and prose comments about NOT catching one. An
    // `EXCEPTION WHEN ...` clause would instead let the function catch and
    // potentially swallow a write failure, reintroducing 013a-style partial
    // commits — assert that syntax is absent.
    expect(sql).not.toMatch(/exception\s+when/i);
  });

  it('is idempotent to re-run — CREATE OR REPLACE FUNCTION plus idempotent REVOKE/GRANT only', () => {
    expect(sql).toMatch(/create or replace function/i);
    expect(sql).not.toMatch(/create function(?! or replace)/i);
  });
});

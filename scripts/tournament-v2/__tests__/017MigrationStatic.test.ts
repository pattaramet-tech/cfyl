import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(path.join(__dirname, '../017-standings-override-atomic-save.sql'), 'utf-8');

// Static/textual checks only — this proves the SQL source text contains the
// statements the atomic RPC and the Standings Override Save service depend
// on. It cannot prove real Postgres locking/transaction behavior; that is
// proven separately by scripts/tournament-v2/verify-standings-override-runtime.ts
// against CFYL-Tournament-Staging once the owner applies this migration there.
describe('017-standings-override-atomic-save.sql (static)', () => {
  it('does not rename or modify migrations 014, 015, or 016', () => {
    expect(sql).not.toMatch(/014-/);
    expect(sql).not.toMatch(/create or replace function tournament\.save_qualification_draw_assignment/);
    expect(sql).not.toMatch(/create or replace function tournament\.submit_quick_result/);
    expect(sql).not.toMatch(/drop function/i);
  });

  it('does not add or alter any columns or tables — function replacement only', () => {
    expect(sql).not.toMatch(/alter table/i);
    expect(sql).not.toMatch(/create table/i);
  });

  it('defines the RPC as SECURITY DEFINER with a pinned search_path, service_role-only execute', () => {
    expect(sql).toMatch(/create or replace function tournament\.save_standings_override/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = tournament, pg_temp/i);
    expect(sql).toMatch(/revoke all on function tournament\.save_standings_override.*from public/i);
    expect(sql).toMatch(/revoke execute on function tournament\.save_standings_override.*from anon/i);
    expect(sql).toMatch(/revoke execute on function tournament\.save_standings_override.*from authenticated/i);
    expect(sql).toMatch(/grant execute on function tournament\.save_standings_override.*to service_role/i);
  });

  it('locks the Group with SELECT ... FOR UPDATE before any other authoritative read or write', () => {
    const lockIndex = sql.search(/select \* into v_group\s*\n\s*from tournament\.tournament_groups\s*\n\s*where id = p_group_id\s*\n\s*for update;/i);
    expect(lockIndex).toBeGreaterThan(-1);

    const beforeLock = sql.slice(0, lockIndex);
    expect(beforeLock).not.toMatch(/^\s*(insert|update|delete)\s+(into\s+)?tournament\./im);
    // Only the cheap, row-independent input-shape checks (reason/rank) may
    // run before the lock — no select from tournaments/teams/group_members
    // may happen before the Group lock is acquired.
    expect(beforeLock).not.toMatch(/select .* from tournament\.tournaments/i);
    expect(beforeLock).not.toMatch(/select .* from tournament\.tournament_teams/i);
    expect(beforeLock).not.toMatch(/select .* from tournament\.tournament_group_members/i);
    expect(beforeLock).not.toMatch(/select .* from tournament\.tournament_standing_overrides/i);
  });

  it('the Group lock occurs before the rank-collision check and the expected-before-state check', () => {
    const lockIndex = sql.indexOf('for update;');
    const rankConflictIndex = sql.indexOf('STANDINGS_OVERRIDE_RANK_CONFLICT');
    const stateChangedIndex = sql.indexOf('v_existing_found := found;');
    expect(lockIndex).toBeGreaterThan(-1);
    expect(rankConflictIndex).toBeGreaterThan(lockIndex);
    expect(stateChangedIndex).toBeGreaterThan(lockIndex);
  });

  it('re-validates tournament, group, team, category, membership, rank, and reason authoritatively under the lock', () => {
    expect(sql).toMatch(/STANDINGS_OVERRIDE_TOURNAMENT_NOT_FOUND/);
    expect(sql).toMatch(/STANDINGS_OVERRIDE_TOURNAMENT_NOT_ACTIVE/);
    expect(sql).toMatch(/STANDINGS_OVERRIDE_GROUP_NOT_FOUND/);
    expect(sql).toMatch(/STANDINGS_OVERRIDE_GROUP_TOURNAMENT_MISMATCH/);
    expect(sql).toMatch(/STANDINGS_OVERRIDE_TEAM_NOT_FOUND/);
    expect(sql).toMatch(/STANDINGS_OVERRIDE_TEAM_DELETED/);
    expect(sql).toMatch(/STANDINGS_OVERRIDE_TEAM_TOURNAMENT_MISMATCH/);
    expect(sql).toMatch(/STANDINGS_OVERRIDE_TEAM_CATEGORY_MISMATCH/);
    expect(sql).toMatch(/STANDINGS_OVERRIDE_TEAM_NOT_IN_GROUP/);
    expect(sql).toMatch(/STANDINGS_OVERRIDE_RANK_INVALID/);
    expect(sql).toMatch(/STANDINGS_OVERRIDE_RANK_OUT_OF_RANGE/);
    expect(sql).toMatch(/STANDINGS_OVERRIDE_RANK_CONFLICT/);
    expect(sql).toMatch(/STANDINGS_OVERRIDE_REASON_REQUIRED/);
    expect(sql).toMatch(/STANDINGS_OVERRIDE_STATE_CHANGED/);
  });

  it('compares the exact primitive expected-before-state under the lock, never a hash', () => {
    expect(sql).toMatch(/p_expected_row_exists/);
    expect(sql).toMatch(/p_expected_override_rank/);
    expect(sql).toMatch(/p_expected_reason/);
    expect(sql).toMatch(/v_existing\.override_rank <> p_expected_override_rank/);
    expect(sql).toMatch(/v_existing\.reason <> p_expected_reason/);
    // No hashing function or hash-shaped parameter — the RPC never
    // re-implements Node's SHA-256-of-JSON.stringify hashing in SQL.
    expect(sql).not.toMatch(/digest\(/i);
    expect(sql).not.toMatch(/p_expected_before_state_hash/);
  });

  it('the expected-before-state check happens before any write', () => {
    const stateCheckIndex = sql.indexOf('v_existing_found := found;');
    const firstWriteIndex = sql.search(/insert into tournament\.tournament_standing_overrides/i);
    expect(stateCheckIndex).toBeGreaterThan(-1);
    expect(stateCheckIndex).toBeLessThan(firstWriteIndex);
  });

  it('does not accept a caller-supplied old_data/new_data payload — builds both canonically inside the function', () => {
    expect(sql).not.toMatch(/p_old_data/);
    expect(sql).not.toMatch(/p_new_data/);
    expect(sql).toMatch(/v_old_data\s*:=/);
    expect(sql).toMatch(/v_new_data\s*:=/);
  });

  it('performs the Override upsert and the Audit insert both inside this one function', () => {
    const overrideIndex = sql.indexOf('insert into tournament.tournament_standing_overrides');
    const auditIndex = sql.indexOf('insert into tournament.tournament_audit_logs');
    const stateCheckIndex = sql.indexOf('v_existing_found := found;');

    expect(overrideIndex).toBeGreaterThan(stateCheckIndex);
    expect(auditIndex).toBeGreaterThan(overrideIndex);
    expect(sql).toMatch(/on conflict \(group_id, team_id\) do update/i);
    expect(sql).toMatch(/'standings\.manual_override'/);
    expect(sql).not.toMatch(/perform\s+tournament\./i);
  });

  it('stores a genuine uuid (team_id) as entity_id, never the composite "group:team" string — entity_id is uuid-typed', () => {
    expect(sql).toMatch(/entity_id,\s*entity_label/);
    const insertStart = sql.indexOf('insert into tournament.tournament_audit_logs');
    const valuesSlice = sql.slice(insertStart, insertStart + 800);
    expect(valuesSlice).toMatch(/p_team_id,\s*\n\s*v_entity_label,/);
    expect(sql).toMatch(/v_entity_label\s*:=\s*format\('group=%s team=%s', p_group_id, p_team_id\)/);
  });

  it('the Override write never touches Group, Team, Match, Qualification Draw, Quick Result, or bracket/schedule data', () => {
    expect(sql).not.toMatch(/update tournament\.tournament_groups/i);
    expect(sql).not.toMatch(/update tournament\.tournament_teams/i);
    expect(sql).not.toMatch(/update tournament\.tournament_matches/i);
    expect(sql).not.toMatch(/tournament_qualification_draws/i);
    expect(sql).not.toMatch(/tournament_result_submissions/i);
    expect(sql).not.toMatch(/tournament_knockout/i);
  });

  it('returns groupId, teamId, overrideRank, reason, and auditLogged', () => {
    expect(sql).toMatch(/'groupId',\s*p_group_id/);
    expect(sql).toMatch(/'teamId',\s*p_team_id/);
    expect(sql).toMatch(/'overrideRank',\s*p_override_rank/);
    expect(sql).toMatch(/'reason',\s*v_reason/);
    expect(sql).toMatch(/'auditLogged',\s*true/);
  });

  it('validates non-empty reason and a positive-integer rank before the Group lock', () => {
    const reasonValidationIndex = sql.indexOf('STANDINGS_OVERRIDE_REASON_REQUIRED');
    const rankValidationIndex = sql.indexOf('STANDINGS_OVERRIDE_RANK_INVALID');
    const lockIndex = sql.indexOf('for update;');
    expect(reasonValidationIndex).toBeGreaterThan(-1);
    expect(rankValidationIndex).toBeGreaterThan(-1);
    expect(reasonValidationIndex).toBeLessThan(lockIndex);
    expect(rankValidationIndex).toBeLessThan(lockIndex);
  });

  it('does not catch or swallow a write failure — no EXCEPTION WHEN handler anywhere in the function', () => {
    // The only legitimate uses of the word "exception" in this file are
    // RAISE EXCEPTION statements (which propagate and roll back, the
    // desired behavior) and prose comments about NOT catching one. An
    // `EXCEPTION WHEN ...` clause would instead let the function catch and
    // potentially swallow a write failure, reintroducing a compensating-
    // rollback-shaped partial-commit risk — assert that syntax is absent.
    expect(sql).not.toMatch(/exception\s+when/i);
  });

  it('is idempotent to re-run — CREATE OR REPLACE FUNCTION plus idempotent REVOKE/GRANT only', () => {
    expect(sql).toMatch(/create or replace function/i);
    expect(sql).not.toMatch(/create function(?! or replace)/i);
  });
});

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(path.join(__dirname, '../015-qualification-draw-atomic-save.sql'), 'utf-8');
const sql012 = fs.readFileSync(path.join(__dirname, '../012-draw-selected-source-support.sql'), 'utf-8');

// Static/textual checks only — this proves the SQL source text contains the
// statements the atomic RPC and the Save route depend on. It cannot prove
// real Postgres locking/transaction behavior; that is proven separately by
// scripts/tournament-v2/verify-qualification-draw-runtime.ts against
// CFYL-Tournament-Staging once the owner applies this migration there.
describe('015-qualification-draw-atomic-save.sql (static)', () => {
  it('does not modify migration 012 retroactively — its unique indexes are untouched', () => {
    expect(sql012).toMatch(/uniq_tqualdraw_active_category_slot/);
    expect(sql012).toMatch(/uniq_tqualcand_selected_order/);
    expect(sql).not.toMatch(/012-draw-selected-source-support/);
    expect(sql).not.toMatch(/drop index/i);
  });

  it('does not add or alter any columns — function replacement only', () => {
    expect(sql).not.toMatch(/alter table/i);
  });

  it('defines the RPC as SECURITY DEFINER with a pinned search_path, service_role-only execute', () => {
    expect(sql).toMatch(/create or replace function tournament\.save_qualification_draw_assignment/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = tournament, pg_temp/i);
    expect(sql).toMatch(/revoke all on function tournament\.save_qualification_draw_assignment.*from public/i);
    expect(sql).toMatch(/revoke execute on function tournament\.save_qualification_draw_assignment.*from anon/i);
    expect(sql).toMatch(/revoke execute on function tournament\.save_qualification_draw_assignment.*from authenticated/i);
    expect(sql).toMatch(/grant execute on function tournament\.save_qualification_draw_assignment.*to service_role/i);
  });

  it('locks the category row with SELECT ... FOR UPDATE before any write', () => {
    const lockIndex = sql.search(/select id into v_category_id\s*\n\s*from tournament\.tournament_categories[\s\S]*?for update;/i);
    expect(lockIndex).toBeGreaterThan(-1);

    // Nothing that mutates data appears before the category lock.
    const beforeLock = sql.slice(0, lockIndex);
    expect(beforeLock).not.toMatch(/^\s*(insert|update|delete)\s/im);
  });

  it('acquires affected Match locks in deterministic id order before updating them', () => {
    expect(sql).toMatch(/order by id\s*\n\s*for update/i);
    // The lock loop (FOR ... LOOP over a SELECT ... FOR UPDATE) must appear
    // before the set-based UPDATE that resolves those Matches.
    const lockLoopIndex = sql.indexOf('for v_match_id in');
    const updateIndex = sql.indexOf('update tournament.tournament_matches m');
    expect(lockLoopIndex).toBeGreaterThan(-1);
    expect(updateIndex).toBeGreaterThan(lockLoopIndex);
  });

  it('checks expected_active_draw_id and fails closed with QUALIFICATION_DRAW_STALE_STATE before any write', () => {
    const staleCheckIndex = sql.indexOf('QUALIFICATION_DRAW_STALE_STATE');
    expect(staleCheckIndex).toBeGreaterThan(-1);
    expect(sql).toMatch(/v_active_draw_id is distinct from p_expected_active_draw_id/);

    // No INSERT/UPDATE of qualification_draws/candidates/matches/audit_logs
    // appears before the stale-state check.
    const beforeStaleCheck = sql.slice(0, staleCheckIndex);
    expect(beforeStaleCheck).not.toMatch(/insert into tournament\.tournament_qualification_draws/i);
    expect(beforeStaleCheck).not.toMatch(/insert into tournament\.tournament_qualification_draw_candidates/i);
    expect(beforeStaleCheck).not.toMatch(/insert into tournament\.tournament_audit_logs/i);
  });

  it('supersedes the previous active draw without deleting it', () => {
    expect(sql).toMatch(/update tournament\.tournament_qualification_draws\s*\n\s*set superseded_at = v_now/i);
    expect(sql).not.toMatch(/delete from tournament\.tournament_qualification_draws/i);
  });

  it('inserts all 3 candidates in one set-based statement', () => {
    expect(sql).toMatch(/insert into tournament\.tournament_qualification_draw_candidates[\s\S]*?from unnest\(p_candidate_team_ids\)/i);
  });

  it('Match updates only ever touch home_team_id/away_team_id/sources_resolved_at/updated_by/updated_at and never source_type/source_ref', () => {
    const updateStart = sql.indexOf('update tournament.tournament_matches m');
    const updateEnd = sql.indexOf('where m.id = any (v_match_ids)');
    expect(updateStart).toBeGreaterThan(-1);
    expect(updateEnd).toBeGreaterThan(updateStart);
    const updateClause = sql.slice(updateStart, updateEnd);

    expect(updateClause).toMatch(/home_team_id\s*=/);
    expect(updateClause).toMatch(/away_team_id\s*=/);
    expect(updateClause).toMatch(/sources_resolved_at\s*=/);
    expect(updateClause).toMatch(/updated_by\s*=\s*p_actor_id/);
    expect(updateClause).toMatch(/updated_at\s*=\s*v_now/);

    // The four source fields legitimately appear inside CASE/WHEN/EXISTS as
    // reads (e.g. `m.home_source_type = 'draw_selected'`), always table-
    // qualified and nested. None may appear as a top-level SET target — i.e.
    // at the start of a SET-item line, unqualified, immediately before `=`.
    expect(updateClause).not.toMatch(/^\s{4}(home_source_type|away_source_type|home_source_ref|away_source_ref)\s*=/m);
  });

  it('scopes Match resolution to the requested category and configured placeholder refs only', () => {
    const updateStart = sql.indexOf('update tournament.tournament_matches m');
    const whereClause = sql.slice(updateStart, sql.indexOf(';', updateStart));
    expect(whereClause).toMatch(/where m\.id = any \(v_match_ids\)/);
    // v_match_ids itself is populated from a category_id-scoped, expected-ref-scoped query (checked above).
    expect(sql).toMatch(/where category_id = v_category_id[\s\S]*?home_source_type = 'draw_selected'/);
  });

  it('validates exactly 3 distinct candidates, all belonging to the category and tournament', () => {
    expect(sql).toMatch(/QUALIFICATION_DRAW_INVALID_CANDIDATE_COUNT/);
    expect(sql).toMatch(/QUALIFICATION_DRAW_DUPLICATE_CANDIDATE/);
    expect(sql).toMatch(/QUALIFICATION_DRAW_CANDIDATE_NOT_IN_CATEGORY/);
    expect(sql).toMatch(/v_candidate_count <> 3/);
  });

  it('validates exactly the configured assignment refs, no duplicate refs, no team on two placeholders, only confirmed candidates', () => {
    expect(sql).toMatch(/QUALIFICATION_DRAW_INVALID_ASSIGNMENT_COUNT/);
    expect(sql).toMatch(/QUALIFICATION_DRAW_DUPLICATE_ASSIGNMENT_REF/);
    expect(sql).toMatch(/QUALIFICATION_DRAW_UNKNOWN_ASSIGNMENT_REF/);
    expect(sql).toMatch(/QUALIFICATION_DRAW_DUPLICATE_ASSIGNMENT_TEAM/);
    expect(sql).toMatch(/QUALIFICATION_DRAW_ASSIGNMENT_NOT_CANDIDATE/);
  });

  it('validates the tournament exists, is not deleted, and is active', () => {
    expect(sql).toMatch(/QUALIFICATION_DRAW_TOURNAMENT_NOT_FOUND/);
    expect(sql).toMatch(/QUALIFICATION_DRAW_TOURNAMENT_NOT_ACTIVE/);
    expect(sql).toMatch(/v_tournament_status <> 'active'/);
  });

  it('validates the category supports a draw_selected qualification rule', () => {
    expect(sql).toMatch(/QUALIFICATION_DRAW_CONFIG_NOT_FOUND/);
    expect(sql).toMatch(/v_rule_method <> 'draw'/);
  });

  it('inserts the audit log inside the same function, after the draw/candidates/Match writes, with no external dependency', () => {
    const auditIndex = sql.indexOf('insert into tournament.tournament_audit_logs');
    const drawInsertIndex = sql.indexOf('insert into tournament.tournament_qualification_draws');
    const candidateInsertIndex = sql.indexOf('insert into tournament.tournament_qualification_draw_candidates');
    const matchUpdateIndex = sql.indexOf('update tournament.tournament_matches m');

    expect(auditIndex).toBeGreaterThan(-1);
    expect(auditIndex).toBeGreaterThan(drawInsertIndex);
    expect(auditIndex).toBeGreaterThan(candidateInsertIndex);
    expect(auditIndex).toBeGreaterThan(matchUpdateIndex);

    // Audit insert is a plain INSERT inside this function — not an RPC call
    // out to another function, not a comment referencing an external route.
    expect(sql).not.toMatch(/perform\s+tournament\./i);
    expect(sql).toMatch(/'qualification-draws\.confirm_manual_placeholder_assignment'/);
  });

  it('returns drawId, version, updatedMatchIds, selectedSourceRefs, and previousDrawId', () => {
    expect(sql).toMatch(/'drawId',\s*v_new_draw_id/);
    expect(sql).toMatch(/'version',\s*v_next_version/);
    expect(sql).toMatch(/'updatedMatchIds'/);
    expect(sql).toMatch(/'selectedSourceRefs'/);
    expect(sql).toMatch(/'previousDrawId',\s*v_previous_draw_id/);
  });

  it('is idempotent to re-run — CREATE OR REPLACE FUNCTION plus idempotent REVOKE/GRANT only', () => {
    expect(sql).toMatch(/create or replace function/i);
    expect(sql).not.toMatch(/create function(?! or replace)/i);
  });
});

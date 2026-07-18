import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Static/textual review of Migration 019 — the atomic Qualification Cutoff
// Tie Draw save RPC. These tests prove structural properties of the SQL
// source text; they do NOT prove the function actually executes correctly
// against a live Postgres instance — that requires the owner applying
// Migration 019 to CFYL-Tournament-Staging and running
// scripts/tournament-v2/verify-qualification-cutoff-draw-runtime.ts, neither
// of which has happened yet.
//
// readSource() strips \r so these \n-anchored regexes are correct
// regardless of the checking-out machine's line-ending settings.
const repoRoot = join(__dirname, '..', '..', '..', '..');

function readSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf-8').replace(/\r\n/g, '\n');
}

const MIGRATION_PATH = 'scripts/tournament-v2/019-qualification-cutoff-tie-draw.sql';
const MIGRATION_020_PATH = 'scripts/tournament-v2/020-qualification-cutoff-draw-resurrection-fix.sql';

describe('Migration 019 — static structural review', () => {
  it('defines the tournament.save_qualification_cutoff_draw function', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/create or replace function tournament\.save_qualification_cutoff_draw\(/);
    expect(source).toMatch(/language plpgsql/);
  });

  it('sets an explicit, safe search_path and is security definer', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/set search_path = tournament, pg_temp/);
    expect(source).toMatch(/security definer/);
  });

  it('revokes broad execute permissions and grants only service_role', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/revoke all on function tournament\.save_qualification_cutoff_draw\([\s\S]*?\) from public;/);
    expect(source).toMatch(/revoke all on function tournament\.save_qualification_cutoff_draw\([\s\S]*?\) from anon;/);
    expect(source).toMatch(/revoke all on function tournament\.save_qualification_cutoff_draw\([\s\S]*?\) from authenticated;/);
    expect(source).toMatch(/grant execute on function tournament\.save_qualification_cutoff_draw\([\s\S]*?\) to service_role;/);
  });

  it('creates two new tables (append-only draws + candidates), never modifying the existing G-U16 draw tables', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/create table if not exists tournament\.tournament_qualification_cutoff_draws/);
    expect(source).toMatch(/create table if not exists tournament\.tournament_qualification_cutoff_draw_candidates/);
    expect(source).not.toMatch(/alter table tournament\.tournament_qualification_draws\b/);
    expect(source).not.toMatch(/alter table tournament\.tournament_qualification_draw_candidates\b/);
  });

  it('the active-draw uniqueness is correctly scoped by group_id (not category_id+slot, unlike the existing G-U16 index)', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/create unique index if not exists uniq_tqualcutoff_active_group\s*\n\s*on tournament\.tournament_qualification_cutoff_draws \(group_id\)\s*\n\s*where superseded_at is null;/);
  });

  it('locks the group row (FOR UPDATE) BEFORE checking idempotency', () => {
    const source = readSource(MIGRATION_PATH);
    const bodyMatch = source.match(/as \$\$([\s\S]*?)\$\$;/);
    const body = bodyMatch ? bodyMatch[1] : '';
    const lockIndex = body.indexOf('for update');
    const idempotencyIndex = body.indexOf('idempotency_key = p_idempotency_key');
    expect(lockIndex).toBeGreaterThan(-1);
    expect(idempotencyIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeLessThan(idempotencyIndex);
  });

  it('checks idempotency BEFORE deriving the candidate pool, group completeness, and validation', () => {
    const source = readSource(MIGRATION_PATH);
    const bodyMatch = source.match(/as \$\$([\s\S]*?)\$\$;/);
    const body = bodyMatch ? bodyMatch[1] : '';
    const idempotentReturnIndex = body.indexOf("'idempotent', true");
    const groupIncompleteIndex = body.indexOf('QUALIFICATION_CUTOFF_DRAW_GROUP_INCOMPLETE');
    const staleCandidatesIndex = body.indexOf('QUALIFICATION_CUTOFF_DRAW_STALE_CANDIDATES');
    expect(idempotentReturnIndex).toBeGreaterThan(-1);
    expect(idempotentReturnIndex).toBeLessThan(groupIncompleteIndex);
    expect(idempotentReturnIndex).toBeLessThan(staleCandidatesIndex);
  });

  it('has no p_candidate_team_ids/p_cutoff_position/p_available_slots parameter — the RPC derives the authoritative candidate pool itself', () => {
    const source = readSource(MIGRATION_PATH);
    const paramListMatch = source.match(/create or replace function tournament\.save_qualification_cutoff_draw\(([\s\S]*?)\)\nreturns jsonb/);
    expect(paramListMatch).not.toBeNull();
    const paramList = paramListMatch ? paramListMatch[1] : '';
    expect(paramList).not.toMatch(/^\s*p_candidate_team_ids\s/m);
    expect(paramList).not.toMatch(/^\s*p_cutoff_position\s/m);
    expect(paramList).not.toMatch(/^\s*p_available_slots\s/m);
    expect(paramList).not.toMatch(/^\s*p_old_data\s/m);
    expect(paramList).not.toMatch(/^\s*p_new_data\s/m);
  });

  it('computes team points from official (finished + published + not-deleted) matches only', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/m\.status = 'finished'/);
    expect(source).toMatch(/m\.result_workflow_status = 'published'/);
    expect(source).toMatch(/m\.deleted_at is null/);
  });

  it('never queries or mutates tournament_result_submissions (Quick Result payloads) — no SQL statement anywhere references it as a table (comments mentioning it by name for documentation purposes are fine)', () => {
    const bodyMatch = readSource(MIGRATION_PATH).match(/as \$\$([\s\S]*?)\$\$;/);
    const body = bodyMatch ? bodyMatch[1] : '';
    expect(body).not.toMatch(/(from|into|update|insert into)\s+tournament\.tournament_result_submissions/);
  });

  it('never updates tournament_matches, draw_selected placeholders, source_type, or source_ref', () => {
    const bodyMatch = readSource(MIGRATION_PATH).match(/as \$\$([\s\S]*?)\$\$;/);
    const body = bodyMatch ? bodyMatch[1] : '';
    expect(body).not.toMatch(/update tournament\.tournament_matches/);
    expect(body).not.toMatch(/home_source_ref|away_source_ref|home_source_type|away_source_type/);
    expect(body).not.toMatch(/draw_selected/);
  });

  it('never references tournament_match_goals, tournament_match_cards, or tournament_match_reports', () => {
    const bodyMatch = readSource(MIGRATION_PATH).match(/as \$\$([\s\S]*?)\$\$;/);
    const body = bodyMatch ? bodyMatch[1] : '';
    expect(body).not.toMatch(/tournament_match_goals|tournament_match_cards|tournament_match_reports/);
  });

  it('validates the proposed selection: count mismatch, duplicates, and non-candidate all rejected inside the transaction', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toContain('QUALIFICATION_CUTOFF_DRAW_SELECTION_COUNT_MISMATCH');
    expect(source).toContain('QUALIFICATION_CUTOFF_DRAW_DUPLICATE_SELECTION');
    expect(source).toContain('QUALIFICATION_CUTOFF_DRAW_SELECTION_NOT_CANDIDATE');
  });

  it('rejects a stale candidate pool BEFORE any write (Score-Correction staleness)', () => {
    const source = readSource(MIGRATION_PATH);
    const bodyMatch = source.match(/as \$\$([\s\S]*?)\$\$;/);
    const body = bodyMatch ? bodyMatch[1] : '';
    const staleIndex = body.indexOf('QUALIFICATION_CUTOFF_DRAW_STALE_CANDIDATES');
    const firstInsertIndex = body.indexOf('insert into tournament.tournament_qualification_cutoff_draws');
    expect(staleIndex).toBeGreaterThan(-1);
    expect(firstInsertIndex).toBeGreaterThan(-1);
    expect(staleIndex).toBeLessThan(firstInsertIndex);
  });

  it('performs the supersede, insert draw, insert candidates, and audit log inside the single function body', () => {
    const bodyMatch = readSource(MIGRATION_PATH).match(/as \$\$([\s\S]*?)\$\$;/);
    const body = bodyMatch ? bodyMatch[1] : '';
    expect(body).toMatch(/update tournament\.tournament_qualification_cutoff_draws\s+set superseded_at = v_now/);
    expect(body).toMatch(/insert into tournament\.tournament_qualification_cutoff_draws/);
    expect(body).toMatch(/insert into tournament\.tournament_qualification_cutoff_draw_candidates/);
    expect(body).toMatch(/insert into tournament\.tournament_audit_logs/);
  });

  it('has no exception handler that could swallow a write failure (no "exception when" block)', () => {
    const bodyMatch = readSource(MIGRATION_PATH).match(/as \$\$([\s\S]*?)\$\$;/);
    const body = bodyMatch ? bodyMatch[1] : '';
    expect(body).not.toMatch(/exception\s+when/i);
  });

  it('performs no randomization anywhere', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).not.toMatch(/random\(\)/i);
  });

  it('is marked as a draft, not applied, in its own header comment', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/STATUS: DRAFT/);
    expect(source).toMatch(/NOT applied/);
  });

  it('does not modify migrations 001-018 (no ALTER on any table/index/function they define outside this file)', () => {
    const source = readSource(MIGRATION_PATH);
    // Confirms this migration only creates ITS OWN new objects — no DROP/ALTER
    // targeting pre-existing tables from other migrations.
    expect(source).not.toMatch(/alter table tournament\.tournament_result_submissions/);
    expect(source).not.toMatch(/alter table tournament\.tournament_matches/);
    expect(source).not.toMatch(/drop constraint/i);
  });
});

describe('Migration 019 — untouched by the resurrection fix (additive-only repair)', () => {
  it('still uses the original v1 candidate_snapshot format — migration 019 was never rewritten', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/v_candidate_snapshot := 'v1\|slots=' \|\| v_available_slots \|\| '\|candidates=' \|\|/);
    expect(source).not.toContain('officialResultRevision');
    expect(source).not.toContain('v_official_result_revision');
  });

  it('still declares itself DRAFT/NOT applied — its own header was not edited to reflect migration 020\'s existence', () => {
    const source = readSource(MIGRATION_PATH);
    expect(source).toMatch(/STATUS: DRAFT/);
    expect(source).toMatch(/NOT applied/);
  });
});

describe('Migration 020 — static structural review (additive stale-draw resurrection fix)', () => {
  it('is CREATE OR REPLACE FUNCTION only — no new/altered tables, columns, or indexes', () => {
    const source = readSource(MIGRATION_020_PATH);
    expect(source).toMatch(/create or replace function tournament\.save_qualification_cutoff_draw\(/);
    expect(source).not.toMatch(/create table/i);
    expect(source).not.toMatch(/alter table/i);
    expect(source).not.toMatch(/create (unique )?index/i);
  });

  it('does not modify migration 019\'s file (no reference to editing 019, and this is a separate file)', () => {
    const source = readSource(MIGRATION_020_PATH);
    expect(source).toMatch(/already applied to Staging[\s\S]*?NOT modified[\s\S]*?retroactively/);
  });

  it('sets an explicit, safe search_path and is security definer', () => {
    const source = readSource(MIGRATION_020_PATH);
    expect(source).toMatch(/set search_path = tournament, pg_temp/);
    expect(source).toMatch(/security definer/);
  });

  it('revokes broad execute permissions and grants only service_role', () => {
    const source = readSource(MIGRATION_020_PATH);
    expect(source).toMatch(/revoke all on function tournament\.save_qualification_cutoff_draw\([\s\S]*?\) from public;/);
    expect(source).toMatch(/revoke all on function tournament\.save_qualification_cutoff_draw\([\s\S]*?\) from anon;/);
    expect(source).toMatch(/revoke all on function tournament\.save_qualification_cutoff_draw\([\s\S]*?\) from authenticated;/);
    expect(source).toMatch(/grant execute on function tournament\.save_qualification_cutoff_draw\([\s\S]*?\) to service_role;/);
  });

  it('folds an official-result revision fingerprint (matchId:version, sorted) into the v2 candidate snapshot', () => {
    const source = readSource(MIGRATION_020_PATH);
    expect(source).toMatch(/v_official_result_revision/);
    expect(source).toMatch(/m\.id::text \|\| ':' \|\| m\.version::text/);
    expect(source).toMatch(/v_candidate_snapshot := 'v2\|slots=' \|\| v_available_slots \|\| '\|candidates=' \|\|/);
    expect(source).toContain("'|rev=' || v_official_result_revision");
  });

  it('still computes team points from official (finished + published + not-deleted) matches only', () => {
    const source = readSource(MIGRATION_020_PATH);
    expect(source).toMatch(/m\.status = 'finished'/);
    expect(source).toMatch(/m\.result_workflow_status = 'published'/);
    expect(source).toMatch(/m\.deleted_at is null/);
  });

  it('rejects a stale candidate pool BEFORE any write', () => {
    const source = readSource(MIGRATION_020_PATH);
    const bodyMatch = source.match(/as \$\$([\s\S]*?)\$\$;/);
    const body = bodyMatch ? bodyMatch[1] : '';
    const staleIndex = body.indexOf('QUALIFICATION_CUTOFF_DRAW_STALE_CANDIDATES');
    const firstInsertIndex = body.indexOf('insert into tournament.tournament_qualification_cutoff_draws');
    expect(staleIndex).toBeGreaterThan(-1);
    expect(firstInsertIndex).toBeGreaterThan(-1);
    expect(staleIndex).toBeLessThan(firstInsertIndex);
  });

  it('locks the group row (FOR UPDATE) BEFORE checking idempotency', () => {
    const source = readSource(MIGRATION_020_PATH);
    const bodyMatch = source.match(/as \$\$([\s\S]*?)\$\$;/);
    const body = bodyMatch ? bodyMatch[1] : '';
    const lockIndex = body.indexOf('for update');
    const idempotencyIndex = body.indexOf('idempotency_key = p_idempotency_key');
    expect(lockIndex).toBeGreaterThan(-1);
    expect(idempotencyIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeLessThan(idempotencyIndex);
  });

  it('has no exception handler that could swallow a write failure (no "exception when" block)', () => {
    const bodyMatch = readSource(MIGRATION_020_PATH).match(/as \$\$([\s\S]*?)\$\$;/);
    const body = bodyMatch ? bodyMatch[1] : '';
    expect(body).not.toMatch(/exception\s+when/i);
  });

  it('performs no randomization anywhere', () => {
    const source = readSource(MIGRATION_020_PATH);
    expect(source).not.toMatch(/random\(\)/i);
  });

  it('is marked as a draft, not applied, in its own header/footer comment', () => {
    const source = readSource(MIGRATION_020_PATH);
    expect(source).toMatch(/STATUS: DRAFT/);
    expect(source).toMatch(/NOT applied/);
  });

  it('does not modify migrations 001-019 (no ALTER on any table/index/function they define outside this file)', () => {
    const source = readSource(MIGRATION_020_PATH);
    expect(source).not.toMatch(/alter table tournament\.tournament_result_submissions/);
    expect(source).not.toMatch(/alter table tournament\.tournament_matches/);
    expect(source).not.toMatch(/drop constraint/i);
  });
});

describe('No non-transactional Qualification Cutoff Draw fallback exists in the app layer', () => {
  it('the service calls the RPC and does not sequentially write draw/candidate rows itself', () => {
    const source = readSource('lib/tournament/services/qualification-cutoff-draws.ts');
    expect(source).toMatch(/\.rpc\(\s*['"]save_qualification_cutoff_draw['"]/);
    expect(source).not.toMatch(/\.from\(['"]tournament_qualification_cutoff_draws['"]\)\s*\.\s*(insert|update|upsert)/);
    expect(source).not.toMatch(/\.from\(['"]tournament_qualification_cutoff_draw_candidates['"]\)\s*\.\s*(insert|update|upsert)/);
  });

  it('fails closed with QUALIFICATION_CUTOFF_DRAW_RPC_UNAVAILABLE when the RPC is missing', () => {
    const source = readSource('lib/tournament/services/qualification-cutoff-draws.ts');
    expect(source).toContain('QUALIFICATION_CUTOFF_DRAW_RPC_UNAVAILABLE');
  });

  it('the service never mutates tournament_matches, goals, cards, reports, or Quick Result', () => {
    const source = readSource('lib/tournament/services/qualification-cutoff-draws.ts');
    expect(source).not.toMatch(/\.from\(['"]tournament_matches['"]\)\s*\.\s*(insert|update|upsert|delete)/);
    expect(source).not.toMatch(/tournament_match_goals|tournament_match_cards|tournament_match_reports/);
  });
});

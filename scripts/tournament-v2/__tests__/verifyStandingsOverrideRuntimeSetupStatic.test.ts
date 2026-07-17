import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(__dirname, '../verify-standings-override-runtime.ts'), 'utf-8');

// Static/textual checks only — guards against the exact regression a live
// Staging run already caught once for the Quick Result verifier (PR #9):
// a random/untracked actor UUID with no matching tournament_user_profiles
// row. This verifier follows the same disposable-actor-profile pattern
// proactively, even though tournament_standing_overrides.created_by and
// tournament_audit_logs.admin_id are plain uuid columns without an FK today.
describe('verify-standings-override-runtime.ts setup/cleanup (static)', () => {
  it('does not declare a module-level actor id constant — actor id must come from Ctx', () => {
    expect(source).not.toMatch(/^const ACTOR_ID\s*=/m);
  });

  it('Ctx carries an actorId field sourced from a real disposable profile row', () => {
    expect(source).toMatch(/interface Ctx \{[\s\S]*?actorId:\s*string;[\s\S]*?\}/);
  });

  it('setup() inserts a disposable tournament_user_profiles row before returning Ctx', () => {
    const setupStart = source.indexOf('async function setup(client: TournamentClient): Promise<Ctx>');
    const setupReturnIndex = source.indexOf('return { client, tournamentId', setupStart);
    const profileInsertIndex = source.indexOf("from('tournament_user_profiles')\n      .insert(", setupStart);

    expect(setupStart).toBeGreaterThan(-1);
    expect(profileInsertIndex).toBeGreaterThan(setupStart);
    expect(setupReturnIndex).toBeGreaterThan(profileInsertIndex);
    expect(source).toMatch(/full_name:\s*`Runtime Verify Actor \$\{RUN_TAG\}`/);
    expect(source).toMatch(/active:\s*true/);
    expect(source.slice(setupReturnIndex, setupReturnIndex + 200)).toMatch(/actorId/);
  });

  it('every previewStandingsOverride/saveStandingsOverride/callSave actorUserId site passes ctx.actorId, never a bare ACTOR_ID', () => {
    const actorUserIdSites = source.match(/actorUserId:\s*[^,\n]+/g) || [];
    expect(actorUserIdSites.length).toBeGreaterThan(0);
    for (const site of actorUserIdSites) {
      expect(site).toMatch(/actorUserId:\s*ctx\.actorId/);
    }
  });

  it("setup()'s failure handler also deletes the actor profile if one was created, not just the tournament", () => {
    const catchIndex = source.indexOf('} catch (err) {');
    expect(catchIndex).toBeGreaterThan(-1);
    const catchBody = source.slice(catchIndex, source.indexOf('\n}', catchIndex));
    expect(catchBody).toMatch(/if \(actorId\)/);
    expect(catchBody).toMatch(/from\('tournament_user_profiles'\)\s*\.delete\(\)\.eq\('id', actorId\)/);
  });

  it('cleanup() explicitly deletes the disposable actor profile by id', () => {
    const cleanupStart = source.indexOf('async function cleanup(ctx: Ctx): Promise<void> {');
    const tournamentDeleteIndex = source.indexOf("from('tournaments').delete().eq('id', ctx.tournamentId)", cleanupStart);
    const profileDeleteIndex = source.indexOf("from('tournament_user_profiles').delete().eq('id', ctx.actorId)", cleanupStart);

    expect(cleanupStart).toBeGreaterThan(-1);
    expect(tournamentDeleteIndex).toBeGreaterThan(cleanupStart);
    expect(profileDeleteIndex).toBeGreaterThan(tournamentDeleteIndex);
  });

  it('cleanup() independently re-queries and asserts the actor profile is actually gone', () => {
    const cleanupStart = source.indexOf('async function cleanup(ctx: Ctx): Promise<void> {');
    const verifyIndex = source.indexOf(
      "from('tournament_user_profiles').select('id').eq('id', ctx.actorId).maybeSingle()",
      cleanupStart
    );
    const assertIndex = source.indexOf('profileAfter.data', cleanupStart);

    expect(verifyIndex).toBeGreaterThan(cleanupStart);
    expect(assertIndex).toBeGreaterThan(verifyIndex);
  });

  it('requires TOURNAMENT_RUNTIME_VERIFY_CONFIRM=CFYL-Tournament-Staging before running anything', () => {
    expect(source).toMatch(/TOURNAMENT_RUNTIME_VERIFY_CONFIRM/);
    expect(source).toMatch(/CFYL-Tournament-Staging/);
    expect(source).toMatch(/process\.exit\(1\)/);
  });

  it('cleanup() also independently re-verifies zero standing_overrides and audit rows remain', () => {
    const cleanupStart = source.indexOf('async function cleanup(ctx: Ctx): Promise<void> {');
    const overridesVerifyIndex = source.indexOf("from('tournament_standing_overrides').select('group_id').eq('group_id', ctx.groupId)", cleanupStart);
    const auditVerifyIndex = source.indexOf("from('tournament_audit_logs').select('id').in('entity_id', ctx.teamIds)", cleanupStart);
    expect(overridesVerifyIndex).toBeGreaterThan(cleanupStart);
    expect(auditVerifyIndex).toBeGreaterThan(cleanupStart);
  });

  it('does not add a production failure-injection mechanism — mid-transaction failures are covered by the RPC mock instead', () => {
    // Only the doc-comment prose may mention "injection" as a design-choice
    // explanation; no actual injection parameter/hook may exist in code.
    expect(source).not.toMatch(/failAt/);
    expect(source).not.toMatch(/injection\s*[:?]/i);
    expect(source).not.toMatch(/RpcFailureInjection/);
  });
});

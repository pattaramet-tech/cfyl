import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(__dirname, '../verify-quick-result-runtime.ts'), 'utf-8');

// Static/textual checks only — guards against the exact regression a live
// Staging run already caught once: tournament_result_submissions.submitted_by
// and tournament_audit_logs.admin_id are FK'd to tournament_user_profiles(id),
// so a random/untracked actor UUID with no matching profile row fails with
// tournament_result_submissions_submitted_by_fkey as soon as the RPC tries to
// write a real submission (Scenario 3 onward — Scenario 1/2 and Preview don't
// write anything FK'd to the profile, so they passed even with the bug).
describe('verify-quick-result-runtime.ts setup/cleanup (static)', () => {
  it('does not declare a module-level actor id constant — actor id must come from Ctx', () => {
    // The original bug was exactly this: `const ACTOR_ID = randomUUID();` at
    // module scope, used everywhere, with no corresponding database row.
    expect(source).not.toMatch(/^const ACTOR_ID\s*=/m);
  });

  it('Ctx carries an actorId field sourced from a real disposable profile row', () => {
    expect(source).toMatch(/interface Ctx \{[\s\S]*?actorId:\s*string;[\s\S]*?\}/);
  });

  it('setup() inserts a disposable tournament_user_profiles row before returning Ctx', () => {
    const setupStart = source.indexOf('async function setup(client: TournamentClient): Promise<Ctx>');
    const setupReturnIndex = source.indexOf('return {', setupStart);
    const profileInsertIndex = source.indexOf("from('tournament_user_profiles')\n      .insert(", setupStart);

    expect(setupStart).toBeGreaterThan(-1);
    expect(profileInsertIndex).toBeGreaterThan(setupStart);
    expect(setupReturnIndex).toBeGreaterThan(profileInsertIndex);
    // The inserted profile row must carry a RUN_TAG-scoped full_name and be active.
    expect(source).toMatch(/full_name:\s*`Runtime Verify Actor \$\{RUN_TAG\}`/);
    expect(source).toMatch(/active:\s*true/);
    // The returned Ctx must carry the same id the insert used.
    expect(source.slice(setupReturnIndex, source.indexOf('}', setupReturnIndex + 200))).toMatch(/actorId,?/);
  });

  it('every previewQuickResult/submitQuickResult call site passes ctx.actorId, never a bare ACTOR_ID', () => {
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

  it('cleanup() explicitly deletes the disposable actor profile by id (it does not cascade from the tournament delete)', () => {
    const cleanupStart = source.indexOf('async function cleanup(ctx: Ctx): Promise<void> {');
    const tournamentDeleteIndex = source.indexOf("from('tournaments').delete().eq('id', ctx.tournamentId)", cleanupStart);
    const profileDeleteIndex = source.indexOf("from('tournament_user_profiles').delete().eq('id', ctx.actorId)", cleanupStart);

    expect(cleanupStart).toBeGreaterThan(-1);
    expect(tournamentDeleteIndex).toBeGreaterThan(cleanupStart);
    // Profile delete must come after the tournament delete (tournament_user_profiles
    // has no tournament_id column, so ordering relative to the cascade doesn't
    // matter for correctness, but this matches the documented, tested order).
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
});

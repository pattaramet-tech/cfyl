import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Source-level isolation checks: Quick Result must never appear in, or be
// invoked by, the public schedule route, the standings/bracket logic (not
// yet implemented — this just asserts nothing in this PR references them),
// or League code. These are static/textual checks rather than runtime tests
// because there is no standings/bracket module to invoke yet in this PR, and
// because the public route's absence of any score/result-submission field is
// itself the guarantee (nothing to redact if it was never selected).

const repoRoot = join(__dirname, '..', '..', '..', '..');

function readSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf-8');
}

describe('Quick Result — public and downstream isolation (source-level)', () => {
  it('the public schedule route never selects score or result-submission fields', () => {
    const source = readSource('app/api/tournament/public/schedule/route.ts');
    expect(source).not.toMatch(/regulation_home_score|regulation_away_score/);
    expect(source).not.toMatch(/tournament_result_submissions/);
    expect(source).not.toMatch(/quick_result/);
  });

  it('the quick-result service never writes result_workflow_status to published', () => {
    const source = readSource('lib/tournament/services/quickResult.ts');
    expect(source).not.toMatch(/result_workflow_status:\s*['"]published['"]/);
  });

  it('the quick-result service never touches goals, cards, or suspension tables', () => {
    const source = readSource('lib/tournament/services/quickResult.ts');
    expect(source).not.toMatch(/tournament_match_goals/);
    expect(source).not.toMatch(/tournament_match_cards/);
    expect(source).not.toMatch(/tournament_suspension_events/);
  });

  it('the quick-result service never queries standings/bracket tables or calls standings/bracket functions', () => {
    const source = readSource('lib/tournament/services/quickResult.ts');
    expect(source).not.toMatch(/\.from\(['"]tournament_standing/);
    expect(source).not.toMatch(/\.from\(['"]tournament_bracket/);
    expect(source).not.toMatch(/calculateStandings|calculateGroupStandings|resolveBracket|advanceKnockout/);
  });

  it('League calculation modules are not imported by the quick-result feature', () => {
    const service = readSource('lib/tournament/services/quickResult.ts');
    const route = readSource('app/api/tournament/admin/matches/[matchId]/quick-result/route.ts');
    for (const source of [service, route]) {
      expect(source).not.toMatch(/from ['"]@\/lib\/calculations['"]/);
      expect(source).not.toMatch(/from ['"]@\/lib\/suspension-calc['"]/);
    }
  });

  it('the quick-result service contains no randomization', () => {
    const source = readSource('lib/tournament/services/quickResult.ts');
    expect(source).not.toMatch(/Math\.random|crypto\.getRandomValues/);
  });

  it('the Venue Matchday page displays the provisional-result notice and does not label it as official publish', () => {
    const source = readSource('app/admin/tournament/venues/[venueId]/matchday/page.tsx');
    expect(source).toContain('ผลด่วนเป็นข้อมูลเบื้องต้นสำหรับการดำเนินงานหน้างาน');
    expect(source).toContain('ยังไม่ใช่ผลการแข่งขันที่เผยแพร่อย่างเป็นทางการ');
    expect(source).toContain('ยืนยันส่งผลเบื้องต้น');
    expect(source).not.toContain('เผยแพร่ผล');
  });

  it('the Submit button is unavailable in the UI without a valid preview token (client-side UX, not the security boundary)', () => {
    const source = readSource('app/admin/tournament/venues/[venueId]/matchday/page.tsx');
    // The submit/confirm button only renders inside the
    // `preview && !previewStale && previewToken` branch.
    expect(source).toMatch(/!preview \|\| previewStale \|\| !previewToken \?[\s\S]*ดูตัวอย่าง[\s\S]*:\s*\([\s\S]*ยืนยันส่งผลเบื้องต้น/);
  });

  it('mandatory Preview is enforced server-side: submitQuickResult verifies a signed preview token, not merely trusting a boolean', () => {
    const source = readSource('lib/tournament/services/quickResult.ts');
    expect(source).toContain('QUICK_RESULT_PREVIEW_REQUIRED');
    expect(source).toContain('verifyPreviewToken(params.previewToken)');
    expect(source).toContain('QUICK_RESULT_PREVIEW_MISMATCH');
    // The mismatch check binds tournament, match, venue, both scores, the
    // match version, and the actor — not just "a token was present".
    expect(source).toMatch(/claims\.tournamentId === params\.tournamentId/);
    expect(source).toMatch(/claims\.matchId === params\.matchId/);
    expect(source).toMatch(/claims\.venueId === params\.venueId/);
    expect(source).toMatch(/claims\.homeScore === homeScore/);
    expect(source).toMatch(/claims\.awayScore === awayScore/);
    expect(source).toMatch(/claims\.matchVersion === params\.expectedVersion/);
    expect(source).toMatch(/claims\.actorUserId === params\.actorUserId/);
  });

  it('the preview token secret is read lazily, never at module load, so a missing secret cannot break build-time page compilation', () => {
    // previewToken.ts itself no longer reads process.env directly — it
    // delegates to the shared signedToken.ts helper (extracted so the
    // Standings Override Preview Token can reuse the same HMAC primitive).
    // The lazy-read guarantee now lives in signedToken.ts; previewToken.ts
    // must not reintroduce any top-level/eager secret read of its own.
    const wrapperSource = readSource('lib/tournament/services/previewToken.ts');
    expect(wrapperSource).not.toMatch(/^const secret = process\.env/m);
    expect(wrapperSource).not.toMatch(/^if \(!.*secret.*\) throw/m);
    expect(wrapperSource).not.toContain('process.env');

    const helperSource = readSource('lib/tournament/services/signedToken.ts');
    // getSecret() must be called from inside functions (issue/verify), not
    // as a top-level `if (!secret) throw` at module scope.
    expect(helperSource).not.toMatch(/^const secret = process\.env/m);
    expect(helperSource).not.toMatch(/^if \(!.*secret.*\) throw/m);
    expect(helperSource).toContain('function getSecret(');
  });
});

describe('Existing stack regression — files remain present', () => {
  it('PR #7 qualification-draws route remains present', () => {
    expect(() => readSource('app/api/tournament/admin/qualification-draws/route.ts')).not.toThrow();
  });

  it('PR #6 schedule import routes remain present', () => {
    expect(() => readSource('app/api/tournament/admin/schedule/import/save/route.ts')).not.toThrow();
    expect(() => readSource('app/api/tournament/public/schedule/route.ts')).not.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Source-level isolation checks for the Full Match Report feature, in the
// same spirit as quickResultIsolation.test.ts. There is no public mutation
// route for Full Match Report (per task scope) — these tests prove the
// EXISTING public routes never gained a reference to internal Full Report
// concepts (report text, Preview Token, idempotency key, audit data), and
// that the service/RPC layer stays out of League and Knockout/Suspension
// territory.

const repoRoot = join(__dirname, '..', '..', '..', '..');

function readSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf-8');
}

describe('Full Match Report — public route isolation', () => {
  it('58/59. the public schedule route never references report text, preview tokens, idempotency keys, or audit data', () => {
    const source = readSource('app/api/tournament/public/schedule/route.ts');
    expect(source).not.toMatch(/report_text|match_report|tournament_match_reports/);
    expect(source).not.toMatch(/preview_token|previewToken/);
    expect(source).not.toMatch(/idempotency_key|idempotencyKey/);
    expect(source).not.toMatch(/tournament_audit_logs/);
  });

  it('58/59. the public standings route never references report text, preview tokens, idempotency keys, or audit data', () => {
    const source = readSource('app/api/tournament/public/standings/route.ts');
    expect(source).not.toMatch(/report_text|match_report|tournament_match_reports/);
    expect(source).not.toMatch(/preview_token|previewToken/);
    expect(source).not.toMatch(/idempotency_key|idempotencyKey/);
    expect(source).not.toMatch(/tournament_audit_logs/);
  });

  it('there is no public full-report route in this PR', () => {
    expect(() => readSource('app/api/tournament/public/full-report/route.ts')).toThrow();
    expect(() => readSource('app/api/tournament/public/matches/full-report/route.ts')).toThrow();
  });
});

describe('Full Match Report — downstream boundary isolation', () => {
  it('the full match report service never calls Standings calculation functions directly (Standings is a read-only downstream consumer, not written by this feature)', () => {
    const source = readSource('lib/tournament/services/fullMatchReport.ts');
    expect(source).not.toMatch(/calculateStandings|calculateGroupStandings|resolveTournamentTiebreak/);
    expect(source).not.toMatch(/\.from\(['"]tournament_standing/);
  });

  it('the full match report service never touches Knockout Advancement or Suspension tables/functions', () => {
    const source = readSource('lib/tournament/services/fullMatchReport.ts');
    expect(source).not.toMatch(/tournament_suspension_events|tournament_suspension_serving_matches/);
    expect(source).not.toMatch(/advanceKnockout|resolveBracket|match_winner|match_loser|group_rank|best_ranked/);
  });

  it('League calculation modules are not imported by the full match report feature', () => {
    const service = readSource('lib/tournament/services/fullMatchReport.ts');
    const route = readSource('app/api/tournament/admin/matches/[matchId]/full-report/route.ts');
    for (const source of [service, route]) {
      expect(source).not.toMatch(/from ['"]@\/lib\/calculations['"]/);
      expect(source).not.toMatch(/from ['"]@\/lib\/suspension-calc['"]/);
    }
  });

  it('65. the full match report service and migration contain no randomization', () => {
    const service = readSource('lib/tournament/services/fullMatchReport.ts');
    const migration = readSource('scripts/tournament-v2/014-full-result-publish-transaction.sql');
    expect(service).not.toMatch(/Math\.random|crypto\.getRandomValues/);
    expect(migration).not.toMatch(/random\(\)/i);
  });

  it('does not implement a Correction/re-publish path: publishing while already published is always rejected', () => {
    const source = readSource('lib/tournament/services/fullMatchReport.ts');
    expect(source).toContain('FULL_REPORT_ALREADY_PUBLISHED_USE_CORRECTION');
    // No "force"/"override" bypass parameter exists for this check (word
    // boundary so this doesn't false-positive on "enforcement").
    expect(source).not.toMatch(/\bforce\b|bypassPublished|allowOverwrite/i);
  });
});

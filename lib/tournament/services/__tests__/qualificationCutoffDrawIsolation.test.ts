import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Source-level isolation checks for the Qualification Cutoff Tie Draw
// feature (D-30) — proves it stays completely out of G-U16's territory,
// League/Tournament V1, Knockout placeholders, and athlete/discipline
// workflows explicitly deferred by this task.

const repoRoot = join(__dirname, '..', '..', '..', '..');

function readSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf-8');
}

describe('Qualification Cutoff Tie Draw — isolation from G-U16 cross-group draw', () => {
  it('does not import or call anything from qualification-draws.ts (G-U16) or drawSelected.ts', () => {
    const service = readSource('lib/tournament/services/qualification-cutoff-draws.ts');
    expect(service).not.toMatch(/from ['"]@\/lib\/tournament\/services\/qualification-draws['"]/);
    expect(service).not.toMatch(/from ['"]@\/lib\/tournament\/scheduling\/drawSelected['"]/);
    expect(service).not.toMatch(/save_qualification_draw_assignment/);
  });

  it("50. the RPC's own function body never calls save_qualification_draw_assignment or uses the 'group_third_place' slot value (the header comment explaining why the G-U16 RPC/slot were NOT reused is fine)", () => {
    const migration = readSource('scripts/tournament-v2/019-qualification-cutoff-tie-draw.sql');
    const bodyMatch = migration.match(/as \$\$([\s\S]*?)\$\$;/);
    const body = bodyMatch ? bodyMatch[1] : '';
    expect(body).not.toMatch(/save_qualification_draw_assignment/);
    expect(body).not.toMatch(/group_third_place/);
  });

  it('the new tables are distinct from the existing G-U16 draw tables', () => {
    const migration = readSource('scripts/tournament-v2/019-qualification-cutoff-tie-draw.sql');
    expect(migration).toMatch(/tournament_qualification_cutoff_draws/);
    expect(migration).not.toMatch(/create table if not exists tournament\.tournament_qualification_draws\b/);
  });
});

describe('Qualification Cutoff Tie Draw — isolation from Knockout/placeholders/goals/cards/discipline', () => {
  it('49. no direct Knockout Match Placeholder mutation anywhere in the service or migration', () => {
    const service = readSource('lib/tournament/services/qualification-cutoff-draws.ts');
    const migration = readSource('scripts/tournament-v2/019-qualification-cutoff-tie-draw.sql');
    for (const source of [service, migration]) {
      expect(source).not.toMatch(/match_winner|match_loser|group_rank|best_ranked/);
      expect(source).not.toMatch(/advanceKnockout|resolveBracket/);
    }
  });

  it('never references discipline, suspension, or attachment tables/workflows', () => {
    const service = readSource('lib/tournament/services/qualification-cutoff-draws.ts');
    const migration = readSource('scripts/tournament-v2/019-qualification-cutoff-tie-draw.sql');
    for (const source of [service, migration]) {
      expect(source).not.toMatch(/tournament_suspension_events|tournament_suspension_serving_matches|tournament_match_attachments/);
    }
  });

  it('never references player/staff tables (athlete/team-staff workflow deferred)', () => {
    const service = readSource('lib/tournament/services/qualification-cutoff-draws.ts');
    const migration = readSource('scripts/tournament-v2/019-qualification-cutoff-tie-draw.sql');
    for (const source of [service, migration]) {
      expect(source).not.toMatch(/tournament_players|tournament_staff/);
    }
  });

  it('51. no diff touches League tables/routes or Tournament V1', () => {
    // Source-level proxy: the new files never import League calculation
    // modules or Tournament V1 paths.
    const service = readSource('lib/tournament/services/qualification-cutoff-draws.ts');
    const route = readSource('app/api/tournament/admin/qualification-cutoff-draws/route.ts');
    for (const source of [service, route]) {
      expect(source).not.toMatch(/from ['"]@\/lib\/calculations['"]/);
      expect(source).not.toMatch(/tournament-v1|TournamentV1/i);
    }
  });
});

describe('Qualification Cutoff Tie Draw — public privacy', () => {
  it('48. the admin route never appears in a public API path', () => {
    expect(() => readSource('app/api/tournament/public/qualification-cutoff-draws/route.ts')).toThrow();
  });

  it('the public standings/schedule routes never reference qualification-cutoff-draw internals', () => {
    const publicStandings = readSource('app/api/tournament/public/standings/route.ts');
    const publicSchedule = readSource('app/api/tournament/public/schedule/route.ts');
    for (const source of [publicStandings, publicSchedule]) {
      expect(source).not.toMatch(/candidate_snapshot|candidateSnapshot/);
      expect(source).not.toMatch(/preview_token|previewToken/);
      expect(source).not.toMatch(/idempotency_key|idempotencyKey/);
      expect(source).not.toMatch(/drawn_by|drawnBy/);
    }
  });

  it('the admin context service never exposes actor email or idempotency key in its read-only context output shape', () => {
    const service = readSource('lib/tournament/services/qualification-cutoff-draws.ts');
    // loadQualificationCutoffDrawContext's return type must not surface
    // actorEmail or idempotencyKey.
    const contextInterfaceMatch = service.match(/export interface QualificationCutoffDrawContext \{([\s\S]*?)\n\}/);
    expect(contextInterfaceMatch).not.toBeNull();
    const body = contextInterfaceMatch ? contextInterfaceMatch[1] : '';
    expect(body).not.toMatch(/actorEmail|idempotencyKey/);
  });
});

describe('Qualification Cutoff Tie Draw — no randomization anywhere in the app layer', () => {
  it('11. the service and preview token module perform no randomization', () => {
    const service = readSource('lib/tournament/services/qualification-cutoff-draws.ts');
    const token = readSource('lib/tournament/services/qualificationCutoffDrawPreviewToken.ts');
    for (const source of [service, token]) {
      expect(source).not.toMatch(/Math\.random|crypto\.getRandomValues/);
    }
  });
});

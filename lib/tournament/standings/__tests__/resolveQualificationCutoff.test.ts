import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildOfficialResultRevision,
  resolveQualificationCutoff,
  validateQualificationDrawSelection,
  type ResolveQualificationCutoffParams,
} from '../resolveQualificationCutoff';

const DEFAULT_REVISION = 'rev-default';

/** Test convenience wrapper — supplies a default officialResultRevision so
 * individual test cases (which mostly aren't testing revision-fingerprint
 * behavior at all) don't need to repeat it. The dedicated
 * "resurrection safety" describe block below overrides it explicitly. */
function resolve(params: Omit<ResolveQualificationCutoffParams, 'officialResultRevision'> & { officialResultRevision?: string }) {
  return resolveQualificationCutoff({ officialResultRevision: DEFAULT_REVISION, ...params });
}

// The task's canonical example: A=6, B=5, C=5, D=3, quota=2.
// automaticQualifiers=[A], drawCandidates=[B,C], availableSlots=1, pending_draw.
const EXAMPLE_TEAMS = [
  { teamId: 'A', points: 6 },
  { teamId: 'B', points: 5 },
  { teamId: 'C', points: 5 },
  { teamId: 'D', points: 3 },
];

describe('resolveQualificationCutoff — canonical example', () => {
  it('A=6,B=5,C=5,D=3 quota=2 -> automaticQualifiers=[A], drawCandidates=[B,C], availableSlots=1, pending_draw', () => {
    const result = resolve({ teams: EXAMPLE_TEAMS, qualifyRankPerGroup: 2, isGroupComplete: true });
    expect(result.automaticQualifiers).toEqual(['A']);
    expect(result.drawCandidates.sort()).toEqual(['B', 'C']);
    expect(result.availableSlots).toBe(1);
    expect(result.qualificationState).toBe('pending_draw');
    expect(result.automaticEliminated).toEqual(['D']);
  });

  it('after Admin records B as drawn -> automaticQualifiers=[A], selectedByDraw=[B], eliminatedByDraw=[C], draw_recorded', () => {
    const snapshot = resolve({ teams: EXAMPLE_TEAMS, qualifyRankPerGroup: 2, isGroupComplete: true }).candidateSnapshot;
    const result = resolve({
      teams: EXAMPLE_TEAMS,
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
      existingDraw: { selectedTeamIds: ['B'], candidateSnapshot: snapshot },
    });
    expect(result.automaticQualifiers).toEqual(['A']);
    expect(result.selectedByDraw).toEqual(['B']);
    expect(result.eliminatedByDraw).toEqual(['C']);
    expect(result.qualificationState).toBe('draw_recorded');
  });
});

describe('resolveQualificationCutoff — pure logic (tasks 1-18)', () => {
  it('1. no tie at the cutoff -> resolved automatically', () => {
    const result = resolve({
      teams: [{ teamId: 'A', points: 9 }, { teamId: 'B', points: 6 }, { teamId: 'C', points: 3 }, { teamId: 'D', points: 0 }],
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
    });
    expect(result.qualificationState).toBe('resolved');
    expect(result.automaticQualifiers.sort()).toEqual(['A', 'B']);
    expect(result.automaticEliminated.sort()).toEqual(['C', 'D']);
    expect(result.drawCandidates).toEqual([]);
  });

  it('2. two teams tied for 1 slot -> pending_draw', () => {
    const result = resolve({
      teams: [{ teamId: 'A', points: 9 }, { teamId: 'B', points: 5 }, { teamId: 'C', points: 5 }],
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
    });
    expect(result.qualificationState).toBe('pending_draw');
    expect(result.availableSlots).toBe(1);
    expect(result.drawCandidates.sort()).toEqual(['B', 'C']);
  });

  it('3. three teams tied for 1 slot -> pending_draw, 1 of 3', () => {
    const result = resolve({
      teams: [{ teamId: 'A', points: 9 }, { teamId: 'B', points: 5 }, { teamId: 'C', points: 5 }, { teamId: 'D', points: 5 }],
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
    });
    expect(result.qualificationState).toBe('pending_draw');
    expect(result.availableSlots).toBe(1);
    expect(result.drawCandidates.sort()).toEqual(['B', 'C', 'D']);
  });

  it('4. three teams tied for 2 slots -> pending_draw, 2 of 3', () => {
    const result = resolve({
      teams: [{ teamId: 'A', points: 5 }, { teamId: 'B', points: 5 }, { teamId: 'C', points: 5 }, { teamId: 'D', points: 0 }],
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
    });
    expect(result.qualificationState).toBe('pending_draw');
    expect(result.availableSlots).toBe(2);
    expect(result.drawCandidates.sort()).toEqual(['A', 'B', 'C']);
  });

  it('5. tie cluster entirely above the cutoff -> all qualify, no draw', () => {
    const result = resolve({
      teams: [{ teamId: 'A', points: 5 }, { teamId: 'B', points: 5 }, { teamId: 'C', points: 5 }, { teamId: 'D', points: 0 }],
      qualifyRankPerGroup: 3,
      isGroupComplete: true,
    });
    expect(result.qualificationState).toBe('resolved');
    expect(result.automaticQualifiers.sort()).toEqual(['A', 'B', 'C']);
    expect(result.drawCandidates).toEqual([]);
  });

  it('6. tie cluster entirely below the cutoff -> all eliminated, no draw', () => {
    const result = resolve({
      teams: [{ teamId: 'A', points: 9 }, { teamId: 'B', points: 9 }, { teamId: 'C', points: 3 }, { teamId: 'D', points: 3 }],
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
    });
    expect(result.qualificationState).toBe('resolved');
    expect(result.automaticQualifiers.sort()).toEqual(['A', 'B']);
    expect(result.automaticEliminated.sort()).toEqual(['C', 'D']);
  });

  it('7. tie straddles cutoff even though H2H would separate them -> pending_draw (resolver never sees H2H, points alone decide)', () => {
    // Points-only input — the resolver has no H2H concept at all, proving it
    // cannot possibly use it.
    const result = resolve({
      teams: [{ teamId: 'A', points: 9 }, { teamId: 'B', points: 5 }, { teamId: 'C', points: 5 }],
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
    });
    expect(result.qualificationState).toBe('pending_draw');
  });

  it('8. tie straddles cutoff regardless of GD -> pending_draw (resolver has no GD concept)', () => {
    const result = resolve({
      teams: [{ teamId: 'A', points: 9 }, { teamId: 'B', points: 5 }, { teamId: 'C', points: 5 }],
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
    });
    expect(result.qualificationState).toBe('pending_draw');
  });

  it('9. tie straddles cutoff regardless of GF -> pending_draw (resolver has no GF concept)', () => {
    const result = resolve({
      teams: [{ teamId: 'A', points: 9 }, { teamId: 'B', points: 5 }, { teamId: 'C', points: 5 }],
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
    });
    expect(result.qualificationState).toBe('pending_draw');
  });

  it('10. tie straddles cutoff regardless of Fair Play -> pending_draw (resolver has no Fair Play concept)', () => {
    const result = resolve({
      teams: [{ teamId: 'A', points: 9 }, { teamId: 'B', points: 5 }, { teamId: 'C', points: 5 }],
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
    });
    expect(result.qualificationState).toBe('pending_draw');
  });

  it('11. the resolver module performs no randomization anywhere', () => {
    const source = readFileSync(join(__dirname, '..', 'resolveQualificationCutoff.ts'), 'utf-8');
    expect(source).not.toMatch(/Math\.random|crypto\.getRandomValues/);
  });

  it('12. manual result filling exactly the available slots -> draw_recorded', () => {
    const pending = resolve({ teams: EXAMPLE_TEAMS, qualifyRankPerGroup: 2, isGroupComplete: true });
    const result = resolve({
      teams: EXAMPLE_TEAMS,
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
      existingDraw: { selectedTeamIds: ['B'], candidateSnapshot: pending.candidateSnapshot },
    });
    expect(result.qualificationState).toBe('draw_recorded');
  });

  it('13/14/15/16. selection validation: over-selection, under-selection, non-candidate, duplicate all rejected', () => {
    expect(validateQualificationDrawSelection({ drawCandidates: ['B', 'C'], availableSlots: 1, selectedTeamIds: ['B', 'C'] })).toMatchObject({
      ok: false,
      code: 'QUALIFICATION_CUTOFF_DRAW_SELECTION_COUNT_MISMATCH',
    });
    expect(validateQualificationDrawSelection({ drawCandidates: ['B', 'C', 'D'], availableSlots: 2, selectedTeamIds: ['B'] })).toMatchObject({
      ok: false,
      code: 'QUALIFICATION_CUTOFF_DRAW_SELECTION_COUNT_MISMATCH',
    });
    expect(validateQualificationDrawSelection({ drawCandidates: ['B', 'C'], availableSlots: 1, selectedTeamIds: ['Z'] })).toMatchObject({
      ok: false,
      code: 'QUALIFICATION_CUTOFF_DRAW_SELECTION_NOT_CANDIDATE',
    });
    expect(validateQualificationDrawSelection({ drawCandidates: ['B', 'C', 'D'], availableSlots: 2, selectedTeamIds: ['B', 'B'] })).toMatchObject({
      ok: false,
      code: 'QUALIFICATION_CUTOFF_DRAW_DUPLICATE_SELECTION',
    });
  });

  it('17. eliminatedByDraw is exactly the cluster minus selected', () => {
    const teams = [{ teamId: 'A', points: 5 }, { teamId: 'B', points: 5 }, { teamId: 'C', points: 5 }, { teamId: 'D', points: 0 }];
    const pending = resolve({ teams, qualifyRankPerGroup: 2, isGroupComplete: true });
    const result = resolve({
      teams,
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
      existingDraw: { selectedTeamIds: ['A', 'C'], candidateSnapshot: pending.candidateSnapshot },
    });
    expect(result.selectedByDraw.sort()).toEqual(['A', 'C']);
    expect(result.eliminatedByDraw).toEqual(['B']);
  });

  it('18. incomplete group -> incomplete state, no decision made', () => {
    const result = resolve({ teams: EXAMPLE_TEAMS, qualifyRankPerGroup: 2, isGroupComplete: false });
    expect(result.qualificationState).toBe('incomplete');
    expect(result.automaticQualifiers).toEqual([]);
    expect(result.drawCandidates).toEqual([]);
  });
});

describe('resolveQualificationCutoff — stale draw detection', () => {
  it('a recorded draw whose candidateSnapshot no longer matches the fresh pool is stale_draw, not silently reused', () => {
    const result = resolve({
      teams: EXAMPLE_TEAMS,
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
      existingDraw: { selectedTeamIds: ['B'], candidateSnapshot: 'v2|slots=1|candidates=STALE,VALUE|rev=irrelevant' },
    });
    expect(result.qualificationState).toBe('stale_draw');
    expect(result.selectedByDraw).toEqual([]);
  });
});

describe('resolveQualificationCutoff — resurrection safety (officialResultRevision)', () => {
  it('buildOfficialResultRevision is deterministic and order-independent, and changes when any match version changes', () => {
    const a = buildOfficialResultRevision([{ matchId: 'm1', version: 1 }, { matchId: 'm2', version: 3 }]);
    const b = buildOfficialResultRevision([{ matchId: 'm2', version: 3 }, { matchId: 'm1', version: 1 }]);
    expect(a).toBe(b);

    const c = buildOfficialResultRevision([{ matchId: 'm1', version: 2 }, { matchId: 'm2', version: 3 }]);
    expect(c).not.toBe(a);
  });

  it('a draw recorded against one revision is stale_draw when read back under a DIFFERENT revision, even if the candidate set and slots are byte-identical (the actual resurrection bug this fix prevents)', () => {
    const teams = EXAMPLE_TEAMS;
    const revisionAtDrawTime = buildOfficialResultRevision([{ matchId: 'm1', version: 1 }, { matchId: 'm2', version: 1 }]);
    const originalResolution = resolveQualificationCutoff({
      teams,
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
      officialResultRevision: revisionAtDrawTime,
    });
    expect(originalResolution.qualificationState).toBe('pending_draw');
    const recordedDraw = { selectedTeamIds: ['B'], candidateSnapshot: originalResolution.candidateSnapshot };

    // Two Score Corrections happen (m1's version bumps twice: 1 -> 2 -> 3),
    // but suppose the SECOND correction reverts scores so the derived
    // points/candidate SET is byte-identical to the original (still
    // A=6,B=5,C=5,D=3) — this is exactly the "candidate pool comes back"
    // scenario. Without officialResultRevision, the old lossy snapshot
    // ('v1|slots=1|candidates=B,C') would match again and silently
    // resurrect the stale draw as 'draw_recorded'.
    const revisionAfterRevert = buildOfficialResultRevision([{ matchId: 'm1', version: 3 }, { matchId: 'm2', version: 1 }]);
    expect(revisionAfterRevert).not.toBe(revisionAtDrawTime);

    const afterRevert = resolveQualificationCutoff({
      teams, // byte-identical points to the original draw's candidate pool
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
      officialResultRevision: revisionAfterRevert,
      existingDraw: recordedDraw,
    });
    expect(afterRevert.qualificationState).toBe('stale_draw');
    expect(afterRevert.selectedByDraw).toEqual([]);
  });

  it('a draw recorded and read back under the EXACT SAME revision is correctly draw_recorded (no false positives)', () => {
    const revision = buildOfficialResultRevision([{ matchId: 'm1', version: 1 }, { matchId: 'm2', version: 1 }]);
    const preview = resolveQualificationCutoff({ teams: EXAMPLE_TEAMS, qualifyRankPerGroup: 2, isGroupComplete: true, officialResultRevision: revision });
    const result = resolveQualificationCutoff({
      teams: EXAMPLE_TEAMS,
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
      officialResultRevision: revision,
      existingDraw: { selectedTeamIds: ['B'], candidateSnapshot: preview.candidateSnapshot },
    });
    expect(result.qualificationState).toBe('draw_recorded');
  });
});

describe('resolveQualificationCutoff — edge cases', () => {
  it('group size equal to quota -> everyone qualifies, no cutoff at all', () => {
    const result = resolve({
      teams: [{ teamId: 'A', points: 3 }, { teamId: 'B', points: 0 }],
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
    });
    expect(result.qualificationState).toBe('resolved');
    expect(result.automaticQualifiers.sort()).toEqual(['A', 'B']);
    expect(result.cutoffPoints).toBeNull();
  });

  it('does not use team array order to decide who is in the cluster (order-independent)', () => {
    const a = resolve({ teams: EXAMPLE_TEAMS, qualifyRankPerGroup: 2, isGroupComplete: true });
    const b = resolve({ teams: [...EXAMPLE_TEAMS].reverse(), qualifyRankPerGroup: 2, isGroupComplete: true });
    expect(a.drawCandidates).toEqual(b.drawCandidates);
    expect(a.automaticQualifiers).toEqual(b.automaticQualifiers);
  });
});

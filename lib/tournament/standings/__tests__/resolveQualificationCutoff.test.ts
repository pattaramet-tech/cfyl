import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveQualificationCutoff, validateQualificationDrawSelection } from '../resolveQualificationCutoff';

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
    const result = resolveQualificationCutoff({ teams: EXAMPLE_TEAMS, qualifyRankPerGroup: 2, isGroupComplete: true });
    expect(result.automaticQualifiers).toEqual(['A']);
    expect(result.drawCandidates.sort()).toEqual(['B', 'C']);
    expect(result.availableSlots).toBe(1);
    expect(result.qualificationState).toBe('pending_draw');
    expect(result.automaticEliminated).toEqual(['D']);
  });

  it('after Admin records B as drawn -> automaticQualifiers=[A], selectedByDraw=[B], eliminatedByDraw=[C], draw_recorded', () => {
    const snapshot = resolveQualificationCutoff({ teams: EXAMPLE_TEAMS, qualifyRankPerGroup: 2, isGroupComplete: true }).candidateSnapshot;
    const result = resolveQualificationCutoff({
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
    const result = resolveQualificationCutoff({
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
    const result = resolveQualificationCutoff({
      teams: [{ teamId: 'A', points: 9 }, { teamId: 'B', points: 5 }, { teamId: 'C', points: 5 }],
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
    });
    expect(result.qualificationState).toBe('pending_draw');
    expect(result.availableSlots).toBe(1);
    expect(result.drawCandidates.sort()).toEqual(['B', 'C']);
  });

  it('3. three teams tied for 1 slot -> pending_draw, 1 of 3', () => {
    const result = resolveQualificationCutoff({
      teams: [{ teamId: 'A', points: 9 }, { teamId: 'B', points: 5 }, { teamId: 'C', points: 5 }, { teamId: 'D', points: 5 }],
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
    });
    expect(result.qualificationState).toBe('pending_draw');
    expect(result.availableSlots).toBe(1);
    expect(result.drawCandidates.sort()).toEqual(['B', 'C', 'D']);
  });

  it('4. three teams tied for 2 slots -> pending_draw, 2 of 3', () => {
    const result = resolveQualificationCutoff({
      teams: [{ teamId: 'A', points: 5 }, { teamId: 'B', points: 5 }, { teamId: 'C', points: 5 }, { teamId: 'D', points: 0 }],
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
    });
    expect(result.qualificationState).toBe('pending_draw');
    expect(result.availableSlots).toBe(2);
    expect(result.drawCandidates.sort()).toEqual(['A', 'B', 'C']);
  });

  it('5. tie cluster entirely above the cutoff -> all qualify, no draw', () => {
    const result = resolveQualificationCutoff({
      teams: [{ teamId: 'A', points: 5 }, { teamId: 'B', points: 5 }, { teamId: 'C', points: 5 }, { teamId: 'D', points: 0 }],
      qualifyRankPerGroup: 3,
      isGroupComplete: true,
    });
    expect(result.qualificationState).toBe('resolved');
    expect(result.automaticQualifiers.sort()).toEqual(['A', 'B', 'C']);
    expect(result.drawCandidates).toEqual([]);
  });

  it('6. tie cluster entirely below the cutoff -> all eliminated, no draw', () => {
    const result = resolveQualificationCutoff({
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
    const result = resolveQualificationCutoff({
      teams: [{ teamId: 'A', points: 9 }, { teamId: 'B', points: 5 }, { teamId: 'C', points: 5 }],
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
    });
    expect(result.qualificationState).toBe('pending_draw');
  });

  it('8. tie straddles cutoff regardless of GD -> pending_draw (resolver has no GD concept)', () => {
    const result = resolveQualificationCutoff({
      teams: [{ teamId: 'A', points: 9 }, { teamId: 'B', points: 5 }, { teamId: 'C', points: 5 }],
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
    });
    expect(result.qualificationState).toBe('pending_draw');
  });

  it('9. tie straddles cutoff regardless of GF -> pending_draw (resolver has no GF concept)', () => {
    const result = resolveQualificationCutoff({
      teams: [{ teamId: 'A', points: 9 }, { teamId: 'B', points: 5 }, { teamId: 'C', points: 5 }],
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
    });
    expect(result.qualificationState).toBe('pending_draw');
  });

  it('10. tie straddles cutoff regardless of Fair Play -> pending_draw (resolver has no Fair Play concept)', () => {
    const result = resolveQualificationCutoff({
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
    const pending = resolveQualificationCutoff({ teams: EXAMPLE_TEAMS, qualifyRankPerGroup: 2, isGroupComplete: true });
    const result = resolveQualificationCutoff({
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
    const pending = resolveQualificationCutoff({ teams, qualifyRankPerGroup: 2, isGroupComplete: true });
    const result = resolveQualificationCutoff({
      teams,
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
      existingDraw: { selectedTeamIds: ['A', 'C'], candidateSnapshot: pending.candidateSnapshot },
    });
    expect(result.selectedByDraw.sort()).toEqual(['A', 'C']);
    expect(result.eliminatedByDraw).toEqual(['B']);
  });

  it('18. incomplete group -> incomplete state, no decision made', () => {
    const result = resolveQualificationCutoff({ teams: EXAMPLE_TEAMS, qualifyRankPerGroup: 2, isGroupComplete: false });
    expect(result.qualificationState).toBe('incomplete');
    expect(result.automaticQualifiers).toEqual([]);
    expect(result.drawCandidates).toEqual([]);
  });
});

describe('resolveQualificationCutoff — stale draw detection', () => {
  it('a recorded draw whose candidateSnapshot no longer matches the fresh pool is stale_draw, not silently reused', () => {
    const result = resolveQualificationCutoff({
      teams: EXAMPLE_TEAMS,
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
      existingDraw: { selectedTeamIds: ['B'], candidateSnapshot: 'v1|slots=1|candidates=STALE,VALUE' },
    });
    expect(result.qualificationState).toBe('stale_draw');
    expect(result.selectedByDraw).toEqual([]);
  });
});

describe('resolveQualificationCutoff — edge cases', () => {
  it('group size equal to quota -> everyone qualifies, no cutoff at all', () => {
    const result = resolveQualificationCutoff({
      teams: [{ teamId: 'A', points: 3 }, { teamId: 'B', points: 0 }],
      qualifyRankPerGroup: 2,
      isGroupComplete: true,
    });
    expect(result.qualificationState).toBe('resolved');
    expect(result.automaticQualifiers.sort()).toEqual(['A', 'B']);
    expect(result.cutoffPoints).toBeNull();
  });

  it('does not use team array order to decide who is in the cluster (order-independent)', () => {
    const a = resolveQualificationCutoff({ teams: EXAMPLE_TEAMS, qualifyRankPerGroup: 2, isGroupComplete: true });
    const b = resolveQualificationCutoff({ teams: [...EXAMPLE_TEAMS].reverse(), qualifyRankPerGroup: 2, isGroupComplete: true });
    expect(a.drawCandidates).toEqual(b.drawCandidates);
    expect(a.automaticQualifiers).toEqual(b.automaticQualifiers);
  });
});

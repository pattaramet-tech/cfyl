import { describe, expect, it } from 'vitest';
import {
  extractEligibleThirdPlaceCandidates,
  identifyG16ThirdPlaceCandidates,
  rankBestThirdPlacedTeams,
} from '../rankCrossGroupCandidates';
import type { GroupStandingsResult, StandingsRow } from '../types';

function row(overrides: Partial<StandingsRow> = {}): StandingsRow {
  return {
    teamId: 'team-x',
    teamName: 'Team X',
    teamCode: 'X',
    groupId: 'group-a',
    groupCode: 'A',
    position: 3,
    played: 3,
    won: 1,
    lost: 2,
    goalsFor: 3,
    goalsAgainst: 3,
    goalDifference: 0,
    points: 3,
    fairPlayScore: 0,
    qualificationStatus: 'pending',
    tiebreakExplanation: 'ไม่มีทีมอื่นคะแนนเท่ากัน',
    tieState: 'resolved',
    overrideApplied: false,
    overrideReason: null,
    overrideRejectedReason: null,
    ...overrides,
  };
}

function group(overrides: Partial<GroupStandingsResult> = {}): GroupStandingsResult {
  return {
    groupId: 'group-a',
    groupCode: 'A',
    isComplete: true,
    qualificationCutoffState: 'resolved',
    rows: [
      row({ position: 1, points: 9 }),
      row({ position: 2, points: 6 }),
      row({ position: 3, points: 3 }),
    ],
    ...overrides,
  };
}

describe('rankCrossGroupCandidates — D-07 ranked method', () => {
  it('extracts exactly the resolved third-place team from each complete group', () => {
    const groups = [
      group({ groupId: 'g1', groupCode: 'A' }),
      group({
        groupId: 'g2',
        groupCode: 'B',
        rows: [
          row({ teamId: 't4', position: 1, groupId: 'g2', groupCode: 'B' }),
          row({ teamId: 't5', position: 2, groupId: 'g2', groupCode: 'B' }),
          row({ teamId: 't6', position: 3, groupId: 'g2', groupCode: 'B' }),
        ],
      }),
    ];
    const { candidates, isComplete } = extractEligibleThirdPlaceCandidates(groups);
    expect(isComplete).toBe(true);
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.rank === 3)).toBe(true);
  });

  it('excludes a group whose standings are incomplete', () => {
    const groups = [group({ isComplete: false })];
    const { candidates, isComplete, incompleteReason } = extractEligibleThirdPlaceCandidates(groups);
    expect(candidates).toHaveLength(0);
    expect(isComplete).toBe(false);
    expect(incompleteReason).toContain('A');
  });

  it('excludes a group whose Qualification Cutoff Tie Draw is still pending, even when the 3rd-place row display order is fully resolved (H2H/GD/GF separated them)', () => {
    // Deliberately tieState='resolved' at position 3 (standings ORDERING is
    // fully decided) but qualificationCutoffState='pending_draw' (the
    // group's own qualifyRankPerGroup cutoff is points-tied and awaiting a
    // manual draw) — proves these two concepts are gated independently.
    const groups = [group({ qualificationCutoffState: 'pending_draw' })];
    const { candidates, isComplete, incompleteReason } = extractEligibleThirdPlaceCandidates(groups);
    expect(candidates).toHaveLength(0);
    expect(isComplete).toBe(false);
    expect(incompleteReason).toContain('รอผลจับฉลาก');
  });

  it('includes a group whose Qualification Cutoff Tie Draw has been recorded (draw_recorded is treated as final, same as resolved)', () => {
    const groups = [group({ qualificationCutoffState: 'draw_recorded' })];
    const { candidates, isComplete } = extractEligibleThirdPlaceCandidates(groups);
    expect(isComplete).toBe(true);
    expect(candidates).toHaveLength(1);
  });

  it('excludes a third place still pending a tiebreak draw (not yet resolved)', () => {
    const groups = [
      group({
        rows: [
          row({ position: 1, points: 9 }),
          row({ position: 2, points: 6 }),
          row({ position: 3, points: 3, tieState: 'pending_draw' }),
        ],
      }),
    ];
    const { candidates, isComplete } = extractEligibleThirdPlaceCandidates(groups);
    expect(candidates).toHaveLength(0);
    expect(isComplete).toBe(false);
  });

  it('ranks best-third-place by points -> GD -> GF -> Fair Play when all candidates played the same number of counted matches', () => {
    const candidates = [
      { teamId: 't1', teamName: 'T1', teamCode: 'T1', groupId: 'g1', groupCode: 'A', rank: 3, points: 3, goalDifference: 0, goalsFor: 2, fairPlayScore: -1, countedMatches: 3 },
      { teamId: 't2', teamName: 'T2', teamCode: 'T2', groupId: 'g2', groupCode: 'B', rank: 3, points: 4, goalDifference: 0, goalsFor: 1, fairPlayScore: 0, countedMatches: 3 },
      { teamId: 't3', teamName: 'T3', teamCode: 'T3', groupId: 'g3', groupCode: 'C', rank: 3, points: 3, goalDifference: 1, goalsFor: 2, fairPlayScore: 0, countedMatches: 3 },
    ];
    const { ranked, fullyResolved, state } = rankBestThirdPlacedTeams(candidates);
    expect(ranked.map((c) => c.teamId)).toEqual(['t2', 't3', 't1']);
    expect(fullyResolved).toBe(true);
    expect(state).toBe('resolved');
  });

  it('reports fullyResolved=false when two candidates remain tied on every criterion (never invents a draw winner)', () => {
    const candidates = [
      { teamId: 't1', teamName: 'T1', teamCode: 'T1', groupId: 'g1', groupCode: 'A', rank: 3, points: 3, goalDifference: 1, goalsFor: 2, fairPlayScore: 0, countedMatches: 3 },
      { teamId: 't2', teamName: 'T2', teamCode: 'T2', groupId: 'g2', groupCode: 'B', rank: 3, points: 3, goalDifference: 1, goalsFor: 2, fairPlayScore: 0, countedMatches: 3 },
    ];
    const { fullyResolved, explanation, state } = rankBestThirdPlacedTeams(candidates);
    expect(fullyResolved).toBe(false);
    expect(state).toBe('unresolved_tie');
    expect(explanation).toContain('จับฉลาก');
  });

  it('returns normalization_required when candidates played an unequal number of counted matches (no approved normalization rule)', () => {
    const candidates = [
      { teamId: 't1', teamName: 'T1', teamCode: 'T1', groupId: 'g1', groupCode: 'A', rank: 3, points: 9, goalDifference: 5, goalsFor: 8, fairPlayScore: 0, countedMatches: 4 },
      { teamId: 't2', teamName: 'T2', teamCode: 'T2', groupId: 'g2', groupCode: 'B', rank: 3, points: 6, goalDifference: 2, goalsFor: 4, fairPlayScore: 0, countedMatches: 3 },
    ];
    const { ranked, fullyResolved, state, explanation } = rankBestThirdPlacedTeams(candidates);
    expect(state).toBe('normalization_required');
    expect(fullyResolved).toBe(false);
    // No qualification selection occurs while normalization is required.
    expect(ranked).toEqual([]);
    expect(explanation).toContain('ยังไม่สามารถเปรียบเทียบทีมอันดับ 3 ข้ามกลุ่มได้');
  });
});

describe('identifyG16ThirdPlaceCandidates — D-29 draw method (identification only, never selection)', () => {
  it('returns exactly three candidates when all three groups have resolved third places', () => {
    const groups = [
      group({ groupId: 'g1', groupCode: 'A' }),
      group({
        groupId: 'g2',
        groupCode: 'B',
        rows: [
          row({ teamId: 't4', position: 1, groupId: 'g2', groupCode: 'B' }),
          row({ teamId: 't5', position: 2, groupId: 'g2', groupCode: 'B' }),
          row({ teamId: 't6', position: 3, groupId: 'g2', groupCode: 'B' }),
        ],
      }),
      group({
        groupId: 'g3',
        groupCode: 'C',
        rows: [
          row({ teamId: 't7', position: 1, groupId: 'g3', groupCode: 'C' }),
          row({ teamId: 't8', position: 2, groupId: 'g3', groupCode: 'C' }),
          row({ teamId: 't9', position: 3, groupId: 'g3', groupCode: 'C' }),
        ],
      }),
    ];
    const result = identifyG16ThirdPlaceCandidates(groups);
    expect(result.isComplete).toBe(true);
    expect(result.candidates).toHaveLength(3);
    // One candidate per group, exactly.
    expect(result.candidates.map((c) => c.groupCode).sort()).toEqual(['A', 'B', 'C']);
  });

  it('never selects or ranks — the returned candidate order carries no selection meaning, and the function has no rank/select output field', () => {
    const groups = [
      group({ groupId: 'g1', groupCode: 'A' }),
      group({
        groupId: 'g2',
        groupCode: 'B',
        rows: [
          row({ teamId: 't4', position: 1, groupId: 'g2', groupCode: 'B' }),
          row({ teamId: 't5', position: 2, groupId: 'g2', groupCode: 'B' }),
          row({ teamId: 't6', position: 3, groupId: 'g2', groupCode: 'B' }),
        ],
      }),
      group({
        groupId: 'g3',
        groupCode: 'C',
        rows: [
          row({ teamId: 't7', position: 1, groupId: 'g3', groupCode: 'C' }),
          row({ teamId: 't8', position: 2, groupId: 'g3', groupCode: 'C' }),
          row({ teamId: 't9', position: 3, groupId: 'g3', groupCode: 'C' }),
        ],
      }),
    ];
    const result = identifyG16ThirdPlaceCandidates(groups);
    expect(Object.keys(result)).toEqual(['candidates', 'isComplete', 'incompleteReason']);
    expect((result as unknown as { selected?: unknown }).selected).toBeUndefined();
  });

  it('marks incomplete with an explanatory reason when fewer than three groups produce a resolved third place', () => {
    const groups = [group({ groupId: 'g1', groupCode: 'A' }), group({ groupId: 'g2', groupCode: 'B', isComplete: false })];
    const result = identifyG16ThirdPlaceCandidates(groups);
    expect(result.isComplete).toBe(false);
    expect(result.incompleteReason).toBeTruthy();
    expect(result.candidates.length).toBeLessThan(3);
  });
});

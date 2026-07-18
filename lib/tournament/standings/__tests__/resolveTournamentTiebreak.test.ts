import { describe, expect, it } from 'vitest';
import { resolveTournamentTiebreak } from '../resolveTournamentTiebreak';
import type { OfficialMatchResult, TeamRawStats } from '../types';

function stats(overrides: Partial<TeamRawStats> = {}): TeamRawStats {
  return {
    teamId: 'team-x',
    teamName: 'Team X',
    teamCode: 'X',
    groupId: 'group-1',
    played: 3,
    won: 1,
    lost: 2,
    goalsFor: 3,
    goalsAgainst: 3,
    goalDifference: 0,
    points: 3,
    fairPlayScore: 0,
    ...overrides,
  };
}

function match(overrides: Partial<OfficialMatchResult> = {}): OfficialMatchResult {
  return {
    matchId: 'm',
    groupId: 'group-1',
    categoryId: 'cat-1',
    homeTeamId: 'team-a',
    awayTeamId: 'team-b',
    regulationHomeScore: 1,
    regulationAwayScore: 0,
    winnerTeamId: 'team-a',
    decidedBy: 'regulation',
    ...overrides,
  };
}

describe('resolveTournamentTiebreak — D-09 recursive mini-league', () => {
  it('two-team tie resolved directly by head-to-head', () => {
    const teams = [stats({ teamId: 'team-a', points: 6 }), stats({ teamId: 'team-b', points: 6 })];
    const matches = [match({ matchId: 'm1', homeTeamId: 'team-a', awayTeamId: 'team-b', winnerTeamId: 'team-a' })];
    const result = resolveTournamentTiebreak({ pointsTiedTeams: teams, groupMatches: matches });
    expect(result.find((r) => r.teamId === 'team-a')?.position).toBe(1);
    expect(result.find((r) => r.teamId === 'team-b')?.position).toBe(2);
    expect(result.find((r) => r.teamId === 'team-a')?.explanation).toContain('Head-to-head');
    expect(result.every((r) => r.tieState === 'resolved')).toBe(true);
  });

  it('four-team cluster: head-to-head fully separates the top and bottom singleton; the remaining shrunk pair (with no direct meeting recorded) recurses into group-wide GD', () => {
    // A/B/C/D all tied on points=6 entering the tiebreak. First head-to-head
    // pass (computed across all four) fully separates A (beats everyone) as
    // the clear top and D (loses to everyone) as the clear bottom singleton.
    // B and C never played each other in this fixture (e.g. an unresolved
    // pairing within an otherwise-scheduled group) so their head-to-head
    // totals against the shared opponents A and D tie exactly - the engine
    // must recurse head-to-head on just the shrunk {B, C} pair (proving the
    // cluster genuinely shrank from 4 to 2), find nothing new there (no B-vs-C
    // match exists), and correctly fall through to group-wide goal difference
    // to finish resolving them - never inventing a random winner.
    const teams = [
      stats({ teamId: 'team-a', points: 6, goalDifference: 6, goalsFor: 6 }),
      stats({ teamId: 'team-b', points: 6, goalDifference: 3, goalsFor: 3 }),
      stats({ teamId: 'team-c', points: 6, goalDifference: 1, goalsFor: 1 }),
      stats({ teamId: 'team-d', points: 6, goalDifference: -10, goalsFor: 0 }),
    ];
    const matches = [
      match({ matchId: 'm1', homeTeamId: 'team-a', awayTeamId: 'team-b', winnerTeamId: 'team-a', regulationHomeScore: 2, regulationAwayScore: 0 }),
      match({ matchId: 'm2', homeTeamId: 'team-a', awayTeamId: 'team-c', winnerTeamId: 'team-a', regulationHomeScore: 2, regulationAwayScore: 0 }),
      match({ matchId: 'm3', homeTeamId: 'team-a', awayTeamId: 'team-d', winnerTeamId: 'team-a', regulationHomeScore: 2, regulationAwayScore: 0 }),
      match({ matchId: 'm4', homeTeamId: 'team-b', awayTeamId: 'team-d', winnerTeamId: 'team-b', regulationHomeScore: 1, regulationAwayScore: 0 }),
      match({ matchId: 'm5', homeTeamId: 'team-c', awayTeamId: 'team-d', winnerTeamId: 'team-c', regulationHomeScore: 1, regulationAwayScore: 0 }),
      // Deliberately no team-b vs team-c match in this fixture.
    ];
    const result = resolveTournamentTiebreak({ pointsTiedTeams: teams, groupMatches: matches });
    const a = result.find((r) => r.teamId === 'team-a')!;
    const b = result.find((r) => r.teamId === 'team-b')!;
    const c = result.find((r) => r.teamId === 'team-c')!;
    const d = result.find((r) => r.teamId === 'team-d')!;
    expect(a.position).toBe(1);
    expect(a.explanation).toContain('Head-to-head');
    expect(d.position).toBe(4);
    expect(d.explanation).toContain('Head-to-head');
    // B and C: tied on head-to-head (no meeting recorded), separated instead
    // by group-wide goal difference (B=+3 > C=+1).
    expect(b.position).toBe(2);
    expect(c.position).toBe(3);
    expect(b.explanation).toContain('ผลต่างประตู');
    expect(result.every((r) => r.tieState === 'resolved')).toBe(true);
  });

  it('fully unresolved tie after all approved criteria returns pending_draw, never a random winner', () => {
    // Two teams with completely identical stats and no matches between them
    // at all (both play only a third opponent, identically).
    const teams = [
      stats({ teamId: 'team-a', points: 3, goalDifference: 2, goalsFor: 2, fairPlayScore: 0 }),
      stats({ teamId: 'team-b', points: 3, goalDifference: 2, goalsFor: 2, fairPlayScore: 0 }),
    ];
    const matches: OfficialMatchResult[] = [];
    const result = resolveTournamentTiebreak({ pointsTiedTeams: teams, groupMatches: matches });
    expect(result.every((r) => r.tieState === 'pending_draw')).toBe(true);
    expect(result.map((r) => r.teamId).sort()).toEqual(['team-a', 'team-b']);
  });

  it('group-wide goal difference separates teams when head-to-head is fully tied', () => {
    const teams = [
      stats({ teamId: 'team-a', points: 3, goalDifference: 5, goalsFor: 6, fairPlayScore: 0 }),
      stats({ teamId: 'team-b', points: 3, goalDifference: 1, goalsFor: 2, fairPlayScore: 0 }),
    ];
    const matches: OfficialMatchResult[] = [];
    const result = resolveTournamentTiebreak({ pointsTiedTeams: teams, groupMatches: matches });
    expect(result.find((r) => r.teamId === 'team-a')?.position).toBe(1);
    expect(result.find((r) => r.teamId === 'team-a')?.explanation).toContain('ผลต่างประตู');
    expect(result.every((r) => r.tieState === 'resolved')).toBe(true);
  });

  it('Fair Play separates teams when points/h2h/group GD/GF are all tied', () => {
    const teams = [
      stats({ teamId: 'team-a', points: 3, goalDifference: 1, goalsFor: 1, fairPlayScore: 0 }),
      stats({ teamId: 'team-b', points: 3, goalDifference: 1, goalsFor: 1, fairPlayScore: -4 }),
    ];
    const matches: OfficialMatchResult[] = [];
    const result = resolveTournamentTiebreak({ pointsTiedTeams: teams, groupMatches: matches });
    expect(result.find((r) => r.teamId === 'team-a')?.position).toBe(1);
    expect(result.find((r) => r.teamId === 'team-a')?.explanation).toContain('แฟร์เพลย์');
    expect(result.every((r) => r.tieState === 'resolved')).toBe(true);
  });

  it('single team "tie" (defensive case) resolves trivially', () => {
    const result = resolveTournamentTiebreak({ pointsTiedTeams: [stats({ teamId: 'team-a' })], groupMatches: [] });
    expect(result).toEqual([{ teamId: 'team-a', position: 1, explanation: 'ไม่มีทีมอื่นคะแนนเท่ากัน', tieState: 'resolved' }]);
  });

  it('is deterministic: same input always produces same ordering and explanation', () => {
    const teams = [stats({ teamId: 'team-a', points: 3 }), stats({ teamId: 'team-b', points: 3 })];
    const matches = [match({ matchId: 'm1', homeTeamId: 'team-a', awayTeamId: 'team-b', winnerTeamId: 'team-a' })];
    const run1 = resolveTournamentTiebreak({ pointsTiedTeams: teams, groupMatches: matches });
    const run2 = resolveTournamentTiebreak({ pointsTiedTeams: teams, groupMatches: matches });
    expect(run1).toEqual(run2);
  });
});

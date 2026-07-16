import { describe, expect, it } from 'vitest';
import { buildFairPlayEvents, calculateFairPlayScore, type RawCardRow } from '../calculateFairPlayScore';

function card(overrides: Partial<RawCardRow> = {}): RawCardRow {
  return { matchId: 'match-1', playerId: 'player-1', teamId: 'team-a', cardType: 'yellow', ...overrides };
}

describe('calculateFairPlayScore — D-06 event classification', () => {
  it('single yellow = -1', () => {
    const events = buildFairPlayEvents([card({ cardType: 'yellow' })]);
    expect(events).toEqual([{ matchId: 'match-1', playerId: 'player-1', points: -1 }]);
  });

  it('second yellow (sending-off) = -3', () => {
    const events = buildFairPlayEvents([card({ cardType: 'second_yellow' })]);
    expect(events[0].points).toBe(-3);
  });

  it('direct red = -4', () => {
    const events = buildFairPlayEvents([card({ cardType: 'red' })]);
    expect(events[0].points).toBe(-4);
  });

  it('yellow followed by direct red in the same match = -5', () => {
    const events = buildFairPlayEvents([card({ cardType: 'yellow' }), card({ cardType: 'red' })]);
    expect(events).toHaveLength(1);
    expect(events[0].points).toBe(-5);
  });

  it('no cards = no event', () => {
    expect(buildFairPlayEvents([])).toEqual([]);
  });

  it('deducts only the single most severe event per player per match (never sums separately)', () => {
    // yellow + red should be exactly -5, not -1 + -4 = -5 coincidentally summed twice.
    const events = buildFairPlayEvents([card({ cardType: 'yellow' }), card({ cardType: 'red' })]);
    expect(events).toHaveLength(1);
  });

  it('sums per-player events across multiple matches for a team total', () => {
    const cards = [
      card({ matchId: 'match-1', playerId: 'p1', teamId: 'team-a', cardType: 'yellow' }),
      card({ matchId: 'match-2', playerId: 'p2', teamId: 'team-a', cardType: 'red' }),
    ];
    expect(calculateFairPlayScore(cards, 'team-a')).toBe(-1 + -4);
  });

  it('a team with fewer total deductions has a higher (less negative) score', () => {
    const cleanTeam = calculateFairPlayScore([], 'team-a');
    const dirtyTeam = calculateFairPlayScore([card({ teamId: 'team-b', cardType: 'red' })], 'team-b');
    expect(cleanTeam).toBeGreaterThan(dirtyTeam);
  });

  it('only counts cards belonging to the requested team', () => {
    const cards = [card({ teamId: 'team-a', cardType: 'red' }), card({ teamId: 'team-b', cardType: 'yellow', playerId: 'p2' })];
    expect(calculateFairPlayScore(cards, 'team-a')).toBe(-4);
    expect(calculateFairPlayScore(cards, 'team-b')).toBe(-1);
  });
});

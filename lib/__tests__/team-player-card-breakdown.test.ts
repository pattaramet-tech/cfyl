import { describe, expect, it } from 'vitest';
import {
  buildPlayerCardBreakdown,
  createEmptyPlayerCardBreakdown,
  getVisiblePlayerCardBadges,
} from '../team-player-card-breakdown';

describe('team player card breakdown', () => {
  it('keeps yellow and red counts separate for the same player', () => {
    const breakdown = buildPlayerCardBreakdown([
      { player_id: 'p1', card_type: 'yellow' },
      { player_id: 'p1', card_type: 'yellow' },
      { player_id: 'p1', card_type: 'red' },
    ]).get('p1');

    expect(breakdown).toEqual({
      yellow: 2,
      red: 1,
      second_yellow: 0,
    });

    expect(getVisiblePlayerCardBadges(breakdown!)).toEqual([
      { cardType: 'yellow', icon: '🟨', count: 2 },
      { cardType: 'red', icon: '🟥', count: 1 },
    ]);
  });

  it('shows second yellow independently instead of folding it into yellow', () => {
    const breakdown = buildPlayerCardBreakdown([
      { player_id: 'p1', card_type: 'yellow' },
      { player_id: 'p1', card_type: 'second_yellow' },
    ]).get('p1');

    expect(breakdown).toEqual({
      yellow: 1,
      red: 0,
      second_yellow: 1,
    });

    expect(getVisiblePlayerCardBadges(breakdown!)).toEqual([
      { cardType: 'yellow', icon: '🟨', count: 1 },
      { cardType: 'second_yellow', icon: '🟨🟨', count: 1 },
    ]);
  });

  it('hides zero-value and unsupported card types from player badges', () => {
    const map = buildPlayerCardBreakdown([
      { player_id: 'p1', card_type: 'warning' },
    ]);

    expect(map.has('p1')).toBe(false);
    expect(getVisiblePlayerCardBadges(createEmptyPlayerCardBreakdown())).toEqual([]);
  });
});

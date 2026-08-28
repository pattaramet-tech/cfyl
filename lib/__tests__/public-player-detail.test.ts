import { describe, expect, it } from 'vitest';
import {
  buildPublicPlayerSummary,
  getPublicSuspensionHistoryStatus,
} from '../public-player-detail';

describe('Public Player Detail summary', () => {
  it('keeps yellow red and second-yellow counts independent and totals goals', () => {
    const summary = buildPublicPlayerSummary(
      [
        { match_id: 'm1', card_type: 'yellow' },
        { match_id: 'm2', card_type: 'yellow' },
        { match_id: 'm3', card_type: 'red' },
        { match_id: 'm4', card_type: 'second_yellow' },
      ],
      [
        { goals: 2, is_own_goal: false },
        { goals: 1, is_own_goal: false },
        { goals: 1, is_own_goal: true },
      ]
    );

    expect(summary).toEqual({
      goals: 3,
      yellow: 2,
      red: 1,
      second_yellow: 1,
      discipline_points: 14,
    });
  });

  it('uses per-match CFYL scoring instead of blindly summing card badge values', () => {
    const summary = buildPublicPlayerSummary(
      [
        { match_id: 'same-match', card_type: 'yellow' },
        { match_id: 'same-match', card_type: 'red' },
      ],
      []
    );

    expect(summary.discipline_points).toBe(8);
  });
});

describe('Public Player Detail suspension history status', () => {
  it('reports an empty unresolved serving assignment as no_next_match', () => {
    expect(
      getPublicSuspensionHistoryStatus(
        { serving_match_ids: [], ban_matches: 1, served_completed_at: null },
        new Map()
      )
    ).toBe('no_next_match');
  });

  it('reports scheduled serving slots as active and finished slots as served', () => {
    expect(
      getPublicSuspensionHistoryStatus(
        { serving_match_ids: ['cl1'], ban_matches: 1 },
        new Map([['cl1', { status: 'scheduled' }]])
      )
    ).toBe('active');

    expect(
      getPublicSuspensionHistoryStatus(
        { serving_match_ids: ['cl1'], ban_matches: 1 },
        new Map([['cl1', { status: 'finished' }]])
      )
    ).toBe('served');
  });

  it('preserves served_completed_at as authoritative history', () => {
    expect(
      getPublicSuspensionHistoryStatus(
        {
          serving_match_ids: [],
          ban_matches: 1,
          served_completed_at: '2026-08-22T14:00:00Z',
        },
        new Map()
      )
    ).toBe('served');
  });
});

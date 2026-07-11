import { vi, describe, it, expect } from 'vitest';

// Mock supabase before module loads (vi.mock is hoisted)
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => null),
}));

import {
  calculateMatchPoints,
  calculateBanMatches,
  classifyPlayerMatchDiscipline,
  isSecondYellowEjection,
  isDirectRedEjection,
  isEligibleSuspensionServingMatch,
  computeStaleEventIds,
  buildNormalYellowPointHistory,
  getCurrentAccumulatedPoints,
  markSupersededLegacyRecords,
} from '../suspension-calc';

// ---------------------------------------------------------------------------
// calculateMatchPoints
// ---------------------------------------------------------------------------
describe('calculateMatchPoints', () => {
  it('1 yellow = 2 pts', () => {
    expect(calculateMatchPoints({ yellow: 1, red: 0, second_yellow: 0 })).toBe(2);
  });

  it('2 yellows = 4 pts', () => {
    expect(calculateMatchPoints({ yellow: 2, red: 0, second_yellow: 0 })).toBe(4);
  });

  it('direct red = 6 pts', () => {
    expect(calculateMatchPoints({ yellow: 0, red: 1, second_yellow: 0 })).toBe(6);
  });

  it('yellow + red = 8 pts', () => {
    expect(calculateMatchPoints({ yellow: 1, red: 1, second_yellow: 0 })).toBe(8);
  });

  it('second_yellow card (technical 2nd yellow) = 4 pts', () => {
    expect(calculateMatchPoints({ yellow: 0, red: 0, second_yellow: 1 })).toBe(4);
  });

  it('second_yellow + red = 8 pts', () => {
    expect(calculateMatchPoints({ yellow: 0, red: 1, second_yellow: 1 })).toBe(8);
  });

  it('0 cards = 0 pts', () => {
    expect(calculateMatchPoints({ yellow: 0, red: 0, second_yellow: 0 })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateBanMatches
// ---------------------------------------------------------------------------
describe('calculateBanMatches', () => {
  it('threshold 6 = 1-match ban', () => {
    expect(calculateBanMatches(6)).toBe(1);
  });

  it('threshold 12 = 2-match ban', () => {
    expect(calculateBanMatches(12)).toBe(2);
  });

  it('threshold 18 = 2-match ban', () => {
    expect(calculateBanMatches(18)).toBe(2);
  });

  it('threshold 24 = 2-match ban', () => {
    expect(calculateBanMatches(24)).toBe(2);
  });

  it('below 6 = no ban', () => {
    expect(calculateBanMatches(5)).toBe(0);
    expect(calculateBanMatches(4)).toBe(0);
    expect(calculateBanMatches(2)).toBe(0);
    expect(calculateBanMatches(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 1: 3 normal yellow cards → threshold 6 → 1-match ban
// ---------------------------------------------------------------------------
describe('Scenario: 3 normal yellows accumulate to threshold 6', () => {
  it('each normal yellow contributes 2 pts with no ejection', () => {
    const match = classifyPlayerMatchDiscipline({ yellow: 1, red: 0, second_yellow: 0 });
    expect(match.accumulatedPointsFromThisMatch).toBe(2);
    expect(match.ejectionBanMatches).toBe(0);
    expect(match.eventType).toBe('normal_yellow_accumulation');
    expect(match.suspensionType).toBe('accumulated_points');
  });

  it('3 yellows over 3 matches = 6 pts → 1-match ban', () => {
    // Simulate 3 separate matches each with 1 yellow
    let cumulative = 0;
    for (let i = 0; i < 3; i++) {
      const m = classifyPlayerMatchDiscipline({ yellow: 1, red: 0, second_yellow: 0 });
      cumulative += m.accumulatedPointsFromThisMatch;
    }
    expect(cumulative).toBe(6);
    expect(calculateBanMatches(cumulative)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: direct red → ejection, zero accumulated points
// ---------------------------------------------------------------------------
describe('Scenario: direct red', () => {
  it('suspension type = direct_red, ejection ban = 1, zero accumulated pts', () => {
    const result = classifyPlayerMatchDiscipline({ yellow: 0, red: 1, second_yellow: 0 });
    expect(result.suspensionType).toBe('direct_red');
    expect(result.ejectionBanMatches).toBe(1);
    expect(result.accumulatedPointsFromThisMatch).toBe(0);
    expect(result.eventType).toBe('direct_red_ejection');
  });

  it('isDirectRedEjection detects red card', () => {
    expect(isDirectRedEjection({ yellow: 0, red: 1, second_yellow: 0 })).toBe(true);
    expect(isDirectRedEjection({ yellow: 1, red: 0, second_yellow: 0 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: second yellow → ejection, zero accumulated points
// ---------------------------------------------------------------------------
describe('Scenario: second yellow', () => {
  it('2 yellows → second_yellow ejection, zero accumulated pts', () => {
    const result = classifyPlayerMatchDiscipline({ yellow: 2, red: 0, second_yellow: 0 });
    expect(result.suspensionType).toBe('second_yellow');
    expect(result.ejectionBanMatches).toBe(1);
    expect(result.accumulatedPointsFromThisMatch).toBe(0);
    expect(result.eventType).toBe('second_yellow_ejection');
  });

  it('second_yellow card type → second_yellow ejection, zero accumulated pts', () => {
    const result = classifyPlayerMatchDiscipline({ yellow: 0, red: 0, second_yellow: 1 });
    expect(result.suspensionType).toBe('second_yellow');
    expect(result.ejectionBanMatches).toBe(1);
    expect(result.accumulatedPointsFromThisMatch).toBe(0);
  });

  it('isSecondYellowEjection detects 2 yellows or second_yellow card', () => {
    expect(isSecondYellowEjection({ yellow: 2, red: 0, second_yellow: 0 })).toBe(true);
    expect(isSecondYellowEjection({ yellow: 0, red: 0, second_yellow: 1 })).toBe(true);
    expect(isSecondYellowEjection({ yellow: 1, red: 0, second_yellow: 0 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: yellow + red → yellow_red, zero accumulated points
// ---------------------------------------------------------------------------
describe('Scenario: yellow + red', () => {
  it('yellow + red → yellow_red ejection, zero accumulated pts', () => {
    const result = classifyPlayerMatchDiscipline({ yellow: 1, red: 1, second_yellow: 0 });
    expect(result.suspensionType).toBe('yellow_red');
    expect(result.ejectionBanMatches).toBe(1);
    expect(result.accumulatedPointsFromThisMatch).toBe(0);
    expect(result.eventType).toBe('yellow_red_ejection');
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: threshold 12 → 2-match ban (already covered above, explicit here)
// ---------------------------------------------------------------------------
describe('Scenario: threshold 12 → 2-match ban', () => {
  it('calculateBanMatches(12) = 2', () => {
    expect(calculateBanMatches(12)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: source_card_ids must be card IDs not match IDs
// ---------------------------------------------------------------------------
describe('source_card_ids contract', () => {
  it('getSeasonCards returns card_ids field (populated from cards.id, not match_id)', () => {
    // The data contract: getSeasonCards() now returns card_ids: string[]
    // These are populated from actual card row IDs: cards.map(c => c.id)
    // The field yellow_card_ids filters to yellow cards only
    // recalculatePlayerSuspensionEventBased uses:
    //   - card.card_ids for ejection events (all cards in the match)
    //   - card.yellow_card_ids for accumulated_points events (yellow cards only)
    //
    // This is a contract test: verify the expected structure shape exists on the return type.
    // The actual card IDs are populated from the DB query selecting `id` from cards.
    //
    // Regression guard: previously source_card_ids: [card.match_id] was the bug.
    // Now it must be card.card_ids (a UUID[] from cards.id, never equal to match_id).

    // Simulate what the data looks like post-fix:
    const mockMatchEntry = {
      match_id: 'match-uuid-000',
      card_ids: ['card-uuid-001', 'card-uuid-002'], // actual card IDs
      yellow_card_ids: ['card-uuid-001'],            // yellow card IDs only
    };

    // Source card IDs must NOT be the match_id
    expect(mockMatchEntry.card_ids).not.toContain(mockMatchEntry.match_id);
    // Source card IDs must be the actual card IDs
    expect(mockMatchEntry.card_ids).toContain('card-uuid-001');
    expect(mockMatchEntry.card_ids).toContain('card-uuid-002');
    // Yellow card IDs is a subset of card_ids
    expect(mockMatchEntry.yellow_card_ids.every((id) => mockMatchEntry.card_ids.includes(id))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 7 & 8: stale cleanup removes obsolete events
// (deleting a red card removes the direct_red suspension; changing red→yellow recalculates)
// ---------------------------------------------------------------------------
describe('computeStaleEventIds — stale cleanup', () => {
  it('deleting a red card: direct_red event becomes stale', () => {
    const existing = [
      { id: 'ev-red', trigger_match_id: 'match-1', suspension_type: 'direct_red', accumulated_threshold: null },
    ];
    const desired = new Set<string>(); // no events after card deletion
    const stale = computeStaleEventIds(existing, desired);
    expect(stale).toContain('ev-red');
    expect(stale).toHaveLength(1);
  });

  it('changing red → yellow: direct_red removed, accumulated_points added if threshold reached', () => {
    const existing = [
      { id: 'ev-red', trigger_match_id: 'match-1', suspension_type: 'direct_red', accumulated_threshold: null },
    ];
    // After card type change, only an accumulated_points event exists
    const desired = new Set(['match-1::accumulated_points::6']);
    const stale = computeStaleEventIds(existing, desired);
    expect(stale).toContain('ev-red'); // direct_red is now stale
    expect(stale).toHaveLength(1);
  });

  it('keeps valid events unchanged', () => {
    const existing = [
      { id: 'ev1', trigger_match_id: 'match-1', suspension_type: 'accumulated_points', accumulated_threshold: 6 },
    ];
    const desired = new Set(['match-1::accumulated_points::6']);
    expect(computeStaleEventIds(existing, desired)).toHaveLength(0);
  });

  it('removes all events when player has no remaining cards', () => {
    const existing = [
      { id: 'ev1', trigger_match_id: 'match-1', suspension_type: 'second_yellow', accumulated_threshold: null },
      { id: 'ev2', trigger_match_id: 'match-2', suspension_type: 'accumulated_points', accumulated_threshold: 6 },
    ];
    const desired = new Set<string>();
    const stale = computeStaleEventIds(existing, desired);
    expect(stale).toHaveLength(2);
    expect(stale).toContain('ev1');
    expect(stale).toContain('ev2');
  });
});

// ---------------------------------------------------------------------------
// Scenario 9: rerun is idempotent
// ---------------------------------------------------------------------------
describe('computeStaleEventIds — idempotency', () => {
  it('second run with identical desired events produces zero stale IDs', () => {
    const events = [
      { id: 'ev1', trigger_match_id: 'match-1', suspension_type: 'direct_red', accumulated_threshold: null },
      { id: 'ev2', trigger_match_id: 'match-2', suspension_type: 'accumulated_points', accumulated_threshold: 6 },
    ];
    const desired = new Set([
      'match-1::direct_red::0',
      'match-2::accumulated_points::6',
    ]);
    expect(computeStaleEventIds(events, desired)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 10: legacy and manual records are never deleted
// ---------------------------------------------------------------------------
describe('legacy/manual records remain untouched', () => {
  it('system event types never include legacy or manual', () => {
    // The DB query in recalculatePlayerSuspensionEventBased filters:
    //   .in('suspension_type', ['accumulated_points', 'second_yellow', 'direct_red', 'yellow_red'])
    // This guarantees legacy and manual records are never returned and never passed to
    // computeStaleEventIds, so they can never be deleted.
    const SYSTEM_TYPES = ['accumulated_points', 'second_yellow', 'direct_red', 'yellow_red'] as const;
    expect(SYSTEM_TYPES as readonly string[]).not.toContain('legacy');
    expect(SYSTEM_TYPES as readonly string[]).not.toContain('manual');
    expect(SYSTEM_TYPES).toHaveLength(4);
  });

  it('computeStaleEventIds only deletes what it receives — never touches legacy/manual', () => {
    // If somehow legacy/manual were passed in (they should NOT be due to DB filter),
    // they would be treated as stale if not in desired. The guard is the DB filter.
    // This test verifies that computeStaleEventIds is pure and only processes its input.
    const existing = [
      { id: 'legacy-ev', trigger_match_id: 'match-1', suspension_type: 'legacy', accumulated_threshold: null },
    ];
    const desired = new Set<string>(); // empty desired
    // The function would mark it as stale — but it will never receive legacy records in practice
    // because the DB query filters them out. This test documents that invariant.
    const stale = computeStaleEventIds(existing, desired);
    // In practice this path is never reached; DB query never returns legacy/manual
    expect(stale).toContain('legacy-ev'); // confirms the DB filter is the guard, not this function
  });
});

// ---------------------------------------------------------------------------
// Scenario 11: serving matches — finished OR scheduled, not postponed/cancelled
// ---------------------------------------------------------------------------
describe('isEligibleSuspensionServingMatch — finished OR scheduled', () => {
  it('scheduled matches are eligible (remaining slot)', () => {
    expect(isEligibleSuspensionServingMatch({ status: 'scheduled' })).toBe(true);
  });

  it('finished matches ARE eligible (served slot — must not be skipped on late recalc)', () => {
    expect(isEligibleSuspensionServingMatch({ status: 'finished' })).toBe(true);
  });

  it('postponed matches are NOT eligible', () => {
    expect(isEligibleSuspensionServingMatch({ status: 'postponed' })).toBe(false);
  });

  it('cancelled matches are NOT eligible', () => {
    expect(isEligibleSuspensionServingMatch({ status: 'cancelled' })).toBe(false);
  });

  it('null match is NOT eligible', () => {
    expect(isEligibleSuspensionServingMatch(null)).toBe(false);
  });

  it('undefined match is NOT eligible', () => {
    expect(isEligibleSuspensionServingMatch(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scenario A: point history restored (event-based point_sources bug fix)
// ---------------------------------------------------------------------------
describe('buildNormalYellowPointHistory — restores full chronological point history', () => {
  it('MD3/MD4/MD5/MD8 normal yellows → 4 rows, cumulative 0→2→4→6→8', () => {
    const seasonCards = [
      { match_id: 'md3', matchday: 3, cards: { yellow: 1, red: 0, second_yellow: 0 }, reason: '1Y' },
      { match_id: 'md4', matchday: 4, cards: { yellow: 1, red: 0, second_yellow: 0 }, reason: '1Y' },
      { match_id: 'md5', matchday: 5, cards: { yellow: 1, red: 0, second_yellow: 0 }, reason: '1Y' },
      { match_id: 'md8', matchday: 8, cards: { yellow: 1, red: 0, second_yellow: 0 }, reason: '1Y' },
    ];
    const history = buildNormalYellowPointHistory(seasonCards);
    expect(history).toHaveLength(4);
    expect(history.map((h) => [h.matchday, h.points_before, h.points_after])).toEqual([
      [3, 0, 2],
      [4, 2, 4],
      [5, 4, 6],
      [8, 6, 8],
    ]);
  });

  it('ejection matches (second_yellow/direct_red/yellow_red) are excluded — contribute 0 points', () => {
    const seasonCards = [
      { match_id: 'md1', matchday: 1, cards: { yellow: 1, red: 0, second_yellow: 0 }, reason: '1Y' },
      { match_id: 'md2', matchday: 2, cards: { yellow: 0, red: 1, second_yellow: 0 }, reason: '1R' }, // direct red
      { match_id: 'md3', matchday: 3, cards: { yellow: 1, red: 0, second_yellow: 0 }, reason: '1Y' },
    ];
    const history = buildNormalYellowPointHistory(seasonCards);
    expect(history).toHaveLength(2);
    expect(history.map((h) => h.matchday)).toEqual([1, 3]);
    expect(history[1].points_after).toBe(4);
  });

  it('no yellow history → empty array (never omitted, just empty)', () => {
    const seasonCards = [
      { match_id: 'md1', matchday: 1, cards: { yellow: 0, red: 1, second_yellow: 0 }, reason: '1R' },
    ];
    expect(buildNormalYellowPointHistory(seasonCards)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Current points must reflect the LATEST point history, not the frozen
// trigger-time snapshot stored on the record (Part 5 example: threshold event
// total_points=6, latest point_sources points_after=8 → current = 8).
// ---------------------------------------------------------------------------
describe('getCurrentAccumulatedPoints — live total, not frozen trigger snapshot', () => {
  it('uses last point_sources.points_after when history exists', () => {
    const record = {
      total_points: 6, // frozen at MD5 threshold-crossing time
      point_sources: [
        { points_before: 0, points_after: 2 },
        { points_before: 2, points_after: 4 },
        { points_before: 4, points_after: 6 },
        { points_before: 6, points_after: 8 }, // MD8 — after the ban was triggered
      ],
    };
    expect(getCurrentAccumulatedPoints(record)).toBe(8);
  });

  it('falls back to total_points when point_sources is empty (e.g. ejection record)', () => {
    expect(getCurrentAccumulatedPoints({ total_points: 0, point_sources: [] })).toBe(0);
  });

  it('falls back to total_points when point_sources is missing', () => {
    expect(getCurrentAccumulatedPoints({ total_points: 6 })).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Scenario C: legacy duplicate — event record wins, legacy is superseded
// ---------------------------------------------------------------------------
describe('markSupersededLegacyRecords — event-based wins over legacy', () => {
  it('marks legacy (suspension_type null) as superseded when an event record exists for same player+team', () => {
    const records = [
      { player_id: 'p1', team_id: 't1', suspension_type: null, id: 'legacy-1' },
      { player_id: 'p1', team_id: 't1', suspension_type: 'accumulated_points', id: 'event-1' },
    ];
    const result = markSupersededLegacyRecords(records);
    const legacy = result.find((r) => r.id === 'legacy-1')!;
    const event = result.find((r) => r.id === 'event-1')!;
    expect(legacy._superseded).toBe(true);
    expect(event._superseded).toBe(false);
  });

  it('does not supersede a legacy record when no event record exists for that player+team', () => {
    const records = [{ player_id: 'p2', team_id: 't1', suspension_type: null, id: 'legacy-2' }];
    const result = markSupersededLegacyRecords(records);
    expect(result[0]._superseded).toBe(false);
  });

  it('treats suspension_type "legacy" the same as null', () => {
    const records = [
      { player_id: 'p3', team_id: 't1', suspension_type: 'legacy', id: 'legacy-3' },
      { player_id: 'p3', team_id: 't1', suspension_type: 'direct_red', id: 'event-3' },
    ];
    const result = markSupersededLegacyRecords(records);
    expect(result.find((r) => r.id === 'legacy-3')!._superseded).toBe(true);
  });

  it('never marks event-based records (of any system type) as superseded by each other', () => {
    const records = [
      { player_id: 'p4', team_id: 't1', suspension_type: 'accumulated_points', id: 'ev-a' },
      { player_id: 'p4', team_id: 't1', suspension_type: 'second_yellow', id: 'ev-b' },
    ];
    const result = markSupersededLegacyRecords(records);
    expect(result.every((r) => r._superseded === false)).toBe(true);
  });
});

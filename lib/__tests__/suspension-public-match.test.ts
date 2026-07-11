import { vi, describe, it, expect } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => null),
}));

import { isSuspendedForMatch } from '../suspension-calc';

// ── Helpers ──────────────────────────────────────────────────────────────────

function eventSuspension(overrides: Record<string, any> = {}): any {
  return {
    suspension_type: 'accumulated_points',
    serving_match_ids: ['md6'],
    served_completed_at: null,
    suspended_from_match_id: null,
    suspension_details: null,
    ban_matches: 1,
    ...overrides,
  };
}

function legacySuspension(overrides: Record<string, any> = {}): any {
  return {
    suspension_type: null,
    serving_match_ids: null,
    served_completed_at: null,
    suspended_from_match_id: 'md6',
    suspension_details: { suspended_matches: [{ match_id: 'md6', status: 'scheduled' }] },
    ban_matches: 1,
    ...overrides,
  };
}

// ── Test 1: Served suspension does not appear on public match page ────────────

describe('served suspension → not shown on public match', () => {
  it('event-based: served_completed_at set → never active', () => {
    const s = eventSuspension({
      serving_match_ids: ['md6'],
      served_completed_at: '2026-06-28T00:00:00Z',
    });
    expect(isSuspendedForMatch(s, 'md6', 'scheduled')).toBe(false);
    expect(isSuspendedForMatch(s, 'md6', 'finished')).toBe(false);
  });

  it('event-based: serving match is finished → already served, not active', () => {
    const s = eventSuspension({
      serving_match_ids: ['md6'],
      served_completed_at: null, // not yet stamped (e.g. recalc pending)
    });
    // MD6 is finished — player already served their ban there
    expect(isSuspendedForMatch(s, 'md6', 'finished')).toBe(false);
  });

  it('event-based: serving match is scheduled → actively suspended', () => {
    const s = eventSuspension({
      serving_match_ids: ['md6'],
      served_completed_at: null,
    });
    expect(isSuspendedForMatch(s, 'md6', 'scheduled')).toBe(true);
  });
});

// ── Test 2: MD6 served ban does not reappear on MD9 ──────────────────────────

describe('MD6 served ban must not reappear on MD9', () => {
  it('md9 not in serving_match_ids → not suspended', () => {
    const s = eventSuspension({
      serving_match_ids: ['md6'],  // correctly points to md6
      served_completed_at: '2026-06-28T00:00:00Z',
    });
    expect(isSuspendedForMatch(s, 'md9', 'scheduled')).toBe(false);
  });

  it('md9 not in serving_match_ids (even without served_completed_at)', () => {
    const s = eventSuspension({
      serving_match_ids: ['md6'],
      served_completed_at: null,
    });
    expect(isSuspendedForMatch(s, 'md9', 'scheduled')).toBe(false);
  });

  it('stale suspended_from_match_id=md9 is ignored for event-based records', () => {
    const s = eventSuspension({
      serving_match_ids: ['md6'],  // correct
      served_completed_at: null,
      suspended_from_match_id: 'md9',  // stale from old assignment
    });
    // event-based: only serving_match_ids is consulted
    expect(isSuspendedForMatch(s, 'md9', 'scheduled')).toBe(false);
  });
});

// ── Test 3: Event-based ignores suspension_details fallback ──────────────────

describe('event-based record ignores suspension_details.suspended_matches', () => {
  it('suspension_details with md9 is ignored for event-based', () => {
    const s = eventSuspension({
      serving_match_ids: ['md6'],  // correct serving assignment
      served_completed_at: null,
      suspension_details: {
        suspended_matches: [{ match_id: 'md9', status: 'scheduled' }],  // stale
      },
    });
    // Should NOT be suspended for md9 despite stale suspension_details
    expect(isSuspendedForMatch(s, 'md9', 'scheduled')).toBe(false);
    // Should be suspended for md6 (in serving_match_ids, scheduled)
    expect(isSuspendedForMatch(s, 'md6', 'scheduled')).toBe(true);
  });

  it('event-based: serving_match_ids=[] → not suspended regardless of details', () => {
    const s = eventSuspension({
      serving_match_ids: [],
      served_completed_at: null,
      suspended_from_match_id: 'md6',
      suspension_details: { suspended_matches: [{ match_id: 'md6' }] },
    });
    expect(isSuspendedForMatch(s, 'md6', 'scheduled')).toBe(false);
  });
});

// ── Test 4: Legacy fallback still works for true legacy records ───────────────

describe('legacy fallback works for null suspension_type', () => {
  it('legacy: suspended_from_match_id match → active', () => {
    const s = legacySuspension({ suspended_from_match_id: 'md6' });
    expect(isSuspendedForMatch(s, 'md6', 'scheduled')).toBe(true);
  });

  it('legacy: suspended_from_match_id does not match → not suspended', () => {
    const s = legacySuspension({ suspended_from_match_id: 'md6' });
    expect(isSuspendedForMatch(s, 'md9', 'scheduled')).toBe(false);
  });

  it('legacy: suspension_details.suspended_matches fallback', () => {
    const s = legacySuspension({
      suspended_from_match_id: null,
      suspension_details: {
        suspended_matches: [{ match_id: 'md6' }, { match_id: 'md7' }],
      },
    });
    expect(isSuspendedForMatch(s, 'md6', 'scheduled')).toBe(true);
    expect(isSuspendedForMatch(s, 'md7', 'scheduled')).toBe(true);
    expect(isSuspendedForMatch(s, 'md9', 'scheduled')).toBe(false);
  });

  it('legacy type="legacy": uses same fallback as null type', () => {
    const s = legacySuspension({
      suspension_type: 'legacy',
      suspended_from_match_id: 'md6',
    });
    expect(isSuspendedForMatch(s, 'md6', 'scheduled')).toBe(true);
  });
});

// ── Test 5: Deduplication (logic tested via isSuspendedForMatch contract) ─────

describe('duplicate legacy/event: event-based takes precedence', () => {
  it('event-based says not suspended → should not appear even if legacy says suspended', () => {
    // Simulates: player has event record (ban at md6, now served) and legacy record (pointing to md9)
    // The filterActiveSuspendedPlayers function in the route prefers event-based.
    // Here we just verify the event-based record correctly returns false for md9.
    const eventRecord = eventSuspension({
      serving_match_ids: ['md6'],
      served_completed_at: '2026-06-28T00:00:00Z',
    });
    const legacyRecord = legacySuspension({
      suspended_from_match_id: 'md9',
    });

    // Event-based: not suspended for md9 (correct source of truth)
    expect(isSuspendedForMatch(eventRecord, 'md9', 'scheduled')).toBe(false);
    // Legacy: incorrectly says suspended for md9
    expect(isSuspendedForMatch(legacyRecord, 'md9', 'scheduled')).toBe(true);
    // filterActiveSuspendedPlayers prefers eventRecord → player not shown
  });
});

// ── Test 6: Active scheduled serving slot still shows correctly ───────────────

describe('active scheduled serving slot displays correctly', () => {
  it('1-ban: serving=[md6_scheduled], not served → active for md6', () => {
    const s = eventSuspension({
      serving_match_ids: ['md6'],
      served_completed_at: null,
    });
    expect(isSuspendedForMatch(s, 'md6', 'scheduled')).toBe(true);
  });

  it('2-ban: serving=[md6_finished, md7_scheduled] → active for md7 only', () => {
    const s = eventSuspension({
      serving_match_ids: ['md6', 'md7'],
      served_completed_at: null,
      ban_matches: 2,
    });
    expect(isSuspendedForMatch(s, 'md6', 'finished')).toBe(false); // already served
    expect(isSuspendedForMatch(s, 'md7', 'scheduled')).toBe(true);  // still active
  });

  it('ejection event: direct_red, serving=[md7_scheduled] → active', () => {
    const s = {
      suspension_type: 'direct_red',
      serving_match_ids: ['md7'],
      served_completed_at: null,
      suspended_from_match_id: null,
      suspension_details: null,
      ban_matches: 1,
    };
    expect(isSuspendedForMatch(s, 'md7', 'scheduled')).toBe(true);
    expect(isSuspendedForMatch(s, 'md9', 'scheduled')).toBe(false);
  });

  it('second_yellow event fully served → not active', () => {
    const s = {
      suspension_type: 'second_yellow',
      serving_match_ids: ['md7'],
      served_completed_at: '2026-07-05T00:00:00Z',
      suspended_from_match_id: null,
      ban_matches: 1,
    };
    expect(isSuspendedForMatch(s, 'md7', 'finished')).toBe(false);
    expect(isSuspendedForMatch(s, 'md7', 'scheduled')).toBe(false); // served_completed_at set
  });

  it('manual suspension_type uses legacy fallback', () => {
    // manual type is treated as non-event-based → legacy fallback
    const s = {
      suspension_type: 'manual',
      serving_match_ids: null,
      served_completed_at: null,
      suspended_from_match_id: 'md7',
      suspension_details: null,
      ban_matches: 1,
    };
    expect(isSuspendedForMatch(s, 'md7', 'scheduled')).toBe(true);
    expect(isSuspendedForMatch(s, 'md9', 'scheduled')).toBe(false);
  });
});

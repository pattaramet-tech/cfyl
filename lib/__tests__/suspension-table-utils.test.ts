import { describe, it, expect } from 'vitest';
import {
  normalizeSearchText,
  matchesSuspensionSearch,
  compareSuspensionRecords,
  compareSuspensionRecordsDefault,
  type SuspensionTableRecord,
} from '../suspension-table-utils';

const TODAY = '2026-07-11';

function makeRecord(overrides: Partial<SuspensionTableRecord> = {}): SuspensionTableRecord {
  return {
    id: 'id-1',
    total_points: 0,
    ban_matches: 0,
    point_sources: [],
    suspension_details: null,
    player: { full_name: 'ผู้เล่น เอ', player_code: 'P001', shirt_no: 10 },
    team: { name: 'ทีมเอ', short_name: 'A' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
describe('matchesSuspensionSearch', () => {
  it('matches a Thai player name', () => {
    const r = makeRecord({ player: { full_name: 'กิติคุณ มารเวก', player_code: 'P099', shirt_no: 9 } });
    expect(matchesSuspensionSearch(r, 'มารเวก', TODAY)).toBe(true);
  });

  it('matches by player code, case-insensitively', () => {
    const r = makeRecord({ player: { full_name: 'ผู้เล่น บี', player_code: 'U17-042', shirt_no: 7 } });
    expect(matchesSuspensionSearch(r, 'u17-042', TODAY)).toBe(true);
  });

  it('matches by team name', () => {
    const r = makeRecord({ team: { name: 'สโมสรทดสอบ', short_name: 'TST' } });
    expect(matchesSuspensionSearch(r, 'สโมสรทดสอบ', TODAY)).toBe(true);
  });

  it('matches by shirt number', () => {
    const r = makeRecord({ player: { full_name: 'ผู้เล่น ซี', player_code: 'P003', shirt_no: 23 } });
    expect(matchesSuspensionSearch(r, '23', TODAY)).toBe(true);
  });

  it('ignores leading/trailing spaces and collapses internal repeated spaces', () => {
    const r = makeRecord({ player: { full_name: 'สมชาย ใจดี', player_code: 'P010', shirt_no: 5 } });
    expect(matchesSuspensionSearch(r, '   สมชาย    ใจดี   ', TODAY)).toBe(true);
  });

  it('empty query matches everything', () => {
    const r = makeRecord();
    expect(matchesSuspensionSearch(r, '   ', TODAY)).toBe(true);
  });

  it('does not match unrelated text', () => {
    const r = makeRecord({ player: { full_name: 'สมชาย ใจดี', player_code: 'P010', shirt_no: 5 } });
    expect(matchesSuspensionSearch(r, 'ไม่มีทางตรงกัน', TODAY)).toBe(false);
  });

  it('normalizeSearchText is case-insensitive and NFKC-normalizing', () => {
    expect(normalizeSearchText('  HELLO   World  ')).toBe('hello world');
  });
});

// ---------------------------------------------------------------------------
// Points sort — must use current disciplinary points, not stale total_points
// ---------------------------------------------------------------------------
describe('compareSuspensionRecords — points column', () => {
  it('sorts by getCurrentDisciplinaryPoints, not the frozen total_points', () => {
    // a: total_points frozen at 6, but latest point_sources shows 8 (current)
    const a = makeRecord({
      id: 'a',
      total_points: 6,
      point_sources: [{ points_before: 4, points_after: 6 } as any, { points_before: 6, points_after: 8 } as any],
      player: { full_name: 'เอ', player_code: 'A', shirt_no: 1 },
    });
    // b: current = 7
    const b = makeRecord({
      id: 'b',
      total_points: 7,
      point_sources: [{ points_before: 0, points_after: 7 } as any],
      player: { full_name: 'บี', player_code: 'B', shirt_no: 2 },
    });
    // Ascending: b (7) before a (8)
    expect(compareSuspensionRecords(a, b, 'points', 'asc', TODAY)).toBeGreaterThan(0);
    expect(compareSuspensionRecords(b, a, 'points', 'asc', TODAY)).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// Shirt number — nulls last in both directions
// ---------------------------------------------------------------------------
describe('compareSuspensionRecords — shirt_no column, null handling', () => {
  const withShirt = makeRecord({ id: 'has-shirt', player: { full_name: 'มีเบอร์', player_code: 'X', shirt_no: 5 } });
  const noShirt = makeRecord({ id: 'no-shirt', player: { full_name: 'ไม่มีเบอร์', player_code: 'Y', shirt_no: null } });

  it('null shirt_no sorts last ascending', () => {
    expect(compareSuspensionRecords(noShirt, withShirt, 'shirt_no', 'asc', TODAY)).toBeGreaterThan(0);
  });

  it('null shirt_no also sorts last descending', () => {
    expect(compareSuspensionRecords(noShirt, withShirt, 'shirt_no', 'desc', TODAY)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Serving-match sort — date/time chronology, not MD number alone
// ---------------------------------------------------------------------------
describe('compareSuspensionRecords — suspended_match column', () => {
  it('sorts by actual chronology even when matchday numbers contradict it', () => {
    // a: MD10 but actually played earlier (2026-07-01)
    const a = makeRecord({
      id: 'a',
      ban_matches: 1,
      suspension_details: {
        suspended_matches: [
          { match_id: 'm1', matchday: 10, match_date: '2026-07-01', match_time: null, status: 'scheduled' },
        ],
      },
    });
    // b: MD3 but actually scheduled later (2026-09-01)
    const b = makeRecord({
      id: 'b',
      ban_matches: 1,
      suspension_details: {
        suspended_matches: [
          { match_id: 'm2', matchday: 3, match_date: '2026-09-01', match_time: null, status: 'scheduled' },
        ],
      },
    });
    // Ascending by date: a (2026-07-01) before b (2026-09-01), despite a.matchday > b.matchday
    expect(compareSuspensionRecords(a, b, 'suspended_match', 'asc', TODAY)).toBeLessThan(0);
  });

  it('prioritizes a scheduled remaining match over a finished one, over none', () => {
    const scheduled = makeRecord({
      id: 'scheduled',
      suspension_details: {
        suspended_matches: [
          { match_id: 'm1', matchday: 5, match_date: '2026-08-01', match_time: null, status: 'scheduled' },
        ],
      },
    });
    const finished = makeRecord({
      id: 'finished',
      suspension_details: {
        suspended_matches: [
          { match_id: 'm2', matchday: 4, match_date: '2026-06-01', match_time: null, status: 'finished' },
        ],
      },
    });
    const none = makeRecord({ id: 'none', suspension_details: { suspended_matches: [] } });

    expect(compareSuspensionRecords(scheduled, finished, 'suspended_match', 'asc', TODAY)).toBeLessThan(0);
    expect(compareSuspensionRecords(finished, none, 'suspended_match', 'asc', TODAY)).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// Header click toggles ascending → descending
// ---------------------------------------------------------------------------
describe('compareSuspensionRecords — direction toggle', () => {
  it('descending is the reverse of ascending for the name column', () => {
    const a = makeRecord({ id: 'a', player: { full_name: 'กอไก่', player_code: 'A', shirt_no: 1 } });
    const b = makeRecord({ id: 'b', player: { full_name: 'ขอไข่', player_code: 'B', shirt_no: 2 } });
    const asc = compareSuspensionRecords(a, b, 'name', 'asc', TODAY);
    const desc = compareSuspensionRecords(a, b, 'name', 'desc', TODAY);
    expect(Math.sign(asc)).toBe(-Math.sign(desc));
  });
});

// ---------------------------------------------------------------------------
// Default sort — currently suspended before served
// ---------------------------------------------------------------------------
describe('compareSuspensionRecordsDefault — status priority', () => {
  it('places an active ban before a served one', () => {
    const active = makeRecord({
      id: 'active',
      ban_matches: 1,
      suspension_details: {
        suspended_matches: [
          { match_id: 'm1', matchday: 5, match_date: TODAY, match_time: null, status: 'scheduled' },
        ],
      },
    });
    const served = makeRecord({
      id: 'served',
      ban_matches: 1,
      suspension_details: {
        suspended_matches: [
          { match_id: 'm2', matchday: 3, match_date: '2026-01-01', match_time: null, status: 'finished' },
        ],
      },
    });
    expect(compareSuspensionRecordsDefault(active, served, TODAY)).toBeLessThan(0);
  });
});

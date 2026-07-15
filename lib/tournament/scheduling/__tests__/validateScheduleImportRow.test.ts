import { describe, expect, it } from 'vitest';
import {
  categoryVenueKey,
  courtKey,
  createScheduleBatchSeen,
  groupKey,
  groupSlotKey,
  scheduleSlotKey,
  validateScheduleImportRow,
  venueDayKey,
  type RawScheduleImportRow,
  type ScheduleValidationContext,
} from '../validateScheduleImportRow';

const category = { id: 'category-1', code: 'B-U12', name: 'ชาย U12' };
const venue = { id: 'venue-1', code: 'V1', name: 'สนาม 1' };
const court = { id: 'court-1', venue_id: venue.id, code: 'C1', name: 'Court 1' };
const group = { id: 'group-1', category_id: category.id, code: 'A', name: 'Group A' };

function makeContext(): ScheduleValidationContext {
  return {
    tournamentStartDate: '2026-08-01',
    tournamentEndDate: '2026-08-11',
    categoriesByCode: new Map([[category.code, category]]),
    venuesByCode: new Map([[venue.code, venue]]),
    courtsByVenueAndCode: new Map([[courtKey(venue.id, court.code), court]]),
    groupsByCategoryAndCode: new Map([[groupKey(category.id, group.code), group]]),
    groupSlots: new Set([
      groupSlotKey(group.id, 'A-S1'),
      groupSlotKey(group.id, 'A-S2'),
      groupSlotKey(group.id, 'A-S3'),
    ]),
    teamsByCategoryAndCode: new Map(),
    primaryCategoryVenues: new Set([categoryVenueKey(category.id, venue.id)]),
    existingMatchesByCode: new Map(),
    existingSlotOwners: new Map(),
    existingVenueDayCounts: new Map(),
    allKnownMatchCodes: new Set(['B-U12-GA-001']),
  };
}

function validRow(overrides: Partial<RawScheduleImportRow> = {}): RawScheduleImportRow {
  return {
    match_code: 'B-U12-GA-001',
    category_code: 'B-U12',
    stage: 'group',
    group_code: 'A',
    venue_code: 'V1',
    court_code: 'C1',
    match_date: '2026-08-01',
    start_time: '08:30',
    match_no: 1,
    home_source_type: 'group_slot',
    home_source_ref: 'A-S1',
    away_source_type: 'group_slot',
    away_source_ref: 'A-S2',
    result_policy: 'single_step',
    status: 'scheduled',
    note: '',
    ...overrides,
  };
}

describe('validateScheduleImportRow', () => {
  it('accepts a valid group-slot fixture with an unresolved-placeholder warning', () => {
    const result = validateScheduleImportRow(validRow(), 2, makeContext(), createScheduleBatchSeen());

    expect(result.status).toBe('warning');
    expect(result.action).toBe('create');
    expect(result.messages.map((message) => message.code)).toEqual(['W8']);
  });

  it('blocks a duplicate match_code inside the same file', () => {
    const context = makeContext();
    const seen = createScheduleBatchSeen();
    validateScheduleImportRow(validRow(), 2, context, seen);
    const duplicate = validateScheduleImportRow(validRow({ start_time: '09:30' }), 3, context, seen);

    expect(duplicate.status).toBe('error');
    expect(duplicate.messages.some((message) => message.code === 'E1')).toBe(true);
  });

  it('blocks a match outside the tournament date range', () => {
    const result = validateScheduleImportRow(
      validRow({ match_date: '2026-07-31' }),
      2,
      makeContext(),
      createScheduleBatchSeen()
    );

    expect(result.status).toBe('error');
    expect(result.messages.some((message) => message.code === 'E16')).toBe(true);
  });

  it('blocks a venue/court time collision with an existing match', () => {
    const context = makeContext();
    context.existingSlotOwners.set(
      scheduleSlotKey(venue.id, court.id, '2026-08-01', '08:30'),
      'OTHER-MATCH'
    );

    const result = validateScheduleImportRow(validRow(), 2, context, createScheduleBatchSeen());

    expect(result.status).toBe('error');
    expect(result.messages.some((message) => message.code === 'E10')).toBe(true);
  });

  it('blocks a ninth match at the same venue on the same day', () => {
    const context = makeContext();
    context.existingVenueDayCounts.set(venueDayKey(venue.id, '2026-08-01'), 8);

    const result = validateScheduleImportRow(validRow(), 2, context, createScheduleBatchSeen());

    expect(result.status).toBe('error');
    expect(result.messages.some((message) => message.code === 'E18')).toBe(true);
  });

  it('treats an existing match_code as an update and returns a diff', () => {
    const context = makeContext();
    context.existingMatchesByCode.set('B-U12-GA-001', {
      id: 'match-1',
      match_code: 'B-U12-GA-001',
      category_id: category.id,
      group_id: group.id,
      venue_id: venue.id,
      court_id: court.id,
      match_date: '2026-08-01',
      match_time: '08:00',
      match_no: 1,
      stage: 'group',
      home_source_type: 'group_slot',
      home_source_ref: 'A-S1',
      away_source_type: 'group_slot',
      away_source_ref: 'A-S2',
      result_policy: 'single_step',
      status: 'scheduled',
      note: null,
      schedule_status: 'published',
      version: 1,
    });

    const result = validateScheduleImportRow(validRow(), 2, context, createScheduleBatchSeen());

    expect(result.action).toBe('update');
    expect(result.diff).toContainEqual({ field: 'match_time', before: '08:00', after: '08:30' });
    expect(result.messages.some((message) => message.code === 'W11')).toBe(true);
  });
});

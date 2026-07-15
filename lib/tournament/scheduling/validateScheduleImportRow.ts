import {
  SCHEDULE_MATCH_STATUSES,
  SCHEDULE_RESULT_POLICIES,
  SCHEDULE_SOURCE_TYPES,
  SCHEDULE_STAGES,
  type ScheduleMatchStatus,
  type ScheduleResultPolicy,
  type ScheduleSourceType,
  type ScheduleStage,
} from './scheduleExcelTemplate';
import {
  DRAW_SELECTED_SOURCE_TYPE,
  type DrawSelectedConfig,
  validateDrawSelectedSourceRef,
} from './drawSelected';

export type ScheduleImportSeverity = 'warning' | 'error';

export interface ScheduleImportMessage {
  severity: ScheduleImportSeverity;
  code: string;
  message: string;
}

export interface RawScheduleImportRow {
  [key: string]: unknown;
}

export interface NormalizedScheduleImportRow {
  match_code: string;
  category_code: string;
  stage: ScheduleStage | string;
  group_code: string;
  venue_code: string;
  court_code: string;
  match_date: string;
  start_time: string;
  match_no: number | null;
  home_source_type: ScheduleSourceType | string;
  home_source_ref: string;
  away_source_type: ScheduleSourceType | string;
  away_source_ref: string;
  result_policy: ScheduleResultPolicy | string;
  status: ScheduleMatchStatus | string;
  note: string;
}

export interface CategoryRef {
  id: string;
  code: string;
  name?: string;
}

export interface VenueRef {
  id: string;
  code: string;
  name?: string;
}

export interface CourtRef {
  id: string;
  venue_id: string;
  code: string;
  name?: string;
}

export interface GroupRef {
  id: string;
  category_id: string;
  code: string;
  name?: string;
}

export interface TeamRef {
  id: string;
  category_id: string;
  team_code: string;
  name?: string;
}

export interface ExistingScheduleMatch {
  id: string;
  match_code: string;
  category_id: string;
  group_id: string | null;
  venue_id: string | null;
  court_id: string | null;
  match_date: string | null;
  match_time: string | null;
  match_no: number | null;
  stage: string;
  home_source_type: string | null;
  home_source_ref: string | null;
  away_source_type: string | null;
  away_source_ref: string | null;
  result_policy: string | null;
  status: string;
  note: string | null;
  schedule_status?: string | null;
  version?: number | null;
}

export interface ScheduleValidationContext {
  tournamentStartDate: string | null;
  tournamentEndDate: string | null;
  categoriesByCode: Map<string, CategoryRef>;
  venuesByCode: Map<string, VenueRef>;
  courtsByVenueAndCode: Map<string, CourtRef>;
  groupsByCategoryAndCode: Map<string, GroupRef>;
  groupSlots: Set<string>;
  teamsByCategoryAndCode: Map<string, TeamRef>;
  primaryCategoryVenues: Set<string>;
  existingMatchesByCode: Map<string, ExistingScheduleMatch>;
  existingSlotOwners: Map<string, string>;
  existingVenueDayCounts: Map<string, number>;
  existingPairOwners: Map<string, string>;
  existingMatchNoOwners: Map<string, string>;
  allKnownMatchCodes: Set<string>;
  drawSelectedConfigsByRef: Map<string, DrawSelectedConfig>;
  drawSelectedConfigsByCategoryCode: Map<string, DrawSelectedConfig[]>;
}

export interface ScheduleBatchSeen {
  matchCodes: Set<string>;
  slotOwners: Map<string, string>;
  venueDayCounts: Map<string, number>;
  pairOwners: Map<string, string>;
  matchNoOwners: Map<string, string>;
}

export interface ScheduleImportDiff {
  field: string;
  before: string | number | null;
  after: string | number | null;
}

export interface ValidatedScheduleImportRow {
  row: number;
  status: 'valid' | 'warning' | 'error';
  action: 'create' | 'update' | 'skip';
  match_code: string;
  normalized: NormalizedScheduleImportRow;
  messages: ScheduleImportMessage[];
  diff: ScheduleImportDiff[];
  existingMatchId: string | null;
  requiresRevisionConfirmation: boolean;
}

const text = (value: unknown): string => String(value ?? '').trim();
const upper = (value: unknown): string => text(value).toUpperCase();
const lower = (value: unknown): string => text(value).toLowerCase();

function parseMatchNo(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDate(value: unknown): string {
  const raw = text(value);
  if (!raw) return '';
  const match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return raw;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function normalizeTime(value: unknown): string {
  const raw = text(value);
  if (!raw) return '';
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return raw;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

export function normalizeScheduleImportRow(raw: RawScheduleImportRow): NormalizedScheduleImportRow {
  const homeType = lower(raw.home_source_type) || 'tbd';
  const awayType = lower(raw.away_source_type) || 'tbd';

  return {
    match_code: upper(raw.match_code),
    category_code: upper(raw.category_code),
    stage: lower(raw.stage) || 'group',
    group_code: upper(raw.group_code),
    venue_code: upper(raw.venue_code),
    court_code: upper(raw.court_code),
    match_date: normalizeDate(raw.match_date),
    start_time: normalizeTime(raw.start_time),
    match_no: parseMatchNo(raw.match_no),
    home_source_type: homeType,
    home_source_ref: upper(raw.home_source_ref) || (homeType === 'bye' ? 'BYE' : homeType === 'tbd' ? 'TBD' : ''),
    away_source_type: awayType,
    away_source_ref: upper(raw.away_source_ref) || (awayType === 'bye' ? 'BYE' : awayType === 'tbd' ? 'TBD' : ''),
    result_policy: lower(raw.result_policy) || 'single_step',
    status: lower(raw.status) || 'scheduled',
    note: text(raw.note),
  };
}

export function createScheduleBatchSeen(): ScheduleBatchSeen {
  return {
    matchCodes: new Set<string>(),
    slotOwners: new Map<string, string>(),
    venueDayCounts: new Map<string, number>(),
    pairOwners: new Map<string, string>(),
    matchNoOwners: new Map<string, string>(),
  };
}

export function categoryVenueKey(categoryId: string, venueId: string): string {
  return `${categoryId}|${venueId}`;
}

export function courtKey(venueId: string, code: string): string {
  return `${venueId}|${upper(code)}`;
}

export function groupKey(categoryId: string, code: string): string {
  return `${categoryId}|${upper(code)}`;
}

export function groupSlotKey(groupId: string, slotCode: string): string {
  return `${groupId}|${upper(slotCode)}`;
}

export function teamKey(categoryId: string, teamCode: string): string {
  return `${categoryId}|${upper(teamCode)}`;
}

export function scheduleSlotKey(
  venueId: string,
  courtId: string | null,
  date: string,
  time: string
): string {
  return `${venueId}|${courtId || 'NO_COURT'}|${date}|${time}`;
}

export function venueDayKey(venueId: string, date: string): string {
  return `${venueId}|${date}`;
}

export function sourceIdentity(sourceType: string, sourceRef: string): string {
  return `${upper(sourceType)}:${upper(sourceRef)}`;
}

export function groupStagePairKey(
  categoryId: string,
  stage: string,
  groupId: string,
  homeSourceType: string,
  homeSourceRef: string,
  awaySourceType: string,
  awaySourceRef: string
): string {
  const identities = [
    sourceIdentity(homeSourceType, homeSourceRef),
    sourceIdentity(awaySourceType, awaySourceRef),
  ].sort();
  return `${categoryId}|${stage}|${groupId}|${identities[0]}|${identities[1]}`;
}

export function matchNoKey(categoryId: string, stage: string, matchNo: number): string {
  return `${categoryId}|${stage}|${matchNo}`;
}

function addMessage(
  messages: ScheduleImportMessage[],
  severity: ScheduleImportSeverity,
  code: string,
  message: string
): void {
  messages.push({ severity, code, message });
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isTime(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hours, minutes] = value.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function validateSource(
  side: 'home' | 'away',
  sourceType: string,
  sourceRef: string,
  row: NormalizedScheduleImportRow,
  category: CategoryRef | undefined,
  group: GroupRef | undefined,
  context: ScheduleValidationContext,
  messages: ScheduleImportMessage[]
): TeamRef | null {
  const label = side === 'home' ? 'ทีมเหย้า' : 'ทีมเยือน';

  if (!SCHEDULE_SOURCE_TYPES.includes(sourceType as ScheduleSourceType)) {
    addMessage(messages, 'error', `E_SOURCE_TYPE_${side.toUpperCase()}`, `${label}: source_type "${sourceType}" ไม่ถูกต้อง`);
    return null;
  }

  if (!sourceRef) {
    addMessage(messages, 'error', `E_SOURCE_REF_${side.toUpperCase()}`, `${label}: ต้องระบุ source_ref`);
    return null;
  }

  if (sourceType === 'team') {
    const team = category ? context.teamsByCategoryAndCode.get(teamKey(category.id, sourceRef)) : undefined;
    if (!team) {
      addMessage(messages, 'error', 'E7', `${label}: ไม่พบ team_code "${sourceRef}" ในประเภทการแข่งขันนี้`);
      return null;
    }
    return team;
  }

  if (sourceType === 'group_slot') {
    if (!group) {
      addMessage(messages, 'error', 'E5', `${label}: group_slot ต้องระบุ group_code ที่มีอยู่จริง`);
      return null;
    }
    if (!context.groupSlots.has(groupSlotKey(group.id, sourceRef))) {
      addMessage(messages, 'error', 'E6', `${label}: ไม่พบ Group Slot "${sourceRef}" ในกลุ่ม ${row.group_code}`);
    }
    return null;
  }

  if (sourceType === 'group_rank' && !/^[A-Z0-9_-]+:\d+$/.test(sourceRef)) {
    addMessage(messages, 'error', 'E_GROUP_RANK_FORMAT', `${label}: group_rank ต้องอยู่ในรูปแบบ A:1`);
  }

  if (sourceType === DRAW_SELECTED_SOURCE_TYPE) {
    const validation = validateDrawSelectedSourceRef({
      sourceRef,
      rowCategoryCode: row.category_code,
      configsByRef: context.drawSelectedConfigsByRef,
      configsByCategoryCode: context.drawSelectedConfigsByCategoryCode,
    });

    if (!validation.ok) {
      addMessage(
        messages,
        'error',
        validation.errorCode || 'E_DRAW_SELECTED',
        `${label}: ${validation.errorMessage || 'draw_selected source_ref is invalid'}`
      );
    }
  }

  if (sourceType === 'match_winner' || sourceType === 'match_loser') {
    if (sourceRef === row.match_code) {
      addMessage(messages, 'error', 'E8', `${label}: Match ห้ามอ้างอิงตัวเอง`);
    } else if (!context.allKnownMatchCodes.has(sourceRef)) {
      addMessage(messages, 'error', 'E9', `${label}: ไม่พบ Match ต้นทาง "${sourceRef}"`);
    }
  }

  return null;
}

function diffValue(value: unknown): string | number | null {
  if (value === undefined || value === '') return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  return String(value);
}

export function buildScheduleImportDiff(
  existing: ExistingScheduleMatch | undefined,
  row: NormalizedScheduleImportRow,
  categoryId: string | null,
  groupId: string | null,
  venueId: string | null,
  courtId: string | null
): ScheduleImportDiff[] {
  if (!existing) return [];

  const pairs: Array<[string, unknown, unknown]> = [
    ['category_id', existing.category_id, categoryId],
    ['group_id', existing.group_id, groupId],
    ['stage', existing.stage, row.stage],
    ['match_no', existing.match_no, row.match_no],
    ['match_date', existing.match_date, row.match_date || null],
    ['match_time', existing.match_time, row.start_time || null],
    ['venue_id', existing.venue_id, venueId],
    ['court_id', existing.court_id, courtId],
    ['home_source_type', existing.home_source_type, row.home_source_type],
    ['home_source_ref', existing.home_source_ref, row.home_source_ref],
    ['away_source_type', existing.away_source_type, row.away_source_type],
    ['away_source_ref', existing.away_source_ref, row.away_source_ref],
    ['result_policy', existing.result_policy, row.result_policy],
    ['status', existing.status, row.status],
    ['note', existing.note, row.note || null],
  ];

  return pairs
    .map(([field, before, after]) => ({ field, before: diffValue(before), after: diffValue(after) }))
    .filter((item) => item.before !== item.after);
}

export function validateScheduleImportRow(
  raw: RawScheduleImportRow,
  rowNo: number,
  context: ScheduleValidationContext,
  seen: ScheduleBatchSeen
): ValidatedScheduleImportRow {
  const row = normalizeScheduleImportRow(raw);
  const messages: ScheduleImportMessage[] = [];

  if (!row.match_code) addMessage(messages, 'error', 'E_REQUIRED_MATCH_CODE', 'ต้องระบุ match_code');
  if (!row.category_code) addMessage(messages, 'error', 'E_REQUIRED_CATEGORY', 'ต้องระบุ category_code');
  if (!row.venue_code) addMessage(messages, 'error', 'E_REQUIRED_VENUE', 'ต้องระบุ venue_code');
  if (!row.match_date) addMessage(messages, 'error', 'E_REQUIRED_DATE', 'ต้องระบุ match_date');
  if (!row.start_time) addMessage(messages, 'error', 'E_REQUIRED_TIME', 'ต้องระบุ start_time');

  if (row.match_code && seen.matchCodes.has(row.match_code)) {
    addMessage(messages, 'error', 'E1', `match_code "${row.match_code}" ซ้ำภายในไฟล์`);
  }

  if (!SCHEDULE_STAGES.includes(row.stage as ScheduleStage)) {
    addMessage(messages, 'error', 'E_STAGE', `stage "${row.stage}" ไม่ถูกต้อง`);
  }
  if (!SCHEDULE_RESULT_POLICIES.includes(row.result_policy as ScheduleResultPolicy)) {
    addMessage(messages, 'error', 'E_RESULT_POLICY', `result_policy "${row.result_policy}" ไม่ถูกต้อง`);
  }
  if (!SCHEDULE_MATCH_STATUSES.includes(row.status as ScheduleMatchStatus)) {
    addMessage(messages, 'error', 'E_STATUS', `status "${row.status}" ไม่รองรับสำหรับการ Import ตารางแข่งขัน`);
  }
  if (row.match_no === null && text(raw.match_no)) {
    addMessage(messages, 'error', 'E_MATCH_NO', 'match_no ต้องเป็นจำนวนเต็มมากกว่า 0');
  }
  if (row.match_date && !isIsoDate(row.match_date)) {
    addMessage(messages, 'error', 'E_DATE_FORMAT', 'match_date ต้องอยู่ในรูปแบบ YYYY-MM-DD');
  }
  if (row.start_time && !isTime(row.start_time)) {
    addMessage(messages, 'error', 'E_TIME_FORMAT', 'start_time ต้องอยู่ในรูปแบบ HH:mm');
  }

  const category = context.categoriesByCode.get(row.category_code);
  if (row.category_code && !category) addMessage(messages, 'error', 'E2', `ไม่พบ Category "${row.category_code}"`);

  const venue = context.venuesByCode.get(row.venue_code);
  if (row.venue_code && !venue) addMessage(messages, 'error', 'E3', `ไม่พบ Venue "${row.venue_code}"`);

  const court = venue && row.court_code
    ? context.courtsByVenueAndCode.get(courtKey(venue.id, row.court_code))
    : undefined;
  if (row.court_code && venue && !court) {
    addMessage(messages, 'error', 'E4', `ไม่พบ Court "${row.court_code}" ภายใน Venue ${row.venue_code}`);
  }
  if (!row.court_code) addMessage(messages, 'warning', 'W6', 'ยังไม่ได้ระบุ Court');

  const group = category && row.group_code
    ? context.groupsByCategoryAndCode.get(groupKey(category.id, row.group_code))
    : undefined;
  if (row.group_code && category && !group) {
    addMessage(messages, 'error', 'E5', `ไม่พบ Group "${row.group_code}" ใน Category ${row.category_code}`);
  }
  if (row.stage === 'group' && !row.group_code) {
    addMessage(messages, 'error', 'E_REQUIRED_GROUP', 'รอบแบ่งกลุ่มต้องระบุ group_code');
  }

  if (
    row.match_date &&
    context.tournamentStartDate &&
    row.match_date < context.tournamentStartDate
  ) {
    addMessage(messages, 'error', 'E16', `วันที่แข่งขันอยู่ก่อนวันเริ่ม Tournament (${context.tournamentStartDate})`);
  }
  if (
    row.match_date &&
    context.tournamentEndDate &&
    row.match_date > context.tournamentEndDate
  ) {
    addMessage(messages, 'error', 'E16', `วันที่แข่งขันอยู่หลังวันจบ Tournament (${context.tournamentEndDate})`);
  }

  const homeTeam = validateSource(
    'home',
    row.home_source_type,
    row.home_source_ref,
    row,
    category,
    group,
    context,
    messages
  );
  const awayTeam = validateSource(
    'away',
    row.away_source_type,
    row.away_source_ref,
    row,
    category,
    group,
    context,
    messages
  );

  if (row.home_source_type === 'bye' && row.away_source_type === 'bye') {
    addMessage(messages, 'error', 'E14', 'Home และ Away ห้ามเป็น BYE พร้อมกัน');
  }
  if (homeTeam && awayTeam && homeTeam.id === awayTeam.id) {
    addMessage(messages, 'error', 'E12', 'Home และ Away Resolve เป็นทีมเดียวกัน');
  }
  if (
    !['bye', 'tbd'].includes(row.home_source_type) &&
    row.home_source_type === row.away_source_type &&
    row.home_source_ref === row.away_source_ref
  ) {
    addMessage(messages, 'error', 'E12', 'Home และ Away อ้างอิงตำแหน่ง/ทีมเดียวกัน (Self-match)');
  }

  if (category && venue && !context.primaryCategoryVenues.has(categoryVenueKey(category.id, venue.id))) {
    addMessage(messages, 'warning', 'W1', `Venue ${row.venue_code} ไม่ใช่สนามหลักของ Category ${row.category_code}`);
  }

  if (
    row.home_source_type !== 'team' ||
    row.away_source_type !== 'team'
  ) {
    addMessage(messages, 'warning', 'W8', 'ยังมี Placeholder ที่รอ Resolve เป็นทีมจริง');
  }

  const existing = context.existingMatchesByCode.get(row.match_code);
  const slot = venue && row.match_date && row.start_time
    ? scheduleSlotKey(venue.id, court?.id || null, row.match_date, row.start_time)
    : null;

  if (slot) {
    const existingOwner = context.existingSlotOwners.get(slot);
    const batchOwner = seen.slotOwners.get(slot);
    if (existingOwner && existingOwner !== row.match_code) {
      addMessage(messages, 'error', 'E10', `Venue/Court/วัน/เวลา ซ้ำกับ Match ${existingOwner}`);
    }
    if (batchOwner && batchOwner !== row.match_code) {
      addMessage(messages, 'error', 'E10', `Venue/Court/วัน/เวลา ซ้ำภายในไฟล์กับ Match ${batchOwner}`);
    }
  }

  if (venue && row.match_date) {
    const dayKey = venueDayKey(venue.id, row.match_date);
    const existingCount = context.existingVenueDayCounts.get(dayKey) || 0;
    const sameExistingDay = existing?.venue_id === venue.id && existing.match_date === row.match_date;
    const batchCount = seen.venueDayCounts.get(dayKey) || 0;
    const projectedCount = existingCount - (sameExistingDay ? 1 : 0) + batchCount + 1;
    if (projectedCount > 8) {
      addMessage(messages, 'error', 'E18', `Venue ${row.venue_code} มี Match เกิน 8 คู่ในวันที่ ${row.match_date}`);
    }
  }

  if (existing?.schedule_status === 'published') {
    addMessage(messages, 'warning', 'W11', 'กำลังแก้ไข Match จากตารางที่ Publish แล้ว');
  }

  const pairKey =
    row.stage === 'group' && category && group
      ? groupStagePairKey(
          category.id,
          row.stage,
          group.id,
          row.home_source_type,
          row.home_source_ref,
          row.away_source_type,
          row.away_source_ref
        )
      : null;

  if (pairKey) {
    const existingPairOwner = context.existingPairOwners.get(pairKey);
    const batchPairOwner = seen.pairOwners.get(pairKey);
    if (existingPairOwner && existingPairOwner !== row.match_code) {
      addMessage(
        messages,
        'error',
        'E20',
        `คู่แข่งขันนี้ซ้ำกับ Match ${existingPairOwner} ในกลุ่มเดียวกัน (Home/Away อาจสลับกัน)`
      );
    }
    if (batchPairOwner && batchPairOwner !== row.match_code) {
      addMessage(
        messages,
        'error',
        'E20',
        `คู่แข่งขันนี้ซ้ำภายในไฟล์กับ Match ${batchPairOwner} ในกลุ่มเดียวกัน (Home/Away อาจสลับกัน)`
      );
    }
  }

  if (row.match_no !== null && category) {
    const noKey = matchNoKey(category.id, row.stage, row.match_no);
    const existingNoOwner = context.existingMatchNoOwners.get(noKey);
    const batchNoOwner = seen.matchNoOwners.get(noKey);
    if (existingNoOwner && existingNoOwner !== row.match_code) {
      addMessage(messages, 'error', 'E19', `match_no ${row.match_no} ซ้ำกับ Match ${existingNoOwner} ใน Category/Stage เดียวกัน`);
    }
    if (batchNoOwner && batchNoOwner !== row.match_code) {
      addMessage(messages, 'error', 'E19', `match_no ${row.match_no} ซ้ำภายในไฟล์กับ Match ${batchNoOwner} ใน Category/Stage เดียวกัน`);
    }
  }

  const diff = buildScheduleImportDiff(
    existing,
    row,
    category?.id || null,
    group?.id || null,
    venue?.id || null,
    court?.id || null
  );

  const hasError = messages.some((message) => message.severity === 'error');
  const hasWarning = messages.some((message) => message.severity === 'warning');
  const status: ValidatedScheduleImportRow['status'] = hasError ? 'error' : hasWarning ? 'warning' : 'valid';

  if (row.match_code) seen.matchCodes.add(row.match_code);
  if (!hasError && slot) seen.slotOwners.set(slot, row.match_code);
  if (!hasError && venue && row.match_date) {
    const dayKey = venueDayKey(venue.id, row.match_date);
    seen.venueDayCounts.set(dayKey, (seen.venueDayCounts.get(dayKey) || 0) + 1);
  }
  if (!hasError && pairKey) seen.pairOwners.set(pairKey, row.match_code);
  if (!hasError && row.match_no !== null && category) {
    seen.matchNoOwners.set(matchNoKey(category.id, row.stage, row.match_no), row.match_code);
  }

  return {
    row: rowNo,
    status,
    action: hasError ? 'skip' : existing ? 'update' : 'create',
    match_code: row.match_code,
    normalized: row,
    messages,
    diff,
    existingMatchId: existing?.id || null,
    requiresRevisionConfirmation: existing?.schedule_status === 'published' && diff.length > 0,
  };
}

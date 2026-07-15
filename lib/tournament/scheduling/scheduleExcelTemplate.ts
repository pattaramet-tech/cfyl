export const SCHEDULE_TEMPLATE_HEADERS = [
  'match_code',
  'category_code',
  'stage',
  'group_code',
  'venue_code',
  'court_code',
  'match_date',
  'start_time',
  'match_no',
  'home_source_type',
  'home_source_ref',
  'away_source_type',
  'away_source_ref',
  'result_policy',
  'status',
  'note',
] as const;

export const SCHEDULE_SOURCE_TYPES = [
  'team',
  'group_slot',
  'group_rank',
  'match_winner',
  'match_loser',
  'best_ranked',
  'bye',
  'tbd',
] as const;

export const SCHEDULE_STAGES = [
  'group',
  'round_of_32',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'third_place',
  'final',
  'custom',
] as const;

export const SCHEDULE_MATCH_STATUSES = [
  'scheduled',
  'ready',
  'postponed',
  'cancelled',
] as const;

export const SCHEDULE_RESULT_POLICIES = [
  'single_step',
  'two_step',
  'central_review',
] as const;

export type ScheduleSourceType = (typeof SCHEDULE_SOURCE_TYPES)[number];
export type ScheduleStage = (typeof SCHEDULE_STAGES)[number];
export type ScheduleMatchStatus = (typeof SCHEDULE_MATCH_STATUSES)[number];
export type ScheduleResultPolicy = (typeof SCHEDULE_RESULT_POLICIES)[number];

export const SCHEDULE_TEMPLATE_SAMPLE: Record<string, string | number>[] = [
  {
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
  },
  {
    match_code: 'B-U12-R16-01',
    category_code: 'B-U12',
    stage: 'round_of_16',
    group_code: '',
    venue_code: 'V1',
    court_code: 'C1',
    match_date: '2026-08-08',
    start_time: '09:00',
    match_no: 65,
    home_source_type: 'group_rank',
    home_source_ref: 'A:1',
    away_source_type: 'group_rank',
    away_source_ref: 'B:2',
    result_policy: 'single_step',
    status: 'scheduled',
    note: '',
  },
];

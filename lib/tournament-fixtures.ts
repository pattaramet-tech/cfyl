// Shared logic for tournament fixtures (manual + XLSX/CSV import).
// Server-side only (used by /api/admin/tournament-fixtures/*).
import type { SupabaseClient } from '@supabase/supabase-js';

export const FIXTURE_STAGES = [
  'group',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'final',
  'third_place',
] as const;
export type FixtureStage = (typeof FIXTURE_STAGES)[number];

export const TEMPLATE_HEADERS = [
  'season_slug',
  'age_group',
  'group',
  'stage',
  'match_code',
  'matchday',
  'date',
  'time',
  'venue',
  'home_team_code',
  'home_team',
  'away_team_code',
  'away_team',
] as const;

export const TEMPLATE_SAMPLE: Record<string, string>[] = [
  {
    season_slug: 'chonburi-pao-2026', age_group: 'U14', group: 'Group A', stage: 'group',
    match_code: 'CPAO-U14-GA-001', matchday: 'Group A MD1', date: '2026-08-01', time: '09:00',
    venue: 'สนาม 1', home_team_code: 'TA', home_team: 'Team A', away_team_code: 'TB', away_team: 'Team B',
  },
  {
    season_slug: 'chonburi-pao-2026', age_group: 'U14', group: 'Group A', stage: 'group',
    match_code: 'CPAO-U14-GA-002', matchday: 'Group A MD1', date: '2026-08-01', time: '10:00',
    venue: 'สนาม 1', home_team_code: 'TC', home_team: 'Team C', away_team_code: 'TD', away_team: 'Team D',
  },
];

export interface RawFixtureRow {
  season_slug?: string;
  age_group?: string;
  group?: string;
  stage?: string;
  match_code?: string;
  matchday?: string;
  date?: string;
  time?: string;
  venue?: string;
  home_team_code?: string;
  home_team?: string;
  away_team_code?: string;
  away_team?: string;
}

export interface FixtureInsert {
  season_id: string;
  age_group_id: string;
  division_id: null;
  tournament_group_id: string | null;
  stage: string;
  match_code: string;
  matchday: string;
  match_date: string | null;
  match_time: string | null;
  venue: string | null;
  home_team_id: string;
  away_team_id: string;
  home_score: null;
  away_score: null;
  status: 'scheduled';
}

export interface RowResult {
  row: number;
  status: 'valid' | 'error';
  messages: string[];
  match_code: string;
  group: string;
  stage: string;
  datetime: string;
  venue: string;
  home: string;
  away: string;
  insert?: FixtureInsert;
}

interface TeamLite { id: string; name: string; short_name: string | null }

export interface FixtureContext {
  seasonId: string;
  ageGroupId: string;
  seasonSeg: string; // slug or year of the selected season
  ageCode: string;
  teamsByCode: Map<string, TeamLite | null>; // null = ambiguous
  teamsByName: Map<string, TeamLite | null>;
  groupsByKey: Map<string, { id: string; name: string } | null>;
  groupTeams: Map<string, Set<string>>; // group_id -> team_ids
  existingCodes: Set<string>;
  existingPairs: Set<string>;
  existingSlots: Set<string>;
}

const norm = (v: unknown) => String(v ?? '').trim();
const low = (v: unknown) => norm(v).toLowerCase();
const pairKey = (stage: string, groupId: string | null, a: string, b: string) =>
  `${stage}|${groupId || ''}|${[a, b].sort().join('-')}`;
const slotKey = (date: string, time: string, venue: string) => `${date}|${time}|${low(venue)}`;

/** Build the validation context for a (season, age group). */
export async function buildFixtureContext(
  db: SupabaseClient,
  seasonId: string,
  ageGroupId: string,
  seasonSeg: string,
  ageCode: string
): Promise<FixtureContext> {
  const [teamsRes, groupsRes, codesRes, existingRes] = await Promise.all([
    db.from('teams').select('id, name, short_name').eq('season_id', seasonId).eq('age_group_id', ageGroupId),
    db.from('tournament_groups').select('id, name, code').eq('season_id', seasonId).eq('age_group_id', ageGroupId),
    db.from('matches').select('match_code').eq('season_id', seasonId),
    db.from('matches')
      .select('home_team_id, away_team_id, stage, tournament_group_id, match_date, match_time, venue')
      .eq('season_id', seasonId)
      .eq('age_group_id', ageGroupId),
  ]);

  const teamsByCode = new Map<string, TeamLite | null>();
  const teamsByName = new Map<string, TeamLite | null>();
  for (const t of (teamsRes.data || []) as TeamLite[]) {
    const nameKey = low(t.name);
    teamsByName.set(nameKey, teamsByName.has(nameKey) ? null : t);
    if (t.short_name) {
      const codeKey = low(t.short_name);
      teamsByCode.set(codeKey, teamsByCode.has(codeKey) ? null : t);
    }
  }

  const groupsByKey = new Map<string, { id: string; name: string } | null>();
  const groupIds: string[] = [];
  for (const g of (groupsRes.data || []) as { id: string; name: string; code: string | null }[]) {
    groupIds.push(g.id);
    const entry = { id: g.id, name: g.name };
    for (const k of [low(g.name), low(g.code)].filter(Boolean)) {
      groupsByKey.set(k, groupsByKey.has(k) ? null : entry);
    }
  }

  const groupTeams = new Map<string, Set<string>>();
  if (groupIds.length) {
    const { data: gt } = await db
      .from('tournament_group_teams')
      .select('group_id, team_id')
      .in('group_id', groupIds);
    for (const r of (gt || []) as { group_id: string; team_id: string }[]) {
      if (!groupTeams.has(r.group_id)) groupTeams.set(r.group_id, new Set());
      groupTeams.get(r.group_id)!.add(r.team_id);
    }
  }

  const existingCodes = new Set<string>((codesRes.data || []).map((m: any) => norm(m.match_code)));
  const existingPairs = new Set<string>();
  const existingSlots = new Set<string>();
  for (const m of (existingRes.data || []) as any[]) {
    if (m.home_team_id && m.away_team_id) {
      existingPairs.add(pairKey(m.stage || 'group', m.tournament_group_id || null, m.home_team_id, m.away_team_id));
    }
    if (m.match_date && m.match_time && m.venue) {
      existingSlots.add(slotKey(m.match_date, m.match_time, m.venue));
    }
  }

  return { seasonId, ageGroupId, seasonSeg, ageCode, teamsByCode, teamsByName, groupsByKey, groupTeams, existingCodes, existingPairs, existingSlots };
}

interface BatchSeen { codes: Set<string>; pairs: Set<string>; slots: Set<string> }
export function newBatchSeen(): BatchSeen {
  return { codes: new Set(), pairs: new Set(), slots: new Set() };
}

function resolveTeam(ctx: FixtureContext, code: string, name: string, side: string, errors: string[]): TeamLite | null {
  if (code) {
    const found = ctx.teamsByCode.get(low(code));
    if (found === null) { errors.push(`${side}_team_code "${code}" ซ้ำกันหลายทีม`); return null; }
    if (!found) { errors.push(`ไม่พบทีมจาก ${side}_team_code "${code}"`); return null; }
    return found;
  }
  if (name) {
    const found = ctx.teamsByName.get(low(name));
    if (found === null) { errors.push(`${side}_team "${name}" ซ้ำกันหลายทีม`); return null; }
    if (!found) { errors.push(`ไม่พบทีมจาก ${side}_team "${name}"`); return null; }
    return found;
  }
  errors.push(`ต้องระบุ ${side}_team_code หรือ ${side}_team`);
  return null;
}

/** Validate a single raw row against the context (+ in-batch dedupe). */
export function validateFixtureRow(raw: RawFixtureRow, ctx: FixtureContext, rowNo: number, seen: BatchSeen): RowResult {
  const errors: string[] = [];

  if (low(raw.season_slug) && low(raw.season_slug) !== low(ctx.seasonSeg)) {
    errors.push(`season_slug "${norm(raw.season_slug)}" ไม่ตรงกับฤดูกาลที่เลือก`);
  }
  if (low(raw.age_group) && low(raw.age_group) !== low(ctx.ageCode)) {
    errors.push(`age_group "${norm(raw.age_group)}" ไม่ตรงกับรุ่นที่เลือก`);
  }

  const stage = norm(raw.stage) || 'group';
  if (!FIXTURE_STAGES.includes(stage as FixtureStage)) {
    errors.push(`stage "${stage}" ไม่ถูกต้อง (${FIXTURE_STAGES.join('/')})`);
  }

  const matchCode = norm(raw.match_code);
  if (!matchCode) errors.push('ต้องระบุ match_code');
  else if (ctx.existingCodes.has(matchCode) || seen.codes.has(low(matchCode))) {
    errors.push(`match_code "${matchCode}" ซ้ำในฤดูกาล`);
  }

  const home = resolveTeam(ctx, norm(raw.home_team_code), norm(raw.home_team), 'home', errors);
  const away = resolveTeam(ctx, norm(raw.away_team_code), norm(raw.away_team), 'away', errors);
  if (home && away && home.id === away.id) errors.push('home_team กับ away_team ต้องไม่ใช่ทีมเดียวกัน');

  let groupId: string | null = null;
  const groupRaw = norm(raw.group);
  if (groupRaw) {
    const g = ctx.groupsByKey.get(low(groupRaw));
    if (g === null) errors.push(`group "${groupRaw}" ซ้ำกันหลายกลุ่ม`);
    else if (!g) errors.push(`ไม่พบกลุ่ม "${groupRaw}"`);
    else {
      groupId = g.id;
      const members = ctx.groupTeams.get(g.id) || new Set();
      if (home && !members.has(home.id)) errors.push(`home_team ไม่ได้อยู่ในกลุ่ม "${g.name}"`);
      if (away && !members.has(away.id)) errors.push(`away_team ไม่ได้อยู่ในกลุ่ม "${g.name}"`);
    }
  }

  const date = norm(raw.date) || null;
  const time = norm(raw.time) || null;
  const venue = norm(raw.venue) || null;

  // duplicate pair (A vs B == B vs A within stage+group)
  if (home && away) {
    const pk = pairKey(stage, groupId, home.id, away.id);
    if (ctx.existingPairs.has(pk) || seen.pairs.has(pk)) {
      errors.push('คู่ทีมนี้ซ้ำใน stage/กลุ่มเดียวกัน');
    }
  }
  // duplicate slot (same date+time+venue)
  if (date && time && venue) {
    const sk = slotKey(date, time, venue);
    if (ctx.existingSlots.has(sk) || seen.slots.has(sk)) {
      errors.push('สนาม + วันที่ + เวลา ซ้ำกับแมตช์อื่น');
    }
  }

  const homeName = home?.name || norm(raw.home_team) || norm(raw.home_team_code);
  const awayName = away?.name || norm(raw.away_team) || norm(raw.away_team_code);
  const base = {
    row: rowNo,
    match_code: matchCode,
    group: groupRaw,
    stage,
    datetime: [date, time].filter(Boolean).join(' '),
    venue: venue || '',
    home: homeName,
    away: awayName,
  };

  if (errors.length || !home || !away) {
    return { ...base, status: 'error', messages: errors.length ? errors : ['ข้อมูลไม่ครบ'] };
  }

  // reserve in batch so later rows detect duplicates
  seen.codes.add(low(matchCode));
  seen.pairs.add(pairKey(stage, groupId, home.id, away.id));
  if (date && time && venue) seen.slots.add(slotKey(date, time, venue));

  const insert: FixtureInsert = {
    season_id: ctx.seasonId,
    age_group_id: ctx.ageGroupId,
    division_id: null,
    tournament_group_id: groupId,
    stage,
    match_code: matchCode,
    matchday: norm(raw.matchday),
    match_date: date,
    match_time: time,
    venue,
    home_team_id: home.id,
    away_team_id: away.id,
    home_score: null,
    away_score: null,
    status: 'scheduled',
  };
  return { ...base, status: 'valid', messages: [], insert };
}

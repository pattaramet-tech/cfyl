// Shared logic for bulk add / import of teams and players (Phase 5A.5).
// Server-side only.
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Templates ──────────────────────────────────────────────────────────────
export const TEAM_HEADERS = [
  'season_slug', 'age_group', 'team_name', 'team_code', 'division', 'logo_url', 'team_color', 'active',
] as const;
export const TEAM_SAMPLE: Record<string, string>[] = [
  // Same school across age groups — use age-specific team_code to avoid confusion
  { season_slug: 'chonburi-pao-2026', age_group: 'U14', team_name: 'โรงเรียนหัวถนนวิทยา', team_code: 'HTN-U14', division: '', logo_url: '', team_color: '', active: 'true' },
  { season_slug: 'chonburi-pao-2026', age_group: 'U16', team_name: 'โรงเรียนหัวถนนวิทยา', team_code: 'HTN-U16', division: '', logo_url: '', team_color: '', active: 'true' },
];

export const PLAYER_HEADERS = [
  'season_slug', 'age_group', 'team_code', 'team_name', 'player_code', 'shirt_no', 'full_name', 'active',
] as const;
export const PLAYER_SAMPLE: Record<string, string>[] = [
  { season_slug: 'chonburi-pao-2026', age_group: 'U14', team_code: 'MON', team_name: 'Monday', player_code: 'U14-MON-001', shirt_no: '1', full_name: 'ด.ช. ตัวอย่าง 1', active: 'true' },
  { season_slug: 'chonburi-pao-2026', age_group: 'U14', team_code: 'MON', team_name: 'Monday', player_code: '', shirt_no: '2', full_name: 'ด.ช. ตัวอย่าง 2', active: 'true' },
];

// ─── Shared helpers ─────────────────────────────────────────────────────────
export interface RowResult {
  row: number;
  status: 'valid' | 'warning' | 'error';
  messages: string[];
  cells: Record<string, string>;
  insert?: Record<string, unknown>;
}

const norm = (v: unknown) => String(v ?? '').trim();
const low = (v: unknown) => norm(v).toLowerCase();
const pad3 = (n: number) => String(n).padStart(3, '0');
const codeSlug = (s: string) => norm(s).replace(/[^a-zA-Z0-9]+/g, '').toUpperCase().slice(0, 8);

function parseActive(v: unknown): boolean {
  const s = low(v);
  if (!s) return true;
  return !['false', '0', 'no', 'ไม่', 'inactive', 'ปิด'].includes(s);
}

// ─── TEAMS ──────────────────────────────────────────────────────────────────
export interface TeamContext {
  seasonId: string; ageGroupId: string; seasonSeg: string; ageCode: string; compType: string;
  divisionsByKey: Map<string, { id: string; name: string } | null>;
  existingNames: Set<string>;
  existingCodes: Set<string>;
}
export interface TeamSeen { names: Set<string>; codes: Set<string> }
export const newTeamSeen = (): TeamSeen => ({ names: new Set(), codes: new Set() });

export async function buildTeamContext(
  db: SupabaseClient, seasonId: string, ageGroupId: string, seasonSeg: string, ageCode: string, compType: string
): Promise<TeamContext> {
  const [divRes, teamRes] = await Promise.all([
    db.from('divisions').select('id, name').eq('season_id', seasonId).eq('age_group_id', ageGroupId),
    db.from('teams').select('name, short_name').eq('season_id', seasonId).eq('age_group_id', ageGroupId),
  ]);
  const divisionsByKey = new Map<string, { id: string; name: string } | null>();
  for (const d of (divRes.data || []) as { id: string; name: string }[]) {
    const k = low(d.name);
    divisionsByKey.set(k, divisionsByKey.has(k) ? null : { id: d.id, name: d.name });
  }
  const existingNames = new Set<string>();
  const existingCodes = new Set<string>();
  for (const t of (teamRes.data || []) as { name: string; short_name: string | null }[]) {
    existingNames.add(low(t.name));
    if (t.short_name) existingCodes.add(low(t.short_name));
  }
  return { seasonId, ageGroupId, seasonSeg, ageCode, compType, divisionsByKey, existingNames, existingCodes };
}

export function validateTeamRow(raw: Record<string, string>, ctx: TeamContext, rowNo: number, seen: TeamSeen): RowResult {
  const errors: string[] = [];
  const name = norm(raw.team_name);
  const code = norm(raw.team_code);
  const divisionRaw = norm(raw.division);

  if (low(raw.season_slug) && low(raw.season_slug) !== low(ctx.seasonSeg)) errors.push(`season_slug ไม่ตรงกับฤดูกาลที่เลือก`);
  if (low(raw.age_group) && low(raw.age_group) !== low(ctx.ageCode)) errors.push(`age_group ไม่ตรงกับรุ่นที่เลือก`);
  if (!name) errors.push('ต้องระบุ team_name');
  else if (ctx.existingNames.has(low(name)) || seen.names.has(low(name))) errors.push(`team_name "${name}" ซ้ำในรุ่นนี้`);

  if (code && (ctx.existingCodes.has(low(code)) || seen.codes.has(low(code)))) errors.push(`team_code "${code}" ซ้ำในรุ่นนี้`);

  let divisionId: string | null = null;
  if (divisionRaw) {
    const d = ctx.divisionsByKey.get(low(divisionRaw));
    if (d === null) errors.push(`division "${divisionRaw}" ซ้ำกันหลายรายการ`);
    else if (!d) errors.push(`ไม่พบ division "${divisionRaw}"`);
    else divisionId = d.id;
  }
  if (ctx.compType === 'league' && !divisionId) errors.push('league season ต้องระบุ division');

  const cells = { team_name: name, team_code: code, division: divisionRaw };
  if (errors.length) return { row: rowNo, status: 'error', messages: errors, cells };

  seen.names.add(low(name));
  if (code) seen.codes.add(low(code));

  return {
    row: rowNo, status: 'valid', messages: [], cells,
    insert: {
      season_id: ctx.seasonId, age_group_id: ctx.ageGroupId, division_id: divisionId,
      name, short_name: code || null,
      logo_url: norm(raw.logo_url) || null,
      team_color: norm(raw.team_color) || null,
      active: parseActive(raw.active),
    },
  };
}

// ─── PLAYERS ────────────────────────────────────────────────────────────────
interface TeamLite { id: string; name: string; short_name: string | null; division_id: string | null }
export interface PlayerContext {
  seasonId: string; ageGroupId: string; seasonSeg: string; ageCode: string;
  teamsByCode: Map<string, TeamLite | null>;
  teamsByName: Map<string, TeamLite | null>;
  existingCodes: Set<string>;
  existingTeamNames: Map<string, Set<string>>; // team_id -> lower full_names
}
export interface PlayerSeen { codes: Set<string>; teamNames: Map<string, Set<string>>; counters: Map<string, number> }
export const newPlayerSeen = (): PlayerSeen => ({ codes: new Set(), teamNames: new Map(), counters: new Map() });

export async function buildPlayerContext(
  db: SupabaseClient, seasonId: string, ageGroupId: string, seasonSeg: string, ageCode: string
): Promise<PlayerContext> {
  const [teamRes, codeRes, nameRes] = await Promise.all([
    db.from('teams').select('id, name, short_name, division_id').eq('season_id', seasonId).eq('age_group_id', ageGroupId),
    db.from('players').select('player_code').eq('season_id', seasonId),
    db.from('players').select('team_id, full_name').eq('season_id', seasonId).eq('age_group_id', ageGroupId),
  ]);
  const teamsByCode = new Map<string, TeamLite | null>();
  const teamsByName = new Map<string, TeamLite | null>();
  for (const t of (teamRes.data || []) as TeamLite[]) {
    const nk = low(t.name);
    teamsByName.set(nk, teamsByName.has(nk) ? null : t);
    if (t.short_name) { const ck = low(t.short_name); teamsByCode.set(ck, teamsByCode.has(ck) ? null : t); }
  }
  const existingCodes = new Set<string>((codeRes.data || []).map((p: any) => low(p.player_code)));
  const existingTeamNames = new Map<string, Set<string>>();
  for (const p of (nameRes.data || []) as { team_id: string; full_name: string }[]) {
    if (!existingTeamNames.has(p.team_id)) existingTeamNames.set(p.team_id, new Set());
    existingTeamNames.get(p.team_id)!.add(low(p.full_name));
  }
  return { seasonId, ageGroupId, seasonSeg, ageCode, teamsByCode, teamsByName, existingCodes, existingTeamNames };
}

function autoGenCode(ctx: PlayerContext, seen: PlayerSeen, team: TeamLite): string {
  const prefix = `${ctx.ageCode}-${team.short_name ? codeSlug(team.short_name) : codeSlug(team.name)}`.toUpperCase();
  let seq = (seen.counters.get(prefix) || 0) + 1;
  let code = `${prefix}-${pad3(seq)}`;
  while (ctx.existingCodes.has(low(code)) || seen.codes.has(low(code))) {
    seq += 1; code = `${prefix}-${pad3(seq)}`;
  }
  seen.counters.set(prefix, seq);
  return code;
}

export function validatePlayerRow(raw: Record<string, string>, ctx: PlayerContext, rowNo: number, seen: PlayerSeen): RowResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fullName = norm(raw.full_name);
  const teamCode = norm(raw.team_code);
  const teamName = norm(raw.team_name);

  if (low(raw.season_slug) && low(raw.season_slug) !== low(ctx.seasonSeg)) errors.push('season_slug ไม่ตรงกับฤดูกาลที่เลือก');
  if (low(raw.age_group) && low(raw.age_group) !== low(ctx.ageCode)) errors.push('age_group ไม่ตรงกับรุ่นที่เลือก');

  // resolve team: code first, else name
  let team: TeamLite | null = null;
  if (teamCode) {
    const t = ctx.teamsByCode.get(low(teamCode));
    if (t === null) errors.push(`team_code "${teamCode}" ซ้ำกันหลายทีม`);
    else if (!t) errors.push(`ไม่พบทีมจาก team_code "${teamCode}"`);
    else team = t;
  } else if (teamName) {
    const t = ctx.teamsByName.get(low(teamName));
    if (t === null) errors.push(`team_name "${teamName}" ซ้ำกันหลายทีม`);
    else if (!t) errors.push(`ไม่พบทีมจาก team_name "${teamName}"`);
    else team = t;
  } else {
    errors.push('ต้องระบุ team_code หรือ team_name');
  }

  if (!fullName) errors.push('ต้องระบุ full_name');

  let playerCode = norm(raw.player_code);
  if (playerCode) {
    if (ctx.existingCodes.has(low(playerCode)) || seen.codes.has(low(playerCode))) {
      errors.push(`player_code "${playerCode}" ถูกใช้แล้ว`);
    }
  }

  // shirt_no
  let shirtNo: number | null = null;
  const shirtRaw = norm(raw.shirt_no);
  if (shirtRaw) {
    const n = parseInt(shirtRaw, 10);
    if (isNaN(n)) warnings.push(`shirt_no "${shirtRaw}" ไม่ใช่ตัวเลข — เว้นว่างให้`);
    else shirtNo = n;
  }

  const cells = { team: team?.name || teamCode || teamName, player_code: playerCode, shirt_no: shirtRaw, full_name: fullName };

  if (errors.length || !team || !fullName) {
    return { row: rowNo, status: 'error', messages: errors.length ? errors : ['ข้อมูลไม่ครบ'], cells };
  }

  // duplicate full_name in same team (different code) -> warning
  const dbNames = ctx.existingTeamNames.get(team.id);
  const batchNames = seen.teamNames.get(team.id);
  if ((dbNames && dbNames.has(low(fullName))) || (batchNames && batchNames.has(low(fullName)))) {
    warnings.push('ชื่อซ้ำในทีมเดียวกัน (คนละ player_code)');
  }

  // auto-generate player_code if blank
  if (!playerCode) playerCode = autoGenCode(ctx, seen, team);

  seen.codes.add(low(playerCode));
  if (!seen.teamNames.has(team.id)) seen.teamNames.set(team.id, new Set());
  seen.teamNames.get(team.id)!.add(low(fullName));

  cells.player_code = playerCode;
  return {
    row: rowNo, status: warnings.length ? 'warning' : 'valid', messages: warnings, cells,
    insert: {
      season_id: ctx.seasonId, age_group_id: ctx.ageGroupId, division_id: team.division_id,
      team_id: team.id, player_code: playerCode, shirt_no: shirtNo, full_name: fullName,
      active: parseActive(raw.active),
    },
  };
}

// Knockout bracket logic (Phase 5B.1). Server-side only.
import { calculateStandings } from '@/lib/calculations';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Match } from '@/types/db';

export const BRACKET_SIZES = [4, 8, 16] as const;
export const KNOCKOUT_STAGES = ['round_of_16', 'quarter_final', 'semi_final', 'final', 'third_place'] as const;

const STAGE_LABEL: Record<string, string> = {
  round_of_16: 'Round of 16', quarter_final: 'Quarter Final', semi_final: 'Semi Final',
  final: 'Final', third_place: 'Third Place',
};
const STAGE_PREFIX: Record<string, string> = {
  round_of_16: 'R16', quarter_final: 'QF', semi_final: 'SF', final: 'F', third_place: 'T',
};

export interface TemplateMatch {
  key: string; stage: string; position: number; isFirst: boolean;
  winnerToKey?: string; winnerToSlot?: 'home' | 'away';
  loserToKey?: string; loserToSlot?: 'home' | 'away';
}
export interface Template {
  size: number; firstStage: string;
  rounds: { stage: string; name: string; sort: number }[];
  matches: TemplateMatch[];
}

/** Build a standard single-elimination template (4 / 8 / 16) + third-place. */
export function buildTemplate(size: number): Template {
  let stages: string[];
  if (size === 16) stages = ['round_of_16', 'quarter_final', 'semi_final', 'final'];
  else if (size === 8) stages = ['quarter_final', 'semi_final', 'final'];
  else if (size === 4) stages = ['semi_final', 'final'];
  else throw new Error('bracket size ต้องเป็น 4, 8 หรือ 16');

  const counts: Record<string, number> = {};
  let c = size / 2;
  for (const s of stages) { counts[s] = s === 'final' ? 1 : c; c = Math.floor(c / 2); }

  const rounds: Template['rounds'] = stages.map((s, i) => ({ stage: s, name: STAGE_LABEL[s], sort: i + 1 }));
  rounds.push({ stage: 'third_place', name: STAGE_LABEL.third_place, sort: stages.length + 1 });

  const matches: TemplateMatch[] = [];
  stages.forEach((s, si) => {
    for (let i = 1; i <= counts[s]; i++) {
      const m: TemplateMatch = { key: `${STAGE_PREFIX[s]}${i}`, stage: s, position: i, isFirst: si === 0 };
      if (si < stages.length - 1) {
        const next = stages[si + 1];
        m.winnerToKey = `${STAGE_PREFIX[next]}${Math.ceil(i / 2)}`;
        m.winnerToSlot = i % 2 === 1 ? 'home' : 'away';
      }
      if (s === 'semi_final') {
        m.loserToKey = `${STAGE_PREFIX.third_place}1`;
        m.loserToSlot = i % 2 === 1 ? 'home' : 'away';
      }
      matches.push(m);
    }
  });
  matches.push({ key: `${STAGE_PREFIX.third_place}1`, stage: 'third_place', position: 1, isFirst: false });
  return { size, firstStage: stages[0], rounds, matches };
}

/** Generate a unique knockout match_code within a season. Mutates `existing`. */
export function knockoutMatchCode(ageCode: string, stage: string, position: number, existing: Set<string>): string {
  const abbr = STAGE_PREFIX[stage] || stage.toUpperCase();
  const base = `${ageCode}-${abbr}-${position}`;
  let code = base, n = 1;
  while (existing.has(code)) { n += 1; code = `${base}-${n}`; }
  existing.add(code);
  return code;
}

/** First-round slots in order (home, away per first-round match). length = size. */
export function firstRoundSlots(tpl: Template): { key: string; slot: 'home' | 'away' }[] {
  const slots: { key: string; slot: 'home' | 'away' }[] = [];
  for (const m of tpl.matches.filter((x) => x.isFirst).sort((a, b) => a.position - b.position)) {
    slots.push({ key: m.key, slot: 'home' }, { key: m.key, slot: 'away' });
  }
  return slots;
}

// ─── Group rank resolution ──────────────────────────────────────────────────
export interface GroupRank {
  groupId: string; name: string; ranked: { teamId: string; teamName: string }[]; complete: boolean;
}
export async function resolveGroupRanks(
  db: SupabaseClient, seasonId: string, ageGroupId: string
): Promise<Map<string, GroupRank>> {
  const out = new Map<string, GroupRank>();
  const { data: groups } = await db
    .from('tournament_groups').select('id, name').eq('season_id', seasonId).eq('age_group_id', ageGroupId);
  const { data: gt } = await db
    .from('tournament_group_teams').select('group_id, team_id, team:team_id(name)')
    .in('group_id', (groups || []).map((g: any) => g.id));
  const { data: matchesRaw } = await db
    .from('matches').select('*').eq('season_id', seasonId).eq('age_group_id', ageGroupId);
  const matches = (matchesRaw as Match[] | null) || [];

  for (const g of (groups || []) as { id: string; name: string }[]) {
    const members = (gt || []).filter((r: any) => r.group_id === g.id);
    const ids = new Set(members.map((m: any) => m.team_id));
    const nameById = new Map(members.map((m: any) => [m.team_id, (m.team as any)?.name || '']));
    const groupMatches = matches.filter(
      (m) => m.status === 'finished' && m.home_score !== null && m.away_score !== null &&
        ids.has(m.home_team_id) && ids.has(m.away_team_id)
    );
    const ranked = Array.from(ids)
      .map((id) => ({ id: id as string, s: calculateStandings(groupMatches, id as string), name: nameById.get(id) || '' }))
      .sort((a, b) =>
        b.s.points - a.s.points || b.s.goalDiff - a.s.goalDiff || b.s.goalsFor - a.s.goalsFor ||
        a.name.localeCompare(b.name, 'th'))
      .map((x) => ({ teamId: x.id, teamName: x.name }));
    const n = ids.size;
    const expected = n > 1 ? (n * (n - 1)) / 2 : 0;
    out.set(g.id, { groupId: g.id, name: g.name, ranked, complete: n > 1 && groupMatches.length >= expected });
  }
  return out;
}

/** Resolve a single source ({type, ref}) to a team id (or null if not yet known). */
export function resolveSource(
  type: string | null | undefined, ref: string | null | undefined, ranks: Map<string, GroupRank>
): { teamId: string | null; label: string; warning?: string } {
  if (type === 'direct_team' && ref) return { teamId: ref, label: 'ทีมที่กำหนด' };
  if (type === 'group_rank' && ref) {
    const [groupId, rankStr] = ref.split(':');
    const rank = parseInt(rankStr, 10);
    const gr = ranks.get(groupId);
    const label = `${gr?.name || 'Group'} อันดับ ${rank}`;
    if (!gr) return { teamId: null, label, warning: 'ไม่พบกลุ่ม' };
    if (!gr.complete) return { teamId: gr.ranked[rank - 1]?.teamId || null, label, warning: 'รอบแบ่งกลุ่มยังไม่ครบ' };
    return { teamId: gr.ranked[rank - 1]?.teamId || null, label };
  }
  if (type === 'match_winner') return { teamId: null, label: `ผู้ชนะ ${ref}` };
  if (type === 'match_loser') return { teamId: null, label: `ผู้แพ้ ${ref}` };
  return { teamId: null, label: '—' };
}

// ─── Winner decision ────────────────────────────────────────────────────────
export interface MatchResultLite {
  home_team_id: string | null; away_team_id: string | null;
  home_score: number | null; away_score: number | null;
  status: string; winner_team_id?: string | null;
}
export type WinnerState =
  | { state: 'no_result' }
  | { state: 'draw_no_winner' }
  | { state: 'decided'; winner: string; loser: string };

export function decideWinner(m: MatchResultLite | null | undefined): WinnerState {
  if (!m || m.status !== 'finished' || m.home_score === null || m.away_score === null) return { state: 'no_result' };
  const h = m.home_team_id!, a = m.away_team_id!;
  if (m.home_score > m.away_score) return { state: 'decided', winner: h, loser: a };
  if (m.away_score > m.home_score) return { state: 'decided', winner: a, loser: h };
  if (m.winner_team_id === h) return { state: 'decided', winner: h, loser: a };
  if (m.winner_team_id === a) return { state: 'decided', winner: a, loser: h };
  return { state: 'draw_no_winner' };
}

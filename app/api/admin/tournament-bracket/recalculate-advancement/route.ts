import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
import { resolveGroupRanks, resolveSource, decideWinner, knockoutMatchCode } from '@/lib/bracket';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated || !auth.profile) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json();
  const { seasonId, ageGroupId } = body;
  if (!seasonId || !ageGroupId) return NextResponse.json({ error: 'seasonId and ageGroupId required' }, { status: 400 });

  const { data: ag } = await supabaseAdmin.from('age_groups').select('code').eq('id', ageGroupId).single();
  if (!ag) return NextResponse.json({ error: 'ไม่พบรุ่นอายุ' }, { status: 404 });
  const ageCode = ag.code;

  const { data: bmsRaw } = await supabaseAdmin
    .from('bracket_matches')
    .select('id, round_id, match_id, bracket_position, home_team_id, away_team_id, home_source_type, home_source_ref, away_source_type, away_source_ref, winner_to_bracket_match_id, winner_to_slot, loser_to_bracket_match_id, loser_to_slot, round:round_id(stage, name, sort_order)')
    .eq('season_id', seasonId).eq('age_group_id', ageGroupId);
  const bms = (bmsRaw || []) as any[];
  if (bms.length === 0) return NextResponse.json({ error: 'ยังไม่มี bracket' }, { status: 404 });

  const matchIds = bms.map((b) => b.match_id).filter(Boolean);
  const matchById = new Map<string, any>();
  if (matchIds.length) {
    const { data: ms } = await supabaseAdmin
      .from('matches').select('id, home_team_id, away_team_id, home_score, away_score, status, winner_team_id').in('id', matchIds);
    for (const m of ms || []) matchById.set(m.id, m);
  }

  const ranks = await resolveGroupRanks(supabaseAdmin, seasonId, ageGroupId);
  const { data: codeRows } = await supabaseAdmin.from('matches').select('match_code').eq('season_id', seasonId);
  const existingCodes = new Set<string>((codeRows || []).map((m: any) => m.match_code));

  const bmById = new Map(bms.map((b) => [b.id, b]));
  const dirty = new Set<string>();
  const warnings: string[] = [];

  // Pass A: resolve first-round group_rank sources not yet set
  for (const b of bms) {
    if (!b.home_team_id && b.home_source_type === 'group_rank') {
      const r = resolveSource(b.home_source_type, b.home_source_ref, ranks);
      if (r.teamId) { b.home_team_id = r.teamId; dirty.add(b.id); } else if (r.warning) warnings.push(`${b.round?.name}: ${r.warning}`);
    }
    if (!b.away_team_id && b.away_source_type === 'group_rank') {
      const r = resolveSource(b.away_source_type, b.away_source_ref, ranks);
      if (r.teamId) { b.away_team_id = r.teamId; dirty.add(b.id); }
    }
  }

  // Pass B: advancement in round order
  const ordered = [...bms].sort((a, b) => (a.round?.sort_order || 0) - (b.round?.sort_order || 0) || a.bracket_position - b.bracket_position);
  const setSlot = (targetId: string | null, slot: string | null, teamId: string) => {
    if (!targetId || !slot) return;
    const t = bmById.get(targetId);
    if (!t) return;
    if (t.match_id) { const r = matchById.get(t.match_id); if (r && r.status === 'finished') return; } // don't overwrite a played match
    const field = slot === 'home' ? 'home_team_id' : 'away_team_id';
    if (t[field] !== teamId) { t[field] = teamId; dirty.add(t.id); }
  };

  for (const b of ordered) {
    const res = b.match_id ? matchById.get(b.match_id) : null;
    const d = decideWinner(res);
    if (d.state === 'draw_no_winner') { warnings.push(`${b.round?.name} #${b.bracket_position}: ผลเสมอ ยังเลื่อนทีมไม่ได้ (กรอกผู้ชนะหลังดวลจุดโทษ)`); continue; }
    if (d.state !== 'decided') continue;
    setSlot(b.winner_to_bracket_match_id, b.winner_to_slot, d.winner);
    setSlot(b.loser_to_bracket_match_id, b.loser_to_slot, d.loser);
  }

  // Persist team updates
  for (const id of dirty) {
    const b = bmById.get(id)!;
    await supabaseAdmin.from('bracket_matches').update({ home_team_id: b.home_team_id, away_team_id: b.away_team_id, updated_at: new Date().toISOString() }).eq('id', id);
  }

  // Create matches for bracket matches that now have both teams and no match yet
  const createdMatchIds: string[] = [];
  for (const b of ordered) {
    if (b.match_id || !b.home_team_id || !b.away_team_id) continue;
    const stage = b.round?.stage || 'final';
    const code = knockoutMatchCode(ageCode, stage, b.bracket_position, existingCodes);
    const { data: match } = await supabaseAdmin.from('matches').insert({
      season_id: seasonId, age_group_id: ageGroupId, division_id: null, tournament_group_id: null,
      stage, match_code: code, matchday: b.round?.name || stage, match_date: null, match_time: null,
      home_team_id: b.home_team_id, away_team_id: b.away_team_id, home_score: null, away_score: null, status: 'scheduled',
    }).select('id').single();
    if (match) {
      await supabaseAdmin.from('bracket_matches').update({ match_id: match.id, status: 'ready', updated_at: new Date().toISOString() }).eq('id', b.id);
      createdMatchIds.push(match.id);
    }
  }

  await logAdminAction({
    admin: { id: auth.profile.id, email: auth.profile.email },
    action: 'tournament_bracket.recalculate_advancement', entityType: 'bracket', entityLabel: 'recalculate advancement',
    newData: { seasonId, ageGroupId, advanced: dirty.size, createdMatches: createdMatchIds.length, createdMatchIds, warnings: warnings.length },
  });

  return NextResponse.json({ success: true, advanced: dirty.size, createdMatches: createdMatchIds.length, warnings });
}

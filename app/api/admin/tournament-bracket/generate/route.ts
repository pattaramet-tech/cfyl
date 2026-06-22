import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
import { buildTemplate, firstRoundSlots, resolveGroupRanks, resolveSource, knockoutMatchCode, BRACKET_SIZES } from '@/lib/bracket';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const dynamic = 'force-dynamic';
interface SourceSpec { type: string; ref: string }

export async function POST(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated || !auth.profile) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json();
  const { seasonId, ageGroupId } = body;
  const size = Number(body.size);
  const force = body.force === true;
  const mapping = (body.mapping || []) as SourceSpec[];
  if (!seasonId || !ageGroupId) return NextResponse.json({ error: 'seasonId and ageGroupId required' }, { status: 400 });
  if (!BRACKET_SIZES.includes(size as any)) return NextResponse.json({ error: 'bracket size ต้องเป็น 4, 8 หรือ 16' }, { status: 400 });
  if (mapping.length !== size) return NextResponse.json({ error: `ต้องระบุแหล่งที่มาให้ครบ ${size} ทีม` }, { status: 400 });

  const { data: ag } = await supabaseAdmin.from('age_groups').select('code').eq('id', ageGroupId).single();
  if (!ag) return NextResponse.json({ error: 'ไม่พบรุ่นอายุ' }, { status: 404 });
  const ageCode = ag.code;

  // Existing bracket?
  const { data: existingRounds } = await supabaseAdmin
    .from('knockout_rounds').select('id').eq('season_id', seasonId).eq('age_group_id', ageGroupId);
  if ((existingRounds || []).length > 0) {
    if (!force) {
      return NextResponse.json({ error: 'มี bracket อยู่แล้ว — ยืนยันเพื่อสร้างใหม่ (ลบของเดิม)', needsConfirm: true }, { status: 409 });
    }
    // gather linked matches and ensure none have goals/cards
    const { data: bms } = await supabaseAdmin
      .from('bracket_matches').select('match_id').eq('season_id', seasonId).eq('age_group_id', ageGroupId);
    const matchIds = (bms || []).map((b: any) => b.match_id).filter(Boolean) as string[];
    if (matchIds.length) {
      const [{ count: g }, { count: c }] = await Promise.all([
        supabaseAdmin.from('goals').select('id', { count: 'exact', head: true }).in('match_id', matchIds),
        supabaseAdmin.from('cards').select('id', { count: 'exact', head: true }).in('match_id', matchIds),
      ]);
      if ((g || 0) > 0 || (c || 0) > 0) {
        return NextResponse.json({ error: 'ลบ bracket เดิมไม่ได้ — มีแมตช์ที่บันทึกประตู/ใบแล้ว' }, { status: 409 });
      }
    }
    await supabaseAdmin.from('knockout_rounds').delete().eq('season_id', seasonId).eq('age_group_id', ageGroupId); // cascades bracket_matches
    if (matchIds.length) await supabaseAdmin.from('matches').delete().in('id', matchIds);
  }

  const tpl = buildTemplate(size);
  const slots = firstRoundSlots(tpl);
  const firstSrc = new Map<string, SourceSpec>();
  slots.forEach((s, i) => firstSrc.set(`${s.key}:${s.slot}`, mapping[i]));

  // 1) rounds
  const { data: roundRows, error: rErr } = await supabaseAdmin
    .from('knockout_rounds')
    .insert(tpl.rounds.map((r) => ({ season_id: seasonId, age_group_id: ageGroupId, name: r.name, stage: r.stage, sort_order: r.sort })))
    .select('id, stage');
  if (rErr) {
    if ((rErr as any).code === '42P01') return NextResponse.json({ error: 'ฐานข้อมูลยังไม่มีตาราง knockout — กรุณารัน migration phase 5B.1 ก่อน' }, { status: 500 });
    return NextResponse.json({ error: 'สร้างรอบไม่สำเร็จ' }, { status: 500 });
  }
  const roundIdByStage = new Map((roundRows || []).map((r) => [r.stage, r.id]));

  // 2) ordered template matches -> bracket_position
  const ordered = [...tpl.matches].sort((a, b) => {
    const sa = tpl.rounds.find((r) => r.stage === a.stage)!.sort;
    const sb = tpl.rounds.find((r) => r.stage === b.stage)!.sort;
    return sa - sb || a.position - b.position;
  });
  const keyToPos = new Map<string, number>();
  ordered.forEach((m, i) => keyToPos.set(m.key, i + 1));

  // 3) insert bracket_matches (first pass)
  const insertRows = ordered.map((m) => {
    const homeSrc = firstSrc.get(`${m.key}:home`);
    const awaySrc = firstSrc.get(`${m.key}:away`);
    return {
      season_id: seasonId, age_group_id: ageGroupId, round_id: roundIdByStage.get(m.stage),
      bracket_position: keyToPos.get(m.key),
      home_source_type: homeSrc?.type || (m.isFirst ? null : 'match_winner'),
      home_source_ref: homeSrc?.ref || null,
      away_source_type: awaySrc?.type || (m.isFirst ? null : 'match_winner'),
      away_source_ref: awaySrc?.ref || null,
      status: 'pending',
    };
  });
  const { data: bmRows, error: bErr } = await supabaseAdmin.from('bracket_matches').insert(insertRows).select('id, bracket_position');
  if (bErr) return NextResponse.json({ error: 'สร้าง bracket ไม่สำเร็จ' }, { status: 500 });
  const idByPos = new Map((bmRows || []).map((b) => [b.bracket_position, b.id]));
  const idByKey = (key: string) => idByPos.get(keyToPos.get(key)!)!;

  // 4) wire pointers
  for (const m of ordered) {
    const upd: Record<string, unknown> = {};
    if (m.winnerToKey) { upd.winner_to_bracket_match_id = idByKey(m.winnerToKey); upd.winner_to_slot = m.winnerToSlot; }
    if (m.loserToKey) { upd.loser_to_bracket_match_id = idByKey(m.loserToKey); upd.loser_to_slot = m.loserToSlot; }
    if (Object.keys(upd).length) await supabaseAdmin.from('bracket_matches').update(upd).eq('id', idByKey(m.key));
  }

  // 5) resolve first-round teams + create matches for resolved pairs
  const ranks = await resolveGroupRanks(supabaseAdmin, seasonId, ageGroupId);
  const { data: codeRows } = await supabaseAdmin.from('matches').select('match_code').eq('season_id', seasonId);
  const existingCodes = new Set<string>((codeRows || []).map((m: any) => m.match_code));
  const createdMatchIds: string[] = [];

  for (const m of ordered.filter((x) => x.isFirst)) {
    const hs = firstSrc.get(`${m.key}:home`); const as = firstSrc.get(`${m.key}:away`);
    const homeId = hs ? resolveSource(hs.type, hs.ref, ranks).teamId : null;
    const awayId = as ? resolveSource(as.type, as.ref, ranks).teamId : null;
    const bmId = idByKey(m.key);
    const upd: Record<string, unknown> = {};
    if (homeId) upd.home_team_id = homeId;
    if (awayId) upd.away_team_id = awayId;

    if (homeId && awayId) {
      const roundName = tpl.rounds.find((r) => r.stage === m.stage)!.name;
      const code = knockoutMatchCode(ageCode, m.stage, m.position, existingCodes);
      const { data: match } = await supabaseAdmin.from('matches').insert({
        season_id: seasonId, age_group_id: ageGroupId, division_id: null, tournament_group_id: null,
        stage: m.stage, match_code: code, matchday: roundName, match_date: null, match_time: null,
        home_team_id: homeId, away_team_id: awayId, home_score: null, away_score: null, status: 'scheduled',
      }).select('id').single();
      if (match) { upd.match_id = match.id; upd.status = 'ready'; createdMatchIds.push(match.id); }
    }
    if (Object.keys(upd).length) await supabaseAdmin.from('bracket_matches').update(upd).eq('id', bmId);
  }

  await logAdminAction({
    admin: { id: auth.profile.id, email: auth.profile.email },
    action: 'tournament_bracket.generate', entityType: 'bracket', entityLabel: `${size}-team bracket`,
    newData: { seasonId, ageGroupId, size, rounds: tpl.rounds.length, bracketMatches: ordered.length, createdMatches: createdMatchIds.length, createdMatchIds },
  });

  return NextResponse.json({ success: true, rounds: tpl.rounds.length, bracketMatches: ordered.length, createdMatches: createdMatchIds.length });
}

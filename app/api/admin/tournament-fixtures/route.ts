import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
import { FIXTURE_STAGES } from '@/lib/tournament-fixtures';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const dynamic = 'force-dynamic';

const SELECT = `id, match_code, matchday, stage, match_date, match_time, venue, status,
  home_score, away_score, season_id, age_group_id, division_id, tournament_group_id,
  home_team:home_team_id(id, name, short_name), away_team:away_team_id(id, name, short_name),
  group:tournament_group_id(id, name), division:division_id(name)`;

export async function GET(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = request.nextUrl;
  const seasonId = searchParams.get('seasonId');
  const ageGroupId = searchParams.get('ageGroupId');
  const groupId = searchParams.get('groupId');
  const stage = searchParams.get('stage');
  if (!seasonId || !ageGroupId) {
    return NextResponse.json({ error: 'seasonId and ageGroupId required' }, { status: 400 });
  }

  let q = supabaseAdmin
    .from('matches')
    .select(SELECT)
    .eq('season_id', seasonId)
    .eq('age_group_id', ageGroupId);
  if (groupId) q = q.eq('tournament_group_id', groupId);
  if (stage) q = q.eq('stage', stage);

  const { data, error } = await q
    .order('match_date', { ascending: true, nullsFirst: false })
    .order('match_time', { ascending: true, nullsFirst: false })
    .order('match_code', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'โหลดรายการแมตช์ไม่สำเร็จ' }, { status: 500 });
  }
  return NextResponse.json(data || []);
}

export async function POST(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated || !auth.profile) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const seasonId = body.seasonId;
  const ageGroupId = body.ageGroupId;
  const groupId = body.groupId || null;
  const stage = (body.stage || 'group').trim();
  const matchCode = (body.match_code || '').trim();
  const matchday = (body.matchday || '').trim();
  const date = (body.date || '').trim() || null;
  const time = (body.time || '').trim() || null;
  const venue = (body.venue || '').trim() || null;
  const homeId = body.home_team_id;
  const awayId = body.away_team_id;

  if (!seasonId || !ageGroupId || !matchCode || !homeId || !awayId) {
    return NextResponse.json({ error: 'seasonId, ageGroupId, match_code, home_team, away_team จำเป็นต้องระบุ' }, { status: 400 });
  }
  if (!FIXTURE_STAGES.includes(stage as any)) {
    return NextResponse.json({ error: `stage ไม่ถูกต้อง (${FIXTURE_STAGES.join('/')})` }, { status: 400 });
  }
  if (homeId === awayId) {
    return NextResponse.json({ error: 'home_team กับ away_team ต้องไม่ใช่ทีมเดียวกัน' }, { status: 400 });
  }

  // Teams must belong to this season + age group
  const { data: teams } = await supabaseAdmin
    .from('teams').select('id, season_id, age_group_id').in('id', [homeId, awayId]);
  const tmap = new Map((teams || []).map((t) => [t.id, t]));
  for (const id of [homeId, awayId]) {
    const t = tmap.get(id);
    if (!t || t.season_id !== seasonId || t.age_group_id !== ageGroupId) {
      return NextResponse.json({ error: 'ทีมไม่ได้อยู่ในฤดูกาล/รุ่นอายุนี้' }, { status: 400 });
    }
  }

  // Group membership
  if (groupId) {
    const { data: gm } = await supabaseAdmin
      .from('tournament_group_teams').select('team_id').eq('group_id', groupId).in('team_id', [homeId, awayId]);
    const inGroup = new Set((gm || []).map((r) => r.team_id));
    if (!inGroup.has(homeId) || !inGroup.has(awayId)) {
      return NextResponse.json({ error: 'ทั้งสองทีมต้องอยู่ในกลุ่มที่เลือก' }, { status: 400 });
    }
  }

  // match_code unique within season
  const { data: codeDup } = await supabaseAdmin
    .from('matches').select('id').eq('season_id', seasonId).eq('match_code', matchCode).maybeSingle();
  if (codeDup) {
    return NextResponse.json({ error: `match_code "${matchCode}" ซ้ำในฤดูกาล` }, { status: 409 });
  }

  // duplicate pair within stage + group
  const { data: stagePairs } = await supabaseAdmin
    .from('matches')
    .select('home_team_id, away_team_id')
    .eq('season_id', seasonId).eq('age_group_id', ageGroupId).eq('stage', stage)
    .or(`and(home_team_id.eq.${homeId},away_team_id.eq.${awayId}),and(home_team_id.eq.${awayId},away_team_id.eq.${homeId})`);
  if ((stagePairs || []).length > 0) {
    return NextResponse.json({ error: 'คู่ทีมนี้ซ้ำใน stage เดียวกัน' }, { status: 409 });
  }

  // duplicate slot (date+time+venue)
  if (date && time && venue) {
    const { data: slotDup } = await supabaseAdmin
      .from('matches').select('id')
      .eq('season_id', seasonId).eq('match_date', date).eq('match_time', time).eq('venue', venue).maybeSingle();
    if (slotDup) {
      return NextResponse.json({ error: 'สนาม + วันที่ + เวลา ซ้ำกับแมตช์อื่น' }, { status: 409 });
    }
  }

  const { data: created, error } = await supabaseAdmin
    .from('matches')
    .insert({
      season_id: seasonId,
      age_group_id: ageGroupId,
      division_id: null,
      tournament_group_id: groupId,
      stage,
      match_code: matchCode,
      matchday,
      match_date: date,
      match_time: time,
      venue,
      home_team_id: homeId,
      away_team_id: awayId,
      home_score: null,
      away_score: null,
      status: 'scheduled',
    })
    .select(SELECT)
    .single();

  if (error) {
    if ((error as any).code === '42703') {
      return NextResponse.json({ error: 'ฐานข้อมูลยังไม่มีคอลัมน์ stage/tournament_group_id/venue — กรุณารัน migration phase 5A.4 ก่อน' }, { status: 500 });
    }
    if ((error as any).code === '23505') {
      return NextResponse.json({ error: `match_code "${matchCode}" ซ้ำในฤดูกาล` }, { status: 409 });
    }
    return NextResponse.json({ error: 'สร้างแมตช์ไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 });
  }

  await logAdminAction({
    admin: { id: auth.profile.id, email: auth.profile.email },
    action: 'tournament_fixture.create',
    entityType: 'match',
    entityId: created.id,
    entityLabel: matchCode,
    newData: { seasonId, ageGroupId, stage, groupId, match_code: matchCode },
  });

  return NextResponse.json({ success: true, match: created }, { status: 201 });
}

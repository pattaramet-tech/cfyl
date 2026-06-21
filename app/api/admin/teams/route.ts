import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const seasonId = searchParams.get('seasonId');
    const ageGroupId = searchParams.get('ageGroupId');
    const divisionId = searchParams.get('divisionId') || null;

    if (!seasonId || !ageGroupId) {
      return NextResponse.json(
        { error: 'seasonId and ageGroupId required' },
        { status: 400 }
      );
    }

    console.log(`[ADMIN_TEAMS_GET] season=${seasonId} ageGroup=${ageGroupId} division=${divisionId}`);

    let query = supabaseAdmin
      .from('teams')
      .select(`
        id, name, short_name, logo_url, team_color, active,
        season_id, age_group_id, division_id,
        division:division_id(id, name, sort_order)
      `)
      .eq('season_id', seasonId)
      .eq('age_group_id', ageGroupId);

    if (divisionId) {
      query = query.eq('division_id', divisionId);
    }

    const { data: teams, error } = await query
      .order('division_id', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      console.error('[ADMIN_TEAMS_GET] Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!teams || teams.length === 0) {
      return NextResponse.json([]);
    }

    // Get player counts for all teams in one query
    const teamIds = teams.map((t) => t.id);
    const { data: playerRows } = await supabaseAdmin
      .from('players')
      .select('team_id')
      .in('team_id', teamIds);

    const playerCountMap: Record<string, number> = {};
    (playerRows || []).forEach((row: any) => {
      playerCountMap[row.team_id] = (playerCountMap[row.team_id] || 0) + 1;
    });

    const result = teams.map((t) => ({
      ...t,
      player_count: playerCountMap[t.id] || 0,
    }));

    console.log(`[ADMIN_TEAMS_GET] Returning ${result.length} teams`);
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_TEAMS_GET] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, short_name, division_id, season_id, age_group_id, logo_url, team_color } = body;

    if (!name || !season_id || !age_group_id) {
      return NextResponse.json(
        { error: 'name, season_id, age_group_id จำเป็นต้องระบุ' },
        { status: 400 }
      );
    }

    // Resolve competition type to decide whether a division is required
    const { data: season } = await supabaseAdmin
      .from('seasons')
      .select('id, competition_type')
      .eq('id', season_id)
      .single();
    if (!season) {
      return NextResponse.json({ error: 'ไม่พบ Season' }, { status: 404 });
    }
    const compType = season.competition_type || 'league';

    if (compType === 'league' && !division_id) {
      return NextResponse.json({ error: 'กรุณาเลือกดิวิชั่น' }, { status: 400 });
    }

    const finalDivisionId = division_id || null;

    // age_group must belong to this season
    const { data: ag } = await supabaseAdmin
      .from('age_groups')
      .select('id, season_id')
      .eq('id', age_group_id)
      .single();
    if (!ag || ag.season_id !== season_id) {
      return NextResponse.json({ error: 'รุ่นอายุไม่ได้อยู่ในฤดูกาลนี้' }, { status: 400 });
    }

    // if a division is given, it must belong to this season + age group
    if (finalDivisionId) {
      const { data: div } = await supabaseAdmin
        .from('divisions')
        .select('id, season_id, age_group_id')
        .eq('id', finalDivisionId)
        .single();
      if (!div || div.season_id !== season_id || div.age_group_id !== age_group_id) {
        return NextResponse.json({ error: 'ดิวิชั่นไม่ได้อยู่ในฤดูกาล/รุ่นอายุนี้' }, { status: 400 });
      }
    }

    console.log(`[ADMIN_TEAMS_POST] Creating team: "${name}" (${compType}, division=${finalDivisionId ?? 'none'})`);

    // Check name uniqueness within (season, age_group, division) — handle null division
    let dupQuery = supabaseAdmin
      .from('teams')
      .select('id, name')
      .eq('season_id', season_id)
      .eq('age_group_id', age_group_id)
      .eq('name', name.trim());
    dupQuery = finalDivisionId
      ? dupQuery.eq('division_id', finalDivisionId)
      : dupQuery.is('division_id', null);
    const { data: existing } = await dupQuery.maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: `ชื่อทีม "${name}" มีอยู่แล้วในรุ่น/ดิวิชั่นนี้` },
        { status: 409 }
      );
    }

    const { data: team, error } = await supabaseAdmin
      .from('teams')
      .insert({
        name: name.trim(),
        short_name: short_name?.trim() || null,
        division_id: finalDivisionId,
        season_id,
        age_group_id,
        logo_url: logo_url?.trim() || null,
        team_color: team_color || null,
        active: true,
      })
      .select(`
        id, name, short_name, logo_url, team_color, active,
        season_id, age_group_id, division_id,
        division:division_id(id, name, sort_order)
      `)
      .single();

    if (error) {
      console.error('[ADMIN_TEAMS_POST] Insert error:', error);
      if ((error as any).code === '23502') {
        return NextResponse.json({ error: 'ฐานข้อมูลยังบังคับ division_id — กรุณารัน migration phase 5A.2 (teams-division-optional) ก่อน' }, { status: 500 });
      }
      return NextResponse.json({ error: 'เพิ่มทีมไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 });
    }

    console.log(`[ADMIN_TEAMS_POST] Created team id=${team.id}`);
    return NextResponse.json({ ...team, player_count: 0 }, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_TEAMS_POST] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

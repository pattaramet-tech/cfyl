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
    const teamId = searchParams.get('teamId') || null;

    if (!seasonId || !ageGroupId) {
      return NextResponse.json(
        { error: 'seasonId and ageGroupId required' },
        { status: 400 }
      );
    }

    console.log(
      `[PLAYERS_MANAGE_GET] season=${seasonId} ageGroup=${ageGroupId} team=${teamId}`
    );

    let query = supabaseAdmin
      .from('players')
      .select(`
        id, player_code, shirt_no, full_name, birth_date, remarks, active,
        season_id, age_group_id, division_id, team_id,
        team:team_id(id, name, short_name)
      `)
      .eq('season_id', seasonId)
      .eq('age_group_id', ageGroupId);

    if (teamId) {
      query = query.eq('team_id', teamId);
    }

    const { data: players, error } = await query
      .order('team_id', { ascending: true })
      .order('shirt_no', { ascending: true, nullsFirst: false })
      .order('full_name', { ascending: true });

    if (error) {
      console.error('[PLAYERS_MANAGE_GET] Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[PLAYERS_MANAGE_GET] Found ${players?.length || 0} players`);
    return NextResponse.json(players || []);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[PLAYERS_MANAGE_GET] Error:', msg);
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
    const { player_code, full_name, shirt_no, team_id, birth_date, remarks } = body;

    if (!player_code || !full_name || !team_id) {
      return NextResponse.json(
        { error: 'player_code, full_name และ team_id จำเป็นต้องระบุ' },
        { status: 400 }
      );
    }

    console.log(`[PLAYERS_MANAGE_POST] Creating: "${full_name}" code=${player_code}`);

    // Fetch team to derive season_id, age_group_id, division_id
    const { data: team, error: teamError } = await supabaseAdmin
      .from('teams')
      .select('id, season_id, age_group_id, division_id')
      .eq('id', team_id)
      .single();

    if (teamError || !team) {
      return NextResponse.json({ error: 'ไม่พบทีมที่ระบุ' }, { status: 404 });
    }

    // Check player_code uniqueness within season
    const { data: existing } = await supabaseAdmin
      .from('players')
      .select('id, full_name')
      .eq('season_id', team.season_id)
      .eq('player_code', player_code.trim())
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: `PlayerID "${player_code}" มีในระบบแล้ว (${existing.full_name})` },
        { status: 409 }
      );
    }

    const { data: player, error } = await supabaseAdmin
      .from('players')
      .insert({
        player_code: player_code.trim(),
        full_name: full_name.trim(),
        shirt_no: shirt_no ? Number(shirt_no) : null,
        team_id,
        season_id: team.season_id,
        age_group_id: team.age_group_id,
        division_id: team.division_id,
        birth_date: birth_date || null,
        remarks: remarks?.trim() || null,
        active: true,
      })
      .select(`
        id, player_code, shirt_no, full_name, birth_date, remarks, active,
        season_id, age_group_id, division_id, team_id,
        team:team_id(id, name, short_name)
      `)
      .single();

    if (error) {
      console.error('[PLAYERS_MANAGE_POST] Insert error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[PLAYERS_MANAGE_POST] Created player id=${player.id}`);
    return NextResponse.json(player, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[PLAYERS_MANAGE_POST] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

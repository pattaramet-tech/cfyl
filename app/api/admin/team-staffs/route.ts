import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
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
    console.log('[TEAM_STAFFS_GET] Request received');

    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const seasonId = searchParams.get('seasonId');
    const ageGroupId = searchParams.get('ageGroupId');
    const divisionId = searchParams.get('divisionId');
    const teamId = searchParams.get('teamId');
    const teamIds = searchParams.get('teamIds');
    const active = searchParams.get('active');

    let query = supabaseAdmin
      .from('team_staffs')
      .select(`
        id,
        season_id,
        age_group_id,
        division_id,
        team_id,
        full_name,
        position,
        phone,
        active,
        created_at,
        updated_at,
        team:team_id(id, name, short_name),
        age_group:age_group_id(id, code, name),
        division:division_id(id, name)
      `);

    if (seasonId) {
      query = query.eq('season_id', seasonId);
    }

    if (ageGroupId) {
      query = query.eq('age_group_id', ageGroupId);
    }

    if (divisionId) {
      query = query.eq('division_id', divisionId);
    }

    if (teamId) {
      query = query.eq('team_id', teamId);
    }

    if (teamIds) {
      const ids = teamIds.split(',');
      query = query.in('team_id', ids);
    }

    if (active !== null) {
      query = query.eq('active', active === 'true');
    }

    const { data, error } = await query.order('full_name');

    if (error) {
      console.error('[TEAM_STAFFS_GET] Query error:', error);
      return NextResponse.json({ error: 'Failed to fetch staffs' }, { status: 500 });
    }

    return NextResponse.json(data || [], { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[TEAM_STAFFS_GET] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('[TEAM_STAFFS_POST] Request received');

    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    if (!authResult.profile?.can_edit_cards) {
      return NextResponse.json({ error: 'No permission to edit staff' }, { status: 403 });
    }

    const body = await request.json();
    const { seasonId, ageGroupId, divisionId, teamId, fullName, position, phone } = body;

    if (!seasonId || !ageGroupId || !teamId || !fullName || !position) {
      return NextResponse.json(
        { error: 'Missing required fields: seasonId, ageGroupId, teamId, fullName, position' },
        { status: 400 }
      );
    }

    console.log('[TEAM_STAFFS_POST] Creating staff:', { seasonId, teamId, fullName, position });

    const { data: newStaff, error: createError } = await supabaseAdmin
      .from('team_staffs')
      .insert({
        season_id: seasonId,
        age_group_id: ageGroupId,
        division_id: divisionId || null,
        team_id: teamId,
        full_name: fullName,
        position,
        phone: phone || null,
        active: true,
      })
      .select(`
        id,
        season_id,
        age_group_id,
        division_id,
        team_id,
        full_name,
        position,
        phone,
        active,
        created_at,
        updated_at,
        team:team_id(id, name, short_name),
        age_group:age_group_id(id, code, name),
        division:division_id(id, name)
      `)
      .single();

    if (createError) {
      console.error('[TEAM_STAFFS_POST] Create error:', createError);
      return NextResponse.json({ error: `Failed to create staff: ${createError.message}` }, { status: 500 });
    }

    console.log('[TEAM_STAFFS_POST] Staff created:', newStaff?.id);

    await logAdminAction({
      admin: { id: authResult.profile!.id, email: authResult.profile!.email },
      action: 'staff.create',
      entityType: 'team_staff',
      entityId: newStaff?.id,
      entityLabel: fullName,
      newData: { season_id: seasonId, team_id: teamId, position, phone },
    });

    return NextResponse.json(newStaff, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[TEAM_STAFFS_POST] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

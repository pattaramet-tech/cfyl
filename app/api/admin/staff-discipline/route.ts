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
    console.log('[STAFF_DISCIPLINE_GET] Request received');

    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const matchId = searchParams.get('matchId');
    const teamId = searchParams.get('teamId');
    const staffId = searchParams.get('staffId');
    const seasonId = searchParams.get('seasonId');
    const ageGroupId = searchParams.get('ageGroupId');
    const status = searchParams.get('status');

    let query = supabaseAdmin
      .from('staff_discipline_events')
      .select(`
        id,
        season_id,
        age_group_id,
        division_id,
        match_id,
        team_id,
        staff_id,
        discipline_type,
        minute,
        reason,
        note,
        suspended_matches,
        suspended_from_matchday,
        status,
        created_by,
        created_at,
        updated_at,
        staff:staff_id(id, full_name, position),
        team:team_id(id, name, short_name)
      `);

    if (matchId) {
      query = query.eq('match_id', matchId);
    }

    if (teamId) {
      query = query.eq('team_id', teamId);
    }

    if (staffId) {
      query = query.eq('staff_id', staffId);
    }

    if (seasonId) {
      query = query.eq('season_id', seasonId);
    }

    if (ageGroupId) {
      query = query.eq('age_group_id', ageGroupId);
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[STAFF_DISCIPLINE_GET] Query error:', error);
      return NextResponse.json({ error: 'Failed to fetch discipline events' }, { status: 500 });
    }

    return NextResponse.json(data || [], { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[STAFF_DISCIPLINE_GET] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('[STAFF_DISCIPLINE_POST] Request received');

    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    if (!authResult.profile?.can_edit_cards && !authResult.profile?.can_edit_goals) {
      return NextResponse.json({ error: 'No permission to record discipline' }, { status: 403 });
    }

    const body = await request.json();
    const { matchId, staffId, disciplineType, minute, reason, note, suspendedMatches } = body;

    if (!staffId || !disciplineType) {
      return NextResponse.json(
        { error: 'Missing required fields: staffId, disciplineType' },
        { status: 400 }
      );
    }

    if (!['warning', 'caution', 'ejection', 'ban'].includes(disciplineType)) {
      return NextResponse.json(
        { error: 'Invalid discipline_type. Must be: warning, caution, ejection, or ban' },
        { status: 400 }
      );
    }

    // Normalize caution to warning
    const normalizedDisciplineType = disciplineType === 'caution' ? 'warning' : disciplineType;

    // Validate minute if provided
    if (minute !== null && minute !== undefined) {
      const m = Number(minute);
      if (!Number.isInteger(m) || m < 0 || m > 120) {
        return NextResponse.json(
          { error: 'Minute must be between 0 and 120' },
          { status: 400 }
        );
      }
    }

    console.log('[STAFF_DISCIPLINE_POST] Creating discipline event:', { staffId, disciplineType, matchId });

    // Fetch staff to get team and season info
    const { data: staff, error: staffError } = await supabaseAdmin
      .from('team_staffs')
      .select('id, season_id, age_group_id, division_id, team_id')
      .eq('id', staffId)
      .single();

    if (staffError || !staff) {
      return NextResponse.json({ error: 'Staff not found' }, { status: 404 });
    }

    // If matchId provided, verify match and get season/age_group/division
    let seasonId = staff.season_id;
    let ageGroupId = staff.age_group_id;
    let divisionId = staff.division_id;

    if (matchId) {
      const { data: match, error: matchError } = await supabaseAdmin
        .from('matches')
        .select('id, season_id, age_group_id, division_id')
        .eq('id', matchId)
        .single();

      if (matchError || !match) {
        return NextResponse.json({ error: 'Match not found' }, { status: 404 });
      }

      seasonId = match.season_id;
      ageGroupId = match.age_group_id;
      divisionId = match.division_id;
    }

    const { data: newEvent, error: createError } = await supabaseAdmin
      .from('staff_discipline_events')
      .insert({
        season_id: seasonId,
        age_group_id: ageGroupId,
        division_id: divisionId,
        match_id: matchId || null,
        team_id: staff.team_id,
        staff_id: staffId,
        discipline_type: normalizedDisciplineType,
        minute: minute !== undefined && minute !== null ? Number(minute) : null,
        reason: reason || null,
        note: note || null,
        suspended_matches: suspendedMatches || 0,
        status: 'active',
        created_by: authResult.profile!.id,
      })
      .select(`
        id,
        season_id,
        age_group_id,
        division_id,
        match_id,
        team_id,
        staff_id,
        discipline_type,
        minute,
        reason,
        note,
        suspended_matches,
        suspended_from_matchday,
        status,
        created_by,
        created_at,
        updated_at,
        staff:staff_id(id, full_name, position),
        team:team_id(id, name, short_name)
      `)
      .single();

    if (createError) {
      console.error('[STAFF_DISCIPLINE_POST] Create error:', createError);
      return NextResponse.json({ error: `Failed to create discipline event: ${createError.message}` }, { status: 500 });
    }

    console.log('[STAFF_DISCIPLINE_POST] Discipline event created:', newEvent?.id);

    await logAdminAction({
      admin: { id: authResult.profile!.id, email: authResult.profile!.email },
      action: 'staff_discipline.create',
      entityType: 'staff_discipline_event',
      entityId: newEvent?.id,
      entityLabel: `${normalizedDisciplineType} - Staff #${staffId}`,
      newData: { staff_id: staffId, discipline_type: normalizedDisciplineType, match_id: matchId, minute, reason },
    });

    return NextResponse.json(newEvent, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[STAFF_DISCIPLINE_POST] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

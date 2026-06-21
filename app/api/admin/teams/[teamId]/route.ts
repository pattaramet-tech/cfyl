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

async function getUsageCounts(teamId: string) {
  const [
    { count: playersCount },
    { count: matchesCount },
    { count: goalsCount },
    { count: cardsCount },
    { count: suspensionsCount },
  ] = await Promise.all([
    supabaseAdmin
      .from('players')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', teamId),
    supabaseAdmin
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`),
    supabaseAdmin
      .from('goals')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', teamId),
    supabaseAdmin
      .from('cards')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', teamId),
    supabaseAdmin
      .from('suspensions')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', teamId),
  ]);

  return {
    players: playersCount || 0,
    matches: matchesCount || 0,
    goals: goalsCount || 0,
    cards: cardsCount || 0,
    suspensions: suspensionsCount || 0,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    const { teamId } = await params;

    const { data: team, error } = await supabaseAdmin
      .from('teams')
      .select(`
        id, name, short_name, logo_url, team_color, active,
        season_id, age_group_id, division_id,
        division:division_id(id, name)
      `)
      .eq('id', teamId)
      .single();

    if (error || !team) {
      return NextResponse.json({ error: 'ไม่พบข้อมูลทีม' }, { status: 404 });
    }

    const counts = await getUsageCounts(teamId);
    return NextResponse.json({ ...team, ...counts });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_TEAMS_ID_GET] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    const { teamId } = await params;
    const body = await request.json();
    const { name, short_name, division_id, logo_url, team_color, active } = body;

    console.log(`[ADMIN_TEAMS_ID_PUT] Updating team=${teamId}`);

    // Fetch existing team
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('teams')
      .select('id, name, season_id, age_group_id, division_id')
      .eq('id', teamId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'ไม่พบข้อมูลทีม' }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    // Resolve competition type (division optional unless league)
    const { data: season } = await supabaseAdmin
      .from('seasons')
      .select('competition_type')
      .eq('id', existing.season_id)
      .single();
    const compType = season?.competition_type || 'league';

    const newName = name !== undefined ? name.trim() : existing.name;
    const newDivisionId =
      division_id !== undefined ? (division_id || null) : existing.division_id;

    if (division_id !== undefined) {
      if (compType === 'league' && !newDivisionId) {
        return NextResponse.json({ error: 'กรุณาเลือกดิวิชั่น' }, { status: 400 });
      }
      if (newDivisionId) {
        const { data: div } = await supabaseAdmin
          .from('divisions')
          .select('id, season_id, age_group_id')
          .eq('id', newDivisionId)
          .single();
        if (!div || div.season_id !== existing.season_id || div.age_group_id !== existing.age_group_id) {
          return NextResponse.json({ error: 'ดิวิชั่นไม่ได้อยู่ในฤดูกาล/รุ่นอายุนี้' }, { status: 400 });
        }
      }
    }

    // Check name uniqueness if name or division changes (null-aware)
    if (name !== undefined || division_id !== undefined) {
      let dupQuery = supabaseAdmin
        .from('teams')
        .select('id, name')
        .eq('season_id', existing.season_id)
        .eq('age_group_id', existing.age_group_id)
        .eq('name', newName)
        .neq('id', teamId);
      dupQuery = newDivisionId
        ? dupQuery.eq('division_id', newDivisionId)
        : dupQuery.is('division_id', null);
      const { data: conflict } = await dupQuery.maybeSingle();

      if (conflict) {
        return NextResponse.json(
          { error: `ชื่อทีม "${newName}" มีอยู่แล้วในรุ่น/ดิวิชั่นนี้` },
          { status: 409 }
        );
      }
    }

    if (name !== undefined) updates.name = newName;
    if (short_name !== undefined) updates.short_name = short_name?.trim() || null;
    if (division_id !== undefined) updates.division_id = newDivisionId;
    if (logo_url !== undefined) updates.logo_url = logo_url?.trim() || null;
    if (team_color !== undefined) updates.team_color = team_color || null;
    if (active !== undefined) updates.active = Boolean(active);

    const { data: team, error } = await supabaseAdmin
      .from('teams')
      .update(updates)
      .eq('id', teamId)
      .select(`
        id, name, short_name, logo_url, team_color, active,
        season_id, age_group_id, division_id,
        division:division_id(id, name, sort_order)
      `)
      .single();

    if (error) {
      console.error('[ADMIN_TEAMS_ID_PUT] Update error:', error);
      return NextResponse.json({ error: 'แก้ไขทีมไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 });
    }

    console.log(`[ADMIN_TEAMS_ID_PUT] Updated team=${teamId} active=${team.active}`);
    return NextResponse.json(team);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_TEAMS_ID_PUT] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    const { teamId } = await params;

    console.log(`[ADMIN_TEAMS_ID_DELETE] Checking team=${teamId}`);

    const counts = await getUsageCounts(teamId);
    const total = counts.players + counts.matches + counts.goals + counts.cards + counts.suspensions;

    if (total > 0) {
      return NextResponse.json(
        {
          error:
            `ไม่สามารถลบได้ — ทีมมีข้อมูลผูกอยู่: ` +
            `ผู้เล่น ${counts.players} คน, ` +
            `แมตช์ ${counts.matches} นัด, ` +
            `ประตู ${counts.goals}, ` +
            `ใบ ${counts.cards} ใบ` +
            ` กรุณาปิดการใช้งานแทน`,
          has_records: true,
          counts,
        },
        { status: 409 }
      );
    }

    const { error } = await supabaseAdmin.from('teams').delete().eq('id', teamId);

    if (error) {
      console.error('[ADMIN_TEAMS_ID_DELETE] Delete error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[ADMIN_TEAMS_ID_DELETE] Deleted team=${teamId}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_TEAMS_ID_DELETE] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

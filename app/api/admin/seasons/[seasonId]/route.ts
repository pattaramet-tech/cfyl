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

const VALID_STATUSES = ['upcoming', 'active', 'completed'] as const;
const VALID_COMPETITION_TYPES = ['league', 'tournament', 'mixed'] as const;

async function getSeasonUsageCounts(seasonId: string) {
  const [
    { count: teamsCount },
    { count: matchesCount },
    { count: playersCount },
    { count: ageGroupsCount },
  ] = await Promise.all([
    supabaseAdmin
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', seasonId),
    supabaseAdmin
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', seasonId),
    supabaseAdmin
      .from('players')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', seasonId),
    supabaseAdmin
      .from('age_groups')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', seasonId),
  ]);

  return {
    teams: teamsCount || 0,
    matches: matchesCount || 0,
    players: playersCount || 0,
    age_groups: ageGroupsCount || 0,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ seasonId: string }> }
) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    const { seasonId } = await params;

    const { data: season, error } = await supabaseAdmin
      .from('seasons')
      .select('*')
      .eq('id', seasonId)
      .single();

    if (error || !season) {
      return NextResponse.json({ error: 'ไม่พบข้อมูล Season' }, { status: 404 });
    }

    const counts = await getSeasonUsageCounts(seasonId);
    return NextResponse.json({ ...season, ...counts });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_SEASONS_ID_GET] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ seasonId: string }> }
) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    const { seasonId } = await params;
    const body = await request.json();
    const { name, year, start_date, end_date, status, competition_type } = body;

    console.log(`[ADMIN_SEASONS_ID_PUT] Updating season=${seasonId}`);

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('seasons')
      .select('id, name, year, status')
      .eq('id', seasonId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'ไม่พบข้อมูล Season' }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName) {
        return NextResponse.json({ error: 'name ต้องไม่ว่างเปล่า' }, { status: 400 });
      }
      updates.name = trimmedName;
    }

    if (year !== undefined) {
      const yearNum = parseInt(String(year), 10);
      if (isNaN(yearNum) || yearNum < 1000 || yearNum > 9999) {
        return NextResponse.json({ error: 'year ต้องเป็นตัวเลข 4 หลัก' }, { status: 400 });
      }
      updates.year = yearNum;
    }

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return NextResponse.json(
          { error: 'status ต้องเป็น upcoming, active, หรือ completed' },
          { status: 400 }
        );
      }
      updates.status = status;
    }

    if (start_date !== undefined) updates.start_date = start_date || null;
    if (end_date !== undefined) updates.end_date = end_date || null;

    if (competition_type !== undefined) {
      if (!VALID_COMPETITION_TYPES.includes(competition_type)) {
        return NextResponse.json(
          { error: 'competition_type ต้องเป็น league, tournament, หรือ mixed' },
          { status: 400 }
        );
      }
      updates.competition_type = competition_type;
    }

    // Check name+year uniqueness if either changed
    const newName = (updates.name as string) ?? existing.name;
    const newYear = (updates.year as number) ?? existing.year;
    if (name !== undefined || year !== undefined) {
      const { data: conflict } = await supabaseAdmin
        .from('seasons')
        .select('id, name')
        .eq('year', newYear)
        .eq('name', newName)
        .neq('id', seasonId)
        .maybeSingle();

      if (conflict) {
        return NextResponse.json(
          { error: `Season "${newName}" ปี ${newYear} มีอยู่แล้ว` },
          { status: 409 }
        );
      }
    }

    // If changing to active, auto-complete other active seasons
    let deactivated: string[] = [];
    const newStatus = (updates.status as string) ?? existing.status;
    if (newStatus === 'active' && existing.status !== 'active') {
      const { data: currentActive } = await supabaseAdmin
        .from('seasons')
        .select('id, name')
        .eq('status', 'active')
        .neq('id', seasonId);

      if (currentActive && currentActive.length > 0) {
        const ids = currentActive.map((s: { id: string }) => s.id);
        deactivated = currentActive.map((s: { name: string }) => s.name);

        await supabaseAdmin
          .from('seasons')
          .update({ status: 'completed', updated_at: new Date().toISOString() })
          .in('id', ids);

        console.log(`[ADMIN_SEASONS_ID_PUT] Auto-completed ${deactivated.length} season(s): ${deactivated.join(', ')}`);
      }
    }

    const { data: season, error } = await supabaseAdmin
      .from('seasons')
      .update(updates)
      .eq('id', seasonId)
      .select('*')
      .single();

    if (error) {
      console.error('[ADMIN_SEASONS_ID_PUT] Update error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[ADMIN_SEASONS_ID_PUT] Updated season=${seasonId} status=${season.status}`);
    return NextResponse.json({ ...season, deactivated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_SEASONS_ID_PUT] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ seasonId: string }> }
) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    const { seasonId } = await params;
    console.log(`[ADMIN_SEASONS_ID_DELETE] Checking season=${seasonId}`);

    const counts = await getSeasonUsageCounts(seasonId);
    const total = counts.teams + counts.matches + counts.players;

    if (total > 0) {
      return NextResponse.json(
        {
          error:
            `ไม่สามารถลบได้ — Season มีข้อมูลผูกอยู่: ` +
            `ทีม ${counts.teams} ทีม, ` +
            `แมตช์ ${counts.matches} นัด, ` +
            `ผู้เล่น ${counts.players} คน` +
            ` กรุณาลบข้อมูลที่เกี่ยวข้องก่อน`,
          has_records: true,
          counts,
        },
        { status: 409 }
      );
    }

    // Safe to delete age_groups and divisions first (FK constraint order)
    await supabaseAdmin.from('divisions').delete().eq('season_id', seasonId);
    await supabaseAdmin.from('age_groups').delete().eq('season_id', seasonId);

    const { error } = await supabaseAdmin.from('seasons').delete().eq('id', seasonId);

    if (error) {
      console.error('[ADMIN_SEASONS_ID_DELETE] Delete error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[ADMIN_SEASONS_ID_DELETE] Deleted season=${seasonId}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_SEASONS_ID_DELETE] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

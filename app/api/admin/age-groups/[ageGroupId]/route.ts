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

async function getAgeGroupUsageCounts(ageGroupId: string) {
  const [
    { count: teamsCount },
    { count: matchesCount },
    { count: playersCount },
  ] = await Promise.all([
    supabaseAdmin
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .eq('age_group_id', ageGroupId),
    supabaseAdmin
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('age_group_id', ageGroupId),
    supabaseAdmin
      .from('players')
      .select('id', { count: 'exact', head: true })
      .eq('age_group_id', ageGroupId),
  ]);

  return {
    teams: teamsCount || 0,
    matches: matchesCount || 0,
    players: playersCount || 0,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ageGroupId: string }> }
) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    const { ageGroupId } = await params;

    const { data: ageGroup, error } = await supabaseAdmin
      .from('age_groups')
      .select('id, season_id, code, name, sort_order, created_at')
      .eq('id', ageGroupId)
      .single();

    if (error || !ageGroup) {
      return NextResponse.json({ error: 'ไม่พบข้อมูล Age Group' }, { status: 404 });
    }

    const counts = await getAgeGroupUsageCounts(ageGroupId);
    return NextResponse.json({ ...ageGroup, ...counts });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_AGE_GROUPS_ID_GET] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ ageGroupId: string }> }
) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    const { ageGroupId } = await params;
    const body = await request.json();
    const { code, name, sort_order } = body;

    console.log(`[ADMIN_AGE_GROUPS_ID_PUT] Updating ageGroup=${ageGroupId}`);

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('age_groups')
      .select('id, season_id, code, name, sort_order')
      .eq('id', ageGroupId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'ไม่พบข้อมูล Age Group' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};

    if (code !== undefined) {
      const trimmedCode = String(code).trim().toUpperCase();
      if (!trimmedCode) {
        return NextResponse.json({ error: 'code ต้องไม่ว่างเปล่า' }, { status: 400 });
      }
      updates.code = trimmedCode;
    }

    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName) {
        return NextResponse.json({ error: 'name ต้องไม่ว่างเปล่า' }, { status: 400 });
      }
      updates.name = trimmedName;
    }

    if (sort_order !== undefined) updates.sort_order = sort_order;

    // Check code uniqueness if code changed
    const newCode = (updates.code as string) ?? existing.code;
    if (code !== undefined && newCode !== existing.code) {
      const { data: conflict } = await supabaseAdmin
        .from('age_groups')
        .select('id, code')
        .eq('season_id', existing.season_id)
        .eq('code', newCode)
        .neq('id', ageGroupId)
        .maybeSingle();

      if (conflict) {
        return NextResponse.json(
          { error: `Age Group "${newCode}" มีใน Season นี้แล้ว` },
          { status: 409 }
        );
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'ไม่มีข้อมูลที่จะอัปเดต' }, { status: 400 });
    }

    const { data: ageGroup, error } = await supabaseAdmin
      .from('age_groups')
      .update(updates)
      .eq('id', ageGroupId)
      .select('id, season_id, code, name, sort_order, created_at')
      .single();

    if (error) {
      console.error('[ADMIN_AGE_GROUPS_ID_PUT] Update error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[ADMIN_AGE_GROUPS_ID_PUT] Updated ageGroup=${ageGroupId}`);
    return NextResponse.json(ageGroup);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_AGE_GROUPS_ID_PUT] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ ageGroupId: string }> }
) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    const { ageGroupId } = await params;
    console.log(`[ADMIN_AGE_GROUPS_ID_DELETE] Checking ageGroup=${ageGroupId}`);

    const counts = await getAgeGroupUsageCounts(ageGroupId);
    const total = counts.teams + counts.matches + counts.players;

    if (total > 0) {
      return NextResponse.json(
        {
          error:
            `ไม่สามารถลบได้ — Age Group มีข้อมูลผูกอยู่: ` +
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

    // Delete divisions under this age group first
    await supabaseAdmin.from('divisions').delete().eq('age_group_id', ageGroupId);

    const { error } = await supabaseAdmin.from('age_groups').delete().eq('id', ageGroupId);

    if (error) {
      console.error('[ADMIN_AGE_GROUPS_ID_DELETE] Delete error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[ADMIN_AGE_GROUPS_ID_DELETE] Deleted ageGroup=${ageGroupId}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_AGE_GROUPS_ID_DELETE] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

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

async function getDivisionUsageCounts(divisionId: string) {
  const [{ count: teamsCount }, { count: matchesCount }] = await Promise.all([
    supabaseAdmin
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .eq('division_id', divisionId),
    supabaseAdmin
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('division_id', divisionId),
  ]);

  return {
    teams: teamsCount || 0,
    matches: matchesCount || 0,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ divisionId: string }> }
) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    const { divisionId } = await params;

    const { data: division, error } = await supabaseAdmin
      .from('divisions')
      .select('id, season_id, age_group_id, name, sort_order, created_at')
      .eq('id', divisionId)
      .single();

    if (error || !division) {
      return NextResponse.json({ error: 'ไม่พบข้อมูล Division' }, { status: 404 });
    }

    const counts = await getDivisionUsageCounts(divisionId);
    return NextResponse.json({ ...division, ...counts });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_DIVISIONS_ID_GET] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ divisionId: string }> }
) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    const { divisionId } = await params;
    const body = await request.json();
    const { name, sort_order } = body;

    console.log(`[ADMIN_DIVISIONS_ID_PUT] Updating division=${divisionId}`);

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('divisions')
      .select('id, season_id, age_group_id, name, sort_order')
      .eq('id', divisionId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'ไม่พบข้อมูล Division' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};

    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName) {
        return NextResponse.json({ error: 'name ต้องไม่ว่างเปล่า' }, { status: 400 });
      }

      // Check name uniqueness if name changed
      if (trimmedName !== existing.name) {
        const { data: conflict } = await supabaseAdmin
          .from('divisions')
          .select('id, name')
          .eq('season_id', existing.season_id)
          .eq('age_group_id', existing.age_group_id)
          .eq('name', trimmedName)
          .neq('id', divisionId)
          .maybeSingle();

        if (conflict) {
          return NextResponse.json(
            { error: `Division "${trimmedName}" มีใน Age Group นี้แล้ว` },
            { status: 409 }
          );
        }
      }

      updates.name = trimmedName;
    }

    if (sort_order !== undefined) updates.sort_order = sort_order;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'ไม่มีข้อมูลที่จะอัปเดต' }, { status: 400 });
    }

    const { data: division, error } = await supabaseAdmin
      .from('divisions')
      .update(updates)
      .eq('id', divisionId)
      .select('id, season_id, age_group_id, name, sort_order, created_at')
      .single();

    if (error) {
      console.error('[ADMIN_DIVISIONS_ID_PUT] Update error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[ADMIN_DIVISIONS_ID_PUT] Updated division=${divisionId}`);
    return NextResponse.json(division);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_DIVISIONS_ID_PUT] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ divisionId: string }> }
) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    const { divisionId } = await params;
    console.log(`[ADMIN_DIVISIONS_ID_DELETE] Checking division=${divisionId}`);

    const counts = await getDivisionUsageCounts(divisionId);
    const total = counts.teams + counts.matches;

    if (total > 0) {
      return NextResponse.json(
        {
          error:
            `ไม่สามารถลบได้ — Division มีข้อมูลผูกอยู่: ` +
            `ทีม ${counts.teams} ทีม, ` +
            `แมตช์ ${counts.matches} นัด` +
            ` กรุณาลบหรือย้ายทีมก่อน`,
          has_records: true,
          counts,
        },
        { status: 409 }
      );
    }

    const { error } = await supabaseAdmin.from('divisions').delete().eq('id', divisionId);

    if (error) {
      console.error('[ADMIN_DIVISIONS_ID_DELETE] Delete error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[ADMIN_DIVISIONS_ID_DELETE] Deleted division=${divisionId}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_DIVISIONS_ID_DELETE] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

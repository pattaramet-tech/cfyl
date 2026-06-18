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

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    console.log('[ADMIN_SEASONS_GET] Fetching all seasons');

    const { data: seasons, error } = await supabaseAdmin
      .from('seasons')
      .select('id, name, year, start_date, end_date, status, created_at, updated_at')
      .order('year', { ascending: false });

    if (error) {
      console.error('[ADMIN_SEASONS_GET] Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!seasons || seasons.length === 0) {
      return NextResponse.json([]);
    }

    // Get age group counts per season in one query
    const seasonIds = seasons.map((s) => s.id);
    const { data: ageGroupRows } = await supabaseAdmin
      .from('age_groups')
      .select('season_id')
      .in('season_id', seasonIds);

    const ageGroupCountMap: Record<string, number> = {};
    (ageGroupRows || []).forEach((row: { season_id: string }) => {
      ageGroupCountMap[row.season_id] = (ageGroupCountMap[row.season_id] || 0) + 1;
    });

    const result = seasons.map((s) => ({
      ...s,
      age_group_count: ageGroupCountMap[s.id] || 0,
    }));

    console.log(`[ADMIN_SEASONS_GET] Returning ${result.length} seasons`);
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_SEASONS_GET] Error:', msg);
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
    const { name, year, start_date, end_date, status } = body;

    if (!name || !year) {
      return NextResponse.json({ error: 'name และ year จำเป็นต้องระบุ' }, { status: 400 });
    }

    const trimmedName = String(name).trim();
    const yearNum = parseInt(String(year), 10);

    if (isNaN(yearNum) || yearNum < 1000 || yearNum > 9999) {
      return NextResponse.json({ error: 'year ต้องเป็นตัวเลข 4 หลัก' }, { status: 400 });
    }

    const resolvedStatus = status || 'upcoming';
    if (!VALID_STATUSES.includes(resolvedStatus)) {
      return NextResponse.json(
        { error: 'status ต้องเป็น upcoming, active, หรือ completed' },
        { status: 400 }
      );
    }

    if (!trimmedName) {
      return NextResponse.json({ error: 'name ต้องไม่ว่างเปล่า' }, { status: 400 });
    }

    console.log(`[ADMIN_SEASONS_POST] Creating season: "${trimmedName}" year=${yearNum}`);

    // Check name uniqueness per year
    const { data: existing } = await supabaseAdmin
      .from('seasons')
      .select('id, name')
      .eq('year', yearNum)
      .eq('name', trimmedName)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: `Season "${trimmedName}" ปี ${yearNum} มีอยู่แล้ว` },
        { status: 409 }
      );
    }

    // If setting active, collect current active seasons (for warning in response)
    let deactivated: string[] = [];
    if (resolvedStatus === 'active') {
      const { data: currentActive } = await supabaseAdmin
        .from('seasons')
        .select('id, name')
        .eq('status', 'active');

      if (currentActive && currentActive.length > 0) {
        const ids = currentActive.map((s: { id: string }) => s.id);
        deactivated = currentActive.map((s: { name: string }) => s.name);

        await supabaseAdmin
          .from('seasons')
          .update({ status: 'completed', updated_at: new Date().toISOString() })
          .in('id', ids);

        console.log(`[ADMIN_SEASONS_POST] Auto-completed ${deactivated.length} season(s): ${deactivated.join(', ')}`);
      }
    }

    const { data: season, error } = await supabaseAdmin
      .from('seasons')
      .insert({
        name: trimmedName,
        year: yearNum,
        start_date: start_date || null,
        end_date: end_date || null,
        status: resolvedStatus,
      })
      .select('id, name, year, start_date, end_date, status, created_at, updated_at')
      .single();

    if (error) {
      console.error('[ADMIN_SEASONS_POST] Insert error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[ADMIN_SEASONS_POST] Created season id=${season.id}`);
    return NextResponse.json(
      { ...season, age_group_count: 0, deactivated },
      { status: 201 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_SEASONS_POST] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

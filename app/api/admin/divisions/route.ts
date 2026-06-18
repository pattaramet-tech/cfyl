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

    if (!seasonId || !ageGroupId) {
      return NextResponse.json(
        { error: 'seasonId และ ageGroupId จำเป็นต้องระบุ' },
        { status: 400 }
      );
    }

    console.log(`[ADMIN_DIVISIONS_GET] season=${seasonId} ageGroup=${ageGroupId}`);

    const { data: divisions, error } = await supabaseAdmin
      .from('divisions')
      .select('id, season_id, age_group_id, name, sort_order, created_at')
      .eq('season_id', seasonId)
      .eq('age_group_id', ageGroupId)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[ADMIN_DIVISIONS_GET] Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!divisions || divisions.length === 0) {
      return NextResponse.json([]);
    }

    const divisionIds = divisions.map((d) => d.id);

    // Get team counts and match counts per division in 2 queries
    const [{ data: teamRows }, { data: matchRows }] = await Promise.all([
      supabaseAdmin
        .from('teams')
        .select('division_id')
        .in('division_id', divisionIds),
      supabaseAdmin
        .from('matches')
        .select('division_id')
        .in('division_id', divisionIds),
    ]);

    const teamCountMap: Record<string, number> = {};
    (teamRows || []).forEach((row: { division_id: string }) => {
      teamCountMap[row.division_id] = (teamCountMap[row.division_id] || 0) + 1;
    });

    const matchCountMap: Record<string, number> = {};
    (matchRows || []).forEach((row: { division_id: string }) => {
      matchCountMap[row.division_id] = (matchCountMap[row.division_id] || 0) + 1;
    });

    const result = divisions.map((d) => ({
      ...d,
      team_count: teamCountMap[d.id] || 0,
      match_count: matchCountMap[d.id] || 0,
    }));

    console.log(`[ADMIN_DIVISIONS_GET] Returning ${result.length} divisions`);
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_DIVISIONS_GET] Error:', msg);
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
    const { season_id, age_group_id, name, sort_order } = body;

    if (!season_id || !age_group_id || !name) {
      return NextResponse.json(
        { error: 'season_id, age_group_id, และ name จำเป็นต้องระบุ' },
        { status: 400 }
      );
    }

    const trimmedName = String(name).trim();
    if (!trimmedName) {
      return NextResponse.json({ error: 'name ต้องไม่ว่างเปล่า' }, { status: 400 });
    }

    console.log(`[ADMIN_DIVISIONS_POST] Creating division: "${trimmedName}"`);

    // Check name uniqueness per season+ageGroup
    const { data: existing } = await supabaseAdmin
      .from('divisions')
      .select('id, name')
      .eq('season_id', season_id)
      .eq('age_group_id', age_group_id)
      .eq('name', trimmedName)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: `Division "${trimmedName}" มีใน Age Group นี้แล้ว` },
        { status: 409 }
      );
    }

    const { data: division, error } = await supabaseAdmin
      .from('divisions')
      .insert({
        season_id,
        age_group_id,
        name: trimmedName,
        sort_order: sort_order ?? 0,
      })
      .select('id, season_id, age_group_id, name, sort_order, created_at')
      .single();

    if (error) {
      console.error('[ADMIN_DIVISIONS_POST] Insert error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[ADMIN_DIVISIONS_POST] Created division id=${division.id}`);
    return NextResponse.json(
      { ...division, team_count: 0, match_count: 0 },
      { status: 201 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_DIVISIONS_POST] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

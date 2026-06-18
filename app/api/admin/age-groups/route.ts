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

    if (!seasonId) {
      return NextResponse.json({ error: 'seasonId จำเป็นต้องระบุ' }, { status: 400 });
    }

    console.log(`[ADMIN_AGE_GROUPS_GET] season=${seasonId}`);

    const { data: ageGroups, error } = await supabaseAdmin
      .from('age_groups')
      .select('id, season_id, code, name, sort_order, created_at')
      .eq('season_id', seasonId)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[ADMIN_AGE_GROUPS_GET] Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!ageGroups || ageGroups.length === 0) {
      return NextResponse.json([]);
    }

    const ageGroupIds = ageGroups.map((ag) => ag.id);

    // Get division counts and team counts per age group in 2 queries
    const [{ data: divisionRows }, { data: teamRows }] = await Promise.all([
      supabaseAdmin
        .from('divisions')
        .select('age_group_id')
        .in('age_group_id', ageGroupIds),
      supabaseAdmin
        .from('teams')
        .select('age_group_id')
        .in('age_group_id', ageGroupIds),
    ]);

    const divisionCountMap: Record<string, number> = {};
    (divisionRows || []).forEach((row: { age_group_id: string }) => {
      divisionCountMap[row.age_group_id] = (divisionCountMap[row.age_group_id] || 0) + 1;
    });

    const teamCountMap: Record<string, number> = {};
    (teamRows || []).forEach((row: { age_group_id: string }) => {
      teamCountMap[row.age_group_id] = (teamCountMap[row.age_group_id] || 0) + 1;
    });

    const result = ageGroups.map((ag) => ({
      ...ag,
      division_count: divisionCountMap[ag.id] || 0,
      team_count: teamCountMap[ag.id] || 0,
    }));

    console.log(`[ADMIN_AGE_GROUPS_GET] Returning ${result.length} age groups`);
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_AGE_GROUPS_GET] Error:', msg);
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
    const { season_id, code, name, sort_order } = body;

    if (!season_id || !code || !name) {
      return NextResponse.json(
        { error: 'season_id, code, และ name จำเป็นต้องระบุ' },
        { status: 400 }
      );
    }

    const trimmedCode = String(code).trim().toUpperCase();
    const trimmedName = String(name).trim();

    if (!trimmedCode) {
      return NextResponse.json({ error: 'code ต้องไม่ว่างเปล่า' }, { status: 400 });
    }
    if (!trimmedName) {
      return NextResponse.json({ error: 'name ต้องไม่ว่างเปล่า' }, { status: 400 });
    }

    console.log(`[ADMIN_AGE_GROUPS_POST] Creating age group: "${trimmedCode}" in season=${season_id}`);

    // Check code uniqueness per season
    const { data: existing } = await supabaseAdmin
      .from('age_groups')
      .select('id, code')
      .eq('season_id', season_id)
      .eq('code', trimmedCode)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: `Age Group "${trimmedCode}" มีใน Season นี้แล้ว` },
        { status: 409 }
      );
    }

    const { data: ageGroup, error } = await supabaseAdmin
      .from('age_groups')
      .insert({
        season_id,
        code: trimmedCode,
        name: trimmedName,
        sort_order: sort_order ?? 0,
      })
      .select('id, season_id, code, name, sort_order, created_at')
      .single();

    if (error) {
      console.error('[ADMIN_AGE_GROUPS_POST] Insert error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[ADMIN_AGE_GROUPS_POST] Created age group id=${ageGroup.id}`);
    return NextResponse.json(
      { ...ageGroup, division_count: 0, team_count: 0 },
      { status: 201 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_AGE_GROUPS_POST] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const seasonId = searchParams.get('seasonId');
  const ageGroupId = searchParams.get('ageGroupId');
  if (!seasonId || !ageGroupId) {
    return NextResponse.json({ error: 'seasonId and ageGroupId are required' }, { status: 400 });
  }

  const { data: groups, error } = await supabaseAdmin
    .from('tournament_groups')
    .select('id, season_id, age_group_id, name, code, sort_order')
    .eq('season_id', seasonId)
    .eq('age_group_id', ageGroupId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: `Failed to fetch groups: ${error.message}` }, { status: 500 });
  }

  // team counts
  const ids = (groups || []).map((g) => g.id);
  const countMap = new Map<string, number>();
  if (ids.length) {
    const { data: gt } = await supabaseAdmin
      .from('tournament_group_teams')
      .select('group_id')
      .in('group_id', ids);
    for (const row of gt || []) countMap.set(row.group_id, (countMap.get(row.group_id) || 0) + 1);
  }

  return NextResponse.json(
    (groups || []).map((g) => ({ ...g, team_count: countMap.get(g.id) || 0 }))
  );
}

export async function POST(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated || !auth.profile) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const seasonId = body.seasonId;
  const ageGroupId = body.ageGroupId;
  const name = (body.name ?? '').trim();
  const code = body.code ? String(body.code).trim() : null;
  const sortOrder = Number.isFinite(body.sort_order) ? Number(body.sort_order) : 0;

  if (!seasonId || !ageGroupId || !name) {
    return NextResponse.json({ error: 'seasonId, ageGroupId and name are required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('tournament_groups')
    .insert({ season_id: seasonId, age_group_id: ageGroupId, name, code, sort_order: sortOrder })
    .select('id, season_id, age_group_id, name, code, sort_order')
    .single();

  if (error) {
    return NextResponse.json({ error: `Failed to create group: ${error.message}` }, { status: 500 });
  }

  await logAdminAction({
    admin: { id: auth.profile.id, email: auth.profile.email },
    action: 'tournament_group.create',
    entityType: 'tournament_group',
    entityId: data.id,
    entityLabel: data.name,
    newData: data,
  });

  return NextResponse.json({ success: true, group: { ...data, team_count: 0 } }, { status: 201 });
}

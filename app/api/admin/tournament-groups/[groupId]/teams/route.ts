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

export async function GET(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from('tournament_group_teams')
    .select('id, team_id, sort_order, team:team_id(id, name, short_name)')
    .eq('group_id', groupId)
    .order('sort_order', { ascending: true });

  if (error) {
    return NextResponse.json({ error: `Failed to fetch teams: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json(data || []);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated || !auth.profile) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const teamId = body.teamId;
  if (!teamId) return NextResponse.json({ error: 'teamId is required' }, { status: 400 });

  // Group context
  const { data: group } = await supabaseAdmin
    .from('tournament_groups').select('id, season_id, age_group_id').eq('id', groupId).single();
  if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });

  // Team must belong to the same season + age group
  const { data: team } = await supabaseAdmin
    .from('teams').select('id, name, season_id, age_group_id').eq('id', teamId).single();
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  if (team.season_id !== group.season_id || team.age_group_id !== group.age_group_id) {
    return NextResponse.json({ error: 'ทีมไม่ได้อยู่ในฤดูกาล/รุ่นอายุเดียวกับกลุ่ม' }, { status: 400 });
  }

  // Team must not already be in another group of the same season + age group
  const { data: siblingGroups } = await supabaseAdmin
    .from('tournament_groups')
    .select('id')
    .eq('season_id', group.season_id)
    .eq('age_group_id', group.age_group_id);
  const siblingIds = (siblingGroups || []).map((g) => g.id);
  if (siblingIds.length) {
    const { data: existing } = await supabaseAdmin
      .from('tournament_group_teams')
      .select('id, group_id')
      .eq('team_id', teamId)
      .in('group_id', siblingIds);
    if ((existing || []).length > 0) {
      const inThis = existing!.some((e) => e.group_id === groupId);
      return NextResponse.json(
        { error: inThis ? 'ทีมนี้อยู่ในกลุ่มนี้แล้ว' : 'ทีมนี้ถูกจัดอยู่ในอีกกลุ่มของรุ่นนี้แล้ว' },
        { status: 409 }
      );
    }
  }

  const { data, error } = await supabaseAdmin
    .from('tournament_group_teams')
    .insert({ group_id: groupId, team_id: teamId, sort_order: Number.isFinite(body.sort_order) ? Number(body.sort_order) : 0 })
    .select('id, team_id, sort_order, team:team_id(id, name, short_name)')
    .single();

  if (error) {
    return NextResponse.json({ error: `Failed to add team: ${error.message}` }, { status: 500 });
  }

  await logAdminAction({
    admin: { id: auth.profile.id, email: auth.profile.email },
    action: 'tournament_group_team.add',
    entityType: 'tournament_group_team',
    entityId: data.id,
    entityLabel: team.name,
    newData: { group_id: groupId, team_id: teamId },
  });

  return NextResponse.json({ success: true, groupTeam: data }, { status: 201 });
}

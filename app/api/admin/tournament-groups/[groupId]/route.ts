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

export async function PUT(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated || !auth.profile) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === 'string') update.name = body.name.trim();
  if (body.code !== undefined) update.code = body.code ? String(body.code).trim() : null;
  if (Number.isFinite(body.sort_order)) update.sort_order = Number(body.sort_order);

  const { data, error } = await supabaseAdmin
    .from('tournament_groups')
    .update(update)
    .eq('id', groupId)
    .select('id, season_id, age_group_id, name, code, sort_order')
    .single();

  if (error) {
    return NextResponse.json({ error: `Failed to update group: ${error.message}` }, { status: 500 });
  }

  await logAdminAction({
    admin: { id: auth.profile.id, email: auth.profile.email },
    action: 'tournament_group.update',
    entityType: 'tournament_group',
    entityId: groupId,
    entityLabel: data.name,
    newData: update,
  });

  return NextResponse.json({ success: true, group: data });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated || !auth.profile) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const force = request.nextUrl.searchParams.get('force') === 'true';

  const { data: group } = await supabaseAdmin
    .from('tournament_groups').select('id, name').eq('id', groupId).single();
  if (!group) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  const { count } = await supabaseAdmin
    .from('tournament_group_teams')
    .select('*', { count: 'exact', head: true })
    .eq('group_id', groupId);

  if ((count || 0) > 0 && !force) {
    return NextResponse.json(
      { error: `กลุ่มนี้มี ${count} ทีม — ยืนยันการลบเพื่อเอาทีมออกพร้อมกลุ่ม`, teamCount: count, needsConfirm: true },
      { status: 409 }
    );
  }

  const { error } = await supabaseAdmin.from('tournament_groups').delete().eq('id', groupId);
  if (error) {
    return NextResponse.json({ error: `Failed to delete group: ${error.message}` }, { status: 500 });
  }

  await logAdminAction({
    admin: { id: auth.profile.id, email: auth.profile.email },
    action: 'tournament_group.delete',
    entityType: 'tournament_group',
    entityId: groupId,
    entityLabel: group.name,
    oldData: { teamCount: count || 0 },
  });

  return NextResponse.json({ success: true });
}

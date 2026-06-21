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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string; teamId: string }> }
) {
  const { groupId, teamId } = await params;
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated || !auth.profile) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const { error } = await supabaseAdmin
    .from('tournament_group_teams')
    .delete()
    .eq('group_id', groupId)
    .eq('team_id', teamId);

  if (error) {
    return NextResponse.json({ error: `Failed to remove team: ${error.message}` }, { status: 500 });
  }

  await logAdminAction({
    admin: { id: auth.profile.id, email: auth.profile.email },
    action: 'tournament_group_team.remove',
    entityType: 'tournament_group_team',
    entityId: teamId,
    entityLabel: teamId,
    oldData: { group_id: groupId, team_id: teamId },
  });

  return NextResponse.json({ success: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
import { logTournamentAdminAction } from '@/lib/tournament/services/audit';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';

export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    await logTournamentAdminAction({
      admin: auth.userId ? { id: auth.userId, email: auth.email } : undefined,
      action: 'draw-assignments.delete',
      entityType: 'draw-assignment',
    });
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  try {
    const client = getTournamentServiceClient();

    // Get the assignment to verify it exists
    const { data: assignment, error: getError } = await client
      .from('tournament_draw_assignments')
      .select('id, group_id, slot_code, category_id')
      .eq('id', id)
      .is('superseded_at', null)
      .single();

    if (getError || !assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    // Supersede it
    const { error: updateError } = await client
      .from('tournament_draw_assignments')
      .update({ superseded_at: new Date().toISOString() })
      .eq('id', id);

    if (updateError) {
      console.error('[DRAW_ASSIGNMENTS_DELETE] update failed:', updateError);
      return NextResponse.json({ error: 'Failed to delete assignment' }, { status: 500 });
    }

    await logTournamentAdminAction({
      admin: { id: auth.userId, email: auth.email },
      action: 'draw-assignments.delete',
      entityType: 'draw-assignment',
      entityId: id,
      entityLabel: `${assignment.slot_code}`,
    });

    return NextResponse.json({ data: { success: true } });
  } catch (err) {
    console.error('[DRAW_ASSIGNMENTS_DELETE] error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

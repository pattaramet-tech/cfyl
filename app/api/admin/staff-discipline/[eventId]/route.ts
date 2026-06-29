import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;
    console.log('[STAFF_DISCIPLINE_DELETE] Request received for eventId:', eventId);

    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    if (!authResult.profile?.can_edit_cards && !authResult.profile?.can_edit_goals) {
      return NextResponse.json({ error: 'No permission to delete discipline' }, { status: 403 });
    }

    // Get current event
    const { data: event } = await supabaseAdmin
      .from('staff_discipline_events')
      .select('id, discipline_type, staff_id')
      .eq('id', eventId)
      .single();

    // Soft delete: set status = cancelled
    const { error: updateError } = await supabaseAdmin
      .from('staff_discipline_events')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', eventId);

    if (updateError) {
      console.error('[STAFF_DISCIPLINE_DELETE] Delete error:', updateError);
      return NextResponse.json({ error: `Failed to delete discipline event: ${updateError.message}` }, { status: 500 });
    }

    console.log('[STAFF_DISCIPLINE_DELETE] Discipline event cancelled:', eventId);

    await logAdminAction({
      admin: { id: authResult.profile!.id, email: authResult.profile!.email },
      action: 'staff_discipline.delete',
      entityType: 'staff_discipline_event',
      entityId: eventId,
      entityLabel: event?.discipline_type || eventId,
      oldData: { status: 'active' },
      newData: { status: 'cancelled' },
    });

    return NextResponse.json({ success: true, message: 'Discipline event cancelled' }, { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[STAFF_DISCIPLINE_DELETE] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

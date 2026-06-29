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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ staffId: string }> }
) {
  try {
    const { staffId } = await params;
    console.log('[TEAM_STAFFS_PUT] Request received for staffId:', staffId);

    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    if (!authResult.profile?.can_edit_cards) {
      return NextResponse.json({ error: 'No permission to edit staff' }, { status: 403 });
    }

    const body = await request.json();
    const { fullName, position, phone, active } = body;

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (fullName !== undefined) updatePayload.full_name = fullName;
    if (position !== undefined) updatePayload.position = position;
    if (phone !== undefined) updatePayload.phone = phone;
    if (active !== undefined) updatePayload.active = active;

    const { data: currentStaff } = await supabaseAdmin
      .from('team_staffs')
      .select('full_name, position, phone, active')
      .eq('id', staffId)
      .single();

    const { data: updatedStaff, error: updateError } = await supabaseAdmin
      .from('team_staffs')
      .update(updatePayload)
      .eq('id', staffId)
      .select(`
        id,
        season_id,
        age_group_id,
        division_id,
        team_id,
        full_name,
        position,
        phone,
        active,
        created_at,
        updated_at,
        team:team_id(id, name, short_name),
        age_group:age_group_id(id, code, name),
        division:division_id(id, name)
      `)
      .single();

    if (updateError) {
      console.error('[TEAM_STAFFS_PUT] Update error:', updateError);
      return NextResponse.json({ error: `Failed to update staff: ${updateError.message}` }, { status: 500 });
    }

    console.log('[TEAM_STAFFS_PUT] Staff updated:', staffId);

    await logAdminAction({
      admin: { id: authResult.profile!.id, email: authResult.profile!.email },
      action: 'staff.update',
      entityType: 'team_staff',
      entityId: staffId,
      entityLabel: updatedStaff?.full_name || staffId,
      oldData: currentStaff,
      newData: updatePayload,
    });

    return NextResponse.json(updatedStaff, { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[TEAM_STAFFS_PUT] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ staffId: string }> }
) {
  try {
    const { staffId } = await params;
    console.log('[TEAM_STAFFS_DELETE] Request received for staffId:', staffId);

    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    if (!authResult.profile?.can_edit_cards) {
      return NextResponse.json({ error: 'No permission to edit staff' }, { status: 403 });
    }

    // Soft delete: set active = false
    const { data: staff } = await supabaseAdmin
      .from('team_staffs')
      .select('full_name')
      .eq('id', staffId)
      .single();

    const { error: updateError } = await supabaseAdmin
      .from('team_staffs')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', staffId);

    if (updateError) {
      console.error('[TEAM_STAFFS_DELETE] Delete error:', updateError);
      return NextResponse.json({ error: `Failed to delete staff: ${updateError.message}` }, { status: 500 });
    }

    console.log('[TEAM_STAFFS_DELETE] Staff deleted:', staffId);

    await logAdminAction({
      admin: { id: authResult.profile!.id, email: authResult.profile!.email },
      action: 'staff.delete',
      entityType: 'team_staff',
      entityId: staffId,
      entityLabel: staff?.full_name || staffId,
      oldData: { active: true },
      newData: { active: false },
    });

    return NextResponse.json({ success: true, message: 'Staff deleted' }, { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[TEAM_STAFFS_DELETE] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

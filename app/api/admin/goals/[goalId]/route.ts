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
  { params }: { params: Promise<{ goalId: string }> }
) {
  try {
    const { goalId } = await params;
    console.log('[GOALS_PUT] Request received for goalId:', goalId);

    // Verify admin is authenticated
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      console.error('[GOALS_PUT] Auth failed:', authResult.error);
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    // Check permission
    if (!authResult.profile?.can_edit_goals) {
      console.warn('[GOALS_PUT] Permission denied for:', authResult.profile?.email);
      return NextResponse.json(
        { error: 'You do not have permission to edit goals' },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { goals, minute } = body;

    console.log('[GOALS_PUT] Updating goal:', { goalId, goals, minute });

    // Validate goals
    if (goals != null && (typeof goals !== 'number' || goals < 1 || goals > 10)) {
      return NextResponse.json(
        { error: 'goals must be a number between 1 and 10' },
        { status: 400 }
      );
    }

    // Validate minute
    const minuteValue =
      minute === undefined || minute === null || minute === ''
        ? null
        : Number(minute);

    if (
      minuteValue !== null &&
      (!Number.isInteger(minuteValue) || minuteValue < 0 || minuteValue > 120)
    ) {
      return NextResponse.json(
        { error: 'minute must be an integer between 0 and 120 or empty' },
        { status: 400 }
      );
    }

    // Get current goal
    const { data: currentGoal, error: getError } = await supabaseAdmin
      .from('goals')
      .select('*')
      .eq('id', goalId)
      .single();

    if (getError || !currentGoal) {
      console.error('[GOALS_PUT] Goal not found:', goalId);
      return NextResponse.json(
        { error: 'Goal not found' },
        { status: 404 }
      );
    }

    // Build update payload
    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (goals != null) updatePayload.goals = goals;
    if ('minute' in body) updatePayload.minute = minuteValue;

    // Update goal
    const { data: updatedGoal, error: updateError } = await supabaseAdmin
      .from('goals')
      .update(updatePayload)
      .eq('id', goalId)
      .select(`
        id,
        match_id,
        player_id,
        team_id,
        goals,
        minute,
        created_at,
        updated_at,
        player:player_id(id, full_name, shirt_no, team_id, team:team_id(id, name, short_name)),
        team:team_id(id, name, short_name)
      `)
      .single();

    if (updateError) {
      console.error('[GOALS_PUT] Update error:', updateError);
      return NextResponse.json(
        { error: `Failed to update goal: ${updateError.message}` },
        { status: 500 }
      );
    }

    console.log('[GOALS_PUT] Goal updated:', goalId);

    await logAdminAction({
      admin: { id: authResult.profile!.id, email: authResult.profile!.email },
      action: 'goal.update',
      entityType: 'goal',
      entityId: goalId,
      entityLabel: (updatedGoal as any)?.player?.full_name ?? goalId,
      oldData: { goals: currentGoal.goals, minute: currentGoal.minute },
      newData: { goals: updatedGoal?.goals, minute: updatedGoal?.minute },
    });

    return NextResponse.json(
      {
        success: true,
        goal: updatedGoal,
      },
      { status: 200 }
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[GOALS_PUT] Error:', errorMsg);
    return NextResponse.json(
      { error: `Failed to update goal: ${errorMsg}` },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ goalId: string }> }
) {
  try {
    const { goalId } = await params;
    console.log('[GOALS_DELETE] Request received for goalId:', goalId);

    // Verify admin is authenticated
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      console.error('[GOALS_DELETE] Auth failed:', authResult.error);
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    // Check permission
    if (!authResult.profile?.can_edit_goals) {
      console.warn('[GOALS_DELETE] Permission denied for:', authResult.profile?.email);
      return NextResponse.json(
        { error: 'You do not have permission to edit goals' },
        { status: 403 }
      );
    }

    console.log('[GOALS_DELETE] Deleting goal:', goalId);

    // Get goal to verify it exists
    const { data: goal, error: getError } = await supabaseAdmin
      .from('goals')
      .select('*')
      .eq('id', goalId)
      .single();

    if (getError || !goal) {
      console.error('[GOALS_DELETE] Goal not found:', goalId);
      return NextResponse.json(
        { error: 'Goal not found' },
        { status: 404 }
      );
    }

    // Delete goal
    const { error: deleteError } = await supabaseAdmin
      .from('goals')
      .delete()
      .eq('id', goalId);

    if (deleteError) {
      console.error('[GOALS_DELETE] Delete error:', deleteError);
      return NextResponse.json(
        { error: `Failed to delete goal: ${deleteError.message}` },
        { status: 500 }
      );
    }

    console.log('[GOALS_DELETE] Goal deleted:', goalId);

    await logAdminAction({
      admin: { id: authResult.profile!.id, email: authResult.profile!.email },
      action: 'goal.delete',
      entityType: 'goal',
      entityId: goalId,
      entityLabel: goalId,
      oldData: goal,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Goal deleted',
      },
      { status: 200 }
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[GOALS_DELETE] Error:', errorMsg);
    return NextResponse.json(
      { error: `Failed to delete goal: ${errorMsg}` },
      { status: 500 }
    );
  }
}

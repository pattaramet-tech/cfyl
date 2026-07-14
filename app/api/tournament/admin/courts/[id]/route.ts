import { NextRequest, NextResponse } from 'next/server';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
import { logTournamentAdminAction } from '@/lib/tournament/services/audit';
import { validateCourtUpdateInput } from '@/lib/tournament/services/courts';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  try {
    const client = getTournamentServiceClient();
    const { data, error } = await client
      .from('tournament_courts')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('[COURT_GET] query error:', error.message);
      return NextResponse.json({ error: 'Failed to fetch court' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Court not found' }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('[COURT_GET] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    await logTournamentAdminAction({
      admin: auth.userId ? { id: auth.userId, email: auth.email } : undefined,
      action: 'courts.update',
      entityType: 'court',
      entityId: id,
    });
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const validation = validateCourtUpdateInput(body);

    if (!validation.valid) {
      await logTournamentAdminAction({
        admin: { id: auth.userId, email: auth.email },
        action: 'courts.update',
        entityType: 'court',
        entityId: id,
        newData: body,
      });
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const client = getTournamentServiceClient();
    const { data: oldData } = await client
      .from('tournament_courts')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    const { data, error } = await client
      .from('tournament_courts')
      .update(validation.payload!)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[COURT_PUT] update error:', error.message, error.code);
      if (error.code === '23505') {
        await logTournamentAdminAction({
          admin: { id: auth.userId, email: auth.email },
          action: 'courts.update',
          entityType: 'court',
          entityId: id,
          newData: body,
        });
        return NextResponse.json({ error: 'Court code already exists in this venue' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to update court' }, { status: 500 });
    }

    await logTournamentAdminAction({
      admin: { id: auth.userId, email: auth.email },
      action: 'courts.update',
      entityType: 'court',
      entityId: data.id,
      entityLabel: data.name,
      oldData,
      newData: data,
    });

    return NextResponse.json({ data });
  } catch (err) {
    console.error('[COURT_PUT] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    await logTournamentAdminAction({
      admin: auth.userId ? { id: auth.userId, email: auth.email } : undefined,
      action: 'courts.delete',
      entityType: 'court',
      entityId: id,
    });
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  try {
    const client = getTournamentServiceClient();
    const { data: oldData } = await client
      .from('tournament_courts')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!oldData) {
      return NextResponse.json({ error: 'Court not found' }, { status: 404 });
    }

    const { error } = await client
      .from('tournament_courts')
      .update({ active: false })
      .eq('id', id);

    if (error) {
      console.error('[COURT_DELETE] delete error:', error.message);
      return NextResponse.json({ error: 'Failed to delete court' }, { status: 500 });
    }

    await logTournamentAdminAction({
      admin: { id: auth.userId, email: auth.email },
      action: 'courts.delete',
      entityType: 'court',
      entityId: id,
      entityLabel: oldData.name,
      oldData,
    });

    return NextResponse.json({ data: null });
  } catch (err) {
    console.error('[COURT_DELETE] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

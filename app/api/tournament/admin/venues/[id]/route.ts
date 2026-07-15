import { NextRequest, NextResponse } from 'next/server';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
import { logTournamentAdminAction } from '@/lib/tournament/services/audit';
import { validateVenueUpdateInput } from '@/lib/tournament/services/venues';
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
      .from('tournament_venues')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('[VENUE_GET] query error:', error.message);
      return NextResponse.json({ error: 'Failed to fetch venue' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('[VENUE_GET] unexpected error:', err instanceof Error ? err.message : err);
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
      action: 'venues.update',
      entityType: 'venue',
      entityId: id,
    });
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const validation = validateVenueUpdateInput(body);

    if (!validation.valid) {
      await logTournamentAdminAction({
        admin: { id: auth.userId, email: auth.email },
        action: 'venues.update',
        entityType: 'venue',
        entityId: id,
        newData: body,
      });
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const client = getTournamentServiceClient();
    const { data: oldData } = await client
      .from('tournament_venues')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    const { data, error } = await client
      .from('tournament_venues')
      .update(validation.payload!)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[VENUE_PUT] update error:', error.message, error.code);
      if (error.code === '23505') {
        await logTournamentAdminAction({
          admin: { id: auth.userId, email: auth.email },
          action: 'venues.update',
          entityType: 'venue',
          entityId: id,
          newData: body,
        });
        return NextResponse.json({ error: 'Venue code or slug already exists in this tournament' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to update venue' }, { status: 500 });
    }

    await logTournamentAdminAction({
      tournamentId: data.tournament_id,
      admin: { id: auth.userId, email: auth.email },
      action: 'venues.update',
      entityType: 'venue',
      entityId: data.id,
      entityLabel: data.name,
      oldData,
      newData: data,
    });

    return NextResponse.json({ data });
  } catch (err) {
    console.error('[VENUE_PUT] unexpected error:', err instanceof Error ? err.message : err);
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
      action: 'venues.delete',
      entityType: 'venue',
      entityId: id,
    });
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  try {
    const client = getTournamentServiceClient();
    const { data: oldData } = await client
      .from('tournament_venues')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!oldData) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const { error } = await client
      .from('tournament_venues')
      .update({ active: false })
      .eq('id', id);

    if (error) {
      console.error('[VENUE_DELETE] delete error:', error.message);
      return NextResponse.json({ error: 'Failed to delete venue' }, { status: 500 });
    }

    await logTournamentAdminAction({
      tournamentId: oldData.tournament_id,
      admin: { id: auth.userId, email: auth.email },
      action: 'venues.delete',
      entityType: 'venue',
      entityId: id,
      entityLabel: oldData.name,
      oldData,
    });

    return NextResponse.json({ data: null });
  } catch (err) {
    console.error('[VENUE_DELETE] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
import { logTournamentAdminAction } from '@/lib/tournament/services/audit';
import { validateVenueInsertInput } from '@/lib/tournament/services/venues';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const tournamentId = url.searchParams.get('tournament_id');

    if (!tournamentId) {
      return NextResponse.json({ error: 'tournament_id parameter is required' }, { status: 400 });
    }

    const client = getTournamentServiceClient();
    const { data, error } = await client
      .from('tournament_venues')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[VENUES_GET] query error:', error.message);
      return NextResponse.json({ error: 'Failed to fetch venues' }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (err) {
    console.error('[VENUES_GET] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    await logTournamentAdminAction({
      admin: auth.userId ? { id: auth.userId, email: auth.email } : undefined,
      action: 'venues.create',
      entityType: 'venue',
    });
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const validation = validateVenueInsertInput(body);

    if (!validation.valid) {
      await logTournamentAdminAction({
        tournamentId: typeof body.tournament_id === 'string' ? body.tournament_id : undefined,
        admin: { id: auth.userId, email: auth.email },
        action: 'venues.create',
        entityType: 'venue',
        newData: body,
      });
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const client = getTournamentServiceClient();
    const { data, error } = await client
      .from('tournament_venues')
      .insert(validation.payload!)
      .select()
      .single();

    if (error) {
      console.error('[VENUES_POST] insert error:', error.message, error.code);
      if (error.code === '23505') {
        await logTournamentAdminAction({
          tournamentId: validation.payload!.tournament_id,
          admin: { id: auth.userId, email: auth.email },
          action: 'venues.create',
          entityType: 'venue',
          newData: body,
        });
        return NextResponse.json({ error: 'Venue code or slug already exists in this tournament' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to create venue' }, { status: 500 });
    }

    await logTournamentAdminAction({
      tournamentId: data.tournament_id,
      admin: { id: auth.userId, email: auth.email },
      action: 'venues.create',
      entityType: 'venue',
      entityId: data.id,
      entityLabel: data.name,
      newData: data,
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    console.error('[VENUES_POST] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

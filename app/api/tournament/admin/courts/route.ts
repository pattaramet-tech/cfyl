import { NextRequest, NextResponse } from 'next/server';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
import { logTournamentAdminAction } from '@/lib/tournament/services/audit';
import { validateCourtInsertInput } from '@/lib/tournament/services/courts';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const venueId = url.searchParams.get('venue_id');

    if (!venueId) {
      return NextResponse.json({ error: 'venue_id parameter is required' }, { status: 400 });
    }

    const client = getTournamentServiceClient();
    const { data, error } = await client
      .from('tournament_courts')
      .select('*')
      .eq('venue_id', venueId)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[COURTS_GET] query error:', error.message);
      return NextResponse.json({ error: 'Failed to fetch courts' }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (err) {
    console.error('[COURTS_GET] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    await logTournamentAdminAction({
      admin: auth.userId ? { id: auth.userId, email: auth.email } : undefined,
      action: 'courts.create',
      entityType: 'court',
    });
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const validation = validateCourtInsertInput(body);

    if (!validation.valid) {
      await logTournamentAdminAction({
        admin: { id: auth.userId, email: auth.email },
        action: 'courts.create',
        entityType: 'court',
        newData: body,
      });
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const client = getTournamentServiceClient();
    const { data, error } = await client
      .from('tournament_courts')
      .insert(validation.payload!)
      .select()
      .single();

    if (error) {
      console.error('[COURTS_POST] insert error:', error.message, error.code);
      if (error.code === '23505') {
        await logTournamentAdminAction({
          admin: { id: auth.userId, email: auth.email },
          action: 'courts.create',
          entityType: 'court',
          newData: body,
        });
        return NextResponse.json({ error: 'Court code already exists in this venue' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to create court' }, { status: 500 });
    }

    await logTournamentAdminAction({
      admin: { id: auth.userId, email: auth.email },
      action: 'courts.create',
      entityType: 'court',
      entityId: data.id,
      entityLabel: data.name,
      newData: data,
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    console.error('[COURTS_POST] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

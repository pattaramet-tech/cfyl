import { NextRequest, NextResponse } from 'next/server';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
import { logTournamentAdminAction } from '@/lib/tournament/services/audit';
import { validateTournamentInsertInput } from '@/lib/tournament/services/tournaments';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get('status');

    const client = getTournamentServiceClient();
    let query = client.from('tournaments').select('*').order('created_at', { ascending: false });

    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[TOURNAMENTS_GET] query error:', error.message);
      return NextResponse.json({ error: 'Failed to fetch tournaments' }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (err) {
    console.error('[TOURNAMENTS_GET] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    await logTournamentAdminAction({
      admin: auth.userId ? { id: auth.userId, email: auth.email } : undefined,
      action: 'tournaments.create',
      entityType: 'tournament',
      newData: { attempted: true },
    });
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const validation = validateTournamentInsertInput(body);

    if (!validation.valid) {
      await logTournamentAdminAction({
        admin: { id: auth.userId, email: auth.email },
        action: 'tournaments.create',
        entityType: 'tournament',
        newData: body,
      });
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const client = getTournamentServiceClient();
    const { data, error } = await client
      .from('tournaments')
      .insert(validation.payload!)
      .select()
      .single();

    if (error) {
      console.error('[TOURNAMENTS_POST] insert error:', error.message, error.code);
      if (error.code === '23505') {
        await logTournamentAdminAction({
          admin: { id: auth.userId, email: auth.email },
          action: 'tournaments.create',
          entityType: 'tournament',
          newData: body,
        });
        return NextResponse.json({ error: 'Tournament slug already exists' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to create tournament' }, { status: 500 });
    }

    await logTournamentAdminAction({
      tournamentId: data.id,
      admin: { id: auth.userId, email: auth.email },
      action: 'tournaments.create',
      entityType: 'tournament',
      entityId: data.id,
      entityLabel: data.name,
      newData: data,
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    console.error('[TOURNAMENTS_POST] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

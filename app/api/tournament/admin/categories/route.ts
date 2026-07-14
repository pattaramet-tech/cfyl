import { NextRequest, NextResponse } from 'next/server';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
import { logTournamentAdminAction } from '@/lib/tournament/services/audit';
import { validateCategoryInsertInput } from '@/lib/tournament/services/categories';
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
      .from('tournament_categories')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[CATEGORIES_GET] query error:', error.message);
      return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (err) {
    console.error('[CATEGORIES_GET] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    await logTournamentAdminAction({
      admin: auth.userId ? { id: auth.userId, email: auth.email } : undefined,
      action: 'categories.create',
      entityType: 'category',
    });
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const validation = validateCategoryInsertInput(body);

    if (!validation.valid) {
      await logTournamentAdminAction({
        tournamentId: typeof body.tournament_id === 'string' ? body.tournament_id : undefined,
        admin: { id: auth.userId, email: auth.email },
        action: 'categories.create',
        entityType: 'category',
        newData: body,
      });
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const client = getTournamentServiceClient();
    const { data, error } = await client
      .from('tournament_categories')
      .insert(validation.payload!)
      .select()
      .single();

    if (error) {
      console.error('[CATEGORIES_POST] insert error:', error.message, error.code);
      if (error.code === '23505') {
        await logTournamentAdminAction({
          tournamentId: validation.payload!.tournament_id,
          admin: { id: auth.userId, email: auth.email },
          action: 'categories.create',
          entityType: 'category',
          newData: body,
        });
        return NextResponse.json({ error: 'Category code already exists in this tournament' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to create category' }, { status: 500 });
    }

    await logTournamentAdminAction({
      tournamentId: data.tournament_id,
      admin: { id: auth.userId, email: auth.email },
      action: 'categories.create',
      entityType: 'category',
      entityId: data.id,
      entityLabel: data.code,
      newData: data,
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    console.error('[CATEGORIES_POST] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

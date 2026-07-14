import { NextRequest, NextResponse } from 'next/server';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
import { logTournamentAdminAction } from '@/lib/tournament/services/audit';
import { validateCategoryVenueInsertInput } from '@/lib/tournament/services/category-venues';
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
    const categoryId = url.searchParams.get('category_id');

    if (!tournamentId && !categoryId) {
      return NextResponse.json({ error: 'tournament_id or category_id parameter is required' }, { status: 400 });
    }

    const client = getTournamentServiceClient();
    let query = client
      .from('tournament_category_venues')
      .select('tournament_category_venues(*), tournament_categories!inner(tournament_id)');

    if (tournamentId) {
      query = query.eq('tournament_categories.tournament_id', tournamentId);
    } else if (categoryId) {
      query = query.eq('category_id', categoryId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[CATEGORY_VENUES_GET] query error:', error.message);
      return NextResponse.json({ error: 'Failed to fetch category-venue mappings' }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (err) {
    console.error('[CATEGORY_VENUES_GET] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    await logTournamentAdminAction({
      admin: auth.userId ? { id: auth.userId, email: auth.email } : undefined,
      action: 'category-venues.create',
      entityType: 'category-venue',
    });
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const validation = validateCategoryVenueInsertInput(body);

    if (!validation.valid) {
      await logTournamentAdminAction({
        admin: { id: auth.userId, email: auth.email },
        action: 'category-venues.create',
        entityType: 'category-venue',
        newData: body,
      });
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const client = getTournamentServiceClient();

    const { data: category } = await client
      .from('tournament_categories')
      .select('tournament_id')
      .eq('id', validation.payload!.category_id)
      .maybeSingle();

    const { data: venue } = await client
      .from('tournament_venues')
      .select('tournament_id')
      .eq('id', validation.payload!.venue_id)
      .maybeSingle();

    if (!category || !venue) {
      return NextResponse.json({ error: 'Category or venue not found' }, { status: 404 });
    }

    if (category.tournament_id !== venue.tournament_id) {
      await logTournamentAdminAction({
        admin: { id: auth.userId, email: auth.email },
        action: 'category-venues.create',
        entityType: 'category-venue',
        newData: body,
      });
      return NextResponse.json({ error: 'Category and venue must belong to the same tournament' }, { status: 400 });
    }

    const { data, error } = await client
      .from('tournament_category_venues')
      .insert(validation.payload!)
      .select()
      .single();

    if (error) {
      console.error('[CATEGORY_VENUES_POST] insert error:', error.message, error.code);
      if (error.code === '23505') {
        await logTournamentAdminAction({
          tournamentId: category.tournament_id,
          admin: { id: auth.userId, email: auth.email },
          action: 'category-venues.create',
          entityType: 'category-venue',
          newData: body,
        });
        return NextResponse.json({ error: 'This category-venue mapping already exists' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to create mapping' }, { status: 500 });
    }

    await logTournamentAdminAction({
      tournamentId: category.tournament_id,
      admin: { id: auth.userId, email: auth.email },
      action: 'category-venues.create',
      entityType: 'category-venue',
      entityId: data.id,
      newData: data,
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    console.error('[CATEGORY_VENUES_POST] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

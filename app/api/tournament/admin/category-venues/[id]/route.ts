import { NextRequest, NextResponse } from 'next/server';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
import { logTournamentAdminAction } from '@/lib/tournament/services/audit';
import { validateCategoryVenueUpdateInput } from '@/lib/tournament/services/category-venues';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    await logTournamentAdminAction({
      admin: auth.userId ? { id: auth.userId, email: auth.email } : undefined,
      action: 'category-venues.update',
      entityType: 'category-venue',
      entityId: id,
    });
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const validation = validateCategoryVenueUpdateInput(body);

    if (!validation.valid) {
      await logTournamentAdminAction({
        admin: { id: auth.userId, email: auth.email },
        action: 'category-venues.update',
        entityType: 'category-venue',
        entityId: id,
        newData: body,
      });
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const client = getTournamentServiceClient();
    const { data: oldData } = await client
      .from('tournament_category_venues')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!oldData) {
      return NextResponse.json({ error: 'Mapping not found' }, { status: 404 });
    }

    if (validation.payload?.venue_id) {
      const { data: category } = await client
        .from('tournament_categories')
        .select('tournament_id')
        .eq('id', oldData.category_id)
        .maybeSingle();

      const { data: venue } = await client
        .from('tournament_venues')
        .select('tournament_id')
        .eq('id', validation.payload.venue_id)
        .maybeSingle();

      if (!venue) {
        return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
      }

      if (category && category.tournament_id !== venue.tournament_id) {
        await logTournamentAdminAction({
          admin: { id: auth.userId, email: auth.email },
          action: 'category-venues.update',
          entityType: 'category-venue',
          entityId: id,
          newData: body,
        });
        return NextResponse.json({ error: 'Category and venue must belong to the same tournament' }, { status: 400 });
      }
    }

    const { data, error } = await client
      .from('tournament_category_venues')
      .update(validation.payload!)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[CATEGORY_VENUE_PUT] update error:', error.message, error.code);
      if (error.code === '23505') {
        await logTournamentAdminAction({
          admin: { id: auth.userId, email: auth.email },
          action: 'category-venues.update',
          entityType: 'category-venue',
          entityId: id,
          newData: body,
        });
        return NextResponse.json({ error: 'This category-venue mapping already exists' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to update mapping' }, { status: 500 });
    }

    const { data: category } = await client
      .from('tournament_categories')
      .select('tournament_id')
      .eq('id', oldData.category_id)
      .maybeSingle();

    await logTournamentAdminAction({
      tournamentId: category?.tournament_id,
      admin: { id: auth.userId, email: auth.email },
      action: 'category-venues.update',
      entityType: 'category-venue',
      entityId: data.id,
      oldData,
      newData: data,
    });

    return NextResponse.json({ data });
  } catch (err) {
    console.error('[CATEGORY_VENUE_PUT] unexpected error:', err instanceof Error ? err.message : err);
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
      action: 'category-venues.delete',
      entityType: 'category-venue',
      entityId: id,
    });
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  try {
    const client = getTournamentServiceClient();
    const { data: oldData } = await client
      .from('tournament_category_venues')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!oldData) {
      return NextResponse.json({ error: 'Mapping not found' }, { status: 404 });
    }

    const { error } = await client
      .from('tournament_category_venues')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[CATEGORY_VENUE_DELETE] delete error:', error.message);
      return NextResponse.json({ error: 'Failed to delete mapping' }, { status: 500 });
    }

    const { data: category } = await client
      .from('tournament_categories')
      .select('tournament_id')
      .eq('id', oldData.category_id)
      .maybeSingle();

    await logTournamentAdminAction({
      tournamentId: category?.tournament_id,
      admin: { id: auth.userId, email: auth.email },
      action: 'category-venues.delete',
      entityType: 'category-venue',
      entityId: id,
      oldData,
    });

    return NextResponse.json({ data: null });
  } catch (err) {
    console.error('[CATEGORY_VENUE_DELETE] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

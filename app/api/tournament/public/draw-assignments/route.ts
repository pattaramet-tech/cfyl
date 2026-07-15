import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const rawTournamentSlug = request.nextUrl.searchParams.get('tournament_slug');
    const rawCategoryCode = request.nextUrl.searchParams.get('category_code');

    if (!rawTournamentSlug || !rawCategoryCode) {
      return NextResponse.json(
        { error: 'tournament_slug and category_code required' },
        { status: 400 }
      );
    }

    // Server-side normalization
    const tournamentSlug = rawTournamentSlug.trim().toLowerCase();
    const categoryCode = rawCategoryCode.trim().toUpperCase();

    const client = getTournamentServiceClient();

    // Resolve tournament by slug
    const { data: tournament, error: tourError } = await client
      .from('tournaments')
      .select('id')
      .eq('slug', tournamentSlug)
      .is('deleted_at', null)
      .single();

    if (tourError || !tournament) {
      console.error('[DRAW_ASSIGNMENTS_PUBLIC_GET] tournament not found:', tourError);
      return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
    }

    // Resolve category by tournament_id + code
    const { data: category, error: catError } = await client
      .from('tournament_categories')
      .select('id')
      .eq('tournament_id', tournament.id)
      .eq('code', categoryCode)
      .is('deleted_at', null)
      .single();

    if (catError || !category) {
      console.error('[DRAW_ASSIGNMENTS_PUBLIC_GET] category not found:', catError);
      return NextResponse.json({ error: `Category ${categoryCode} not found` }, { status: 404 });
    }

    const { data, error } = await client
      .from('tournament_draw_assignments')
      .select(
        `
        id,
        category_id,
        group_id,
        slot_code,
        team_id,
        version,
        assigned_at,
        tournament_teams!inner(id, name, team_code)
        `
      )
      .eq('category_id', category.id)
      .is('superseded_at', null);

    if (error) {
      console.error('[DRAW_ASSIGNMENTS_PUBLIC_GET] db error:', error);
      return NextResponse.json({ error: 'Failed to fetch assignments' }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('[DRAW_ASSIGNMENTS_PUBLIC_GET] error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

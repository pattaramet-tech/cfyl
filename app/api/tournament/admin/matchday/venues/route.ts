import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { requireTournamentResultOperator } from '@/lib/tournament/services/auth';

export const dynamic = 'force-dynamic';

interface VenueRow {
  id: string;
  name: string;
  code: string;
}

function asText(value: string | null): string {
  return (value || '').trim();
}

export async function GET(request: NextRequest) {
  const tournamentSlug = asText(request.nextUrl.searchParams.get('tournament_slug')).toLowerCase();
  if (!tournamentSlug) {
    return NextResponse.json({ error: 'tournament_slug is required' }, { status: 400 });
  }

  const client = getTournamentServiceClient();

  try {
    const { data: tournamentData, error: tournamentError } = await client
      .from('tournaments')
      .select('id')
      .eq('slug', tournamentSlug)
      .is('deleted_at', null)
      .maybeSingle();
    if (tournamentError) throw new Error(tournamentError.message);
    const tournamentId = (tournamentData as { id: string } | null)?.id;
    if (!tournamentId) {
      return NextResponse.json({ error: `Tournament ${tournamentSlug} not found` }, { status: 404 });
    }

    const auth = await requireTournamentResultOperator(request, tournamentId);
    if (!auth.authenticated || !auth.authorized) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
    }

    const { data, error } = await client
      .from('tournament_venues')
      .select('id, name, code')
      .eq('tournament_id', tournamentId)
      .order('sort_order', { ascending: true });
    if (error) throw new Error(error.message);

    return NextResponse.json({ data: (data || []) as VenueRow[] });
  } catch (error) {
    console.error('[MATCHDAY_VENUES] unexpected error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

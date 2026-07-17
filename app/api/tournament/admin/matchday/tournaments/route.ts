import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { listAuthorizedTournamentScopes } from '@/lib/tournament/services/auth';

export const dynamic = 'force-dynamic';

interface TournamentRow {
  id: string;
  name: string;
  slug: string;
  status: string;
}

export async function GET(request: NextRequest) {
  const auth = await listAuthorizedTournamentScopes(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }
  if (auth.scopes.length === 0) {
    return NextResponse.json({ error: auth.error || 'No tournament access' }, { status: 403 });
  }

  try {
    const client = getTournamentServiceClient();
    const { data, error } = await client
      .from('tournaments')
      .select('id, name, slug, status')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    const isGlobal = auth.scopes.some((scope) => scope.tournamentId === null);
    const allowedIds = new Set(auth.scopes.map((scope) => scope.tournamentId).filter((id): id is string => id !== null));

    const tournaments = ((data || []) as TournamentRow[]).filter((tournament) => isGlobal || allowedIds.has(tournament.id));

    return NextResponse.json({ data: tournaments });
  } catch (error) {
    console.error('[MATCHDAY_TOURNAMENTS] unexpected error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

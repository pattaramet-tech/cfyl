import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { requireTournamentResultOperator } from '@/lib/tournament/services/auth';
import { listVenueMatchdayMatches } from '@/lib/tournament/services/quickResult';

export const dynamic = 'force-dynamic';

function asText(value: string | null): string {
  return (value || '').trim();
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params;
  const tournamentSlug = asText(request.nextUrl.searchParams.get('tournament_slug')).toLowerCase();
  const date = asText(request.nextUrl.searchParams.get('date'));

  if (!tournamentSlug) {
    return NextResponse.json({ error: 'tournament_slug is required' }, { status: 400 });
  }
  if (!date) {
    return NextResponse.json({ error: 'date is required' }, { status: 400 });
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

    const matches = await listVenueMatchdayMatches({ client, tournamentId, venueId, date });

    return NextResponse.json({
      data: {
        venue_id: venueId,
        date,
        matches: matches.map((match) => ({
          match_id: match.matchId,
          match_code: match.matchCode,
          match_no: match.matchNo,
          match_date: match.matchDate,
          match_time: match.matchTime,
          category_code: match.categoryCode,
          home_team_name: match.homeTeamName,
          away_team_name: match.awayTeamName,
          status: match.status,
          has_quick_result: match.hasQuickResult,
          eligible: match.eligible,
          ineligible_reason: match.ineligibleReason,
        })),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[MATCHDAY_LIST] unexpected error:', message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

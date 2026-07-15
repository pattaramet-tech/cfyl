import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import scheduleData from '@/data/tournament-schedule-fallback.json';

export const dynamic = 'force-dynamic';

interface ScheduleMatch {
  id: string;
  category_code: string;
  venue_code: string;
  date: string;
  time: string;
  home_slot: string;
  away_slot: string;
  home_team?: string;
  away_team?: string;
  court: number;
  round: string;
  match_number: string | number;
}

type SupabaseClient = ReturnType<typeof getTournamentServiceClient>;

async function resolveTeamForSlot(
  client: SupabaseClient,
  tournamentId: string,
  categoryCode: string,
  slotCode: string
): Promise<string | undefined> {
  // If slot is a placeholder like "Winner M1" or "TBD", don't resolve
  if (slotCode.startsWith('Winner ') || slotCode === 'TBD' || !slotCode.includes('-')) {
    return undefined;
  }

  try {
    const groupCode = slotCode.split('-')[0];

    // Get category by tournament_id + code
    const { data: category } = await client
      .from('tournament_categories')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('code', categoryCode)
      .is('deleted_at', null)
      .single();

    if (!category) return undefined;

    // Get group by tournament_id + category_id + code
    const { data: group } = await client
      .from('tournament_groups')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('category_id', category.id)
      .eq('code', groupCode)
      .maybeSingle();

    if (!group) return undefined;

    // Get assignment for this group + slot
    const { data: assignment } = await client
      .from('tournament_draw_assignments')
      .select('team_id, tournament_teams!inner(name)')
      .eq('group_id', group.id)
      .eq('slot_code', slotCode)
      .is('superseded_at', null)
      .single();

    if (assignment) {
      const teams = assignment.tournament_teams as Array<{ name: string }>;
      if (Array.isArray(teams) && teams.length > 0 && teams[0].name) {
        return teams[0].name;
      }
    }

    return undefined;
  } catch (err) {
    console.error('[SCHEDULE_RESOLVE] Error resolving team:', err);
    return undefined;
  }
}

export async function GET(request: NextRequest) {
  try {
    const tournamentSlug = request.nextUrl.searchParams.get('tournament_slug');
    const categoryCode = request.nextUrl.searchParams.get('category_code');
    const venueCode = request.nextUrl.searchParams.get('venue_code');
    const date = request.nextUrl.searchParams.get('date');

    if (!tournamentSlug) {
      return NextResponse.json(
        { error: 'tournament_slug required' },
        { status: 400 }
      );
    }

    const client = getTournamentServiceClient();

    // Resolve tournament by slug
    const { data: tournament } = await client
      .from('tournaments')
      .select('id')
      .eq('slug', tournamentSlug.trim().toLowerCase())
      .is('deleted_at', null)
      .single();

    if (!tournament) {
      return NextResponse.json(
        { error: 'Tournament not found' },
        { status: 404 }
      );
    }

    // Get schedule from fallback data
    let matches: ScheduleMatch[] = scheduleData.matches.map((m) => ({ ...m }));

    // Apply filters
    if (categoryCode) {
      matches = matches.filter((m) => m.category_code === categoryCode.trim().toUpperCase());
    }

    if (venueCode) {
      matches = matches.filter((m) => m.venue_code === venueCode.trim().toUpperCase());
    }

    if (date) {
      matches = matches.filter((m) => m.date === date);
    }

    // Resolve team names for each slot
    const resolvedMatches: ScheduleMatch[] = [];

    for (const match of matches) {
      const homeTeam = await resolveTeamForSlot(
        client,
        tournament.id,
        match.category_code,
        match.home_slot
      );

      const awayTeam = await resolveTeamForSlot(
        client,
        tournament.id,
        match.category_code,
        match.away_slot
      );

      resolvedMatches.push({
        ...match,
        home_team: homeTeam,
        away_team: awayTeam,
      });
    }

    return NextResponse.json({
      tournament_slug: tournamentSlug,
      competition_dates: scheduleData.competition_dates,
      total_matches: resolvedMatches.length,
      data: resolvedMatches,
    });
  } catch (err) {
    console.error('[SCHEDULE_GET] error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

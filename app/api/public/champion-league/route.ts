import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { buildRegularLeagueStandings } from '@/lib/league-standings';
import {
  calculateChampionLeagueStandings,
  getChampionLeaguePlacementPairings,
  getChampionLeagueProgress,
  type ChampionLeagueQualifier,
} from '@/lib/champion-league';
import type { Match } from '@/types/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const seasonId = request.nextUrl.searchParams.get('seasonId');
    const ageGroupId = request.nextUrl.searchParams.get('ageGroupId');
    const divisionId = request.nextUrl.searchParams.get('divisionId');

    if (!seasonId || !ageGroupId || !divisionId) {
      return NextResponse.json(
        { error: 'Missing required parameters: seasonId, ageGroupId, divisionId' },
        { status: 400 }
      );
    }

    const [matchesResult, teamsResult] = await Promise.all([
      supabase
        .from('matches')
        .select(
          `
          *,
          home_team:home_team_id(name, short_name, logo_url),
          away_team:away_team_id(name, short_name, logo_url),
          division:division_id(name)
        `
        )
        .eq('season_id', seasonId)
        .eq('age_group_id', ageGroupId)
        .eq('division_id', divisionId)
        .order('match_date', { ascending: true })
        .order('match_time', { ascending: true }),
      supabase
        .from('teams')
        .select('id, name, short_name, logo_url, active')
        .eq('season_id', seasonId)
        .eq('age_group_id', ageGroupId)
        .eq('division_id', divisionId)
        .eq('active', true),
    ]);

    if (matchesResult.error) throw matchesResult.error;
    if (teamsResult.error) throw teamsResult.error;

    const matches = (matchesResult.data || []) as unknown as Match[];
    const teams = teamsResult.data || [];
    const regularStandings = buildRegularLeagueStandings(matches, teams, {
      seasonId,
      ageGroupId,
      divisionId,
    });

    const qualifiers: ChampionLeagueQualifier[] = regularStandings.slice(0, 4).map((row, index) => ({
      team_id: row.team_id,
      league_rank: index + 1,
      team_name: row.team_name,
      team_short_name: row.team_short_name,
      team_logo_url: row.team_logo_url,
    }));

    const standings = calculateChampionLeagueStandings(qualifiers, matches);
    const progress = getChampionLeagueProgress(qualifiers, matches);
    const pairings = getChampionLeaguePlacementPairings(standings, progress);
    const rawMatches = (matchesResult.data || []) as Array<Match & Record<string, unknown>>;

    const active = rawMatches.some(
      (match) =>
        match.league_phase != null &&
        ['champion_league', 'final', 'third_place'].includes(match.league_phase)
    );

    return NextResponse.json({
      active,
      qualifiers,
      standings,
      progress,
      pairings,
      matches: {
        champion_league: rawMatches.filter((match) => match.league_phase === 'champion_league'),
        final: rawMatches.filter((match) => match.league_phase === 'final'),
        third_place: rawMatches.filter((match) => match.league_phase === 'third_place'),
      },
      rules: {
        win_points: 3,
        draw_points: 1,
        loss_points: 0,
        tied_points_tiebreak: 'regular_league_rank',
        required_matches_per_team: 3,
        required_unique_matches: 6,
      },
    });
  } catch (error) {
    console.error('[CHAMPION_LEAGUE_PUBLIC] API error:', error);
    return NextResponse.json({ error: 'Failed to fetch Champion League data' }, { status: 500 });
  }
}

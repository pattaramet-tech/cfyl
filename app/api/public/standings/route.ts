import { supabase } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import { buildRegularLeagueStandings, type LeagueStandingTeam } from '@/lib/league-standings';
import { isRegularLeagueMatch } from '@/lib/champion-league';
import type { Match } from '@/types/db';

export const dynamic = 'force-dynamic';

interface TeamRow extends LeagueStandingTeam {
  active?: boolean | null;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const seasonId = searchParams.get('seasonId');
    const ageGroupId = searchParams.get('ageGroupId');
    const divisionId = searchParams.get('divisionId');
    const debug = searchParams.get('debug') === '1';

    if (!seasonId || !ageGroupId || !divisionId) {
      return NextResponse.json(
        { error: 'Missing required parameters: seasonId, ageGroupId, divisionId' },
        { status: 400 }
      );
    }

    const { data: matches, error: matchError } = await supabase
      .from('matches')
      .select('*')
      .eq('season_id', seasonId)
      .eq('age_group_id', ageGroupId)
      .eq('division_id', divisionId);

    if (matchError) throw matchError;

    const safeMatches = (matches || []) as Match[];
    const regularMatches = safeMatches.filter(isRegularLeagueMatch);

    const teamIdsFromMatches = Array.from(
      new Set(regularMatches.flatMap((m) => [m.home_team_id, m.away_team_id]).filter(Boolean))
    );

    const { data: teamsByDiv, error: teamDivError } = await supabase
      .from('teams')
      .select('id, name, short_name, logo_url, active')
      .eq('season_id', seasonId)
      .eq('age_group_id', ageGroupId)
      .eq('division_id', divisionId)
      .eq('active', true);

    if (teamDivError) throw teamDivError;

    let teamsByMatchIds: TeamRow[] = [];
    if (teamIdsFromMatches.length > 0) {
      const { data: matchTeams, error: matchTeamError } = await supabase
        .from('teams')
        .select('id, name, short_name, logo_url, active')
        .in('id', teamIdsFromMatches)
        .eq('active', true);

      if (matchTeamError) throw matchTeamError;
      teamsByMatchIds = matchTeams || [];
    }

    const teamMap = new Map<string, TeamRow>();
    (teamsByDiv || []).forEach((team) => {
      if (team.active !== false) teamMap.set(team.id, team);
    });
    teamsByMatchIds.forEach((team) => {
      if (team.active !== false) teamMap.set(team.id, team);
    });

    const teams = Array.from(teamMap.values());
    const inactiveTeamsFiltered = (teamsByDiv || []).length + teamsByMatchIds.length - teams.length;
    const standings = buildRegularLeagueStandings(safeMatches, teams, {
      seasonId,
      ageGroupId,
      divisionId,
    });

    if (debug) {
      return NextResponse.json({
        rows: standings,
        debug: {
          seasonId,
          ageGroupId,
          divisionId,
          teamsByDivisionCount: (teamsByDiv || []).length,
          teamsFromMatchesCount: teamsByMatchIds.length,
          inactiveTeamsFiltered,
          finalTeamsCount: teams.length,
          allMatchesCount: safeMatches.length,
          regularMatchesCount: regularMatches.length,
          postLeagueMatchesExcluded: safeMatches.length - regularMatches.length,
        },
      });
    }

    return NextResponse.json(standings);
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Failed to fetch standings' }, { status: 500 });
  }
}

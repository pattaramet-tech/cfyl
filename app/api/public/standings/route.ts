import { supabase } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import { calculateStandings } from '@/lib/calculations';
import type { Match, Standing } from '@/types/db';

export const dynamic = 'force-dynamic';

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

    // Get all matches for this season/age group/division
    const { data: matches, error: matchError } = await supabase
      .from('matches')
      .select('*')
      .eq('season_id', seasonId)
      .eq('age_group_id', ageGroupId)
      .eq('division_id', divisionId);

    if (matchError) throw matchError;

    const safeMatches = matches || [];

    // Derive team ids from matches
    const teamIdsFromMatches = Array.from(
      new Set(
        (safeMatches as Match[])
          .flatMap((m) => [m.home_team_id, m.away_team_id])
          .filter(Boolean)
      )
    );

    // Get teams by division_id (primary)
    const { data: teamsByDiv, error: teamDivError } = await supabase
      .from('teams')
      .select('id, name, short_name, logo_url')
      .eq('season_id', seasonId)
      .eq('age_group_id', ageGroupId)
      .eq('division_id', divisionId);

    if (teamDivError) throw teamDivError;

    // Get teams by match ids (handles division_id = null case)
    let teamsByMatchIds: any[] = [];
    if (teamIdsFromMatches.length > 0) {
      const { data: matchTeams, error: matchTeamError } = await supabase
        .from('teams')
        .select('id, name, short_name, logo_url')
        .in('id', teamIdsFromMatches);

      if (matchTeamError) throw matchTeamError;

      teamsByMatchIds = matchTeams || [];
    }

    // Merge teams by id (avoid duplicates)
    const teamMap = new Map<string, any>();
    (teamsByDiv || []).forEach((t) => teamMap.set(t.id, t));
    teamsByMatchIds.forEach((t) => teamMap.set(t.id, t));

    const teams = Array.from(teamMap.values());

    // Filter: finished matches with scores
    const scoredMatches = (safeMatches as Match[]).filter(
      (m) => m.status === 'finished' && m.home_score !== null && m.away_score !== null
    );

    // Calculate standings for each team
    const standings: any[] = teams.map((team) => {
      const stats = calculateStandings(scoredMatches, team.id);
      return {
        season_id: seasonId,
        age_group_id: ageGroupId,
        division_id: divisionId,
        team_id: team.id,
        team_name: team.name,
        team_short_name: team.short_name,
        team_logo_url: team.logo_url,
        played: stats.played,
        wins: stats.wins,
        draws: stats.draws,
        losses: stats.losses,
        goals_for: stats.goalsFor,
        goals_against: stats.goalsAgainst,
        goal_diff: stats.goalDiff,
        points: stats.points,
      };
    });

    // Sort by points (desc), goal_diff (desc), goals_for (desc)
    standings.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goal_diff !== a.goal_diff) return b.goal_diff - a.goal_diff;
      return b.goals_for - a.goals_for;
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
          finalTeamsCount: teams.length,
          allMatchesCount: safeMatches.length,
          scoredMatchesCount: scoredMatches.length,
        },
      });
    }

    return NextResponse.json(standings);
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Failed to fetch standings' }, { status: 500 });
  }
}

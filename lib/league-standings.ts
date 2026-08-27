import { calculateStandings, calculateTeamForm } from '@/lib/calculations';
import { isRegularLeagueMatch } from '@/lib/champion-league';
import type { Match, Standing } from '@/types/db';

export interface LeagueStandingTeam {
  id: string;
  name: string;
  short_name?: string | null;
  logo_url?: string | null;
}

export interface LeagueStandingScope {
  seasonId: string;
  ageGroupId: string;
  divisionId: string;
}

export function buildRegularLeagueStandings(
  matches: Match[],
  teams: LeagueStandingTeam[],
  scope: LeagueStandingScope
): Standing[] {
  const regularScoredMatches = matches.filter(
    (match) =>
      isRegularLeagueMatch(match) &&
      match.status === 'finished' &&
      match.home_score !== null &&
      match.away_score !== null
  );

  const standings: Standing[] = teams.map((team) => {
    const stats = calculateStandings(regularScoredMatches, team.id);
    const form = calculateTeamForm(regularScoredMatches, team.id, 5);
    return {
      season_id: scope.seasonId,
      age_group_id: scope.ageGroupId,
      division_id: scope.divisionId,
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
      form,
    };
  });

  standings.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goal_diff !== a.goal_diff) return b.goal_diff - a.goal_diff;
    if (b.goals_for !== a.goals_for) return b.goals_for - a.goals_for;
    return a.team_name.localeCompare(b.team_name, 'th');
  });

  return standings;
}

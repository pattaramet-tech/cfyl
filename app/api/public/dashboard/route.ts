import { supabase } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface PublicDashboardResponse {
  scope: {
    season_id?: string | null;
    season_name?: string | null;
    age_group_id?: string | null;
    age_group_name?: string | null;
    division_id?: string | null;
    division_name?: string | null;
  };

  totals: {
    teams: number;
    players: number;
    matches: number;
    finished_matches: number;
    scheduled_matches: number;
    goals: number;
    own_goals: number;
    yellow_cards: number;
    red_cards: number;
    staff_discipline_events: number;
  };

  derived: {
    goals_per_finished_match: number;
    completion_percent: number;
  };

  leaders: {
    top_scorer?: {
      player_id: string;
      full_name: string;
      shirt_no?: number | null;
      team_name?: string | null;
      goals: number;
    } | null;

    top_scoring_team?: {
      team_id: string;
      team_name: string;
      goals: number;
    } | null;

    highest_scoring_match?: {
      match_id: string;
      matchday?: string | number | null;
      home_team_name: string;
      away_team_name: string;
      home_score: number;
      away_score: number;
      total_goals: number;
      match_date?: string | null;
    } | null;
  };

  latest_finished_match?: {
    match_id: string;
    matchday?: string | number | null;
    home_team_name: string;
    away_team_name: string;
    home_score: number;
    away_score: number;
    match_date?: string | null;
  } | null;

  next_match?: {
    match_id: string;
    matchday?: string | number | null;
    home_team_name: string;
    away_team_name: string;
    match_date?: string | null;
    match_time?: string | null;
  } | null;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    let seasonId = searchParams.get('seasonId');
    let ageGroupId = searchParams.get('ageGroupId');
    const divisionId = searchParams.get('divisionId');

    // If no seasonId provided, get the latest active season
    if (!seasonId) {
      const { data: seasons } = await supabase
        .from('seasons')
        .select('id, name')
        .eq('status', 'active')
        .order('year', { ascending: false })
        .limit(1);

      if (seasons && seasons.length > 0) {
        seasonId = seasons[0].id;
      } else {
        return NextResponse.json({
          scope: {},
          totals: {
            teams: 0,
            players: 0,
            matches: 0,
            finished_matches: 0,
            scheduled_matches: 0,
            goals: 0,
            own_goals: 0,
            yellow_cards: 0,
            red_cards: 0,
            staff_discipline_events: 0,
          },
          derived: {
            goals_per_finished_match: 0,
            completion_percent: 0,
          },
          leaders: {},
        });
      }
    }

    // If no ageGroupId provided, get the first age group
    if (!ageGroupId && seasonId) {
      const { data: ageGroups } = await supabase
        .from('age_groups')
        .select('id, name')
        .eq('season_id', seasonId)
        .order('sort_order', { ascending: true })
        .limit(1);

      if (ageGroups && ageGroups.length > 0) {
        ageGroupId = ageGroups[0].id;
      }
    }

    if (!seasonId || !ageGroupId) {
      return NextResponse.json(
        { error: 'Cannot determine season or age group' },
        { status: 400 }
      );
    }

    // Fetch scope info
    const [{ data: season }, { data: ageGroup }, { data: division }] = await Promise.all([
      supabase.from('seasons').select('name').eq('id', seasonId).single(),
      supabase.from('age_groups').select('name').eq('id', ageGroupId).single(),
      divisionId
        ? supabase.from('divisions').select('name').eq('id', divisionId).single()
        : Promise.resolve({ data: null }),
    ]);

    // Build base query condition
    let teamQuery = supabase.from('teams').select('id, name').eq('season_id', seasonId).eq('age_group_id', ageGroupId);
    let matchQuery = supabase.from('matches').select('*').eq('season_id', seasonId).eq('age_group_id', ageGroupId);

    if (divisionId) {
      teamQuery = teamQuery.eq('division_id', divisionId);
      matchQuery = matchQuery.eq('division_id', divisionId);
    }

    // Fetch teams and matches
    const [{ data: teams }, { data: matches }] = await Promise.all([teamQuery, matchQuery]);

    const teamIds = teams?.map(t => t.id) || [];
    const matchIds = matches?.map(m => m.id) || [];

    // Fetch players, goals, cards
    const [{ data: players }, { data: goals }, { data: cards }, { data: staffDiscipline }] = await Promise.all([
      teamIds.length > 0
        ? supabase.from('players').select('id').in('team_id', teamIds)
        : Promise.resolve({ data: [] }),
      matchIds.length > 0
        ? supabase
            .from('goals')
            .select('id, player_id, team_id, goals, is_own_goal, player:player_id(full_name, shirt_no, team_id), team:team_id(name)')
            .in('match_id', matchIds)
        : Promise.resolve({ data: [] }),
      matchIds.length > 0
        ? supabase.from('cards').select('id, card_type').in('match_id', matchIds)
        : Promise.resolve({ data: [] }),
      matchIds.length > 0
        ? supabase
            .from('staff_discipline_events')
            .select('id')
            .in('match_id', matchIds)
            .eq('status', 'active')
        : Promise.resolve({ data: [] }),
    ]);

    // Calculate totals
    const goalsArray = goals || [];
    const totalGoals = goalsArray.reduce((sum, g) => sum + (Number(g.goals) || 1), 0);
    const ownGoals = goalsArray.filter(g => g.is_own_goal).length;
    const yellowCards = (cards || []).filter(c => c.card_type === 'yellow').length;
    const redCards = (cards || []).filter(c => c.card_type === 'red').length;

    const totalMatches = matches?.length || 0;
    const finishedMatches = (matches || []).filter(m => m.status === 'finished').length;
    const scheduledMatches = (matches || []).filter(m => m.status === 'scheduled').length;

    const goalsPerMatch = finishedMatches > 0 ? totalGoals / finishedMatches : 0;
    const completionPercent = totalMatches > 0 ? (finishedMatches / totalMatches) * 100 : 0;

    // Find top scorer (exclude own goals)
    const scorerMap = new Map<string, any>();
    goalsArray
      .filter((g: any) => !g.is_own_goal && g.player_id && g.player)
      .forEach((g: any) => {
        const key = g.player_id;
        const player = Array.isArray(g.player) ? g.player[0] : g.player;
        if (!scorerMap.has(key)) {
          scorerMap.set(key, {
            player_id: key,
            full_name: player?.full_name || 'ไม่ระบุชื่อ',
            shirt_no: player?.shirt_no,
            team_name: g.team?.name || 'ไม่ระบุทีม',
            goals: 0,
          });
        }
        scorerMap.get(key).goals += Number(g.goals || 1);
      });

    const topScorer = Array.from(scorerMap.values()).sort((a, b) => b.goals - a.goals)[0] || null;

    // Find top scoring team (include own goals in total)
    const teamGoalsMap = new Map<string, any>();
    goalsArray.forEach((g: any) => {
      const teamId = g.team_id;
      const team = Array.isArray(g.team) ? g.team[0] : g.team;
      if (teamId && team) {
        if (!teamGoalsMap.has(teamId)) {
          teamGoalsMap.set(teamId, {
            team_id: teamId,
            team_name: team?.name || 'ไม่ระบุทีม',
            goals: 0,
          });
        }
        teamGoalsMap.get(teamId).goals += Number(g.goals || 1);
      }
    });

    const topScoringTeam = Array.from(teamGoalsMap.values()).sort((a, b) => b.goals - a.goals)[0] || null;

    // Find highest scoring match
    const highestScoringMatch = (matches || [])
      .filter(m => m.status === 'finished' && m.home_score !== null && m.away_score !== null)
      .map(m => ({
        match_id: m.id,
        matchday: m.matchday,
        home_team_name: m.home_team?.name || 'ไม่ระบุทีม',
        away_team_name: m.away_team?.name || 'ไม่ระบุทีม',
        home_score: m.home_score || 0,
        away_score: m.away_score || 0,
        total_goals: (m.home_score || 0) + (m.away_score || 0),
        match_date: m.match_date,
      }))
      .sort((a, b) => b.total_goals - a.total_goals)[0] || null;

    // Find latest finished match
    const latestMatch = (matches || [])
      .filter(m => m.status === 'finished')
      .sort((a, b) => {
        const dateA = new Date(a.match_date || a.updated_at || 0).getTime();
        const dateB = new Date(b.match_date || b.updated_at || 0).getTime();
        return dateB - dateA;
      })[0] || null;

    const latestFinishedMatch = latestMatch
      ? {
          match_id: latestMatch.id,
          matchday: latestMatch.matchday,
          home_team_name: latestMatch.home_team?.name || 'ไม่ระบุทีม',
          away_team_name: latestMatch.away_team?.name || 'ไม่ระบุทีม',
          home_score: latestMatch.home_score || 0,
          away_score: latestMatch.away_score || 0,
          match_date: latestMatch.match_date,
        }
      : null;

    // Find next match
    const nextMatch = (matches || [])
      .filter(m => m.status === 'scheduled')
      .sort((a, b) => {
        const dateA = new Date(a.match_date || 0).getTime();
        const dateB = new Date(b.match_date || 0).getTime();
        return dateA - dateB;
      })[0] || null;

    const nextMatchData = nextMatch
      ? {
          match_id: nextMatch.id,
          matchday: nextMatch.matchday,
          home_team_name: nextMatch.home_team?.name || 'ไม่ระบุทีม',
          away_team_name: nextMatch.away_team?.name || 'ไม่ระบุทีม',
          match_date: nextMatch.match_date,
          match_time: nextMatch.match_time,
        }
      : null;

    const response: PublicDashboardResponse = {
      scope: {
        season_id: seasonId,
        season_name: season?.name,
        age_group_id: ageGroupId,
        age_group_name: ageGroup?.name,
        division_id: divisionId,
        division_name: division?.name,
      },
      totals: {
        teams: teamIds.length,
        players: players?.length || 0,
        matches: totalMatches,
        finished_matches: finishedMatches,
        scheduled_matches: scheduledMatches,
        goals: totalGoals,
        own_goals: ownGoals,
        yellow_cards: yellowCards,
        red_cards: redCards,
        staff_discipline_events: staffDiscipline?.length || 0,
      },
      derived: {
        goals_per_finished_match: Math.round(goalsPerMatch * 10) / 10,
        completion_percent: Math.round(completionPercent),
      },
      leaders: {
        top_scorer: topScorer,
        top_scoring_team: topScoringTeam,
        highest_scoring_match: highestScoringMatch,
      },
      latest_finished_match: latestFinishedMatch,
      next_match: nextMatchData,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[PUBLIC_DASHBOARD] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    );
  }
}

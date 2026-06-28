import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { calculateStandings } from '@/lib/calculations';
import { parseMatchdayNumber } from '@/lib/suspension-calc';
import type { Match } from '@/types/db';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function GET(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const seasonId = searchParams.get('seasonId');
  const matchdayParam = searchParams.get('matchday');
  const debug = searchParams.get('debug') === '1';
  const matchdayFilter =
    matchdayParam && matchdayParam.trim() !== ''
      ? parseInt(matchdayParam, 10)
      : null;

  if (!seasonId) {
    return NextResponse.json({ error: 'seasonId is required' }, { status: 400 });
  }

  // Fetch season
  const { data: season, error: seasonError } = await supabaseAdmin
    .from('seasons')
    .select('id, name, year')
    .eq('id', seasonId)
    .single();

  if (seasonError || !season) {
    return NextResponse.json({ error: 'Season not found' }, { status: 404 });
  }

  // Fetch age groups directly from season
  const { data: ageGroups, error: agError } = await supabaseAdmin
    .from('age_groups')
    .select('id, code, name, sort_order')
    .eq('season_id', seasonId)
    .order('sort_order', { ascending: true })
    .order('code', { ascending: true });

  if (agError) {
    return NextResponse.json({ error: 'Failed to fetch age groups' }, { status: 500 });
  }
  if (!ageGroups?.length) {
    return NextResponse.json({ season, matchdayFilter, groups: [] });
  }

  // Debug tracking
  let totalAgeGroups = 0;
  let totalTeams = 0;
  let totalMatches = 0;
  const debugGroups: any[] = [];
  const groups: GroupResult[] = [];
  const usedTeamIds = new Set<string>();

  for (const ag of ageGroups) {
    totalAgeGroups += 1;

    // Fetch divisions for this age group
    const { data: divisions, error: divError } = await supabaseAdmin
      .from('divisions')
      .select('id, name, sort_order')
      .eq('season_id', seasonId)
      .eq('age_group_id', ag.id)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (divError) {
      console.error('[STANDINGS_EXPORT] Division fetch error:', divError);
      continue;
    }

    // Process explicit divisions first
    const divisionCandidates: ExportDivisionGroup[] = (divisions || []).map((d) => ({
      id: d.id,
      name: d.name,
      sort_order: d.sort_order ?? 999,
    }));

    if (divisionCandidates.length === 0) continue;

    for (const divCandidate of divisionCandidates) {
      // Fetch matches for this division first
      const { data: allMatches, error: matchError } = await supabaseAdmin
        .from('matches')
        .select('*')
        .eq('season_id', seasonId)
        .eq('age_group_id', ag.id)
        .eq('division_id', divCandidate.id);

      if (matchError) {
        console.error('[STANDINGS_EXPORT] Match fetch error:', matchError);
        continue;
      }

      const safeMatches = allMatches || [];
      totalMatches += safeMatches.length;

      // Derive team ids from matches
      const teamIdsFromMatches = Array.from(
        new Set(
          (safeMatches as Match[])
            .flatMap((m) => [m.home_team_id, m.away_team_id])
            .filter(Boolean)
        )
      );

      // Fetch teams with explicit division_id
      const { data: teamsByDivision } = await supabaseAdmin
        .from('teams')
        .select('id, name')
        .eq('season_id', seasonId)
        .eq('age_group_id', ag.id)
        .eq('division_id', divCandidate.id);

      // Fetch teams from match ids (handles division_id = null case)
      let teamsByMatchIds: any[] = [];
      if (teamIdsFromMatches.length > 0) {
        const { data: matchTeams } = await supabaseAdmin
          .from('teams')
          .select('id, name')
          .in('id', teamIdsFromMatches);
        teamsByMatchIds = matchTeams || [];
      }

      // Merge teams: use Map to avoid duplicates by id
      const teamMap = new Map<string, any>();
      (teamsByDivision || []).forEach((t) => teamMap.set(t.id, t));
      (teamsByMatchIds || []).forEach((t) => teamMap.set(t.id, t));

      const safeTeams = Array.from(teamMap.values());

      // Skip if no teams and no matches
      if (safeTeams.length === 0 && safeMatches.length === 0) continue;

      totalTeams += safeTeams.length;

      // Filter: status=finished AND both scores not null
      let scoredMatches = (safeMatches as Match[]).filter(
        (m) =>
          m.status === 'finished' &&
          m.home_score !== null &&
          m.away_score !== null
      );

      // Apply matchday filter
      if (matchdayFilter !== null && !isNaN(matchdayFilter)) {
        scoredMatches = scoredMatches.filter(
          (m) => parseMatchdayNumber(m.matchday) <= matchdayFilter
        );
      }

      // Calculate standings
      const standings = safeTeams.map((team) => {
        const stats = calculateStandings(scoredMatches, team.id);
        usedTeamIds.add(team.id);
        return {
          teamId: team.id,
          teamName: team.name,
          played: stats.played,
          wins: stats.wins,
          draws: stats.draws,
          losses: stats.losses,
          goalsFor: stats.goalsFor,
          goalsAgainst: stats.goalsAgainst,
          goalDiff: stats.goalDiff,
          points: stats.points,
        };
      });

      // Sort: pts DESC → GD DESC → GF DESC → name ASC
      standings.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
        return a.teamName.localeCompare(b.teamName, 'th');
      });

      // Format label
      const agLabel = ag.code || ag.name;
      const divLabel = formatDivisionLabel(divCandidate.name);

      const groupResult: GroupResult = {
        ageGroupId: ag.id,
        ageGroupName: agLabel,
        divisionId: divCandidate.id,
        divisionName: divCandidate.name,
        label: `${agLabel} ${divLabel}`,
        standings: standings.map((s, i) => ({ rank: i + 1, ...s })),
      };

      groups.push(groupResult);

      if (debug) {
        debugGroups.push({
          label: groupResult.label,
          teamsByDivisionCount: (teamsByDivision || []).length,
          teamsFromMatchesCount: teamsByMatchIds.length,
          finalTeamsCount: safeTeams.length,
          allMatchesCount: safeMatches.length,
          scoredMatchesCount: scoredMatches.length,
        });
      }
    }
  }

  // Check for no-division data (teams/matches with division_id = null)
  // Only add if not all data was already captured in explicit divisions
  if (groups.length > 0) {
    for (const ag of ageGroups) {
      const { data: noDivTeams } = await supabaseAdmin
        .from('teams')
        .select('id, name')
        .eq('season_id', seasonId)
        .eq('age_group_id', ag.id)
        .is('division_id', null);

      const { data: noDivMatches } = await supabaseAdmin
        .from('matches')
        .select('*')
        .eq('season_id', seasonId)
        .eq('age_group_id', ag.id)
        .is('division_id', null);

      const safeNoDivTeams = (noDivTeams || []).filter((t) => !usedTeamIds.has(t.id));
      const safeNoDivMatches = noDivMatches || [];

      if (safeNoDivTeams.length === 0 && safeNoDivMatches.length === 0) continue;

      totalTeams += safeNoDivTeams.length;
      totalMatches += safeNoDivMatches.length;

      // Filter scored matches
      let scoredMatches = (safeNoDivMatches as Match[]).filter(
        (m) =>
          m.status === 'finished' &&
          m.home_score !== null &&
          m.away_score !== null
      );

      if (matchdayFilter !== null && !isNaN(matchdayFilter)) {
        scoredMatches = scoredMatches.filter(
          (m) => parseMatchdayNumber(m.matchday) <= matchdayFilter
        );
      }

      // Calculate standings
      const standings = safeNoDivTeams.map((team) => {
        const stats = calculateStandings(scoredMatches, team.id);
        return {
          teamId: team.id,
          teamName: team.name,
          played: stats.played,
          wins: stats.wins,
          draws: stats.draws,
          losses: stats.losses,
          goalsFor: stats.goalsFor,
          goalsAgainst: stats.goalsAgainst,
          goalDiff: stats.goalDiff,
          points: stats.points,
        };
      });

      standings.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
        return a.teamName.localeCompare(b.teamName, 'th');
      });

      const agLabel = ag.code || ag.name;
      groups.push({
        ageGroupId: ag.id,
        ageGroupName: agLabel,
        divisionId: null,
        divisionName: 'รวม',
        label: `${agLabel} รวม`,
        standings: standings.map((s, i) => ({ rank: i + 1, ...s })),
      });

      if (debug) {
        debugGroups.push({
          label: `${agLabel} รวม`,
          finalTeamsCount: safeNoDivTeams.length,
          allMatchesCount: safeNoDivMatches.length,
          scoredMatchesCount: scoredMatches.length,
        });
      }
    }
  }

  const response: any = { season, matchdayFilter, groups };

  if (debug) {
    response.debug = {
      ageGroupsCount: totalAgeGroups,
      groupsCount: groups.length,
      totalTeams,
      totalMatches,
      matchdayFilter,
      groups: debugGroups,
    };
  }

  return NextResponse.json(response);
}

function formatDivisionLabel(name: string): string {
  const trimmed = name.trim();
  if (/division/i.test(trimmed)) return trimmed.toUpperCase();
  if (/ดิวิชั่น/.test(trimmed)) return trimmed;
  return `DIVISION ${trimmed.toUpperCase()}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface StandingRow {
  rank: number;
  teamId: string;
  teamName: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
}

interface GroupResult {
  ageGroupId: string;
  ageGroupName: string;
  divisionId: string | null;
  divisionName: string;
  label: string;
  standings: StandingRow[];
}

interface ExportDivisionGroup {
  id: string;
  name: string;
  sort_order: number;
}

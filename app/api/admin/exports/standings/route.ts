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

  // Fetch age groups directly from season (master data)
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

  // Debug counters
  let totalAgeGroups = 0;
  let totalTeams = 0;
  let totalMatches = 0;
  const groups: GroupResult[] = [];

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

    // Build division candidates: explicit divisions + potential no-division group
    const divisionCandidates: ExportDivisionGroup[] = (divisions || []).map((d) => ({
      id: d.id,
      name: d.name,
      sort_order: d.sort_order ?? 999,
    }));

    // Check if there are teams/matches without division_id
    const { data: teamsWithoutDiv } = await supabaseAdmin
      .from('teams')
      .select('id')
      .eq('season_id', seasonId)
      .eq('age_group_id', ag.id)
      .is('division_id', null)
      .limit(1);

    const { data: matchesWithoutDiv } = await supabaseAdmin
      .from('matches')
      .select('id')
      .eq('season_id', seasonId)
      .eq('age_group_id', ag.id)
      .is('division_id', null)
      .limit(1);

    const hasNoDivisionTeams = (teamsWithoutDiv?.length ?? 0) > 0;
    const hasNoDivisionMatches = (matchesWithoutDiv?.length ?? 0) > 0;

    // Add no-division group if teams or matches exist without division_id
    if (hasNoDivisionTeams || hasNoDivisionMatches) {
      divisionCandidates.push({
        id: null,
        name: 'รวม',
        sort_order: 9999,
      });
    }

    // If no divisions and no no-division data, skip this age group
    if (divisionCandidates.length === 0) continue;

    // Process each division candidate
    for (const divCandidate of divisionCandidates) {
      // Fetch teams
      let teamsQuery = supabaseAdmin
        .from('teams')
        .select('id, name')
        .eq('season_id', seasonId)
        .eq('age_group_id', ag.id);

      if (divCandidate.id === null) {
        teamsQuery = teamsQuery.is('division_id', null);
      } else {
        teamsQuery = teamsQuery.eq('division_id', divCandidate.id);
      }

      const { data: teams, error: teamError } = await teamsQuery;

      if (teamError) {
        console.error('[STANDINGS_EXPORT] Team fetch error:', teamError);
        continue;
      }

      const safeTeams = teams || [];
      if (safeTeams.length === 0) continue;

      totalTeams += safeTeams.length;

      // Fetch matches
      let matchesQuery = supabaseAdmin
        .from('matches')
        .select('*')
        .eq('season_id', seasonId)
        .eq('age_group_id', ag.id);

      if (divCandidate.id === null) {
        matchesQuery = matchesQuery.is('division_id', null);
      } else {
        matchesQuery = matchesQuery.eq('division_id', divCandidate.id);
      }

      const { data: allMatches, error: matchError } = await matchesQuery;

      if (matchError) {
        console.error('[STANDINGS_EXPORT] Match fetch error:', matchError);
        continue;
      }

      const safeMatches = allMatches || [];
      totalMatches += safeMatches.length;

      // Filter: status=finished AND both scores not null (safe 0-0 handling)
      let scoredMatches = (safeMatches as Match[]).filter(
        (m) =>
          m.status === 'finished' &&
          m.home_score !== null &&
          m.away_score !== null
      );

      // Apply matchday filter if provided
      if (matchdayFilter !== null && !isNaN(matchdayFilter)) {
        scoredMatches = scoredMatches.filter(
          (m) => parseMatchdayNumber(m.matchday) <= matchdayFilter
        );
      }

      // Calculate standings per team
      const standings = safeTeams.map((team) => {
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

      // Sort: pts DESC → GD DESC → GF DESC → name ASC
      standings.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
        return a.teamName.localeCompare(b.teamName, 'th');
      });

      // Display label
      const agLabel = ag.code || ag.name;
      const divLabel =
        divCandidate.id === null
          ? 'รวม'
          : divCandidate.name.toUpperCase().includes('DIVISION')
          ? divCandidate.name.toUpperCase()
          : `DIVISION ${divCandidate.name.toUpperCase()}`;

      groups.push({
        ageGroupId: ag.id,
        ageGroupName: agLabel,
        divisionId: divCandidate.id,
        divisionName: divCandidate.name,
        label: `${agLabel} ${divLabel}`,
        standings: standings.map((s, i) => ({ rank: i + 1, ...s })),
      });
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
    };
  }

  return NextResponse.json(response);
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
  id: string | null;
  name: string;
  sort_order: number;
}

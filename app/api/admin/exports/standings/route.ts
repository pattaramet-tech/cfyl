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

  // Fetch divisions for this season to get unique age_group_ids
  const { data: allDivisions, error: divError } = await supabaseAdmin
    .from('divisions')
    .select('id, age_group_id')
    .eq('season_id', seasonId);

  if (divError) {
    return NextResponse.json({ error: 'Failed to fetch divisions' }, { status: 500 });
  }

  if (!allDivisions?.length) {
    return NextResponse.json({ season, groups: [] });
  }

  // Get unique age_group_ids from divisions
  const uniqueAgeGroupIds = Array.from(
    new Set(allDivisions.map((d) => d.age_group_id))
  );

  // Fetch age groups by those IDs, sorted by sort_order then code
  const { data: ageGroups, error: agError } = await supabaseAdmin
    .from('age_groups')
    .select('id, code, name, sort_order')
    .in('id', uniqueAgeGroupIds)
    .order('sort_order', { ascending: true })
    .order('code', { ascending: true });

  if (agError) {
    return NextResponse.json({ error: 'Failed to fetch age groups' }, { status: 500 });
  }
  if (!ageGroups?.length) {
    return NextResponse.json({ season, groups: [] });
  }

  const groups: GroupResult[] = [];

  for (const ag of ageGroups) {
    // Fetch divisions sorted by sort_order then name
    const { data: divisions } = await supabaseAdmin
      .from('divisions')
      .select('id, name, sort_order')
      .eq('season_id', seasonId)
      .eq('age_group_id', ag.id)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (!divisions?.length) continue;

    for (const div of divisions) {
      // Fetch all matches
      const { data: allMatches } = await supabaseAdmin
        .from('matches')
        .select('*')
        .eq('season_id', seasonId)
        .eq('age_group_id', ag.id)
        .eq('division_id', div.id);

      // Fetch teams (active only for display, but include all for standings)
      const { data: teams } = await supabaseAdmin
        .from('teams')
        .select('id, name')
        .eq('season_id', seasonId)
        .eq('age_group_id', ag.id)
        .eq('division_id', div.id);

      if (!allMatches || !teams) continue;

      // Filter: status=finished AND both scores not null (safe 0-0 handling)
      let scoredMatches = (allMatches as Match[]).filter(
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

      // Calculate standings per team using existing calculateStandings
      const standings = teams.map((team) => {
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

      // Display label: use age_group.code (U14/U17) + division name uppercased
      const agLabel = ag.code || ag.name;
      const divLabel = div.name.toUpperCase().includes('DIVISION')
        ? div.name.toUpperCase()
        : `DIVISION ${div.name.toUpperCase()}`;

      groups.push({
        ageGroupId: ag.id,
        ageGroupName: agLabel,
        divisionId: div.id,
        divisionName: div.name,
        label: `${agLabel} ${divLabel}`,
        standings: standings.map((s, i) => ({ rank: i + 1, ...s })),
      });
    }
  }

  return NextResponse.json({ season, matchdayFilter, groups });
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
  divisionId: string;
  divisionName: string;
  label: string;
  standings: StandingRow[];
}

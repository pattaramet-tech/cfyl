import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { calculateStandings } from '@/lib/calculations';
import { createClient } from '@supabase/supabase-js';
import type { Match } from '@/types/db';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  // Group + its teams
  const { data: group } = await supabaseAdmin
    .from('tournament_groups').select('id, season_id, age_group_id, name').eq('id', groupId).single();
  if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });

  const { data: groupTeams } = await supabaseAdmin
    .from('tournament_group_teams')
    .select('team_id, sort_order, team:team_id(id, name)')
    .eq('group_id', groupId)
    .order('sort_order', { ascending: true });

  const teams = (groupTeams || []).map((gt) => ({ id: gt.team_id, name: (gt.team as any)?.name || '' }));
  const teamIds = new Set(teams.map((t) => t.id));

  if (teams.length === 0) {
    return NextResponse.json({ group: { id: group.id, name: group.name }, standings: [] });
  }

  // Matches within the group: both teams in the group, finished with scores (0-0 safe)
  const { data: allMatches } = await supabaseAdmin
    .from('matches')
    .select('*')
    .eq('season_id', group.season_id)
    .eq('age_group_id', group.age_group_id);

  const groupMatches = (allMatches as Match[] | null || []).filter(
    (m) =>
      m.status === 'finished' &&
      m.home_score !== null &&
      m.away_score !== null &&
      teamIds.has(m.home_team_id) &&
      teamIds.has(m.away_team_id)
  );

  const standings = teams
    .map((t) => {
      const s = calculateStandings(groupMatches, t.id);
      return {
        teamId: t.id,
        teamName: t.name,
        played: s.played,
        wins: s.wins,
        draws: s.draws,
        losses: s.losses,
        goalsFor: s.goalsFor,
        goalsAgainst: s.goalsAgainst,
        goalDiff: s.goalDiff,
        points: s.points,
      };
    })
    .sort((a, b) =>
      b.points - a.points ||
      b.goalDiff - a.goalDiff ||
      b.goalsFor - a.goalsFor ||
      a.teamName.localeCompare(b.teamName, 'th')
    )
    .map((row, i) => ({ rank: i + 1, ...row }));

  return NextResponse.json({ group: { id: group.id, name: group.name }, standings });
}

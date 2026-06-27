import { supabase } from '@/lib/supabase';
import { resolveTournamentContext } from '@/lib/public-tournament';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MATCH_SELECT = `id, match_code, stage, match_date, match_time, venue, home_score, away_score, status,
  home_team:home_team_id(name, short_name), away_team:away_team_id(name, short_name), group:tournament_group_id(name)`;

export async function GET(request: NextRequest, { params }: { params: Promise<{ seasonSlug: string; ageGroupCode: string }> }) {
  const { seasonSlug, ageGroupCode } = await params;
  const ctx = await resolveTournamentContext(seasonSlug, ageGroupCode);
  if (!ctx) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { season, ageGroup } = ctx;

  const [{ count: teams }, { count: groups }, { count: matches }, { count: finished }] = await Promise.all([
    supabase.from('teams').select('id', { count: 'exact', head: true }).eq('season_id', season.id).eq('age_group_id', ageGroup.id),
    supabase.from('tournament_groups').select('id', { count: 'exact', head: true }).eq('season_id', season.id).eq('age_group_id', ageGroup.id),
    supabase.from('matches').select('id', { count: 'exact', head: true }).eq('season_id', season.id).eq('age_group_id', ageGroup.id),
    supabase.from('matches').select('id', { count: 'exact', head: true }).eq('season_id', season.id).eq('age_group_id', ageGroup.id).eq('status', 'finished'),
  ]);

  const { data: recent } = await supabase
    .from('matches').select(MATCH_SELECT)
    .eq('season_id', season.id).eq('age_group_id', ageGroup.id)
    .eq('status', 'finished').not('home_score', 'is', null)
    .order('match_date', { ascending: false }).order('match_time', { ascending: false }).limit(5);

  const { data: upcoming } = await supabase
    .from('matches').select(MATCH_SELECT)
    .eq('season_id', season.id).eq('age_group_id', ageGroup.id)
    .neq('status', 'finished')
    .order('match_date', { ascending: true }).order('match_time', { ascending: true }).limit(5);

  return NextResponse.json({
    season, ageGroup,
    counts: { teams: teams || 0, groups: groups || 0, matches: matches || 0, finished: finished || 0 },
    recent: recent || [], upcoming: upcoming || [],
  });
}

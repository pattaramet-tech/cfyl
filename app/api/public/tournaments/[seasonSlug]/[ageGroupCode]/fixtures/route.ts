import { supabase } from '@/lib/supabase';
import { resolveTournamentContext } from '@/lib/public-tournament';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ seasonSlug: string; ageGroupCode: string }> }) {
  const { seasonSlug, ageGroupCode } = await params;
  const ctx = await resolveTournamentContext(seasonSlug, ageGroupCode);
  if (!ctx) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { data: matches } = await supabase
    .from('matches')
    .select(`id, match_code, matchday, stage, match_date, match_time, venue, home_score, away_score, status,
      tournament_group_id, winner_team_id,
      home_team:home_team_id(name, short_name), away_team:away_team_id(name, short_name),
      group:tournament_group_id(name)`)
    .eq('season_id', ctx.season.id).eq('age_group_id', ctx.ageGroup.id)
    .order('match_date', { ascending: true, nullsFirst: false })
    .order('match_time', { ascending: true, nullsFirst: false })
    .order('match_code', { ascending: true });

  return NextResponse.json({ season: ctx.season, ageGroup: ctx.ageGroup, matches: matches || [] });
}

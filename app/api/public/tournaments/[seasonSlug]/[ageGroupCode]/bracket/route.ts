import { supabase } from '@/lib/supabase';
import { resolveTournamentContext } from '@/lib/public-tournament';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ seasonSlug: string; ageGroupCode: string }> }) {
  const { seasonSlug, ageGroupCode } = await params;
  const ctx = await resolveTournamentContext(seasonSlug, ageGroupCode);
  if (!ctx) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { data: rounds } = await supabase
    .from('knockout_rounds').select('id, name, stage, sort_order')
    .eq('season_id', ctx.season.id).eq('age_group_id', ctx.ageGroup.id)
    .order('sort_order', { ascending: true });

  const { data: bracketMatches } = await supabase
    .from('bracket_matches')
    .select(`id, round_id, bracket_position, status, home_team_id, away_team_id,
      home_source_ref, away_source_ref,
      round:round_id(stage, name, sort_order),
      home_team:home_team_id(name, short_name), away_team:away_team_id(name, short_name),
      match:match_id(match_code, stage, match_date, match_time, venue, home_score, away_score, status, winner_team_id)`)
    .eq('season_id', ctx.season.id).eq('age_group_id', ctx.ageGroup.id)
    .order('bracket_position', { ascending: true });

  return NextResponse.json({ season: ctx.season, ageGroup: ctx.ageGroup, rounds: rounds || [], bracketMatches: bracketMatches || [] });
}

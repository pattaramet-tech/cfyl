import { supabase } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const seasonId = searchParams.get('seasonId');
    const ageGroupId = searchParams.get('ageGroupId');
    const divisionId = searchParams.get('divisionId');
    const matchday = searchParams.get('matchday');

    let query = supabase
      .from('matches')
      .select(
        `
        *,
        home_team:home_team_id(name, short_name, logo_url),
        away_team:away_team_id(name, short_name, logo_url),
        division:division_id(name)
      `
      )
      .order('match_date', { ascending: true })
      .order('match_time', { ascending: true });

    if (seasonId) query = query.eq('season_id', seasonId);
    if (ageGroupId) query = query.eq('age_group_id', ageGroupId);
    if (divisionId) query = query.eq('division_id', divisionId);
    if (matchday) query = query.eq('matchday', matchday);

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Failed to fetch matches' }, { status: 500 });
  }
}

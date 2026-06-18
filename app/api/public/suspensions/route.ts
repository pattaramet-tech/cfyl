import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    console.log('[SUSPENSIONS_GET] Request received');

    // Get query params
    const { searchParams } = new URL(request.url);
    const seasonId = searchParams.get('seasonId');
    const ageGroupId = searchParams.get('ageGroupId');

    if (!seasonId || !ageGroupId) {
      return NextResponse.json(
        { error: 'seasonId and ageGroupId parameters required' },
        { status: 400 }
      );
    }

    console.log(
      '[SUSPENSIONS_GET] Fetching suspensions for season:',
      seasonId,
      'age_group:',
      ageGroupId
    );

    // Get suspensions with relations
    const { data: suspensions, error } = await supabaseAnon
      .from('suspensions')
      .select(`
        id,
        season_id,
        age_group_id,
        player_id,
        team_id,
        total_points,
        point_sources,
        ban_matches,
        suspended_from_match_id,
        suspension_reason,
        created_at,
        player:player_id(id, full_name, shirt_no),
        team:team_id(id, name, short_name),
        match:suspended_from_match_id(id, matchday, home_team_id, away_team_id)
      `)
      .eq('season_id', seasonId)
      .eq('age_group_id', ageGroupId)
      .order('total_points', { ascending: false });

    if (error) {
      console.error('[SUSPENSIONS_GET] Query error:', error);
      return NextResponse.json(
        { error: `Failed to fetch suspensions: ${error.message}` },
        { status: 500 }
      );
    }

    console.log('[SUSPENSIONS_GET] Fetched', suspensions?.length || 0, 'suspensions');

    return NextResponse.json(suspensions || [], { status: 200 });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[SUSPENSIONS_GET] Error:', errorMsg);
    return NextResponse.json(
      { error: `Failed to fetch suspensions: ${errorMsg}` },
      { status: 500 }
    );
  }
}

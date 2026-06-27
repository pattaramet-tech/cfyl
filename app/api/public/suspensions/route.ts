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
        suspension_details,
        created_at,
        player:player_id(id, full_name, shirt_no),
        team:team_id(id, name, short_name)
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

    // Enrich suspensions with card details for display
    const enriched = await Promise.all(
      (suspensions || []).map(async (suspension) => {
        // Only fetch card details if player has cards to display
        if (!suspension.player_id || !suspension.season_id) {
          return suspension;
        }

        const { data: cards, error: cardsError } = await supabaseAnon
          .from('cards')
          .select(
            'id, card_type, minute, note, match_id, match:match_id(matchday, match_date, match_time)'
          )
          .eq('player_id', suspension.player_id)
          .order('match_id', { ascending: true });

        if (cardsError) {
          console.warn(
            '[SUSPENSIONS_GET] Failed to fetch cards for player',
            suspension.player_id,
            cardsError
          );
          return suspension;
        }

        return {
          ...suspension,
          card_details: cards || [],
        };
      })
    );

    return NextResponse.json(enriched, { status: 200 });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[SUSPENSIONS_GET] Error:', errorMsg);
    return NextResponse.json(
      { error: `Failed to fetch suspensions: ${errorMsg}` },
      { status: 500 }
    );
  }
}

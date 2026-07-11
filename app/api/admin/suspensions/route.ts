import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    console.log('[ADMIN_SUSPENSIONS_GET] Request received');

    // Require admin auth
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      console.warn('[ADMIN_SUSPENSIONS_GET] Auth failed:', authResult.error);
      return NextResponse.json(
        { error: authResult.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const seasonId = searchParams.get('seasonId');
    const ageGroupId = searchParams.get('ageGroupId');

    if (!seasonId || !ageGroupId) {
      return NextResponse.json(
        { error: 'seasonId and ageGroupId are required' },
        { status: 400 }
      );
    }

    console.log('[ADMIN_SUSPENSIONS_GET] Fetching for season:', seasonId, 'age_group:', ageGroupId);

    const { data: suspensions, error } = await supabaseAdmin
      .from('suspensions')
      .select(`
        id,
        season_id,
        age_group_id,
        player_id,
        team_id,
        total_points,
        ban_matches,
        suspension_type,
        trigger_match_id,
        accumulated_threshold,
        source_card_ids,
        serving_match_ids,
        served_completed_at,
        legacy_migrated,
        suspended_from_match_id,
        suspension_reason,
        suspension_details,
        point_sources,
        updated_at,
        player:player_id(id, full_name, shirt_no, player_code),
        team:team_id(id, name, short_name)
      `)
      .eq('season_id', seasonId)
      .eq('age_group_id', ageGroupId)
      .order('total_points', { ascending: false });

    if (error) {
      console.error('[ADMIN_SUSPENSIONS_GET] Query error:', error);
      return NextResponse.json(
        { error: `Failed to fetch suspensions: ${error.message}` },
        { status: 500 }
      );
    }

    console.log('[ADMIN_SUSPENSIONS_GET] Fetched', suspensions?.length || 0, 'records');
    return NextResponse.json(suspensions || [], { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ADMIN_SUSPENSIONS_GET] Error:', msg);
    return NextResponse.json(
      { error: `Failed to fetch suspensions: ${msg}` },
      { status: 500 }
    );
  }
}

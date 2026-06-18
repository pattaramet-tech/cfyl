import { NextRequest, NextResponse } from 'next/server';
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
    console.log('[PLAYERS_GET] Request received');

    // Get query params
    const { searchParams } = new URL(request.url);
    const teamIdsParam = searchParams.get('teamIds');

    if (!teamIdsParam) {
      return NextResponse.json(
        { error: 'teamIds parameter required (comma-separated)' },
        { status: 400 }
      );
    }

    // Parse team IDs
    const teamIds = teamIdsParam.split(',').filter((id) => id.trim());
    if (teamIds.length === 0) {
      return NextResponse.json(
        { error: 'At least one team ID required' },
        { status: 400 }
      );
    }

    console.log('[PLAYERS_GET] Fetching players for teams:', teamIds);

    // Get players filtered by teams
    const { data: players, error } = await supabaseAdmin
      .from('players')
      .select(`
        id,
        full_name,
        shirt_no,
        team_id,
        team:team_id(id, name, short_name)
      `)
      .in('team_id', teamIds)
      .order('full_name', { ascending: true });

    if (error) {
      console.error('[PLAYERS_GET] Query error:', error);
      return NextResponse.json(
        { error: `Failed to fetch players: ${error.message}` },
        { status: 500 }
      );
    }

    console.log('[PLAYERS_GET] Fetched', players?.length || 0, 'players');

    return NextResponse.json(players || [], { status: 200 });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[PLAYERS_GET] Error:', errorMsg);
    return NextResponse.json(
      { error: `Failed to fetch players: ${errorMsg}` },
      { status: 500 }
    );
  }
}

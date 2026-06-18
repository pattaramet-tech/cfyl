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
    console.log('[GOALS_GET] Request received');

    // Verify admin is authenticated
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      console.error('[GOALS_GET] Auth failed:', authResult.error);
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    // Get query params
    const { searchParams } = new URL(request.url);
    const matchId = searchParams.get('match_id');

    if (!matchId) {
      return NextResponse.json(
        { error: 'match_id parameter required' },
        { status: 400 }
      );
    }

    console.log('[GOALS_GET] Fetching goals for match:', matchId);

    // Get goals with player and team details
    const { data: goals, error } = await supabaseAdmin
      .from('goals')
      .select(`
        id,
        match_id,
        player_id,
        team_id,
        goals,
        created_at,
        updated_at,
        player:player_id(id, full_name, shirt_no),
        team:team_id(id, name, short_name)
      `)
      .eq('match_id', matchId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[GOALS_GET] Query error:', error);
      return NextResponse.json(
        { error: `Failed to fetch goals: ${error.message}` },
        { status: 500 }
      );
    }

    console.log('[GOALS_GET] Fetched', goals?.length || 0, 'goals');

    return NextResponse.json(goals || [], { status: 200 });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[GOALS_GET] Error:', errorMsg);
    return NextResponse.json(
      { error: `Failed to fetch goals: ${errorMsg}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('[GOALS_POST] Request received');

    // Verify admin is authenticated
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      console.error('[GOALS_POST] Auth failed:', authResult.error);
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    // Check permission
    if (!authResult.profile?.can_edit_goals) {
      console.warn('[GOALS_POST] Permission denied for:', authResult.profile?.email);
      return NextResponse.json(
        { error: 'You do not have permission to edit goals' },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { match_id, player_id, goals } = body;

    console.log('[GOALS_POST] Creating goal:', { match_id, player_id, goals });

    // Validate inputs
    if (!match_id || !player_id) {
      return NextResponse.json(
        { error: 'match_id and player_id are required' },
        { status: 400 }
      );
    }

    if (goals == null || typeof goals !== 'number' || goals < 1 || goals > 10) {
      return NextResponse.json(
        { error: 'goals must be a number between 1 and 10' },
        { status: 400 }
      );
    }

    // Get match to find teams and verify player is in match
    const { data: match, error: matchError } = await supabaseAdmin
      .from('matches')
      .select('id, home_team_id, away_team_id')
      .eq('id', match_id)
      .single();

    if (matchError || !match) {
      console.error('[GOALS_POST] Match not found:', match_id);
      return NextResponse.json(
        { error: 'Match not found' },
        { status: 404 }
      );
    }

    // Get player to verify they're in one of the match teams
    const { data: player, error: playerError } = await supabaseAdmin
      .from('players')
      .select('id, team_id, full_name')
      .eq('id', player_id)
      .single();

    if (playerError || !player) {
      console.error('[GOALS_POST] Player not found:', player_id);
      return NextResponse.json(
        { error: 'Player not found' },
        { status: 404 }
      );
    }

    // Verify player is in match's teams
    const playerInMatch = player.team_id === match.home_team_id || player.team_id === match.away_team_id;
    if (!playerInMatch) {
      console.warn('[GOALS_POST] Player not in match teams:', { player_id, match_id });
      return NextResponse.json(
        { error: 'Player is not in this match' },
        { status: 400 }
      );
    }

    // Create goal entry
    const { data: newGoal, error: createError } = await supabaseAdmin
      .from('goals')
      .insert({
        match_id,
        player_id,
        team_id: player.team_id,
        goals,
      })
      .select(`
        id,
        match_id,
        player_id,
        team_id,
        goals,
        created_at,
        updated_at,
        player:player_id(id, full_name, shirt_no),
        team:team_id(id, name, short_name)
      `)
      .single();

    if (createError) {
      console.error('[GOALS_POST] Create error:', createError);
      return NextResponse.json(
        { error: `Failed to create goal: ${createError.message}` },
        { status: 500 }
      );
    }

    console.log('[GOALS_POST] Goal created:', newGoal?.id);

    return NextResponse.json(
      {
        success: true,
        goal: newGoal,
      },
      { status: 201 }
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[GOALS_POST] Error:', errorMsg);
    return NextResponse.json(
      { error: `Failed to create goal: ${errorMsg}` },
      { status: 500 }
    );
  }
}

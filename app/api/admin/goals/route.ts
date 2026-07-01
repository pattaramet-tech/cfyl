import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
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
        minute,
        is_own_goal,
        note,
        created_at,
        updated_at,
        player:player_id(id, full_name, shirt_no, team_id, team:team_id(id, name, short_name)),
        team:team_id(id, name, short_name)
      `)
      .eq('match_id', matchId)
      .order('minute', { ascending: true, nullsFirst: false })
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
    const { match_id, player_id, team_id, goals, minute, is_own_goal, note } = body;

    console.log('[GOALS_POST] Creating goal:', { match_id, player_id, team_id, goals, minute, is_own_goal });

    // Validate inputs
    if (!match_id) {
      return NextResponse.json(
        { error: 'match_id is required' },
        { status: 400 }
      );
    }

    // Validate own goal vs normal goal
    const isOwnGoal = is_own_goal === true;
    if (isOwnGoal) {
      if (!team_id) {
        return NextResponse.json(
          { error: 'กรุณาเลือกทีมที่ได้รับประตูจาก Own Goal' },
          { status: 400 }
        );
      }
    } else {
      if (!player_id) {
        return NextResponse.json(
          { error: 'player_id is required for normal goals' },
          { status: 400 }
        );
      }
    }

    if (goals == null || typeof goals !== 'number' || goals < 1 || goals > 10) {
      return NextResponse.json(
        { error: 'goals must be a number between 1 and 10' },
        { status: 400 }
      );
    }

    // Validate minute
    const minuteValue =
      minute === undefined || minute === null || minute === ''
        ? null
        : Number(minute);

    if (
      minuteValue !== null &&
      (!Number.isInteger(minuteValue) || minuteValue < 0 || minuteValue > 120)
    ) {
      return NextResponse.json(
        { error: 'minute must be an integer between 0 and 120 or empty' },
        { status: 400 }
      );
    }

    // Get match to find teams
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

    let finalTeamId: string;
    let finalPlayerId: string | null = null;

    if (isOwnGoal) {
      // Own Goal: verify team_id is one of the match teams
      const teamIsInMatch = team_id === match.home_team_id || team_id === match.away_team_id;
      if (!teamIsInMatch) {
        console.warn('[GOALS_POST] Team not in match:', { team_id, match_id });
        return NextResponse.json(
          { error: 'Team is not in this match' },
          { status: 400 }
        );
      }
      finalTeamId = team_id;
    } else {
      // Normal goal: verify player is in match
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

      finalTeamId = player.team_id;
      finalPlayerId = player_id;
    }

    // Create goal entry
    const goalData = {
      match_id,
      player_id: finalPlayerId,
      team_id: finalTeamId,
      goals,
      minute: minuteValue,
      is_own_goal: isOwnGoal,
      note: note?.trim() || (isOwnGoal ? 'Own Goal' : null),
    };

    const { data: newGoal, error: createError } = await supabaseAdmin
      .from('goals')
      .insert(goalData)
      .select(`
        id,
        match_id,
        player_id,
        team_id,
        goals,
        minute,
        is_own_goal,
        note,
        created_at,
        updated_at,
        player:player_id(id, full_name, shirt_no, team_id, team:team_id(id, name, short_name)),
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

    const entityLabel = isOwnGoal
      ? `Own Goal (${goals}${minuteValue ? ` @ ${minuteValue}'` : ''})`
      : `Goal (${goals}${minuteValue ? ` @ ${minuteValue}'` : ''})`;

    await logAdminAction({
      admin: { id: authResult.profile!.id, email: authResult.profile!.email },
      action: 'goal.create',
      entityType: 'goal',
      entityId: newGoal?.id,
      entityLabel,
      newData: goalData,
    });

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

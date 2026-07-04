import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth, badRequestResponse, internalErrorResponse } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    const { matchId } = await params;

    // Verify admin is authenticated
    const authResult = await verifyAdminAuth(request);

    if (!authResult.authenticated || !authResult.profile) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check permission to edit matches
    if (!authResult.profile.can_edit_matches) {
      return NextResponse.json(
        { error: 'You do not have permission to edit matches' },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { home_score, away_score, status, winner_team_id, result_type } = body;

    // Validate inputs
    if (home_score == null || away_score == null) {
      return badRequestResponse('home_score and away_score are required');
    }

    if (typeof home_score !== 'number' || typeof away_score !== 'number') {
      return badRequestResponse('Scores must be numbers');
    }

    if (home_score < 0 || away_score < 0) {
      return badRequestResponse('Scores cannot be negative');
    }

    if (home_score > 99 || away_score > 99) {
      return badRequestResponse('Scores cannot exceed 99');
    }

    if (status && !['scheduled', 'finished', 'postponed', 'cancelled'].includes(status)) {
      return badRequestResponse('Invalid status');
    }

    const allowedResultTypes = ['normal', 'home_win_by_bye', 'away_win_by_bye'];
    if (result_type && !allowedResultTypes.includes(result_type)) {
      return badRequestResponse('Invalid result_type');
    }

    // Get current match
    const { data: currentMatch, error: getError } = await supabaseAdmin
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single();

    if (getError || !currentMatch) {
      return NextResponse.json(
        { error: 'Match not found' },
        { status: 404 }
      );
    }

    // winner_team_id (knockout draw / penalty decider) — must be one of the two teams or null
    let winnerUpdate: Record<string, unknown> = {};
    if (winner_team_id !== undefined) {
      if (winner_team_id && winner_team_id !== currentMatch.home_team_id && winner_team_id !== currentMatch.away_team_id) {
        return badRequestResponse('winner_team_id must be the home or away team');
      }
      winnerUpdate = { winner_team_id: winner_team_id || null };
    }

    // Update match
    // If bye result, force status to finished
    let finalStatus = status || currentMatch.status;
    if (result_type && result_type !== 'normal') {
      finalStatus = 'finished';
    }

    const { data: updatedMatch, error: updateError } = await supabaseAdmin
      .from('matches')
      .update({
        home_score,
        away_score,
        status: finalStatus,
        result_type: result_type || 'normal',
        ...winnerUpdate,
        updated_at: new Date().toISOString(),
      })
      .eq('id', matchId)
      .select()
      .single();

    if (updateError) {
      console.error('Update match error:', updateError);
      return internalErrorResponse('Failed to update match');
    }

    await logAdminAction({
      admin: { id: authResult.profile.id, email: authResult.profile.email },
      action: 'match.update_score',
      entityType: 'match',
      entityId: matchId,
      entityLabel: currentMatch.match_code || matchId,
      oldData: {
        home_score: currentMatch.home_score,
        away_score: currentMatch.away_score,
        status: currentMatch.status,
      },
      newData: { home_score, away_score, status: status || currentMatch.status },
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Match updated successfully',
        match: updatedMatch,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Update match error:', error);
    return internalErrorResponse('Failed to update match');
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    const { matchId } = await params;

    // Verify admin is authenticated
    const authResult = await verifyAdminAuth(request);

    if (!authResult.authenticated) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get match with team details
    const { data: match, error } = await supabaseAdmin
      .from('matches')
      .select(
        `
        *,
        home_team:home_team_id(name, short_name, logo_url),
        away_team:away_team_id(name, short_name, logo_url),
        division:division_id(name),
        goals(id, player_id, player:player_id(full_name, shirt_no), team:team_id(name), goals),
        cards(id, player_id, player:player_id(full_name, shirt_no), team:team_id(name), card_type)
      `
      )
      .eq('id', matchId)
      .single();

    if (error || !match) {
      return NextResponse.json(
        { error: 'Match not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(match, { status: 200 });
  } catch (error) {
    console.error('Get match error:', error);
    return internalErrorResponse('Failed to fetch match');
  }
}

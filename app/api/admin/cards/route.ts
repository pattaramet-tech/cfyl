import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { recalculatePlayerSuspension, getMatchDetails } from '@/lib/suspension-calc';
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
    console.log('[CARDS_GET] Request received');

    // Verify admin is authenticated
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      console.warn('[CARDS_GET] Auth failed:', authResult.error);
      return NextResponse.json(
        { error: authResult.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get query params
    const { searchParams } = new URL(request.url);
    const matchId = searchParams.get('matchId');

    if (!matchId) {
      return NextResponse.json(
        { error: 'matchId parameter required' },
        { status: 400 }
      );
    }

    console.log('[CARDS_GET] Fetching cards for match:', matchId);

    // Get cards with player and team relations
    const { data: cards, error } = await supabaseAdmin
      .from('cards')
      .select(`
        id,
        match_id,
        player_id,
        card_type,
        minute,
        created_at,
        player:player_id(id, full_name, shirt_no, team_id),
        match:match_id(id, matchday, home_team_id, away_team_id)
      `)
      .eq('match_id', matchId)
      .order('minute', { ascending: true });

    if (error) {
      console.error('[CARDS_GET] Query error:', error);
      return NextResponse.json(
        { error: `Failed to fetch cards: ${error.message}` },
        { status: 500 }
      );
    }

    console.log('[CARDS_GET] Fetched', cards?.length || 0, 'cards');

    return NextResponse.json(cards || [], { status: 200 });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[CARDS_GET] Error:', errorMsg);
    return NextResponse.json(
      { error: `Failed to fetch cards: ${errorMsg}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('[CARDS_POST] Request received');

    // Verify admin is authenticated
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      console.warn('[CARDS_POST] Auth failed:', authResult.error);
      return NextResponse.json(
        { error: authResult.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check permission
    if (!authResult.profile?.can_edit_cards) {
      console.warn('[CARDS_POST] No can_edit_cards permission');
      return NextResponse.json(
        { error: 'No permission to edit cards' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { matchId, playerId, cardType, minute } = body;

    // Validation
    if (!matchId || !playerId || !cardType || minute === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: matchId, playerId, cardType, minute' },
        { status: 400 }
      );
    }

    if (!['yellow', 'red', 'second_yellow'].includes(cardType)) {
      return NextResponse.json(
        { error: 'Invalid card_type. Must be: yellow, red, or second_yellow' },
        { status: 400 }
      );
    }

    if (typeof minute !== 'number' || minute < 0 || minute > 90) {
      return NextResponse.json(
        { error: 'Minute must be between 0 and 90' },
        { status: 400 }
      );
    }

    console.log('[CARDS_POST] Validating match exists:', matchId);

    // Verify match exists
    const { data: match, error: matchError } = await supabaseAdmin
      .from('matches')
      .select('id, season_id, age_group_id, home_team_id, away_team_id')
      .eq('id', matchId)
      .single();

    if (matchError || !match) {
      return NextResponse.json(
        { error: 'Match not found' },
        { status: 404 }
      );
    }

    console.log('[CARDS_POST] Validating player exists:', playerId);

    // Verify player exists
    const { data: player, error: playerError } = await supabaseAdmin
      .from('players')
      .select('id, team_id')
      .eq('id', playerId)
      .single();

    if (playerError || !player) {
      return NextResponse.json(
        { error: 'Player not found' },
        { status: 404 }
      );
    }

    // Verify player is in one of the match teams
    const playerTeamId = player.team_id;
    if (
      playerTeamId !== match.home_team_id &&
      playerTeamId !== match.away_team_id
    ) {
      return NextResponse.json(
        { error: 'Player does not belong to either team in this match' },
        { status: 400 }
      );
    }

    console.log('[CARDS_POST] Creating card');

    // Create card
    const { data: card, error: createError } = await supabaseAdmin
      .from('cards')
      .insert({
        match_id: matchId,
        player_id: playerId,
        team_id: playerTeamId,
        card_type: cardType,
        minute,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (createError) {
      console.error('[CARDS_POST] Insert error:', createError);
      return NextResponse.json(
        { error: `Failed to create card: ${createError.message}` },
        { status: 500 }
      );
    }

    console.log('[CARDS_POST] Card created:', card.id);

    // Recalculate suspension for this player
    console.log('[CARDS_POST] Recalculating suspension for player:', playerId);
    try {
      await recalculatePlayerSuspension(
        playerId,
        match.season_id,
        match.age_group_id,
        playerTeamId
      );
    } catch (calcError) {
      console.error('[CARDS_POST] Suspension calculation error:', calcError);
      // Don't fail the request if suspension calc fails
    }

    return NextResponse.json(card, { status: 201 });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[CARDS_POST] Error:', errorMsg);
    return NextResponse.json(
      { error: `Failed to create card: ${errorMsg}` },
      { status: 500 }
    );
  }
}

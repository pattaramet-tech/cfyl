import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
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

    // Get cards with player, team, and note
    const { data: cards, error } = await supabaseAdmin
      .from('cards')
      .select(`
        id,
        match_id,
        player_id,
        card_type,
        minute,
        note,
        created_at,
        player:player_id(id, full_name, shirt_no, team_id, team:team_id(name, short_name)),
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
  const timerTotal = `[CARDS_POST] Total request time`;
  console.time(timerTotal);

  try {
    console.log('[CARDS_POST] Request received');

    // Verify admin is authenticated
    const timerAuth = `[CARDS_POST] Auth check`;
    console.time(timerAuth);
    const authResult = await verifyAdminAuth(request);
    console.timeEnd(timerAuth);

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
    // Support both camelCase (new) and snake_case (legacy)
    const matchId = body.matchId ?? body.match_id;
    const playerId = body.playerId ?? body.player_id;
    const cardType = body.cardType ?? body.card_type;
    const minute = body.minute;
    const note = body.note;

    // Validation — minute is optional (null allowed)
    if (!matchId || !playerId || !cardType) {
      return NextResponse.json(
        { error: 'Missing required fields: matchId, playerId, cardType' },
        { status: 400 }
      );
    }

    if (!['yellow', 'red', 'second_yellow'].includes(cardType)) {
      return NextResponse.json(
        { error: 'Invalid card_type. Must be: yellow, red, or second_yellow' },
        { status: 400 }
      );
    }

    if (minute !== null && minute !== undefined) {
      if (typeof minute !== 'number' || minute < 0 || minute > 120) {
        return NextResponse.json(
          { error: 'Minute must be between 0 and 120' },
          { status: 400 }
        );
      }
    }

    // Verify match exists
    const timerMatch = `[CARDS_POST] Match validation`;
    console.time(timerMatch);
    const { data: match, error: matchError } = await supabaseAdmin
      .from('matches')
      .select('id, season_id, age_group_id, home_team_id, away_team_id')
      .eq('id', matchId)
      .single();
    console.timeEnd(timerMatch);

    if (matchError || !match) {
      return NextResponse.json(
        { error: 'Match not found' },
        { status: 404 }
      );
    }

    // Verify player exists
    const timerPlayer = `[CARDS_POST] Player validation`;
    console.time(timerPlayer);
    const { data: player, error: playerError } = await supabaseAdmin
      .from('players')
      .select('id, team_id')
      .eq('id', playerId)
      .single();
    console.timeEnd(timerPlayer);

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

    // Create card
    const timerInsert = `[CARDS_POST] Card insert`;
    console.time(timerInsert);
    const { data: card, error: createError } = await supabaseAdmin
      .from('cards')
      .insert({
        match_id: matchId,
        player_id: playerId,
        team_id: playerTeamId,
        card_type: cardType,
        minute: minute ?? null,
        note: note ?? null,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();
    console.timeEnd(timerInsert);

    if (createError) {
      console.error('[CARDS_POST] Insert error:', createError);
      return NextResponse.json(
        { error: `Failed to create card: ${createError.message}` },
        { status: 500 }
      );
    }

    // Recalculate suspension for this player
    const timerSuspension = `[CARDS_POST] Suspension recalculation`;
    console.time(timerSuspension);
    try {
      await recalculatePlayerSuspension(
        playerId,
        match.season_id,
        match.age_group_id,
        playerTeamId
      );
      console.timeEnd(timerSuspension);
    } catch (calcError) {
      console.timeEnd(timerSuspension);
      console.error('[CARDS_POST] Suspension calculation error:', calcError);
      // Don't fail the request if suspension calc fails
    }

    await logAdminAction({
      admin: { id: authResult.profile!.id, email: authResult.profile!.email },
      action: 'card.create',
      entityType: 'card',
      entityId: card?.id,
      entityLabel: cardType,
      newData: { match_id: matchId, player_id: playerId, team_id: playerTeamId, card_type: cardType, minute: minute ?? null },
    });

    console.timeEnd(timerTotal);
    return NextResponse.json(card, { status: 201 });
  } catch (error) {
    console.timeEnd(timerTotal);
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[CARDS_POST] Error:', errorMsg);
    return NextResponse.json(
      { error: `Failed to create card: ${errorMsg}` },
      { status: 500 }
    );
  }
}

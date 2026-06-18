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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) {
  try {
    const { cardId } = await params;
    console.log('[CARDS_PUT] Request for card:', cardId);

    // Verify admin is authenticated
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      console.warn('[CARDS_PUT] Auth failed:', authResult.error);
      return NextResponse.json(
        { error: authResult.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check permission
    if (!authResult.profile?.can_edit_cards) {
      console.warn('[CARDS_PUT] No can_edit_cards permission');
      return NextResponse.json(
        { error: 'No permission to edit cards' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { cardType, minute } = body;

    // Validation
    if (!cardType && minute === undefined) {
      return NextResponse.json(
        { error: 'At least one field required: cardType or minute' },
        { status: 400 }
      );
    }

    if (cardType && !['yellow', 'red', 'second_yellow'].includes(cardType)) {
      return NextResponse.json(
        { error: 'Invalid card_type. Must be: yellow, red, or second_yellow' },
        { status: 400 }
      );
    }

    if (minute !== undefined && (typeof minute !== 'number' || minute < 0 || minute > 90)) {
      return NextResponse.json(
        { error: 'Minute must be between 0 and 90' },
        { status: 400 }
      );
    }

    console.log('[CARDS_PUT] Fetching existing card');

    // Get existing card
    const { data: existingCard, error: fetchError } = await supabaseAdmin
      .from('cards')
      .select('id, match_id, player_id, card_type, minute')
      .eq('id', cardId)
      .single();

    if (fetchError || !existingCard) {
      return NextResponse.json(
        { error: 'Card not found' },
        { status: 404 }
      );
    }

    console.log('[CARDS_PUT] Updating card');

    // Update card
    const { data: updatedCard, error: updateError } = await supabaseAdmin
      .from('cards')
      .update({
        card_type: cardType || existingCard.card_type,
        minute: minute !== undefined ? minute : existingCard.minute,
        updated_at: new Date().toISOString(),
      })
      .eq('id', cardId)
      .select()
      .single();

    if (updateError) {
      console.error('[CARDS_PUT] Update error:', updateError);
      return NextResponse.json(
        { error: `Failed to update card: ${updateError.message}` },
        { status: 500 }
      );
    }

    console.log('[CARDS_PUT] Card updated:', cardId);

    // Recalculate suspension for this player
    try {
      const match = await getMatchDetails(existingCard.match_id);
      const { data: player } = await supabaseAdmin
        .from('players')
        .select('team_id')
        .eq('id', existingCard.player_id)
        .single();

      if (match && player) {
        await recalculatePlayerSuspension(
          existingCard.player_id,
          match.season_id,
          match.age_group_id,
          player.team_id
        );
      }
    } catch (calcError) {
      console.error('[CARDS_PUT] Suspension calculation error:', calcError);
    }

    return NextResponse.json(updatedCard, { status: 200 });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[CARDS_PUT] Error:', errorMsg);
    return NextResponse.json(
      { error: `Failed to update card: ${errorMsg}` },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) {
  try {
    const { cardId } = await params;
    console.log('[CARDS_DELETE] Request for card:', cardId);

    // Verify admin is authenticated
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      console.warn('[CARDS_DELETE] Auth failed:', authResult.error);
      return NextResponse.json(
        { error: authResult.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check permission
    if (!authResult.profile?.can_edit_cards) {
      console.warn('[CARDS_DELETE] No can_edit_cards permission');
      return NextResponse.json(
        { error: 'No permission to edit cards' },
        { status: 403 }
      );
    }

    console.log('[CARDS_DELETE] Fetching card before deletion');

    // Get card before deleting (for suspension recalc)
    const { data: card, error: fetchError } = await supabaseAdmin
      .from('cards')
      .select('id, match_id, player_id')
      .eq('id', cardId)
      .single();

    if (fetchError || !card) {
      return NextResponse.json(
        { error: 'Card not found' },
        { status: 404 }
      );
    }

    console.log('[CARDS_DELETE] Deleting card');

    // Delete card
    const { error: deleteError } = await supabaseAdmin
      .from('cards')
      .delete()
      .eq('id', cardId);

    if (deleteError) {
      console.error('[CARDS_DELETE] Delete error:', deleteError);
      return NextResponse.json(
        { error: `Failed to delete card: ${deleteError.message}` },
        { status: 500 }
      );
    }

    console.log('[CARDS_DELETE] Card deleted:', cardId);

    // Recalculate suspension for this player
    try {
      const match = await getMatchDetails(card.match_id);
      const { data: player } = await supabaseAdmin
        .from('players')
        .select('team_id')
        .eq('id', card.player_id)
        .single();

      if (match && player) {
        await recalculatePlayerSuspension(
          card.player_id,
          match.season_id,
          match.age_group_id,
          player.team_id
        );
      }
    } catch (calcError) {
      console.error('[CARDS_DELETE] Suspension calculation error:', calcError);
    }

    return NextResponse.json(
      { message: 'Card deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[CARDS_DELETE] Error:', errorMsg);
    return NextResponse.json(
      { error: `Failed to delete card: ${errorMsg}` },
      { status: 500 }
    );
  }
}

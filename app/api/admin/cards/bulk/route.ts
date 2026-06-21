import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
import { recalculatePlayerSuspension } from '@/lib/suspension-calc';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const dynamic = 'force-dynamic';

const VALID_CARD_TYPES = ['yellow', 'red', 'second_yellow'] as const;

interface BulkCardItem {
  playerId: string;
  cardType: string;
  minute?: number | null;
  reason?: string | null;
}

export async function POST(request: NextRequest) {
  try {
    console.log('[CARDS_BULK_POST] Request received');

    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    if (!authResult.profile?.can_edit_cards) {
      return NextResponse.json({ error: 'No permission to edit cards' }, { status: 403 });
    }

    const body = await request.json();
    const { matchId, items } = body as { matchId: string; items: BulkCardItem[] };

    if (!matchId) {
      return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items must be a non-empty array' }, { status: 400 });
    }

    console.log(`[CARDS_BULK_POST] match=${matchId} items=${items.length}`);

    // Validate match exists
    const { data: match, error: matchError } = await supabaseAdmin
      .from('matches')
      .select('id, season_id, age_group_id, home_team_id, away_team_id')
      .eq('id', matchId)
      .single();

    if (matchError || !match) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    }

    const validTeamIds = new Set([match.home_team_id, match.away_team_id]);

    // Validate items
    const validationErrors: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (!item.playerId) {
        validationErrors.push(`แถวที่ ${i + 1}: ต้องเลือกผู้เล่น`);
        continue;
      }

      if (!VALID_CARD_TYPES.includes(item.cardType as typeof VALID_CARD_TYPES[number])) {
        validationErrors.push(`แถวที่ ${i + 1}: card_type ไม่ถูกต้อง`);
        continue;
      }

      if (item.minute != null) {
        const min = Number(item.minute);
        if (isNaN(min) || min < 0 || min > 90) {
          validationErrors.push(`แถวที่ ${i + 1}: minute ต้องอยู่ระหว่าง 0–90`);
        }
      }
    }

    if (validationErrors.length > 0) {
      return NextResponse.json({ error: validationErrors.join('; '), errors: validationErrors }, { status: 400 });
    }

    // Fetch all referenced players in one query
    const playerIds = [...new Set(items.map((i) => i.playerId))];
    const { data: players, error: playerError } = await supabaseAdmin
      .from('players')
      .select('id, team_id, full_name')
      .in('id', playerIds);

    if (playerError) {
      return NextResponse.json({ error: 'Failed to fetch players' }, { status: 500 });
    }

    const playerMap = new Map(
      (players || []).map((p: { id: string; team_id: string; full_name: string }) => [p.id, p])
    );

    // Validate each player belongs to this match
    const playerErrors: string[] = [];
    for (const playerId of playerIds) {
      const player = playerMap.get(playerId);
      if (!player) {
        playerErrors.push(`ไม่พบผู้เล่น id=${playerId}`);
        continue;
      }
      if (!validTeamIds.has(player.team_id)) {
        playerErrors.push(`${player.full_name} ไม่ใช่ผู้เล่นของทีมในแมตช์นี้`);
      }
    }

    if (playerErrors.length > 0) {
      return NextResponse.json({ error: playerErrors.join('; '), errors: playerErrors }, { status: 400 });
    }

    // Build insert records
    const inserts = items.map((item) => {
      const player = playerMap.get(item.playerId)!;
      return {
        match_id: matchId,
        player_id: item.playerId,
        team_id: player.team_id,
        card_type: item.cardType,
        minute: item.minute != null ? Number(item.minute) : null,
        note: item.reason?.trim() || null,
        created_at: new Date().toISOString(),
      };
    });

    console.log(`[CARDS_BULK_POST] Inserting ${inserts.length} card(s)`);

    const { data: created, error: insertError } = await supabaseAdmin
      .from('cards')
      .insert(inserts)
      .select(`
        id, match_id, player_id, team_id, card_type, minute, note,
        player:player_id(id, full_name, shirt_no)
      `);

    if (insertError) {
      console.error('[CARDS_BULK_POST] Insert error:', insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    console.log(`[CARDS_BULK_POST] Created ${created?.length} cards`);

    // Recalculate suspensions for all distinct players — after all inserts
    const suspensionWarnings: string[] = [];

    for (const playerId of playerIds) {
      const player = playerMap.get(playerId)!;
      try {
        await recalculatePlayerSuspension(
          playerId,
          match.season_id,
          match.age_group_id,
          player.team_id
        );
        console.log(`[CARDS_BULK_POST] Suspension recalculated for player=${playerId}`);
      } catch (calcError) {
        const msg = calcError instanceof Error ? calcError.message : String(calcError);
        console.error(`[CARDS_BULK_POST] Suspension calc error for player=${playerId}:`, msg);
        suspensionWarnings.push(`${player.full_name}: ${msg}`);
      }
    }

    await logAdminAction({
      admin: { id: authResult.profile!.id, email: authResult.profile!.email },
      action: 'card.bulk_create',
      entityType: 'card',
      entityId: matchId,
      entityLabel: `${created?.length ?? 0} cards / ${playerIds.length} players`,
      newData: { match_id: matchId, players: playerIds.length, created: created?.length ?? 0 },
    });

    return NextResponse.json(
      {
        success: true,
        created: created?.length ?? 0,
        items: created,
        suspensionWarnings: suspensionWarnings.length > 0 ? suspensionWarnings : undefined,
      },
      { status: 201 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[CARDS_BULK_POST] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

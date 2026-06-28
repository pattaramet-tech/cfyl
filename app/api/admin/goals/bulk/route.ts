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

interface BulkGoalItem {
  playerId: string;
  goals: number;
  minute?: number | null;
}

export async function POST(request: NextRequest) {
  try {
    console.log('[GOALS_BULK_POST] Request received');

    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    if (!authResult.profile?.can_edit_goals) {
      return NextResponse.json({ error: 'No permission to edit goals' }, { status: 403 });
    }

    const body = await request.json();
    const { matchId, items } = body as { matchId: string; items: BulkGoalItem[] };

    if (!matchId) {
      return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items must be a non-empty array' }, { status: 400 });
    }

    console.log(`[GOALS_BULK_POST] match=${matchId} items=${items.length}`);

    // Validate match exists
    const { data: match, error: matchError } = await supabaseAdmin
      .from('matches')
      .select('id, home_team_id, away_team_id')
      .eq('id', matchId)
      .single();

    if (matchError || !match) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    }

    const validTeamIds = new Set([match.home_team_id, match.away_team_id]);

    // Validate items (no merge — each row = 1 record)
    const errors: string[] = [];
    const validItems: Array<{ playerId: string; goals: number; minute?: number | null }> = [];
    const playerIdSet = new Set<string>();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (!item.playerId) {
        errors.push(`แถวที่ ${i + 1}: ต้องเลือกผู้เล่น`);
        continue;
      }

      const goals = Number(item.goals);
      if (isNaN(goals) || goals < 1 || goals > 10) {
        errors.push(`แถวที่ ${i + 1}: goals ต้องอยู่ระหว่าง 1–10`);
        continue;
      }

      // Validate minute if provided
      if (item.minute != null) {
        const m = Number(item.minute);
        if (!Number.isInteger(m) || m < 0 || m > 120) {
          errors.push(`แถวที่ ${i + 1}: นาทีต้องเป็นตัวเลข 0-120`);
          continue;
        }
      }

      validItems.push({
        playerId: item.playerId,
        goals,
        minute: item.minute ?? null,
      });
      playerIdSet.add(item.playerId);
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join('; '), errors }, { status: 400 });
    }

    // Fetch all referenced players in one query
    const playerIds = Array.from(playerIdSet);
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

    // Build insert records — each item = 1 record (no merge)
    const inserts: { match_id: string; player_id: string; team_id: string; goals: number; minute?: number | null }[] = [];

    for (const item of validItems) {
      const player = playerMap.get(item.playerId)!;
      inserts.push({
        match_id: matchId,
        player_id: item.playerId,
        team_id: player.team_id,
        goals: item.goals,
        minute: item.minute,
      });
    }

    console.log(`[GOALS_BULK_POST] Inserting ${inserts.length} goal record(s)`);

    const { data: created, error: insertError } = await supabaseAdmin
      .from('goals')
      .insert(inserts)
      .select(`
        id, match_id, player_id, team_id, goals, minute,
        player:player_id(id, full_name, shirt_no),
        team:team_id(id, name, short_name)
      `);

    if (insertError) {
      console.error('[GOALS_BULK_POST] Insert error:', insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    console.log(`[GOALS_BULK_POST] Created ${created?.length} records`);

    await logAdminAction({
      admin: { id: authResult.profile!.id, email: authResult.profile!.email },
      action: 'goal.bulk_create',
      entityType: 'goal',
      entityId: matchId,
      entityLabel: `${created?.length ?? 0} records`,
      newData: { match_id: matchId, created: created?.length ?? 0 },
    });

    return NextResponse.json(
      {
        success: true,
        created: created?.length ?? 0,
        items: created,
      },
      { status: 201 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[GOALS_BULK_POST] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

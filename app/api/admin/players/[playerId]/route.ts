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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ playerId: string }> }
) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    const { playerId } = await params;

    const { data: player, error } = await supabaseAdmin
      .from('players')
      .select(`
        id, player_code, shirt_no, full_name, birth_date, remarks, active,
        season_id, age_group_id, division_id, team_id,
        team:team_id(id, name, short_name)
      `)
      .eq('id', playerId)
      .single();

    if (error || !player) {
      return NextResponse.json({ error: 'ไม่พบข้อมูลผู้เล่น' }, { status: 404 });
    }

    // Count goals and cards
    const [{ count: goalsCount }, { count: cardsCount }] = await Promise.all([
      supabaseAdmin.from('goals').select('id', { count: 'exact', head: true }).eq('player_id', playerId),
      supabaseAdmin.from('cards').select('id', { count: 'exact', head: true }).eq('player_id', playerId),
    ]);

    return NextResponse.json({ ...player, goals_count: goalsCount || 0, cards_count: cardsCount || 0 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[PLAYERS_ID_GET] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ playerId: string }> }
) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    const { playerId } = await params;
    const body = await request.json();
    const { player_code, full_name, shirt_no, team_id, birth_date, remarks, active } = body;

    console.log(`[PLAYERS_ID_PUT] Updating player=${playerId}`);

    // Fetch existing player
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('players')
      .select('id, player_code, season_id, age_group_id, division_id')
      .eq('id', playerId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'ไม่พบข้อมูลผู้เล่น' }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    // Validate and set player_code if changed
    if (player_code !== undefined) {
      const trimmedCode = player_code.trim();
      if (trimmedCode !== existing.player_code) {
        const { data: codeConflict } = await supabaseAdmin
          .from('players')
          .select('id, full_name')
          .eq('season_id', existing.season_id)
          .eq('player_code', trimmedCode)
          .neq('id', playerId)
          .maybeSingle();

        if (codeConflict) {
          return NextResponse.json(
            { error: `PlayerID "${trimmedCode}" มีในระบบแล้ว (${codeConflict.full_name})` },
            { status: 409 }
          );
        }
      }
      updates.player_code = trimmedCode;
    }

    if (full_name !== undefined) updates.full_name = full_name.trim();
    if (shirt_no !== undefined) updates.shirt_no = shirt_no ? Number(shirt_no) : null;
    if (birth_date !== undefined) updates.birth_date = birth_date || null;
    if (remarks !== undefined) updates.remarks = remarks?.trim() || null;
    if (active !== undefined) updates.active = Boolean(active);

    // If team changes, update division_id from the new team
    if (team_id !== undefined) {
      const { data: newTeam, error: teamError } = await supabaseAdmin
        .from('teams')
        .select('id, division_id')
        .eq('id', team_id)
        .single();

      if (teamError || !newTeam) {
        return NextResponse.json({ error: 'ไม่พบทีมที่ระบุ' }, { status: 404 });
      }

      updates.team_id = team_id;
      updates.division_id = newTeam.division_id;
    }

    const { data: player, error } = await supabaseAdmin
      .from('players')
      .update(updates)
      .eq('id', playerId)
      .select(`
        id, player_code, shirt_no, full_name, birth_date, remarks, active,
        season_id, age_group_id, division_id, team_id,
        team:team_id(id, name, short_name)
      `)
      .single();

    if (error) {
      console.error('[PLAYERS_ID_PUT] Update error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[PLAYERS_ID_PUT] Updated player=${playerId} active=${player.active}`);
    return NextResponse.json(player);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[PLAYERS_ID_PUT] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ playerId: string }> }
) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    const { playerId } = await params;

    console.log(`[PLAYERS_ID_DELETE] Deleting player=${playerId}`);

    // Check if player has any goals or cards
    const [{ count: goalsCount }, { count: cardsCount }] = await Promise.all([
      supabaseAdmin.from('goals').select('id', { count: 'exact', head: true }).eq('player_id', playerId),
      supabaseAdmin.from('cards').select('id', { count: 'exact', head: true }).eq('player_id', playerId),
    ]);

    if ((goalsCount ?? 0) > 0 || (cardsCount ?? 0) > 0) {
      return NextResponse.json(
        {
          error: `ไม่สามารถลบได้ — ผู้เล่นมีประวัติ ${goalsCount} ประตู และ ${cardsCount} ใบ กรุณาปิดการใช้งานแทน`,
          has_records: true,
          goals_count: goalsCount,
          cards_count: cardsCount,
        },
        { status: 409 }
      );
    }

    const { error } = await supabaseAdmin
      .from('players')
      .delete()
      .eq('id', playerId);

    if (error) {
      console.error('[PLAYERS_ID_DELETE] Delete error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[PLAYERS_ID_DELETE] Deleted player=${playerId}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[PLAYERS_ID_DELETE] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

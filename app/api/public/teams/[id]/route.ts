import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const teamId = id;

    if (!teamId) {
      return NextResponse.json({ error: 'Team ID required' }, { status: 400 });
    }

    // Fetch team with metadata
    const { data: team, error: teamError } = await supabaseAdmin
      .from('teams')
      .select(
        `
        *,
        division:division_id(id, name),
        age_group:age_group_id(id, code, name),
        season:season_id(id, name, year)
      `
      )
      .eq('id', teamId)
      .maybeSingle();

    if (teamError) {
      console.error('[PUBLIC_TEAM_PROFILE] Team query error:', teamError);
      return NextResponse.json(
        { error: 'ไม่สามารถโหลดข้อมูลทีมได้' },
        { status: 500 }
      );
    }

    if (!team) {
      return NextResponse.json({ error: 'ไม่พบทีมนี้' }, { status: 404 });
    }

    // Fetch players
    const { data: players, error: playersError } = await supabaseAdmin
      .from('players')
      .select('id, full_name, shirt_no, position, team_id')
      .eq('team_id', teamId)
      .order('shirt_no', { ascending: true, nullsFirst: false })
      .order('full_name', { ascending: true });

    if (playersError) {
      console.error('[PUBLIC_TEAM_PROFILE] Players fetch error:', playersError);
    }

    // Fetch matches for this team
    const { data: matches, error: matchesError } = await supabaseAdmin
      .from('matches')
      .select(
        `
        *,
        home_team:home_team_id(id, name, short_name, logo_url),
        away_team:away_team_id(id, name, short_name, logo_url),
        division:division_id(id, name)
      `
      )
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .order('match_date', { ascending: true })
      .order('match_time', { ascending: true });

    if (matchesError) {
      console.error('[PUBLIC_TEAM_PROFILE] Matches fetch error:', matchesError);
    }

    // Fetch goals for this team
    const { data: goals, error: goalsError } = await supabaseAdmin
      .from('goals')
      .select(
        `
        id,
        match_id,
        player_id,
        team_id,
        goals,
        minute,
        is_own_goal,
        note,
        created_at,
        player:player_id(id, full_name, shirt_no),
        team:team_id(id, name, short_name)
      `
      )
      .eq('team_id', teamId);

    if (goalsError) {
      console.error('[PUBLIC_TEAM_PROFILE] Goals fetch error:', goalsError);
    }

    // Fetch cards for this team
    const { data: cards, error: cardsError } = await supabaseAdmin
      .from('cards')
      .select(
        `
        id,
        player_id,
        team_id,
        card_type,
        minute,
        note,
        created_at,
        player:player_id(id, full_name, shirt_no, team_id),
        match:match_id(id, matchday, match_date, status)
      `
      )
      .eq('team_id', teamId);

    if (cardsError) {
      console.error('[PUBLIC_TEAM_PROFILE] Cards fetch error:', cardsError);
    }

    // Fetch suspensions for players in this team
    const playerIds = (players || []).map((p: any) => p.id).filter(Boolean);
    const { data: suspensions, error: suspensionsError } = playerIds.length
      ? await supabaseAdmin
          .from('suspensions')
          .select(`
            id,
            player_id,
            total_points,
            ban_matches,
            status,
            reason,
            created_at,
            updated_at,
            player:player_id(id, full_name, shirt_no, team_id)
          `)
          .in('player_id', playerIds)
          .neq('status', 'completed')
      : { data: [], error: null };

    if (suspensionsError) {
      console.error('[PUBLIC_TEAM_PROFILE] Suspensions fetch error:', suspensionsError);
    }

    // Normalize suspensions response with player names
    const suspensionsWithPlayer = (suspensions || []).map((s: any) => ({
      id: s.id,
      player_id: s.player_id,
      player_name: s.player?.full_name || null,
      shirt_no: s.player?.shirt_no ?? null,
      total_points: s.total_points ?? 0,
      ban_matches: s.ban_matches ?? 0,
      status: s.status || 'active',
      reason: s.reason || null,
      created_at: s.created_at,
      updated_at: s.updated_at,
    }));

    console.log('[PUBLIC_TEAM_PROFILE] Result counts:', {
      teamId,
      players: players?.length || 0,
      matches: matches?.length || 0,
      goals: goals?.length || 0,
      cards: cards?.length || 0,
      suspensions: suspensionsWithPlayer?.length || 0,
    });

    return NextResponse.json({
      team,
      players: players || [],
      matches: matches || [],
      goals: goals || [],
      cards: cards || [],
      suspensions: suspensionsWithPlayer || [],
    });
  } catch (error) {
    console.error('[PUBLIC_TEAM_PROFILE] API error:', error);
    return NextResponse.json(
      { error: 'ไม่สามารถโหลดข้อมูลทีมได้' },
      { status: 500 }
    );
  }
}

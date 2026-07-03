import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const dynamic = 'force-dynamic';

// Normalize relation array or single object
function normalizeRelation<T = any>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

// Add or merge player into map
function addPlayerToMap(map: Map<string, any>, player: any) {
  if (!player?.id) return;

  const existing = map.get(player.id);

  map.set(player.id, {
    id: player.id,
    full_name: player.full_name || existing?.full_name || 'ไม่ทราบชื่อ',
    shirt_no: player.shirt_no ?? existing?.shirt_no ?? null,
    position: player.position ?? existing?.position ?? null,
    team_id: player.team_id || existing?.team_id || null,
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const teamId = id;
    const debug = request.nextUrl.searchParams.get('debug') === '1';

    if (!teamId) {
      return NextResponse.json({ error: 'Team ID required' }, { status: 400 });
    }

    const errorLogs: Record<string, string | null> = {};

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
      .select('id, full_name, shirt_no, team_id')
      .eq('team_id', teamId)
      .order('shirt_no', { ascending: true, nullsFirst: false })
      .order('full_name', { ascending: true });

    if (playersError) {
      errorLogs.players = playersError.message;
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
      errorLogs.matches = matchesError.message;
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
        player:player_id(id, full_name, shirt_no, team_id),
        team:team_id(id, name, short_name)
      `
      )
      .eq('team_id', teamId);

    if (goalsError) {
      errorLogs.goals = goalsError.message;
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
      errorLogs.cards = cardsError.message;
      console.error('[PUBLIC_TEAM_PROFILE] Cards fetch error:', cardsError);
    }

    // Merge players from direct query + goals + cards relations (fallback if team_id link is broken)
    const playersMap = new Map<string, any>();

    // Add from direct players query
    (players || []).forEach((p: any) => addPlayerToMap(playersMap, p));

    // Add from goals player relation (exclude own goals)
    (goals || []).forEach((g: any) => {
      if (g.is_own_goal) return;
      const player = normalizeRelation(g.player);
      addPlayerToMap(playersMap, player);
    });

    // Add from cards player relation
    (cards || []).forEach((c: any) => {
      const player = normalizeRelation(c.player);
      addPlayerToMap(playersMap, player);
    });

    const mergedPlayers = Array.from(playersMap.values()).sort((a, b) => {
      const shirtA = a.shirt_no ?? 9999;
      const shirtB = b.shirt_no ?? 9999;
      if (shirtA !== shirtB) return shirtA - shirtB;
      return String(a.full_name || '').localeCompare(String(b.full_name || ''), 'th');
    });

    // Fetch suspensions for players in this team (using merged players)
    const playerIds = mergedPlayers.map((p: any) => p.id).filter(Boolean);

    const suspensionSelector = `
      id,
      player_id,
      team_id,
      total_points,
      ban_matches,
      status,
      suspended_from_match_id,
      suspension_reason,
      suspension_details,
      created_at,
      updated_at,
      player:player_id(id, full_name, shirt_no, team_id)
    `;

    // Query suspensions by player_id
    const { data: suspensionsByPlayers, error: suspensionsByPlayersError } = playerIds.length
      ? await supabaseAdmin
          .from('suspensions')
          .select(suspensionSelector)
          .in('player_id', playerIds)
      : { data: [], error: null };

    if (suspensionsByPlayersError) {
      errorLogs.suspensions = suspensionsByPlayersError.message;
      console.error('[PUBLIC_TEAM_PROFILE] Suspensions by players fetch error:', suspensionsByPlayersError);
    }

    // Query suspensions by team_id (fallback for data consistency)
    const { data: suspensionsByTeam, error: suspensionsByTeamError } = await supabaseAdmin
      .from('suspensions')
      .select(suspensionSelector)
      .eq('team_id', teamId);

    if (suspensionsByTeamError) {
      errorLogs.suspensionsByTeam = suspensionsByTeamError.message;
      console.error('[PUBLIC_TEAM_PROFILE] Suspensions by team fetch error:', suspensionsByTeamError);
    }

    // Merge and dedupe suspensions from both queries
    const suspensionMap = new Map<string, any>();
    [...(suspensionsByPlayers || []), ...(suspensionsByTeam || [])].forEach((s: any) => {
      if (!s?.id) return;
      suspensionMap.set(s.id, s);
    });

    const suspensions = Array.from(suspensionMap.values());

    // Filter active suspensions (exclude completed and those with no bans)
    const activeSuspensions = (suspensions || []).filter((s: any) => {
      const status = s.status || 'active';

      // Skip completed suspensions
      if (status === 'completed') return false;

      // Include if has active bans/points
      const banMatches = Number(s.ban_matches || 0);
      const totalPoints = Number(s.total_points || 0);

      return banMatches > 0 || totalPoints >= 6;
    });

    // Normalize suspensions response with player names and all details
    const suspensionsWithPlayer = activeSuspensions.map((s: any) => ({
      id: s.id,
      player_id: s.player_id,
      team_id: s.team_id,
      player_name: s.player?.full_name || null,
      shirt_no: s.player?.shirt_no ?? null,
      total_points: Number(s.total_points || 0),
      ban_matches: Number(s.ban_matches || 0),
      status: s.status || 'active',
      suspension_reason: s.suspension_reason || null,
      suspended_from_match_id: s.suspended_from_match_id || null,
      suspension_details: s.suspension_details || null,
      created_at: s.created_at,
      updated_at: s.updated_at,
    }));

    console.log('[PUBLIC_TEAM_PROFILE] Result counts:', {
      teamId,
      directPlayers: players?.length || 0,
      mergedPlayers: mergedPlayers.length,
      matches: matches?.length || 0,
      goals: goals?.length || 0,
      cards: cards?.length || 0,
      playerIds: playerIds.length,
      rawSuspensions: suspensions.length,
      activeSuspensions: suspensionsWithPlayer?.length || 0,
    });

    const responsePayload: any = {
      team,
      players: mergedPlayers,
      matches: matches || [],
      goals: goals || [],
      cards: cards || [],
      suspensions: suspensionsWithPlayer || [],
    };

    if (debug) {
      responsePayload.debug = {
        teamId,
        directPlayersCount: players?.length || 0,
        mergedPlayersCount: mergedPlayers.length,
        errors: {
          players: errorLogs.players || null,
          matches: errorLogs.matches || null,
          goals: errorLogs.goals || null,
          cards: errorLogs.cards || null,
          suspensions: errorLogs.suspensions || null,
        },
      };
    }

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('[PUBLIC_TEAM_PROFILE] API error:', error);
    return NextResponse.json(
      { error: 'ไม่สามารถโหลดข้อมูลทีมได้' },
      { status: 500 }
    );
  }
}

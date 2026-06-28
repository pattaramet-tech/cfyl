import { supabase } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

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
    const { data: team, error: teamError } = await supabase
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
    const { data: players, error: playersError } = await supabase
      .from('players')
      .select('id, full_name, shirt_no, position, team_id')
      .eq('team_id', teamId)
      .order('shirt_no', { ascending: true });

    if (playersError) {
      console.error('[PUBLIC_TEAM_PROFILE] Players fetch error:', playersError);
    }

    // Fetch matches for this team
    const { data: matches, error: matchesError } = await supabase
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
    const { data: goals, error: goalsError } = await supabase
      .from('goals')
      .select(
        `
        *,
        player:player_id(id, full_name, shirt_no),
        team:team_id(id, name, short_name)
      `
      )
      .eq('team_id', teamId);

    if (goalsError) {
      console.error('[PUBLIC_TEAM_PROFILE] Goals fetch error:', goalsError);
    }

    // Fetch cards for this team
    const { data: cards, error: cardsError } = await supabase
      .from('cards')
      .select(
        `
        *,
        player:player_id(id, full_name, shirt_no),
        match:match_id(id, matchday, match_date, status)
      `
      )
      .eq('team_id', teamId);

    if (cardsError) {
      console.error('[PUBLIC_TEAM_PROFILE] Cards fetch error:', cardsError);
    }

    // Fetch suspensions for players in this team
    const { data: suspensions, error: suspensionsError } = await supabase
      .from('suspensions')
      .select('*')
      .in(
        'player_id',
        players?.map((p) => p.id) || []
      );

    if (suspensionsError) {
      console.error('[PUBLIC_TEAM_PROFILE] Suspensions fetch error:', suspensionsError);
    }

    return NextResponse.json({
      team,
      players: players || [],
      matches: matches || [],
      goals: goals || [],
      cards: cards || [],
      suspensions: suspensions || [],
    });
  } catch (error) {
    console.error('[PUBLIC_TEAM_PROFILE] API error:', error);
    return NextResponse.json(
      { error: 'ไม่สามารถโหลดข้อมูลทีมได้' },
      { status: 500 }
    );
  }
}

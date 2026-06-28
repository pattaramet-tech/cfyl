import { supabase } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const matchId = id;

    if (!matchId) {
      return NextResponse.json({ error: 'Match ID required' }, { status: 400 });
    }

    // Fetch match
    const { data: match, error: matchError } = await supabase
      .from('matches')
      .select(
        `
        *,
        home_team:home_team_id(id, name, short_name, logo_url),
        away_team:away_team_id(id, name, short_name, logo_url),
        division:division_id(id, name),
        season:season_id(id, name, year),
        age_group:age_group_id(id, code, name)
      `
      )
      .eq('id', matchId)
      .single();

    if (matchError || !match) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    }

    // Fetch goals for this match
    const { data: goals, error: goalsError } = await supabase
      .from('goals')
      .select(
        `
        *,
        player:player_id(id, full_name, shirt_no),
        team:team_id(id, name, short_name)
      `
      )
      .eq('match_id', matchId);

    // Fetch cards for this match
    const { data: cards, error: cardsError } = await supabase
      .from('cards')
      .select(
        `
        *,
        player:player_id(id, full_name, shirt_no, team_id),
        match:match_id(id, matchday, home_team_id, away_team_id)
      `
      )
      .eq('match_id', matchId);

    if (goalsError) {
      console.error('Goals fetch error:', goalsError);
    }
    if (cardsError) {
      console.error('Cards fetch error:', cardsError);
    }

    return NextResponse.json({
      match,
      goals: goals || [],
      cards: cards || [],
    });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Failed to fetch match details' }, { status: 500 });
  }
}

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

    // Fetch match (without optional relations to avoid join errors)
    const { data: match, error: matchError } = await supabase
      .from('matches')
      .select(
        `
        *,
        home_team:home_team_id(id, name, short_name, logo_url),
        away_team:away_team_id(id, name, short_name, logo_url),
        division:division_id(id, name)
      `
      )
      .eq('id', matchId)
      .maybeSingle();

    if (matchError) {
      console.error('[PUBLIC_MATCH_DETAIL] Match query error:', matchError);
      return NextResponse.json(
        { error: 'ไม่สามารถโหลดข้อมูลแมตช์ได้' },
        { status: 500 }
      );
    }

    if (!match) {
      return NextResponse.json({ error: 'ไม่พบแมตช์นี้' }, { status: 404 });
    }

    // Fetch optional metadata (season, age_group)
    let season = null;
    let age_group = null;

    if (match.season_id) {
      const { data: seasonData } = await supabase
        .from('seasons')
        .select('id, name, year')
        .eq('id', match.season_id)
        .maybeSingle();
      season = seasonData;
    }

    if (match.age_group_id) {
      const { data: ageGroupData } = await supabase
        .from('age_groups')
        .select('id, code, name')
        .eq('id', match.age_group_id)
        .maybeSingle();
      age_group = ageGroupData;
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
      console.error('[PUBLIC_MATCH_DETAIL] Goals fetch error:', goalsError);
    }
    if (cardsError) {
      console.error('[PUBLIC_MATCH_DETAIL] Cards fetch error:', cardsError);
    }

    const matchWithMeta = {
      ...match,
      season,
      age_group,
    };

    return NextResponse.json({
      match: matchWithMeta,
      goals: goals || [],
      cards: cards || [],
    });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Failed to fetch match details' }, { status: 500 });
  }
}

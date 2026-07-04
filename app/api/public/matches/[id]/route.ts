import { supabase } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

function isSuspendedForMatch(suspension: any, matchId: string): boolean {
  if (suspension.suspended_from_match_id === matchId) return true;

  const suspendedMatches = suspension.suspension_details?.suspended_matches;
  if (Array.isArray(suspendedMatches)) {
    return suspendedMatches.some((m: any) => m.match_id === matchId);
  }

  return false;
}

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
        player:player_id(id, full_name, shirt_no, team_id, team:team_id(id, name, short_name)),
        team:team_id(id, name, short_name),
        match:match_id(id, matchday, home_team_id, away_team_id)
      `
      )
      .eq('match_id', matchId);

    // Fetch staff discipline events for this match
    const { data: staffDisciplineEvents, error: staffDisciplineError } = await supabase
      .from('staff_discipline_events')
      .select(
        `
        *,
        staff:staff_id(id, full_name, position),
        team:team_id(id, name, short_name)
      `
      )
      .eq('match_id', matchId)
      .eq('status', 'active');

    // Fetch suspensions for players in this match's teams (using service role to bypass RLS)
    const { data: suspensions, error: suspensionsError } = await supabaseAdmin
      .from('suspensions')
      .select(
        `
        id,
        season_id,
        age_group_id,
        player_id,
        team_id,
        total_points,
        ban_matches,
        suspended_from_match_id,
        suspension_reason,
        suspension_details,
        player:player_id(id, full_name, shirt_no, team_id),
        team:team_id(id, name, short_name)
      `
      )
      .eq('season_id', match.season_id)
      .eq('age_group_id', match.age_group_id)
      .in('team_id', [match.home_team_id, match.away_team_id])
      .gt('ban_matches', 0);

    if (goalsError) {
      console.error('[PUBLIC_MATCH_DETAIL] Goals fetch error:', goalsError);
    }
    if (cardsError) {
      console.error('[PUBLIC_MATCH_DETAIL] Cards fetch error:', cardsError);
    }
    if (staffDisciplineError) {
      console.error('[PUBLIC_MATCH_DETAIL] Staff discipline fetch error:', staffDisciplineError);
    }
    if (suspensionsError) {
      console.error('[PUBLIC_MATCH_DETAIL] Suspensions fetch error:', suspensionsError);
    }

    const matchWithMeta = {
      ...match,
      season,
      age_group,
    };

    // Filter suspended players for this match
    const suspendedPlayers = (suspensions || []).filter((s) =>
      isSuspendedForMatch(s, match.id)
    );

    return NextResponse.json({
      match: matchWithMeta,
      goals: goals || [],
      cards: cards || [],
      staff_discipline_events: staffDisciplineEvents || [],
      suspended_players: suspendedPlayers,
    });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Failed to fetch match details' }, { status: 500 });
  }
}

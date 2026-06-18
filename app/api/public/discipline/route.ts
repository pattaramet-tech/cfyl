import { supabase } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export const revalidate = 600; // Cache for 10 minutes

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const seasonId = searchParams.get('seasonId');
    const ageGroupId = searchParams.get('ageGroupId');
    const divisionId = searchParams.get('divisionId');

    if (!seasonId) {
      return NextResponse.json({ error: 'Missing seasonId parameter' }, { status: 400 });
    }

    // Get all cards
    let query = supabase
      .from('cards')
      .select(
        `
        id,
        match_id,
        player_id,
        player:player_id(full_name, shirt_no, player_code, team_id),
        team:team_id(name),
        card_type,
        unit
      `
      );

    if (seasonId) {
      query = query.eq('player.season_id', seasonId);
    }

    const { data: cards, error: cardsError } = await query;

    if (cardsError) throw cardsError;

    // Aggregate cards by player
    const disciplineMap = new Map<string, any>();

    cards?.forEach((record: any) => {
      const key = record.player_id;
      if (!disciplineMap.has(key)) {
        disciplineMap.set(key, {
          player_id: record.player_id,
          player_code: record.player.player_code,
          full_name: record.player.full_name,
          shirt_no: record.player.shirt_no,
          team_id: record.player.team_id,
          team_name: record.team.name,
          yellow_cards: 0,
          red_cards: 0,
          total_cards: 0,
        });
      }

      const player = disciplineMap.get(key);
      if (record.card_type === 'Yellow') {
        player.yellow_cards += record.unit;
      } else if (record.card_type === 'Red') {
        player.red_cards += record.unit;
      }
      player.total_cards += record.unit;
    });

    let discipline = Array.from(disciplineMap.values());

    // Filter by age group and division if needed
    if (ageGroupId && divisionId) {
      const { data: playerIds } = await supabase
        .from('players')
        .select('id')
        .eq('age_group_id', ageGroupId)
        .eq('division_id', divisionId);

      const playerIdSet = new Set(playerIds?.map(p => p.id) || []);
      discipline = discipline.filter(d => playerIdSet.has(d.player_id));
    }

    // Sort by total cards (desc), red cards (desc)
    discipline.sort((a, b) => {
      if (b.total_cards !== a.total_cards) return b.total_cards - a.total_cards;
      if (b.red_cards !== a.red_cards) return b.red_cards - a.red_cards;
      return a.full_name.localeCompare(b.full_name);
    });

    // Add suspension info
    const { data: suspensions } = await supabase
      .from('suspensions')
      .select('player_id, suspended_matches, status')
      .eq('season_id', seasonId);

    const suspensionMap = new Map<string, any>();
    suspensions?.forEach(s => {
      if (s.status === 'pending') {
        suspensionMap.set(s.player_id, s);
      }
    });

    discipline = discipline.map(d => ({
      ...d,
      matches_banned: suspensionMap.has(d.player_id) ? suspensionMap.get(d.player_id).suspended_matches : 0,
    }));

    return NextResponse.json(discipline);
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Failed to fetch discipline records' }, { status: 500 });
  }
}

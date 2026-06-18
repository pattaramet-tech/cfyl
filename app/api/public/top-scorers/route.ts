import { supabase } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const seasonId = searchParams.get('seasonId');
    const ageGroupId = searchParams.get('ageGroupId');
    const divisionId = searchParams.get('divisionId');
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    let query = supabase
      .from('goals')
      .select(
        `
        player_id,
        player:player_id(player_code, full_name, shirt_no, team_id),
        team:team_id(name),
        goals
      `
      );

    if (seasonId) {
      query = query.eq('player.season_id', seasonId);
    }

    const { data: rawData, error } = await query;

    if (error) throw error;

    // Transform and aggregate
    const scorerMap = new Map<string, any>();

    rawData?.forEach((record: any) => {
      const key = record.player_id;
      if (!scorerMap.has(key)) {
        scorerMap.set(key, {
          player_id: record.player_id,
          player_code: record.player.player_code,
          full_name: record.player.full_name,
          shirt_no: record.player.shirt_no,
          team_id: record.player.team_id,
          team_name: record.team.name,
          total_goals: 0,
        });
      }
      scorerMap.get(key).total_goals += record.goals;
    });

    let scorers = Array.from(scorerMap.values());

    // Filter by age group and division if needed
    if (ageGroupId && divisionId) {
      const { data: playerIds } = await supabase
        .from('players')
        .select('id')
        .eq('age_group_id', ageGroupId)
        .eq('division_id', divisionId);

      const playerIdSet = new Set(playerIds?.map(p => p.id) || []);
      scorers = scorers.filter(s => playerIdSet.has(s.player_id));
    }

    // Sort by goals (desc), name (asc)
    scorers.sort((a, b) => {
      if (b.total_goals !== a.total_goals) return b.total_goals - a.total_goals;
      return a.full_name.localeCompare(b.full_name);
    });

    // Apply limit
    scorers = scorers.slice(0, limit);

    return NextResponse.json(scorers);
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Failed to fetch top scorers' }, { status: 500 });
  }
}

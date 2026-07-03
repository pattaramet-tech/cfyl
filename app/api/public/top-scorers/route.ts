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
        is_own_goal,
        player:player_id(player_code, full_name, shirt_no, team_id, season_id, age_group_id, division_id),
        team:team_id(name, short_name),
        goals
      `
      )
      .eq('is_own_goal', false)
      .not('player_id', 'is', null);

    const { data: rawData, error } = await query;

    if (error) throw error;

    // Filter records before aggregation
    const filteredRecords = (rawData || []).filter((record: any) => {
      // Skip if player or own goal issue
      if (!record.player_id || record.is_own_goal || !record.player) {
        return false;
      }

      // Filter by season (from player data)
      if (seasonId && record.player.season_id !== seasonId) {
        return false;
      }

      // Filter by age group (from player data)
      if (ageGroupId && record.player.age_group_id !== ageGroupId) {
        return false;
      }

      // Filter by division (from player data)
      if (divisionId && record.player.division_id !== divisionId) {
        return false;
      }

      return true;
    });

    // Transform and aggregate from filtered records
    const scorerMap = new Map<string, any>();

    filteredRecords.forEach((record: any) => {
      const key = record.player_id;
      if (!scorerMap.has(key)) {
        scorerMap.set(key, {
          player_id: record.player_id,
          player_code: record.player.player_code || '',
          full_name: record.player.full_name || 'ไม่ระบุชื่อ',
          shirt_no: record.player.shirt_no,
          team_id: record.player.team_id,
          team_name: record.team?.name || record.team?.short_name || 'ไม่ระบุทีม',
          total_goals: 0,
        });
      }
      scorerMap.get(key).total_goals += Number(record.goals || 1);
    });

    let scorers = Array.from(scorerMap.values());

    // Sort by goals (desc), name (asc)
    scorers.sort((a, b) => {
      if (b.total_goals !== a.total_goals) return b.total_goals - a.total_goals;
      return a.full_name.localeCompare(b.full_name);
    });

    // Apply limit
    scorers = scorers.slice(0, limit);

    return NextResponse.json(scorers);
  } catch (error) {
    console.error('[PUBLIC_TOP_SCORERS] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch top scorers' },
      { status: 500 }
    );
  }
}

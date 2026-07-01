import { supabase } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const seasonId = searchParams.get('seasonId');
    const ageGroupId = searchParams.get('ageGroupId');
    const divisionId = searchParams.get('divisionId');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 500);

    let query = supabase
      .from('match_bulk_import_batches')
      .select(
        `
        id,
        batch_no,
        file_name,
        import_mode,
        season_id,
        age_group_id,
        division_id,
        status,
        summary,
        warnings_count,
        errors_count,
        matches_updated,
        goals_inserted,
        cards_inserted,
        staff_discipline_inserted,
        players_updated,
        suspensions_recalculated,
        affected_match_ids,
        affected_player_ids,
        affected_team_ids,
        created_by_email,
        created_at,
        season:season_id(name),
        age_group:age_group_id(name),
        division:division_id(name)
      `,
        { count: 'exact' }
      );

    if (seasonId) {
      query = query.eq('season_id', seasonId);
    }

    if (ageGroupId) {
      query = query.eq('age_group_id', ageGroupId);
    }

    if (divisionId) {
      query = query.eq('division_id', divisionId);
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[MATCH_BULK_HISTORY] Query error:', error);
      // If table doesn't exist, return empty list (graceful degradation)
      if (error.message.includes('match_bulk_import_batches')) {
        return NextResponse.json({
          data: [],
          count: 0,
          error: 'Batch log table does not exist. Please run SQL migration.',
        });
      }
      return NextResponse.json(
        { error: 'Failed to load history' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: data || [],
      count: count || 0,
    });
  } catch (error) {
    console.error('[MATCH_BULK_HISTORY] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load import history' },
      { status: 500 }
    );
  }
}

import { supabase } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await params;

    if (!batchId) {
      return NextResponse.json(
        { error: 'batchId required' },
        { status: 400 }
      );
    }

    // Fetch batch header
    const { data: batch, error: batchError } = await supabase
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
      `
      )
      .eq('id', batchId)
      .maybeSingle();

    if (batchError) {
      console.error('[MATCH_BULK_HISTORY_DETAIL] Batch query error:', batchError);
      if (batchError.message.includes('match_bulk_import_batches')) {
        return NextResponse.json(
          { error: 'Batch log table does not exist' },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: 'Failed to load batch' },
        { status: 500 }
      );
    }

    if (!batch) {
      return NextResponse.json(
        { error: 'Batch not found' },
        { status: 404 }
      );
    }

    // Fetch batch rows
    const { data: rows, error: rowsError } = await supabase
      .from('match_bulk_import_batch_rows')
      .select('*')
      .eq('batch_id', batchId)
      .order('sheet_name', { ascending: true })
      .order('row_number', { ascending: true });

    if (rowsError) {
      console.error('[MATCH_BULK_HISTORY_DETAIL] Rows query error:', rowsError);
    }

    return NextResponse.json({
      batch,
      rows: rows || [],
    });
  } catch (error) {
    console.error('[MATCH_BULK_HISTORY_DETAIL] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load batch details' },
      { status: 500 }
    );
  }
}

import { supabase } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import { BulkImportRowResult, BulkImportApplyResponse } from '@/types/bulk-import';
import { recalculatePlayerSuspensionEventBased } from '@/lib/suspension-calc';
import { generateImportBatchNo } from '@/lib/bulk-import-utils';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { seasonId, ageGroupId, divisionId, rows } = body;

    if (!seasonId || !ageGroupId || !rows || !Array.isArray(rows)) {
      return NextResponse.json(
        { error: 'seasonId, ageGroupId, rows จำเป็น' },
        { status: 400 }
      );
    }

    // Check for errors
    const hasErrors = rows.some((r: BulkImportRowResult) => r.status === 'error');
    if (hasErrors) {
      return NextResponse.json(
        { error: 'มี error rows ที่ต้องแก้ก่อน' },
        { status: 400 }
      );
    }

    const errors: Array<{ sheet: string; rowNumber: number; message: string }> = [];
    const affectedPlayersForSuspension = new Set<string>();

    let matchesUpdated = 0;
    let goalsInserted = 0;
    let cardsInserted = 0;
    let staffDisciplineInserted = 0;
    let playersUpdated = 0;

    // Group rows by sheet
    const rowsBySheet = rows.reduce(
      (acc: any, row: BulkImportRowResult) => {
        if (!acc[row.sheet]) acc[row.sheet] = [];
        acc[row.sheet].push(row);
        return acc;
      },
      {}
    );

    // 1. Apply PlayerUpdates first
    if (rowsBySheet['PlayerUpdates']) {
      for (const row of rowsBySheet['PlayerUpdates']) {
        if (row.status === 'error') continue;

        try {
          const { player_id, full_name, shirt_no, active } = row.resolved || {};
          if (!player_id) throw new Error('player_id missing');

          const updatePayload: any = {};
          if (full_name) updatePayload.full_name = full_name;
          if (shirt_no !== undefined && shirt_no !== null) updatePayload.shirt_no = shirt_no;
          if (active !== undefined && active !== null) updatePayload.active = active;

          if (Object.keys(updatePayload).length > 0) {
            await supabase.from('players').update(updatePayload).eq('id', player_id);
            playersUpdated++;
          }
        } catch (err) {
          errors.push({
            sheet: 'PlayerUpdates',
            rowNumber: row.rowNumber,
            message: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }

    // 2. Apply Matches
    if (rowsBySheet['Matches']) {
      for (const row of rowsBySheet['Matches']) {
        if (row.status === 'error') continue;

        try {
          const { match_id, home_score, away_score, status } = row.resolved || {};
          if (!match_id) throw new Error('match_id missing');

          const updatePayload: any = {};
          if (home_score !== undefined && home_score !== null) updatePayload.home_score = home_score;
          if (away_score !== undefined && away_score !== null) updatePayload.away_score = away_score;
          if (status) updatePayload.status = status;

          if (Object.keys(updatePayload).length > 0) {
            await supabase.from('matches').update(updatePayload).eq('id', match_id);
            matchesUpdated++;
          }
        } catch (err) {
          errors.push({
            sheet: 'Matches',
            rowNumber: row.rowNumber,
            message: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }

    // 3. Apply Goals
    if (rowsBySheet['Goals']) {
      for (const row of rowsBySheet['Goals']) {
        if (row.status === 'error') continue;

        try {
          const { match_id, player_id, team_id, goals, minute } = row.resolved || {};
          if (!match_id || !player_id || !team_id) throw new Error('Required fields missing');

          // Insert goal record
          await supabase.from('goals').insert({
            match_id,
            player_id,
            team_id,
            goals: goals || 1,
            minute: minute || null,
          });

          goalsInserted++;
        } catch (err) {
          errors.push({
            sheet: 'Goals',
            rowNumber: row.rowNumber,
            message: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }

    // 4. Apply Cards
    if (rowsBySheet['Cards']) {
      for (const row of rowsBySheet['Cards']) {
        if (row.status === 'error') continue;

        try {
          const { match_id, player_id, team_id, card_type, minute, count } = row.resolved || {};
          if (!match_id || !player_id || !team_id || !card_type) throw new Error('Required fields missing');

          // Insert card records according to count
          const cardCount = count || 1;
          for (let i = 0; i < cardCount; i++) {
            await supabase.from('cards').insert({
              match_id,
              player_id,
              team_id,
              card_type,
              minute: minute || null,
            });
            cardsInserted++;
          }

          affectedPlayersForSuspension.add(player_id);
        } catch (err) {
          errors.push({
            sheet: 'Cards',
            rowNumber: row.rowNumber,
            message: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }

    // 5. Apply StaffDiscipline
    if (rowsBySheet['StaffDiscipline']) {
      for (const row of rowsBySheet['StaffDiscipline']) {
        if (row.status === 'error') continue;

        try {
          const { match_id, staff_id, team_id, discipline_type, minute, reason, suspended_matches } =
            row.resolved || {};
          if (!match_id || !staff_id || !team_id || !discipline_type) throw new Error('Required fields missing');

          await supabase.from('staff_discipline_events').insert({
            match_id,
            staff_id,
            team_id,
            discipline_type,
            minute: minute || null,
            reason: reason || null,
            status: 'active',
          });

          staffDisciplineInserted++;
        } catch (err) {
          errors.push({
            sheet: 'StaffDiscipline',
            rowNumber: row.rowNumber,
            message: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }

    // 6. Recalculate suspensions for affected players
    if (affectedPlayersForSuspension.size > 0) {
      const playerIds = Array.from(affectedPlayersForSuspension);
      const playersData = await supabase
        .from('players')
        .select('id, team_id')
        .in('id', playerIds)
        .then(({ data }) => data || []);

      for (const player of playersData) {
        try {
          await recalculatePlayerSuspensionEventBased(player.id, seasonId, ageGroupId, player.team_id);
        } catch (err) {
          console.error(`[MATCH_BULK_APPLY] Failed to recalculate suspension for player ${player.id}:`, err);
        }
      }
    }

    // Record batch log
    let batchId: string | null = null;
    let batchNo: string | null = null;
    let logWarning: string | null = null;

    try {
      const batchNo_ = generateImportBatchNo();
      const batchStatus =
        errors.length > 0 && (matchesUpdated > 0 || goalsInserted > 0 || cardsInserted > 0 || staffDisciplineInserted > 0 || playersUpdated > 0)
          ? 'partial'
          : errors.length > 0
            ? 'failed'
            : 'success';

      const warningCount = rows.filter((r) => r.status === 'warning').length;

      const { data: batch, error: batchError } = await supabase
        .from('match_bulk_import_batches')
        .insert({
          batch_no: batchNo_,
          file_name: body.fileName || null,
          import_mode: 'append_only',
          season_id: seasonId,
          age_group_id: ageGroupId,
          division_id: divisionId || null,
          status: batchStatus,
          summary: {
            totalRows: rows.length,
            successCount: rows.filter((r) => r.status === 'success').length,
            warningCount,
            failedCount: errors.length,
          },
          warnings_count: warningCount,
          errors_count: errors.length,
          matches_updated: matchesUpdated,
          goals_inserted: goalsInserted,
          cards_inserted: cardsInserted,
          staff_discipline_inserted: staffDisciplineInserted,
          players_updated: playersUpdated,
          suspensions_recalculated: affectedPlayersForSuspension.size,
          affected_match_ids: [],
          affected_player_ids: Array.from(affectedPlayersForSuspension),
          affected_team_ids: [],
          created_by_email: null,
        } as any)
        .select('id, batch_no')
        .single();

      if (batchError) {
        console.error('[MATCH_BULK_APPLY] Batch insert error:', batchError);
        if (batchError.message.includes('match_bulk_import_batches')) {
          logWarning =
            'Import applied but batch log could not be saved (table does not exist yet). Please run SQL migration.';
        }
      } else if (batch) {
        batchId = batch.id;
        batchNo = batch.batch_no;

        // Insert batch rows if log was created
        if (rows.length > 0) {
          const batchRows = rows.map((row) => ({
            batch_id: batch.id,
            sheet_name: row.sheet,
            row_number: row.rowNumber,
            action: row.action,
            status: row.status,
            message: row.message || null,
            raw_data: row.raw || {},
            resolved_data: row.resolved || {},
            error: null,
            entity_type: null,
            entity_id: null,
            match_id: null,
            player_id: null,
            team_id: null,
          }));

          const { error: rowsInsertError } = await supabase
            .from('match_bulk_import_batch_rows')
            .insert(batchRows as any);

          if (rowsInsertError) {
            console.error('[MATCH_BULK_APPLY] Batch rows insert error:', rowsInsertError);
          }
        }
      }
    } catch (err) {
      console.error('[MATCH_BULK_APPLY] Batch log error:', err);
      logWarning = 'Batch log creation failed but import was applied';
    }

    const response: BulkImportApplyResponse = {
      success: errors.length === 0,
      message:
        errors.length === 0
          ? `นำเข้าข้อมูลสำเร็จ`
          : `นำเข้าข้อมูลจบ แต่มี ${errors.length} row ที่ล้มเหลว`,
      summary: {
        matchesUpdated,
        goalsInserted,
        cardsInserted,
        staffDisciplineInserted,
        playersUpdated,
        affectedPlayersForSuspension: Array.from(affectedPlayersForSuspension),
      },
      errors,
      ...(batchId && { batchId }),
      ...(batchNo && { batchNo }),
      ...(logWarning && { logWarning }),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[MATCH_BULK_APPLY] Error:', error);
    return NextResponse.json(
      { error: 'ไม่สามารถ apply ได้', details: error instanceof Error ? error.message : '' },
      { status: 500 }
    );
  }
}

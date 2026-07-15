import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
import { logTournamentAdminAction } from '@/lib/tournament/services/audit';
import {
  buildDrawSelectedConfigs,
  DRAW_SELECTED_SOURCE_TYPE,
  validateDrawSelectedSourceRef,
} from '@/lib/tournament/scheduling/drawSelected';
import { resolveScheduleSourceTeamId } from '@/lib/tournament/scheduling/resolveScheduleSource';
import {
  courtKey,
  groupKey,
  groupSlotKey,
  teamKey,
  type NormalizedScheduleImportRow,
} from '@/lib/tournament/scheduling/validateScheduleImportRow';

export const dynamic = 'force-dynamic';

interface SaveRequestBody {
  batchId?: unknown;
}

interface BatchRow {
  id: string;
  tournament_id: string;
  file_name: string | null;
  status: string;
  total_rows: number;
  valid_rows: number;
  warning_rows: number;
  error_rows: number;
}

interface StoredPayload {
  normalized?: NormalizedScheduleImportRow;
}

interface ImportRow {
  id: string;
  row_no: number;
  status: 'valid' | 'warning' | 'error';
  action: 'create' | 'update' | 'skip' | null;
  match_code: string | null;
  raw_payload: StoredPayload;
  messages: unknown;
}

interface CategoryRow {
  id: string;
  code: string;
}

interface VenueRow {
  id: string;
  code: string;
}

interface CourtRow {
  id: string;
  venue_id: string;
  code: string;
}

interface GroupRow {
  id: string;
  category_id: string;
  code: string;
}

interface GroupMemberRow {
  group_id: string;
  slot_code: string;
  team_id: string | null;
}

interface TeamRow {
  id: string;
  category_id: string;
  team_code: string;
}

interface QualificationRuleRow {
  category_id: string;
  best_third_placed_count: number;
  best_third_placed_method: string;
}

interface DrawSelectedRuleConfig {
  categoryId: string;
  categoryCode: string;
  bestThirdPlacedCount: number;
  bestThirdPlacedMethod: string;
}

interface ExistingMatchRow {
  id: string;
  match_code: string;
  version: number | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_source_type: string | null;
  home_source_ref: string | null;
  away_source_type: string | null;
  away_source_ref: string | null;
  sources_resolved_at: string | null;
}

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

function upper(value: string): string {
  return value.trim().toUpperCase();
}

export async function POST(request: NextRequest) {
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  let body: SaveRequestBody;
  try {
    body = (await request.json()) as SaveRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const batchId = asText(body.batchId);
  if (!batchId) {
    return NextResponse.json({ error: 'batchId is required' }, { status: 400 });
  }

  try {
    const client = getTournamentServiceClient();
    const { data: batchData, error: batchError } = await client
      .from('tournament_schedule_batches')
      .select('id, tournament_id, file_name, status, total_rows, valid_rows, warning_rows, error_rows')
      .eq('id', batchId)
      .eq('batch_type', 'fixture_import')
      .maybeSingle();

    if (batchError) {
      console.error('[SCHEDULE_IMPORT_SAVE] batch query failed:', batchError.message);
      return NextResponse.json({ error: 'โหลด Import Batch ไม่สำเร็จ' }, { status: 500 });
    }
    if (!batchData) {
      return NextResponse.json({ error: 'ไม่พบ Import Batch' }, { status: 404 });
    }

    const batch = batchData as BatchRow;
    if (batch.status !== 'preview') {
      return NextResponse.json(
        { error: batch.status === 'saved' ? 'Import Batch นี้ถูกบันทึกไปแล้ว' : 'Import Batch นี้ไม่พร้อมบันทึก' },
        { status: 409 }
      );
    }

    const [
      rowsResult,
      categoriesResult,
      venuesResult,
      courtsResult,
      groupsResult,
      membersResult,
      teamsResult,
      qualificationRulesResult,
    ] =
      await Promise.all([
        client
          .from('tournament_schedule_import_rows')
          .select('id, row_no, status, action, match_code, raw_payload, messages')
          .eq('batch_id', batchId)
          .order('row_no', { ascending: true }),
        client
          .from('tournament_categories')
          .select('id, code')
          .eq('tournament_id', batch.tournament_id)
          .is('deleted_at', null),
        client
          .from('tournament_venues')
          .select('id, code')
          .eq('tournament_id', batch.tournament_id),
        client.from('tournament_courts').select('id, venue_id, code'),
        client
          .from('tournament_groups')
          .select('id, category_id, code')
          .eq('tournament_id', batch.tournament_id),
        client.from('tournament_group_members').select('group_id, slot_code, team_id'),
        client
          .from('tournament_teams')
          .select('id, category_id, team_code')
          .eq('tournament_id', batch.tournament_id),
        client
          .from('tournament_qualification_rules')
          .select('category_id, best_third_placed_count, best_third_placed_method')
          .eq('tournament_id', batch.tournament_id),
      ]);

    const queryError = [
      rowsResult.error,
      categoriesResult.error,
      venuesResult.error,
      courtsResult.error,
      groupsResult.error,
      membersResult.error,
      teamsResult.error,
      qualificationRulesResult.error,
    ].find(Boolean);

    if (queryError) {
      console.error('[SCHEDULE_IMPORT_SAVE] reference query failed:', queryError.message);
      return NextResponse.json({ error: 'โหลดข้อมูลสำหรับบันทึกไม่สำเร็จ' }, { status: 500 });
    }

    const importRows = (rowsResult.data || []) as ImportRow[];
    const categories = (categoriesResult.data || []) as CategoryRow[];
    const venues = (venuesResult.data || []) as VenueRow[];
    const venueIds = new Set(venues.map((venue) => venue.id));
    const groups = (groupsResult.data || []) as GroupRow[];
    const groupIds = new Set(groups.map((group) => group.id));
    const qualificationRules = ((qualificationRulesResult.data || []) as QualificationRuleRow[])
      .map((rule) => {
        const category = categories.find((entry) => entry.id === rule.category_id);
        return category
          ? {
              categoryId: rule.category_id,
              categoryCode: category.code,
              bestThirdPlacedCount: rule.best_third_placed_count,
              bestThirdPlacedMethod: rule.best_third_placed_method,
            }
          : null;
      })
      .filter((rule): rule is DrawSelectedRuleConfig => rule !== null);
    const {
      configsByRef: drawSelectedConfigsByRef,
      configsByCategoryCode: drawSelectedConfigsByCategoryCode,
    } = buildDrawSelectedConfigs(qualificationRules);

    const categoriesByCode = new Map(categories.map((category) => [upper(category.code), category]));
    const venuesByCode = new Map(venues.map((venue) => [upper(venue.code), venue]));
    const courtsByVenueAndCode = new Map<string, CourtRow>();
    ((courtsResult.data || []) as CourtRow[])
      .filter((court) => venueIds.has(court.venue_id))
      .forEach((court) => courtsByVenueAndCode.set(courtKey(court.venue_id, court.code), court));

    const groupsByCategoryAndCode = new Map<string, GroupRow>();
    groups.forEach((group) => groupsByCategoryAndCode.set(groupKey(group.category_id, group.code), group));

    const groupMembersBySlot = new Map<string, GroupMemberRow>();
    ((membersResult.data || []) as GroupMemberRow[])
      .filter((member) => groupIds.has(member.group_id))
      .forEach((member) =>
        groupMembersBySlot.set(groupSlotKey(member.group_id, member.slot_code), member)
      );

    const teamsByCategoryAndCode = new Map<string, TeamRow>();
    ((teamsResult.data || []) as TeamRow[]).forEach((team) =>
      teamsByCategoryAndCode.set(teamKey(team.category_id, team.team_code), team)
    );

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const failures: Array<{ row: number; match_code: string | null; error: string }> = [];

    for (const importRow of importRows) {
      if (importRow.status === 'error' || importRow.action === 'skip') {
        skipped += 1;
        continue;
      }

      const normalized = importRow.raw_payload?.normalized;
      if (!normalized) {
        failed += 1;
        failures.push({ row: importRow.row_no, match_code: importRow.match_code, error: 'ไม่พบ normalized payload' });
        continue;
      }

      const category = categoriesByCode.get(upper(normalized.category_code));
      const venue = venuesByCode.get(upper(normalized.venue_code));
      if (!category || !venue) {
        failed += 1;
        failures.push({ row: importRow.row_no, match_code: importRow.match_code, error: 'Category หรือ Venue ไม่พร้อมใช้งาน' });
        continue;
      }

      const court = normalized.court_code
        ? courtsByVenueAndCode.get(courtKey(venue.id, normalized.court_code))
        : undefined;
      const group = normalized.group_code
        ? groupsByCategoryAndCode.get(groupKey(category.id, normalized.group_code))
        : undefined;

      const { data: existingData, error: existingError } = await client
        .from('tournament_matches')
        .select(
          'id, match_code, version, home_team_id, away_team_id, home_source_type, home_source_ref, away_source_type, away_source_ref, sources_resolved_at'
        )
        .eq('tournament_id', batch.tournament_id)
        .eq('match_code', normalized.match_code)
        .is('deleted_at', null)
        .maybeSingle();

      if (existingError) {
        failed += 1;
        failures.push({ row: importRow.row_no, match_code: normalized.match_code, error: existingError.message });
        continue;
      }

      const existing = (existingData || null) as ExistingMatchRow | null;
      const drawSelectedRefsToValidate: Array<{ side: 'home' | 'away'; sourceRef: string }> = [];
      if (normalized.home_source_type === DRAW_SELECTED_SOURCE_TYPE) {
        drawSelectedRefsToValidate.push({ side: 'home', sourceRef: normalized.home_source_ref });
      }
      if (normalized.away_source_type === DRAW_SELECTED_SOURCE_TYPE) {
        drawSelectedRefsToValidate.push({ side: 'away', sourceRef: normalized.away_source_ref });
      }

      const invalidDrawSelectedRef = drawSelectedRefsToValidate
        .map((entry) => ({
          side: entry.side,
          validation: validateDrawSelectedSourceRef({
            sourceRef: entry.sourceRef,
            rowCategoryCode: normalized.category_code,
            configsByRef: drawSelectedConfigsByRef,
            configsByCategoryCode: drawSelectedConfigsByCategoryCode,
          }),
        }))
        .find((entry) => !entry.validation.ok);

      if (invalidDrawSelectedRef) {
        failed += 1;
        failures.push({
          row: importRow.row_no,
          match_code: normalized.match_code,
          error:
            invalidDrawSelectedRef.validation.errorMessage ||
            `${invalidDrawSelectedRef.side} draw_selected source_ref is invalid`,
        });
        continue;
      }

      const homeTeamId = resolveScheduleSourceTeamId({
        sourceType: normalized.home_source_type,
        sourceRef: normalized.home_source_ref,
        categoryId: category.id,
        groupId: group?.id || null,
        teamsByCategoryAndCode,
        groupMembersBySlot,
        existingSourceType: existing?.home_source_type || null,
        existingSourceRef: existing?.home_source_ref || null,
        existingTeamId: existing?.home_team_id || null,
      });
      const awayTeamId = resolveScheduleSourceTeamId({
        sourceType: normalized.away_source_type,
        sourceRef: normalized.away_source_ref,
        categoryId: category.id,
        groupId: group?.id || null,
        teamsByCategoryAndCode,
        groupMembersBySlot,
        existingSourceType: existing?.away_source_type || null,
        existingSourceRef: existing?.away_source_ref || null,
        existingTeamId: existing?.away_team_id || null,
      });

      const now = new Date().toISOString();
      const payload = {
        tournament_id: batch.tournament_id,
        category_id: category.id,
        group_id: group?.id || null,
        stage: normalized.stage,
        match_code: normalized.match_code,
        match_no: normalized.match_no,
        match_date: normalized.match_date || null,
        match_time: normalized.start_time || null,
        venue_id: venue.id,
        court_id: court?.id || null,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        home_source_type: normalized.home_source_type,
        home_source_ref: normalized.home_source_ref,
        away_source_type: normalized.away_source_type,
        away_source_ref: normalized.away_source_ref,
        sources_resolved_at:
          homeTeamId || awayTeamId ? now : existing?.sources_resolved_at || null,
        result_policy: normalized.result_policy,
        result_type:
          normalized.home_source_type === 'bye' || normalized.away_source_type === 'bye'
            ? 'bye'
            : 'normal',
        status: normalized.status,
        note: normalized.note || null,
        schedule_batch_id: batchId,
        schedule_status: 'validated',
        updated_by: auth.userId || null,
        updated_at: now,
      };

      if (existing) {
        const { data: updatedMatch, error: updateError } = await client
          .from('tournament_matches')
          .update({ ...payload, version: (existing.version || 1) + 1 })
          .eq('id', existing.id)
          .select('id')
          .single();

        if (updateError || !updatedMatch) {
          failed += 1;
          failures.push({ row: importRow.row_no, match_code: normalized.match_code, error: updateError?.message || 'Update failed' });
          continue;
        }

        await client
          .from('tournament_schedule_import_rows')
          .update({ action: 'update', matched_match_id: updatedMatch.id })
          .eq('id', importRow.id);
        updated += 1;
      } else {
        const { data: createdMatch, error: createError } = await client
          .from('tournament_matches')
          .insert({ ...payload, version: 1, created_by: auth.userId || null })
          .select('id')
          .single();

        if (createError || !createdMatch) {
          failed += 1;
          failures.push({ row: importRow.row_no, match_code: normalized.match_code, error: createError?.message || 'Create failed' });
          continue;
        }

        await client
          .from('tournament_schedule_import_rows')
          .update({ action: 'create', matched_match_id: createdMatch.id })
          .eq('id', importRow.id);
        created += 1;
      }
    }

    const savedAt = new Date().toISOString();
    const { error: finishError } = await client
      .from('tournament_schedule_batches')
      .update({ status: 'saved', saved_at: savedAt })
      .eq('id', batchId)
      .eq('status', 'preview');

    if (finishError) {
      console.error('[SCHEDULE_IMPORT_SAVE] batch finalization failed:', finishError.message);
      return NextResponse.json(
        {
          error: 'บันทึก Match แล้ว แต่เปลี่ยนสถานะ Batch ไม่สำเร็จ กรุณาตรวจ Audit Log',
          data: { batchId, created, updated, skipped, failed, failures },
        },
        { status: 500 }
      );
    }

    await logTournamentAdminAction({
      tournamentId: batch.tournament_id,
      admin: { id: auth.userId, email: auth.email },
      action: 'schedule.import.save',
      entityType: 'schedule_batch',
      entityId: batchId,
      entityLabel: batch.file_name,
      newData: { created, updated, skipped, failed, failures },
    });

    return NextResponse.json({
      data: {
        batchId,
        status: 'saved',
        created,
        updated,
        skipped,
        failed,
        failures,
      },
    });
  } catch (error) {
    console.error(
      '[SCHEDULE_IMPORT_SAVE] unexpected error:',
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดระหว่างบันทึกตารางแข่งขัน' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
import { logTournamentAdminAction } from '@/lib/tournament/services/audit';
import { buildDrawSelectedConfigs } from '@/lib/tournament/scheduling/drawSelected';
import { resolveScheduleSourceTeamId } from '@/lib/tournament/scheduling/resolveScheduleSource';
import {
  buildScheduleImportDiff,
  categoryVenueKey,
  courtKey,
  createScheduleBatchSeen,
  groupKey,
  groupSlotKey,
  scheduleSlotKey,
  teamKey,
  validateScheduleImportRow,
  venueDayKey,
  matchNoKey,
  groupStagePairKey,
  type CategoryRef,
  type CourtRef,
  type ExistingScheduleMatch,
  type GroupRef,
  type NormalizedScheduleImportRow,
  type RawScheduleImportRow,
  type ScheduleValidationContext,
  type TeamRef,
  type VenueRef,
} from '@/lib/tournament/scheduling/validateScheduleImportRow';

export const dynamic = 'force-dynamic';

const PUBLISHED_LOCK_MESSAGE = 'Published fixture changes require the D-28 revision confirmation workflow.';

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
  save_result: SaveResultSummary | null;
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

interface GroupMemberRow {
  group_id: string;
  slot_code: string;
  team_id: string | null;
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

interface CategoryVenueRow {
  category_id: string;
  venue_id: string;
  is_primary: boolean;
}

interface VersionRow {
  category_id: string;
  stage: string;
  version: number;
}

interface SaveFailure {
  row: number;
  match_code: string | null;
  error: string;
  code?: string;
}

interface SaveResultSummary {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  failures: SaveFailure[];
}

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

function upper(value: string): string {
  return value.trim().toUpperCase();
}

async function markBatchFailed(
  client: ReturnType<typeof getTournamentServiceClient>,
  batchId: string,
  reason: string
): Promise<void> {
  await client
    .from('tournament_schedule_batches')
    .update({ status: 'failed', failed_at: new Date().toISOString(), failure_reason: reason })
    .eq('id', batchId)
    .eq('status', 'saving');
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

  const client = getTournamentServiceClient();

  // Atomic claim: only one concurrent request can flip preview -> saving.
  const { data: claimedData, error: claimError } = await client
    .from('tournament_schedule_batches')
    .update({ status: 'saving' })
    .eq('id', batchId)
    .eq('batch_type', 'fixture_import')
    .eq('status', 'preview')
    .select('id, tournament_id, file_name, status, total_rows, valid_rows, warning_rows, error_rows, save_result')
    .maybeSingle();

  if (claimError) {
    console.error('[SCHEDULE_IMPORT_SAVE] claim failed:', claimError.message);
    return NextResponse.json({ error: 'โหลด Import Batch ไม่สำเร็จ' }, { status: 500 });
  }

  if (!claimedData) {
    // Claim failed: batch is missing, or already saving/saved/failed/rolled_back.
    const { data: currentData, error: currentError } = await client
      .from('tournament_schedule_batches')
      .select('id, tournament_id, file_name, status, total_rows, valid_rows, warning_rows, error_rows, save_result')
      .eq('id', batchId)
      .eq('batch_type', 'fixture_import')
      .maybeSingle();

    if (currentError) {
      return NextResponse.json({ error: 'โหลด Import Batch ไม่สำเร็จ' }, { status: 500 });
    }
    if (!currentData) {
      return NextResponse.json({ error: 'ไม่พบ Import Batch' }, { status: 404 });
    }

    const current = currentData as BatchRow;
    if (current.status === 'saved') {
      // Retry after success: return the same result, do not write again.
      return NextResponse.json({
        data: {
          batchId,
          status: 'saved',
          idempotent: true,
          ...(current.save_result || { created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, failures: [] }),
        },
      });
    }
    if (current.status === 'saving') {
      return NextResponse.json({ error: 'Import Batch นี้กำลังถูกบันทึกโดยคำขออื่นอยู่' }, { status: 409 });
    }
    if (current.status === 'failed') {
      return NextResponse.json(
        { error: 'Import Batch นี้บันทึกไม่สำเร็จก่อนหน้านี้ กรุณาสร้าง Batch ใหม่' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Import Batch นี้ไม่พร้อมบันทึก' }, { status: 409 });
  }

  const batch = claimedData as BatchRow;

  try {
    const [
      tournamentResult,
      rowsResult,
      categoriesResult,
      venuesResult,
      courtsResult,
      groupsResult,
      membersResult,
      teamsResult,
      categoryVenuesResult,
      qualificationRulesResult,
      matchesResult,
      versionsResult,
    ] = await Promise.all([
      client
        .from('tournaments')
        .select('id, start_date, end_date')
        .eq('id', batch.tournament_id)
        .maybeSingle(),
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
      client.from('tournament_category_venues').select('category_id, venue_id, is_primary'),
      client
        .from('tournament_qualification_rules')
        .select('category_id, best_third_placed_count, best_third_placed_method')
        .eq('tournament_id', batch.tournament_id),
      client
        .from('tournament_matches')
        .select(
          'id, match_code, category_id, group_id, venue_id, court_id, match_date, match_time, match_no, stage, home_source_type, home_source_ref, away_source_type, away_source_ref, result_policy, status, note, schedule_status, version'
        )
        .eq('tournament_id', batch.tournament_id)
        .is('deleted_at', null),
      client.from('tournament_schedule_versions').select('category_id, stage, version'),
    ]);

    const queryError = [
      tournamentResult.error,
      rowsResult.error,
      categoriesResult.error,
      venuesResult.error,
      courtsResult.error,
      groupsResult.error,
      membersResult.error,
      teamsResult.error,
      categoryVenuesResult.error,
      qualificationRulesResult.error,
      matchesResult.error,
      versionsResult.error,
    ].find(Boolean);

    if (queryError || !tournamentResult.data) {
      console.error('[SCHEDULE_IMPORT_SAVE] reference query failed:', queryError?.message);
      await markBatchFailed(client, batchId, queryError?.message || 'reference query failed');
      return NextResponse.json({ error: 'โหลดข้อมูลสำหรับบันทึกไม่สำเร็จ' }, { status: 500 });
    }

    const tournament = tournamentResult.data as { id: string; start_date: string | null; end_date: string | null };
    const importRows = (rowsResult.data || []) as ImportRow[];
    const categories = (categoriesResult.data || []) as CategoryRef[];
    const categoryIds = new Set(categories.map((category) => category.id));
    const venues = (venuesResult.data || []) as VenueRef[];
    const venueIds = new Set(venues.map((venue) => venue.id));
    const groups = (groupsResult.data || []) as GroupRef[];
    const groupIds = new Set(groups.map((group) => group.id));
    const courts = ((courtsResult.data || []) as CourtRef[]).filter((court) => venueIds.has(court.venue_id));
    const members = ((membersResult.data || []) as GroupMemberRow[]).filter((member) =>
      groupIds.has(member.group_id)
    );
    const teams = ((teamsResult.data || []) as TeamRef[]).filter((team) => categoryIds.has(team.category_id));
    const categoryVenues = ((categoryVenuesResult.data || []) as CategoryVenueRow[]).filter(
      (mapping) => categoryIds.has(mapping.category_id) && venueIds.has(mapping.venue_id)
    );
    const existingMatches = (matchesResult.data || []) as ExistingScheduleMatch[];
    const versionRows = (versionsResult.data || []) as VersionRow[];

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

    const categoriesByCode = new Map<string, CategoryRef>();
    categories.forEach((category) => categoriesByCode.set(upper(category.code), category));
    const venuesByCode = new Map<string, VenueRef>();
    venues.forEach((venue) => venuesByCode.set(upper(venue.code), venue));
    const courtsByVenueAndCode = new Map<string, CourtRef>();
    courts.forEach((court) => courtsByVenueAndCode.set(courtKey(court.venue_id, court.code), court));
    const groupsByCategoryAndCode = new Map<string, GroupRef>();
    groups.forEach((group) => groupsByCategoryAndCode.set(groupKey(group.category_id, group.code), group));
    const groupSlots = new Set<string>();
    const groupMembersBySlot = new Map<string, GroupMemberRow>();
    members.forEach((member) => {
      groupSlots.add(groupSlotKey(member.group_id, member.slot_code));
      groupMembersBySlot.set(groupSlotKey(member.group_id, member.slot_code), member);
    });
    const teamsByCategoryAndCode = new Map<string, TeamRef>();
    teams.forEach((team) => teamsByCategoryAndCode.set(teamKey(team.category_id, team.team_code), team));
    const primaryCategoryVenues = new Set<string>();
    categoryVenues
      .filter((mapping) => mapping.is_primary)
      .forEach((mapping) => primaryCategoryVenues.add(categoryVenueKey(mapping.category_id, mapping.venue_id)));

    const existingMatchesByCode = new Map<string, ExistingScheduleMatch>();
    const existingSlotOwners = new Map<string, string>();
    const existingVenueDayCounts = new Map<string, number>();
    const existingPairOwners = new Map<string, string>();
    const existingMatchNoOwners = new Map<string, string>();

    existingMatches.forEach((match) => {
      const matchCode = upper(match.match_code);
      existingMatchesByCode.set(matchCode, { ...match, match_code: matchCode });
      if (match.venue_id && match.match_date) {
        const dayKey = venueDayKey(match.venue_id, match.match_date);
        existingVenueDayCounts.set(dayKey, (existingVenueDayCounts.get(dayKey) || 0) + 1);
      }
      if (match.venue_id && match.match_date && match.match_time) {
        existingSlotOwners.set(
          scheduleSlotKey(match.venue_id, match.court_id, match.match_date, match.match_time),
          matchCode
        );
      }
      if (
        match.stage === 'group' &&
        match.group_id &&
        match.home_source_type &&
        match.home_source_ref &&
        match.away_source_type &&
        match.away_source_ref
      ) {
        existingPairOwners.set(
          groupStagePairKey(
            match.category_id,
            match.stage,
            match.group_id,
            match.home_source_type,
            match.home_source_ref,
            match.away_source_type,
            match.away_source_ref
          ),
          matchCode
        );
      }
      if (match.match_no !== null && match.match_no !== undefined) {
        existingMatchNoOwners.set(matchNoKey(match.category_id, match.stage, match.match_no), matchCode);
      }
    });

    const allKnownMatchCodes = new Set(existingMatchesByCode.keys());
    importRows.forEach((row) => {
      if (row.match_code) allKnownMatchCodes.add(upper(row.match_code));
    });

    const context: ScheduleValidationContext = {
      tournamentStartDate: tournament.start_date,
      tournamentEndDate: tournament.end_date,
      categoriesByCode,
      venuesByCode,
      courtsByVenueAndCode,
      groupsByCategoryAndCode,
      groupSlots,
      teamsByCategoryAndCode,
      primaryCategoryVenues,
      existingMatchesByCode,
      existingSlotOwners,
      existingVenueDayCounts,
      existingPairOwners,
      existingMatchNoOwners,
      allKnownMatchCodes,
      drawSelectedConfigsByRef,
      drawSelectedConfigsByCategoryCode,
    };

    const seen = createScheduleBatchSeen();
    const maxVersionByKey = new Map<string, number>();
    versionRows.forEach((row) => {
      const key = `${row.category_id}|${row.stage}`;
      maxVersionByKey.set(key, Math.max(maxVersionByKey.get(key) || 0, row.version));
    });
    const affectedCategoryStages = new Set<string>();

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let skipped = 0;
    let failed = 0;
    const failures: SaveFailure[] = [];

    for (const importRow of importRows) {
      if (importRow.status === 'error' || importRow.action === 'skip') {
        skipped += 1;
        continue;
      }

      const storedNormalized = importRow.raw_payload?.normalized;
      if (!storedNormalized) {
        failed += 1;
        failures.push({ row: importRow.row_no, match_code: importRow.match_code, error: 'ไม่พบ normalized payload' });
        continue;
      }

      // Revalidate against current database state — the same rules Preview
      // applied, re-run here because the database may have changed since Preview.
      const revalidated = validateScheduleImportRow(
        storedNormalized as unknown as RawScheduleImportRow,
        importRow.row_no,
        context,
        seen
      );
      if (revalidated.status === 'error') {
        failed += 1;
        failures.push({
          row: importRow.row_no,
          match_code: revalidated.match_code,
          error: revalidated.messages.filter((message) => message.severity === 'error').map((message) => message.message).join('; '),
        });
        continue;
      }

      const normalized = revalidated.normalized;
      const category = categoriesByCode.get(upper(normalized.category_code));
      const venue = venuesByCode.get(upper(normalized.venue_code));
      if (!category || !venue) {
        failed += 1;
        failures.push({ row: importRow.row_no, match_code: normalized.match_code, error: 'Category หรือ Venue ไม่พร้อมใช้งาน' });
        continue;
      }

      const court = normalized.court_code
        ? courtsByVenueAndCode.get(courtKey(venue.id, normalized.court_code))
        : undefined;
      const group = normalized.group_code
        ? groupsByCategoryAndCode.get(groupKey(category.id, normalized.group_code))
        : undefined;

      const existing = existingMatchesByCode.get(upper(normalized.match_code)) || undefined;
      const diff = buildScheduleImportDiff(
        existing,
        normalized,
        category.id,
        group?.id || null,
        venue.id,
        court?.id || null
      );

      if (existing && diff.length === 0) {
        unchanged += 1;
        continue;
      }

      if (existing && existing.schedule_status === 'published') {
        failed += 1;
        failures.push({
          row: importRow.row_no,
          match_code: normalized.match_code,
          error: PUBLISHED_LOCK_MESSAGE,
          code: 'E_PUBLISHED_LOCKED',
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
        existingTeamId: null,
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
        existingTeamId: null,
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
        sources_resolved_at: homeTeamId || awayTeamId ? now : null,
        result_policy: normalized.result_policy,
        result_type:
          normalized.home_source_type === 'bye' || normalized.away_source_type === 'bye' ? 'bye' : 'normal',
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

      affectedCategoryStages.add(`${category.id}|${normalized.stage}`);
    }

    // Create schedule version records for categories/stages touched by this batch.
    // Never published automatically; never created for unchanged-only rows or
    // rows rejected under the published-fixture lock.
    const versionInserts = Array.from(affectedCategoryStages).map((key) => {
      const [categoryId, stage] = key.split('|');
      const nextVersion = (maxVersionByKey.get(key) || 0) + 1;
      return {
        category_id: categoryId,
        stage,
        version: nextVersion,
        status: 'validated',
        batch_id: batchId,
        note: `Schedule import batch ${batchId}`,
      };
    });

    if (versionInserts.length > 0) {
      const { error: versionInsertError } = await client.from('tournament_schedule_versions').insert(versionInserts);
      if (versionInsertError) {
        console.error('[SCHEDULE_IMPORT_SAVE] version insert failed:', versionInsertError.message);
        // Non-fatal: matches are already saved. Log and continue to finalize the batch.
      }
    }

    const saveResult: SaveResultSummary = { created, updated, unchanged, skipped, failed, failures };
    const savedAt = new Date().toISOString();
    const { error: finishError } = await client
      .from('tournament_schedule_batches')
      .update({ status: 'saved', saved_at: savedAt, save_result: saveResult })
      .eq('id', batchId)
      .eq('status', 'saving');

    if (finishError) {
      console.error('[SCHEDULE_IMPORT_SAVE] batch finalization failed:', finishError.message);
      await markBatchFailed(client, batchId, finishError.message);
      return NextResponse.json(
        {
          error: 'บันทึก Match แล้ว แต่เปลี่ยนสถานะ Batch ไม่สำเร็จ กรุณาตรวจ Audit Log',
          data: { batchId, ...saveResult },
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
      newData: saveResult,
    });

    return NextResponse.json({
      data: {
        batchId,
        status: 'saved',
        ...saveResult,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[SCHEDULE_IMPORT_SAVE] unexpected error:', message);
    await markBatchFailed(client, batchId, message);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดระหว่างบันทึกตารางแข่งขัน' }, { status: 500 });
  }
}

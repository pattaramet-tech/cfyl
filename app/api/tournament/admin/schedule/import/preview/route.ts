import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
import { logTournamentAdminAction } from '@/lib/tournament/services/audit';
import { buildDrawSelectedConfigs } from '@/lib/tournament/scheduling/drawSelected';
import {
  categoryVenueKey,
  courtKey,
  createScheduleBatchSeen,
  groupKey,
  groupSlotKey,
  normalizeScheduleImportRow,
  scheduleSlotKey,
  teamKey,
  validateScheduleImportRow,
  venueDayKey,
  type CategoryRef,
  type CourtRef,
  type ExistingScheduleMatch,
  type GroupRef,
  type RawScheduleImportRow,
  type ScheduleValidationContext,
  type TeamRef,
  type VenueRef,
} from '@/lib/tournament/scheduling/validateScheduleImportRow';

export const dynamic = 'force-dynamic';

interface PreviewRequestBody {
  tournamentId?: unknown;
  fileName?: unknown;
  rows?: unknown;
}

interface TournamentRow {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
}

interface CategoryRow extends CategoryRef {
  tournament_id: string;
}

interface VenueRow extends VenueRef {
  tournament_id: string;
}

type CourtRow = CourtRef;
type GroupRow = GroupRef;
type TeamRow = TeamRef;

interface GroupMemberRow {
  group_id: string;
  slot_code: string;
  team_id: string | null;
}

interface CategoryVenueRow {
  category_id: string;
  venue_id: string;
  is_primary: boolean;
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

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

function asRows(value: unknown): RawScheduleImportRow[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(
    (row): row is RawScheduleImportRow => !!row && typeof row === 'object' && !Array.isArray(row)
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  let body: PreviewRequestBody;
  try {
    body = (await request.json()) as PreviewRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const tournamentId = asText(body.tournamentId);
  const fileName = asText(body.fileName) || 'schedule-import.xlsx';
  const rows = asRows(body.rows);

  if (!tournamentId) {
    return NextResponse.json({ error: 'tournamentId is required' }, { status: 400 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'ไฟล์ไม่มีข้อมูลตารางแข่งขัน' }, { status: 400 });
  }
  if (rows.length > 2000) {
    return NextResponse.json({ error: 'รองรับสูงสุด 2,000 แถวต่อการ Import' }, { status: 400 });
  }

  try {
    const client = getTournamentServiceClient();
    const { data: tournamentData, error: tournamentError } = await client
      .from('tournaments')
      .select('id, name, start_date, end_date')
      .eq('id', tournamentId)
      .is('deleted_at', null)
      .maybeSingle();

    if (tournamentError) {
      console.error('[SCHEDULE_IMPORT_PREVIEW] tournament query failed:', tournamentError.message);
      return NextResponse.json({ error: 'โหลด Tournament ไม่สำเร็จ' }, { status: 500 });
    }
    if (!tournamentData) {
      return NextResponse.json({ error: 'ไม่พบ Tournament ที่เลือก' }, { status: 404 });
    }

    const tournament = tournamentData as TournamentRow;
    const [
      categoriesResult,
      venuesResult,
      courtsResult,
      groupsResult,
      membersResult,
      teamsResult,
      categoryVenuesResult,
      qualificationRulesResult,
      matchesResult,
    ] = await Promise.all([
      client
        .from('tournament_categories')
        .select('id, tournament_id, code, name')
        .eq('tournament_id', tournamentId)
        .is('deleted_at', null),
      client
        .from('tournament_venues')
        .select('id, tournament_id, code, name')
        .eq('tournament_id', tournamentId),
      client
        .from('tournament_courts')
        .select('id, venue_id, code, name'),
      client
        .from('tournament_groups')
        .select('id, category_id, code, name')
        .eq('tournament_id', tournamentId),
      client
        .from('tournament_group_members')
        .select('group_id, slot_code, team_id'),
      client
        .from('tournament_teams')
        .select('id, category_id, team_code, name')
        .eq('tournament_id', tournamentId),
      client
        .from('tournament_category_venues')
        .select('category_id, venue_id, is_primary'),
      client
        .from('tournament_qualification_rules')
        .select('category_id, best_third_placed_count, best_third_placed_method')
        .eq('tournament_id', tournamentId),
      client
        .from('tournament_matches')
        .select(
          'id, match_code, category_id, group_id, venue_id, court_id, match_date, match_time, match_no, stage, home_source_type, home_source_ref, away_source_type, away_source_ref, result_policy, status, note, schedule_status, version'
        )
        .eq('tournament_id', tournamentId)
        .is('deleted_at', null),
    ]);

    const queryError = [
      categoriesResult.error,
      venuesResult.error,
      courtsResult.error,
      groupsResult.error,
      membersResult.error,
      teamsResult.error,
      categoryVenuesResult.error,
      qualificationRulesResult.error,
      matchesResult.error,
    ].find(Boolean);

    if (queryError) {
      console.error('[SCHEDULE_IMPORT_PREVIEW] context query failed:', queryError.message);
      return NextResponse.json({ error: 'โหลดข้อมูลอ้างอิงสำหรับตรวจตารางไม่สำเร็จ' }, { status: 500 });
    }

    const categories = (categoriesResult.data || []) as CategoryRow[];
    const venues = (venuesResult.data || []) as VenueRow[];
    const venueIds = new Set(venues.map((venue) => venue.id));
    const categoryIds = new Set(categories.map((category) => category.id));
    const groups = ((groupsResult.data || []) as GroupRow[]).filter((group) =>
      categoryIds.has(group.category_id)
    );
    const groupIds = new Set(groups.map((group) => group.id));
    const courts = ((courtsResult.data || []) as CourtRow[]).filter((court) =>
      venueIds.has(court.venue_id)
    );
    const members = ((membersResult.data || []) as GroupMemberRow[]).filter((member) =>
      groupIds.has(member.group_id)
    );
    const teams = ((teamsResult.data || []) as TeamRow[]).filter((team) =>
      categoryIds.has(team.category_id)
    );
    const categoryVenues = ((categoryVenuesResult.data || []) as CategoryVenueRow[]).filter(
      (mapping) => categoryIds.has(mapping.category_id) && venueIds.has(mapping.venue_id)
    );
    const qualificationRules = ((qualificationRulesResult.data || []) as QualificationRuleRow[])
      .filter((rule) => categoryIds.has(rule.category_id))
      .map((rule) => {
        const categoryRef = categories.find((category) => category.id === rule.category_id);
        return categoryRef
          ? {
              categoryId: rule.category_id,
              categoryCode: categoryRef.code,
              bestThirdPlacedCount: rule.best_third_placed_count,
              bestThirdPlacedMethod: rule.best_third_placed_method,
            }
          : null;
      })
      .filter((rule): rule is DrawSelectedRuleConfig => rule !== null);
    const existingMatches = (matchesResult.data || []) as ExistingScheduleMatch[];
    const { configsByRef: drawSelectedConfigsByRef, configsByCategoryCode: drawSelectedConfigsByCategoryCode } =
      buildDrawSelectedConfigs(qualificationRules);

    const categoriesByCode = new Map<string, CategoryRef>();
    categories.forEach((category) => categoriesByCode.set(category.code.trim().toUpperCase(), category));

    const venuesByCode = new Map<string, VenueRef>();
    venues.forEach((venue) => venuesByCode.set(venue.code.trim().toUpperCase(), venue));

    const courtsByVenueAndCode = new Map<string, CourtRef>();
    courts.forEach((court) => courtsByVenueAndCode.set(courtKey(court.venue_id, court.code), court));

    const groupsByCategoryAndCode = new Map<string, GroupRef>();
    groups.forEach((group) =>
      groupsByCategoryAndCode.set(groupKey(group.category_id, group.code), group)
    );

    const groupSlots = new Set<string>();
    members.forEach((member) => groupSlots.add(groupSlotKey(member.group_id, member.slot_code)));

    const teamsByCategoryAndCode = new Map<string, TeamRef>();
    teams.forEach((team) =>
      teamsByCategoryAndCode.set(teamKey(team.category_id, team.team_code), team)
    );

    const primaryCategoryVenues = new Set<string>();
    categoryVenues
      .filter((mapping) => mapping.is_primary)
      .forEach((mapping) =>
        primaryCategoryVenues.add(categoryVenueKey(mapping.category_id, mapping.venue_id))
      );

    const existingMatchesByCode = new Map<string, ExistingScheduleMatch>();
    const existingSlotOwners = new Map<string, string>();
    const existingVenueDayCounts = new Map<string, number>();

    existingMatches.forEach((match) => {
      const matchCode = match.match_code.trim().toUpperCase();
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
    });

    const allKnownMatchCodes = new Set(existingMatchesByCode.keys());
    rows.forEach((row) => {
      const matchCode = normalizeScheduleImportRow(row).match_code;
      if (matchCode) allKnownMatchCodes.add(matchCode);
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
      allKnownMatchCodes,
      drawSelectedConfigsByRef,
      drawSelectedConfigsByCategoryCode,
    };

    const seen = createScheduleBatchSeen();
    const results = rows.map((row, index) =>
      validateScheduleImportRow(row, index + 2, context, seen)
    );

    const validRows = results.filter((row) => row.status === 'valid').length;
    const warningRows = results.filter((row) => row.status === 'warning').length;
    const errorRows = results.filter((row) => row.status === 'error').length;

    const { data: batchData, error: batchError } = await client
      .from('tournament_schedule_batches')
      .insert({
        tournament_id: tournamentId,
        batch_type: 'fixture_import',
        file_name: fileName,
        status: 'preview',
        total_rows: results.length,
        valid_rows: validRows,
        warning_rows: warningRows,
        error_rows: errorRows,
        uploaded_by: auth.userId || null,
      })
      .select('id')
      .single();

    if (batchError || !batchData) {
      console.error('[SCHEDULE_IMPORT_PREVIEW] batch insert failed:', batchError?.message);
      return NextResponse.json({ error: 'สร้าง Import Batch ไม่สำเร็จ' }, { status: 500 });
    }

    const batchId = String(batchData.id);
    const importRows = results.map((result, index) => ({
      batch_id: batchId,
      row_no: result.row,
      raw_payload: {
        raw: rows[index],
        normalized: result.normalized,
        diff: result.diff,
        old_match: result.existingMatchId
          ? existingMatchesByCode.get(result.match_code) || null
          : null,
      },
      match_code: result.match_code || null,
      status: result.status,
      messages: result.messages,
      matched_match_id: result.existingMatchId,
      action: result.action,
    }));

    const { error: rowsInsertError } = await client
      .from('tournament_schedule_import_rows')
      .insert(importRows);

    if (rowsInsertError) {
      console.error('[SCHEDULE_IMPORT_PREVIEW] row insert failed:', rowsInsertError.message);
      await client.from('tournament_schedule_batches').delete().eq('id', batchId);
      return NextResponse.json({ error: 'บันทึกผล Preview รายแถวไม่สำเร็จ' }, { status: 500 });
    }

    await logTournamentAdminAction({
      tournamentId,
      admin: { id: auth.userId, email: auth.email },
      action: 'schedule.import.preview',
      entityType: 'schedule_batch',
      entityId: batchId,
      entityLabel: fileName,
      newData: {
        total_rows: results.length,
        valid_rows: validRows,
        warning_rows: warningRows,
        error_rows: errorRows,
      },
    });

    return NextResponse.json({
      data: {
        batchId,
        tournament: { id: tournament.id, name: tournament.name },
        fileName,
        summary: {
          total: results.length,
          valid: validRows,
          warning: warningRows,
          error: errorRows,
          creatable: validRows + warningRows,
        },
        results,
      },
    });
  } catch (error) {
    console.error(
      '[SCHEDULE_IMPORT_PREVIEW] unexpected error:',
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดระหว่างตรวจไฟล์ตารางแข่งขัน' }, { status: 500 });
  }
}

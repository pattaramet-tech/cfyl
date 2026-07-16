/**
 * Tournament V2 — Schedule Import disposable-data RUNTIME verifier.
 *
 * NOT part of `npm run test`. Requires real TOURNAMENT_SUPABASE_* credentials
 * for CFYL-Tournament-Staging in .env.local, plus an explicit opt-in:
 *
 *   TOURNAMENT_RUNTIME_VERIFY_CONFIRM=CFYL-Tournament-Staging
 *
 * Run: npm run verify:tournament-schedule-import-runtime
 *
 * WHAT THIS PROVES that the mocked unit tests (validateScheduleImportRow.test.ts,
 * import/preview/__tests__/route.test.ts, import/save/__tests__/route.test.ts)
 * cannot: real Postgres constraint/index enforcement, real transactional
 * behavior of the atomic preview->saving->saved claim, and real end-to-end
 * data persistence — using disposable, uniquely-tagged rows only.
 *
 * DESIGN CHOICE — bypasses HTTP/auth, exercises the real logic directly:
 * The Schedule Import preview/save routes live entirely in
 * app/api/tournament/admin/schedule/import/{preview,save}/route.ts (there is
 * no separate service module) and both require a real League Supabase Auth
 * bearer token via requireTournamentSuperAdmin(). To avoid creating throwaway
 * users in League's shared production Auth system (out of scope — the task's
 * disposable-data boundary is CFYL-Tournament-Staging, not League), this
 * verifier does NOT call the route POST handlers directly. Instead it calls
 * the exact same underlying REAL functions the routes call —:
 * validateScheduleImportRow, buildDrawSelectedConfigs, resolveScheduleSourceTeamId,
 * buildScheduleImportDiff, createScheduleBatchSeen — and replicates the routes'
 * persistence orchestration (same tables, same columns, same status values,
 * same atomic-claim UPDATE) line-for-line against the real service client.
 * This mirrors the precedent already used by verify-full-report-runtime.ts on
 * this repo's sibling PR. The requireTournamentSuperAdmin() HTTP/auth wrapper
 * itself is intentionally out of scope for this runtime check.
 *
 * KNOWN GAP — Scenario 9 (rollback workflow) is reported BLOCKED, not faked:
 * as of this branch, no rollback API route or service function exists anywhere
 * in the codebase for schedule import batches. Only schema-level support
 * exists (tournament_schedule_batches.status allows 'rolled_back',
 * rolled_back_at/rolled_back_by columns from migration 011) and a design doc
 * (TOURNAMENT_V2_SCHEDULING_AND_IMPORT.md §9) describing an intended future
 * POST /schedule/import/batches/{id}/rollback endpoint. Building it here would
 * be starting a new feature, which is explicitly out of scope for this task.
 * Cleanup therefore uses direct disposable-row deletion (as verify-foundation.ts
 * and verify-full-report-runtime.ts already do), not a rollback endpoint.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { loadEnvConfig } from '@next/env';
import { randomUUID } from 'crypto';
import { getTournamentServiceClient } from '../../lib/tournament/db/supabase-tournament';
import { logTournamentAdminAction } from '../../lib/tournament/services/audit';
import {
  GROUP_THIRD_PLACE_QUALIFICATION_SLOT,
  buildDrawSelectedConfigs,
} from '../../lib/tournament/scheduling/drawSelected';
import { resolveScheduleSourceTeamId } from '../../lib/tournament/scheduling/resolveScheduleSource';
import {
  buildScheduleImportDiff,
  categoryVenueKey,
  courtKey,
  createScheduleBatchSeen,
  groupKey,
  groupSlotKey,
  groupStagePairKey,
  matchNoKey,
  scheduleSlotKey,
  teamKey,
  normalizeScheduleImportRow,
  validateScheduleImportRow,
  venueDayKey,
  type CategoryRef,
  type CourtRef,
  type ExistingScheduleMatch,
  type GroupRef,
  type NormalizedScheduleImportRow,
  type RawScheduleImportRow,
  type ScheduleValidationContext,
  type TeamRef,
  type ValidatedScheduleImportRow,
  type VenueRef,
} from '../../lib/tournament/scheduling/validateScheduleImportRow';

loadEnvConfig(process.cwd());

const REQUIRED_CONFIRM = 'CFYL-Tournament-Staging';
if (process.env.TOURNAMENT_RUNTIME_VERIFY_CONFIRM !== REQUIRED_CONFIRM) {
  console.error(
    `[SAFETY] Refusing to run: set TOURNAMENT_RUNTIME_VERIFY_CONFIRM="${REQUIRED_CONFIRM}" in .env.local ` +
      'to confirm you intend to write disposable rows to that exact Staging project. This script never runs ' +
      'without that explicit confirmation.'
  );
  process.exit(1);
}

const RUN_TAG = `sir-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ACTOR_ID = randomUUID();
const ACTOR_EMAIL = 'runtime-verify-schedule-import@example.com';

type TournamentClient = ReturnType<typeof getTournamentServiceClient>;

interface Ctx {
  client: TournamentClient;
  tournamentId: string;
  categoryId: string;
  categoryCode: string;
  venueId: string;
  courtId: string;
  teamAId: string;
  teamBId: string;
  batchIds: string[];
  matchIds: string[];
  versionIds: string[];
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
  revisionsConfirmed: number;
  failures: SaveFailure[];
}

interface SaveResponse extends SaveResultSummary {
  batchId: string;
  status: string;
  idempotent?: boolean;
}

const EMPTY_SAVE_RESULT: SaveResultSummary = {
  created: 0,
  updated: 0,
  unchanged: 0,
  skipped: 0,
  failed: 0,
  revisionsConfirmed: 0,
  failures: [],
};

class BlockedError extends Error {}

interface ScenarioResult {
  name: string;
  ok: boolean;
  blocked?: boolean;
  detail?: string;
}
const results: ScenarioResult[] = [];

async function run(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✓ ${name}`);
  } catch (e) {
    if (e instanceof BlockedError) {
      results.push({ name, ok: false, blocked: true, detail: e.message });
      console.log(`⚠ BLOCKED: ${name}\n    ${e.message}`);
    } else {
      const detail = e instanceof Error ? e.message : String(e);
      results.push({ name, ok: false, detail });
      console.error(`✗ ${name}\n    ${detail}`);
    }
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

// ============================================================================
// Setup — disposable tournament + category (code 'G-U16') + venue/court + 2 teams
// + a draw_selected-eligible qualification rule, all uniquely tagged with RUN_TAG.
// ============================================================================

async function setupRemainder(client: TournamentClient, tournamentId: string): Promise<Ctx> {
  const categoryCode = 'G-U16';
  const { data: category, error: catErr } = await client
    .from('tournament_categories')
    .insert({ tournament_id: tournamentId, code: categoryCode, name: `Runtime Verify ${categoryCode} ${RUN_TAG}`, gender: 'mixed' })
    .select('id')
    .single();
  if (catErr || !category) throw new Error(`category insert failed: ${catErr?.message}`);
  const categoryId = category.id as string;

  const { data: venue, error: venueErr } = await client
    .from('tournament_venues')
    .insert({ tournament_id: tournamentId, name: `Runtime Verify Venue ${RUN_TAG}`, code: 'V1', slug: `sir-v1-${RUN_TAG}` })
    .select('id')
    .single();
  if (venueErr || !venue) throw new Error(`venue insert failed: ${venueErr?.message}`);
  const venueId = venue.id as string;

  const { data: court, error: courtErr } = await client
    .from('tournament_courts')
    .insert({ venue_id: venueId, code: 'C1', name: 'Court 1' })
    .select('id')
    .single();
  if (courtErr || !court) throw new Error(`court insert failed: ${courtErr?.message}`);
  const courtId = court.id as string;

  const { error: cvErr } = await client
    .from('tournament_category_venues')
    .insert({ category_id: categoryId, venue_id: venueId, is_primary: true });
  if (cvErr) throw new Error(`category_venue insert failed: ${cvErr.message}`);

  const { data: teamA, error: teamAErr } = await client
    .from('tournament_teams')
    .insert({ tournament_id: tournamentId, category_id: categoryId, name: `Runtime Verify Team A ${RUN_TAG}`, team_code: 'TA' })
    .select('id')
    .single();
  if (teamAErr || !teamA) throw new Error(`team A insert failed: ${teamAErr?.message}`);

  const { data: teamB, error: teamBErr } = await client
    .from('tournament_teams')
    .insert({ tournament_id: tournamentId, category_id: categoryId, name: `Runtime Verify Team B ${RUN_TAG}`, team_code: 'TB' })
    .select('id')
    .single();
  if (teamBErr || !teamB) throw new Error(`team B insert failed: ${teamBErr?.message}`);

  const { error: qrErr } = await client.from('tournament_qualification_rules').insert({
    tournament_id: tournamentId,
    category_id: categoryId,
    qualify_rank_per_group: 2,
    best_third_placed_count: 2,
    best_third_placed_method: 'draw',
    cross_group_comparison: false,
  });
  if (qrErr) throw new Error(`qualification_rules insert failed: ${qrErr.message}`);

  return {
    client,
    tournamentId,
    categoryId,
    categoryCode,
    venueId,
    courtId,
    teamAId: teamA.id as string,
    teamBId: teamB.id as string,
    batchIds: [],
    matchIds: [],
    versionIds: [],
  };
}

async function setup(client: TournamentClient): Promise<Ctx> {
  const { data: tournament, error: tErr } = await client
    .from('tournaments')
    .insert({
      name: `Schedule Import Runtime Verify ${RUN_TAG}`,
      slug: `sir-verify-${RUN_TAG}`,
      status: 'active',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    })
    .select('id')
    .single();
  if (tErr || !tournament) throw new Error(`setup: tournament insert failed: ${tErr?.message}`);
  const tournamentId = tournament.id as string;

  try {
    return await setupRemainder(client, tournamentId);
  } catch (err) {
    console.error('[SETUP] remainder failed, attempting emergency cleanup of tournament row...');
    const { error: cleanupErr } = await client.from('tournaments').delete().eq('id', tournamentId);
    if (cleanupErr) {
      console.error(`[SETUP] emergency cleanup ALSO failed: ${cleanupErr.message} — manual cleanup required for tournament ${tournamentId}`);
    } else {
      console.error('[SETUP] emergency cleanup succeeded.');
    }
    throw err;
  }
}

// ============================================================================
// Shared context loader — mirrors the Promise.all block in both route.ts files.
// ============================================================================

async function loadScheduleContext(
  client: TournamentClient,
  tournamentId: string
): Promise<{
  context: ScheduleValidationContext;
  groupMembersBySlot: Map<string, { team_id: string | null }>;
}> {
  const [
    tournamentResult,
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
    client.from('tournaments').select('id, start_date, end_date').eq('id', tournamentId).maybeSingle(),
    client.from('tournament_categories').select('id, tournament_id, code, name').eq('tournament_id', tournamentId).is('deleted_at', null),
    client.from('tournament_venues').select('id, tournament_id, code, name').eq('tournament_id', tournamentId),
    client.from('tournament_courts').select('id, venue_id, code, name'),
    client.from('tournament_groups').select('id, category_id, code, name').eq('tournament_id', tournamentId),
    client.from('tournament_group_members').select('group_id, slot_code, team_id'),
    client.from('tournament_teams').select('id, category_id, team_code, name').eq('tournament_id', tournamentId),
    client.from('tournament_category_venues').select('category_id, venue_id, is_primary'),
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

  const errs = [
    tournamentResult.error,
    categoriesResult.error,
    venuesResult.error,
    courtsResult.error,
    groupsResult.error,
    membersResult.error,
    teamsResult.error,
    categoryVenuesResult.error,
    qualificationRulesResult.error,
    matchesResult.error,
  ].filter(Boolean);
  if (errs.length > 0) throw new Error(`loadScheduleContext query failed: ${errs.map((e) => e!.message).join('; ')}`);
  if (!tournamentResult.data) throw new Error('loadScheduleContext: tournament not found');

  const tournament = tournamentResult.data as { id: string; start_date: string | null; end_date: string | null };
  const categories = (categoriesResult.data || []) as CategoryRef[];
  const categoryIds = new Set(categories.map((c) => c.id));
  const venues = (venuesResult.data || []) as VenueRef[];
  const venueIds = new Set(venues.map((v) => v.id));
  const groups = ((groupsResult.data || []) as GroupRef[]).filter((g) => categoryIds.has(g.category_id));
  const courts = ((courtsResult.data || []) as CourtRef[]).filter((c) => venueIds.has(c.venue_id));
  const members = (membersResult.data || []) as { group_id: string; slot_code: string; team_id: string | null }[];
  const teams = ((teamsResult.data || []) as TeamRef[]).filter((t) => categoryIds.has(t.category_id));
  const categoryVenues = ((categoryVenuesResult.data || []) as { category_id: string; venue_id: string; is_primary: boolean }[]).filter(
    (m) => categoryIds.has(m.category_id) && venueIds.has(m.venue_id)
  );
  const qualificationRules = ((qualificationRulesResult.data || []) as {
    category_id: string;
    best_third_placed_count: number;
    best_third_placed_method: string;
  }[])
    .map((rule) => {
      const category = categories.find((c) => c.id === rule.category_id);
      return category
        ? {
            categoryId: rule.category_id,
            categoryCode: category.code,
            bestThirdPlacedCount: rule.best_third_placed_count,
            bestThirdPlacedMethod: rule.best_third_placed_method,
          }
        : null;
    })
    .filter((r): r is { categoryId: string; categoryCode: string; bestThirdPlacedCount: number; bestThirdPlacedMethod: string } => r !== null);
  const existingMatches = (matchesResult.data || []) as ExistingScheduleMatch[];

  const { configsByRef: drawSelectedConfigsByRef, configsByCategoryCode: drawSelectedConfigsByCategoryCode } =
    buildDrawSelectedConfigs(qualificationRules);

  const categoriesByCode = new Map<string, CategoryRef>();
  categories.forEach((c) => categoriesByCode.set(c.code.trim().toUpperCase(), c));
  const venuesByCode = new Map<string, VenueRef>();
  venues.forEach((v) => venuesByCode.set(v.code.trim().toUpperCase(), v));
  const courtsByVenueAndCode = new Map<string, CourtRef>();
  courts.forEach((c) => courtsByVenueAndCode.set(courtKey(c.venue_id, c.code), c));
  const groupsByCategoryAndCode = new Map<string, GroupRef>();
  groups.forEach((g) => groupsByCategoryAndCode.set(groupKey(g.category_id, g.code), g));
  const groupSlots = new Set<string>();
  const groupMembersBySlot = new Map<string, { team_id: string | null }>();
  members.forEach((m) => {
    groupSlots.add(groupSlotKey(m.group_id, m.slot_code));
    groupMembersBySlot.set(groupSlotKey(m.group_id, m.slot_code), m);
  });
  const teamsByCategoryAndCode = new Map<string, TeamRef>();
  teams.forEach((t) => teamsByCategoryAndCode.set(teamKey(t.category_id, t.team_code), t));
  const primaryCategoryVenues = new Set<string>();
  categoryVenues.filter((m) => m.is_primary).forEach((m) => primaryCategoryVenues.add(categoryVenueKey(m.category_id, m.venue_id)));

  const existingMatchesByCode = new Map<string, ExistingScheduleMatch>();
  const existingSlotOwners = new Map<string, string>();
  const existingVenueDayCounts = new Map<string, number>();
  const existingPairOwners = new Map<string, string>();
  const existingMatchNoOwners = new Map<string, string>();

  existingMatches.forEach((match) => {
    const matchCode = match.match_code.trim().toUpperCase();
    existingMatchesByCode.set(matchCode, { ...match, match_code: matchCode });
    if (match.venue_id && match.match_date) {
      const dayKey = venueDayKey(match.venue_id, match.match_date);
      existingVenueDayCounts.set(dayKey, (existingVenueDayCounts.get(dayKey) || 0) + 1);
    }
    if (match.venue_id && match.match_date && match.match_time) {
      existingSlotOwners.set(scheduleSlotKey(match.venue_id, match.court_id, match.match_date, match.match_time), matchCode);
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
        groupStagePairKey(match.category_id, match.stage, match.group_id, match.home_source_type, match.home_source_ref, match.away_source_type, match.away_source_ref),
        matchCode
      );
    }
    if (match.match_no !== null && match.match_no !== undefined) {
      existingMatchNoOwners.set(matchNoKey(match.category_id, match.stage, match.match_no), matchCode);
    }
  });

  const allKnownMatchCodes = new Set(existingMatchesByCode.keys());

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

  return { context, groupMembersBySlot };
}

// ============================================================================
// Preliminary check — Migration 012's two partial unique indexes, verified
// functionally (real INSERT collisions), since pg_indexes/pg_catalog isn't
// exposed over PostgREST and no direct Postgres connection string is available.
// ============================================================================

async function checkMigration012Indexes(ctx: Ctx): Promise<void> {
  const { client, categoryId } = ctx;

  const { data: draw1, error: draw1Err } = await client
    .from('tournament_qualification_draws')
    .insert({ category_id: categoryId, qualification_slot: GROUP_THIRD_PLACE_QUALIFICATION_SLOT, slots_available: 2 })
    .select('id')
    .single();
  if (draw1Err || !draw1) throw new Error(`first (baseline) active draw insert failed unexpectedly: ${draw1Err?.message}`);
  const drawId = draw1.id as string;

  const { error: draw2Err } = await client
    .from('tournament_qualification_draws')
    .insert({ category_id: categoryId, qualification_slot: GROUP_THIRD_PLACE_QUALIFICATION_SLOT, slots_available: 2 });
  assert(!!draw2Err, 'expected a second active (non-superseded) draw for the same category/slot to be rejected — uniq_tqualdraw_active_category_slot missing?');
  assert(
    !!draw2Err && draw2Err.message.includes('uniq_tqualdraw_active_category_slot'),
    `expected rejection to name index uniq_tqualdraw_active_category_slot, got: ${draw2Err?.message}`
  );

  const { error: cand1Err } = await client
    .from('tournament_qualification_draw_candidates')
    .insert({ draw_id: drawId, team_id: ctx.teamAId, is_selected: true, draw_order: 1 });
  if (cand1Err) throw new Error(`first (baseline) selected candidate insert failed unexpectedly: ${cand1Err.message}`);

  const { error: cand2Err } = await client
    .from('tournament_qualification_draw_candidates')
    .insert({ draw_id: drawId, team_id: ctx.teamBId, is_selected: true, draw_order: 1 });
  assert(!!cand2Err, 'expected a second selected candidate at the same draw_order to be rejected — uniq_tqualcand_selected_order missing?');
  assert(
    !!cand2Err && cand2Err.message.includes('uniq_tqualcand_selected_order'),
    `expected rejection to name index uniq_tqualcand_selected_order, got: ${cand2Err?.message}`
  );
}

// ============================================================================
// Scenarios 1-2: Preview two draw_selected rows, confirm Warning not Error.
// ============================================================================

function buildRawRows(ctx: Ctx): RawScheduleImportRow[] {
  return [
    {
      match_code: `${RUN_TAG}-M1`,
      category_code: ctx.categoryCode,
      stage: 'round_of_16',
      group_code: '',
      venue_code: 'V1',
      court_code: 'C1',
      match_date: '2026-06-01',
      start_time: '09:00',
      match_no: 1,
      home_source_type: 'draw_selected',
      home_source_ref: 'G-U16-THIRD-DRAW-1',
      away_source_type: 'team',
      away_source_ref: 'TA',
      result_policy: 'single_step',
      status: 'scheduled',
      note: `runtime verify ${RUN_TAG}`,
    },
    {
      match_code: `${RUN_TAG}-M2`,
      category_code: ctx.categoryCode,
      stage: 'round_of_16',
      group_code: '',
      venue_code: 'V1',
      court_code: 'C1',
      match_date: '2026-06-01',
      start_time: '10:00',
      match_no: 2,
      home_source_type: 'draw_selected',
      home_source_ref: 'G-U16-THIRD-DRAW-2',
      away_source_type: 'team',
      away_source_ref: 'TB',
      result_policy: 'single_step',
      status: 'scheduled',
      note: `runtime verify ${RUN_TAG}`,
    },
  ];
}

interface PreviewOutcome {
  batchId: string;
  results: ValidatedScheduleImportRow[];
  rawRows: RawScheduleImportRow[];
}

async function scenarioPreview(ctx: Ctx): Promise<PreviewOutcome> {
  const rawRows = buildRawRows(ctx);
  const { context } = await loadScheduleContext(ctx.client, ctx.tournamentId);
  const seen = createScheduleBatchSeen();
  const rowResults = rawRows.map((row, index) => validateScheduleImportRow(row, index + 2, context, seen));

  rowResults.forEach((result, i) => {
    assert(result.status === 'warning', `row ${i + 1} (${result.match_code}) expected status 'warning', got '${result.status}': ${JSON.stringify(result.messages)}`);
    assert(result.messages.some((m) => m.code === 'W8'), `row ${i + 1} expected W8 (unresolved placeholder) warning, got: ${JSON.stringify(result.messages)}`);
    assert(!result.messages.some((m) => m.severity === 'error'), `row ${i + 1} expected zero error messages, got: ${JSON.stringify(result.messages)}`);
    assert(result.action === 'create', `row ${i + 1} expected action 'create', got '${result.action}'`);
  });

  const validRows = rowResults.filter((r) => r.status === 'valid').length;
  const warningRows = rowResults.filter((r) => r.status === 'warning').length;
  const errorRows = rowResults.filter((r) => r.status === 'error').length;

  const { data: batchData, error: batchError } = await ctx.client
    .from('tournament_schedule_batches')
    .insert({
      tournament_id: ctx.tournamentId,
      batch_type: 'fixture_import',
      file_name: `runtime-verify-${RUN_TAG}.xlsx`,
      status: 'preview',
      total_rows: rowResults.length,
      valid_rows: validRows,
      warning_rows: warningRows,
      error_rows: errorRows,
      uploaded_by: ACTOR_ID,
    })
    .select('id')
    .single();
  if (batchError || !batchData) throw new Error(`batch insert failed: ${batchError?.message}`);
  const batchId = batchData.id as string;
  ctx.batchIds.push(batchId);

  const importRows = rowResults.map((result, index) => ({
    batch_id: batchId,
    row_no: result.row,
    raw_payload: {
      raw: rawRows[index],
      normalized: result.normalized,
      diff: result.diff,
      old_match: null,
      requires_revision_confirmation: result.requiresRevisionConfirmation,
    },
    match_code: result.match_code || null,
    status: result.status,
    messages: result.messages,
    matched_match_id: result.existingMatchId,
    action: result.action,
  }));

  const { error: rowsInsertError } = await ctx.client.from('tournament_schedule_import_rows').insert(importRows);
  if (rowsInsertError) {
    await ctx.client.from('tournament_schedule_batches').delete().eq('id', batchId);
    throw new Error(`import rows insert failed: ${rowsInsertError.message}`);
  }

  await logTournamentAdminAction({
    tournamentId: ctx.tournamentId,
    admin: { id: ACTOR_ID, email: ACTOR_EMAIL },
    action: 'schedule.import.preview',
    entityType: 'schedule_batch',
    entityId: batchId,
    entityLabel: `runtime-verify-${RUN_TAG}.xlsx`,
    newData: { total_rows: rowResults.length, valid_rows: validRows, warning_rows: warningRows, error_rows: errorRows },
  });

  return { batchId, results: rowResults, rawRows };
}

// ============================================================================
// Save — replicates app/api/tournament/admin/schedule/import/save/route.ts
// exactly (status branches, atomic claim, per-row persistence, version
// records, finalize), minus the HTTP/auth wrapper (see header comment).
// ============================================================================

async function performSave(ctx: Ctx, batchId: string, confirmPublishedRevision = false): Promise<SaveResponse> {
  const client = ctx.client;

  const { data: batchData, error: batchError } = await client
    .from('tournament_schedule_batches')
    .select('id, tournament_id, file_name, status, total_rows, valid_rows, warning_rows, error_rows, save_result')
    .eq('id', batchId)
    .eq('batch_type', 'fixture_import')
    .maybeSingle();
  if (batchError) throw new Error(`batch query failed: ${batchError.message}`);
  if (!batchData) throw new Error('batch not found');
  const batch = batchData as {
    id: string;
    tournament_id: string;
    file_name: string | null;
    status: string;
    save_result: SaveResultSummary | null;
  };

  if (batch.status === 'saved') {
    return { batchId, status: 'saved', idempotent: true, ...(batch.save_result || EMPTY_SAVE_RESULT) };
  }
  if (batch.status === 'saving') throw new Error('SAVE_IN_PROGRESS: batch is currently being saved by another request');
  if (batch.status === 'failed') throw new Error('BATCH_FAILED: batch previously failed and is not retryable');
  if (batch.status !== 'preview') throw new Error(`BATCH_NOT_READY: unexpected status "${batch.status}"`);

  let claimed = false;
  try {
    const [rowsResult, versionsResult] = await Promise.all([
      client
        .from('tournament_schedule_import_rows')
        .select('id, row_no, status, action, match_code, raw_payload, messages')
        .eq('batch_id', batchId)
        .order('row_no', { ascending: true }),
      client.from('tournament_schedule_versions').select('category_id, stage, version'),
    ]);
    if (rowsResult.error) throw new Error(`import rows query failed: ${rowsResult.error.message}`);
    if (versionsResult.error) throw new Error(`schedule versions query failed: ${versionsResult.error.message}`);

    const importRows = (rowsResult.data || []) as {
      id: string;
      row_no: number;
      status: string;
      action: string | null;
      match_code: string | null;
      raw_payload: { normalized?: NormalizedScheduleImportRow };
      messages: unknown;
    }[];
    const versionRows = (versionsResult.data || []) as { category_id: string; stage: string; version: number }[];

    const { context, groupMembersBySlot } = await loadScheduleContext(client, batch.tournament_id);

    const seen = createScheduleBatchSeen();
    const revalidatedByRowId = new Map<string, ValidatedScheduleImportRow>();
    for (const importRow of importRows) {
      if (importRow.status === 'error' || importRow.action === 'skip') continue;
      const storedNormalized = importRow.raw_payload?.normalized;
      if (!storedNormalized) continue;
      const revalidated = validateScheduleImportRow(storedNormalized as unknown as RawScheduleImportRow, importRow.row_no, context, seen);
      revalidatedByRowId.set(importRow.id, revalidated);
    }

    const publishedChangeRows = importRows.filter((row) => {
      const revalidated = revalidatedByRowId.get(row.id);
      return revalidated && revalidated.status !== 'error' && revalidated.requiresRevisionConfirmation;
    });
    if (publishedChangeRows.length > 0 && !confirmPublishedRevision) {
      throw new Error('PUBLISHED_REVISION_CONFIRMATION_REQUIRED');
    }

    const { data: claimedData, error: claimError } = await client
      .from('tournament_schedule_batches')
      .update({ status: 'saving' })
      .eq('id', batchId)
      .eq('batch_type', 'fixture_import')
      .eq('status', 'preview')
      .select('id')
      .maybeSingle();
    if (claimError) throw new Error(`atomic claim failed: ${claimError.message}`);
    if (!claimedData) {
      const { data: currentData } = await client.from('tournament_schedule_batches').select('status, save_result').eq('id', batchId).maybeSingle();
      const current = currentData as { status: string; save_result: SaveResultSummary | null } | null;
      if (current?.status === 'saved') {
        return { batchId, status: 'saved', idempotent: true, ...(current.save_result || EMPTY_SAVE_RESULT) };
      }
      throw new Error('SAVE_IN_PROGRESS_RACE: batch claimed by another request between read and claim attempt');
    }
    claimed = true;

    const maxVersionByKey = new Map<string, number>();
    versionRows.forEach((row) => {
      const key = `${row.category_id}|${row.stage}`;
      maxVersionByKey.set(key, Math.max(maxVersionByKey.get(key) || 0, row.version));
    });
    const categoryStageStatus = new Map<string, 'validated' | 'revision_required'>();

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let skipped = 0;
    let failed = 0;
    let revisionsConfirmed = 0;
    const failures: SaveFailure[] = [];

    for (const importRow of importRows) {
      if (importRow.status === 'error' || importRow.action === 'skip') {
        skipped += 1;
        continue;
      }
      const storedNormalized = importRow.raw_payload?.normalized;
      if (!storedNormalized) {
        failed += 1;
        failures.push({ row: importRow.row_no, match_code: importRow.match_code, error: 'missing normalized payload' });
        continue;
      }
      const revalidated = revalidatedByRowId.get(importRow.id);
      if (!revalidated || revalidated.status === 'error') {
        failed += 1;
        failures.push({
          row: importRow.row_no,
          match_code: revalidated?.match_code || importRow.match_code,
          error: (revalidated?.messages || []).filter((m) => m.severity === 'error').map((m) => m.message).join('; ') || 'revalidation failed',
        });
        continue;
      }

      const normalized = revalidated.normalized;
      const category = context.categoriesByCode.get(normalized.category_code.trim().toUpperCase());
      const venue = context.venuesByCode.get(normalized.venue_code.trim().toUpperCase());
      if (!category || !venue) {
        failed += 1;
        failures.push({ row: importRow.row_no, match_code: normalized.match_code, error: 'category or venue unavailable' });
        continue;
      }
      const court = normalized.court_code ? context.courtsByVenueAndCode.get(courtKey(venue.id, normalized.court_code)) : undefined;
      const group = normalized.group_code ? context.groupsByCategoryAndCode.get(groupKey(category.id, normalized.group_code)) : undefined;

      const existing = context.existingMatchesByCode.get(normalized.match_code.trim().toUpperCase());
      const diff = buildScheduleImportDiff(existing, normalized, category.id, group?.id || null, venue.id, court?.id || null);
      if (existing && diff.length === 0) {
        unchanged += 1;
        continue;
      }

      const isConfirmedPublishedRevision = existing?.schedule_status === 'published';
      if (isConfirmedPublishedRevision && !confirmPublishedRevision) {
        failed += 1;
        failures.push({
          row: importRow.row_no,
          match_code: normalized.match_code,
          error: 'PUBLISHED_REVISION_CONFIRMATION_REQUIRED',
          code: 'PUBLISHED_REVISION_CONFIRMATION_REQUIRED',
        });
        continue;
      }

      const homeTeamId = resolveScheduleSourceTeamId({
        sourceType: normalized.home_source_type,
        sourceRef: normalized.home_source_ref,
        categoryId: category.id,
        groupId: group?.id || null,
        teamsByCategoryAndCode: context.teamsByCategoryAndCode,
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
        teamsByCategoryAndCode: context.teamsByCategoryAndCode,
        groupMembersBySlot,
        existingSourceType: existing?.away_source_type || null,
        existingSourceRef: existing?.away_source_ref || null,
        existingTeamId: null,
      });

      const now = new Date().toISOString();
      const nextScheduleStatus = isConfirmedPublishedRevision ? 'revision_required' : 'validated';
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
        result_type: normalized.home_source_type === 'bye' || normalized.away_source_type === 'bye' ? 'bye' : 'normal',
        status: normalized.status,
        note: normalized.note || null,
        schedule_batch_id: batchId,
        schedule_status: nextScheduleStatus,
        updated_by: ACTOR_ID,
        updated_at: now,
      };
      const categoryStageKey = `${category.id}|${normalized.stage}`;

      if (existing) {
        const { data: updatedMatch, error: updateError } = await client
          .from('tournament_matches')
          .update({ ...payload, version: (existing.version || 1) + 1 })
          .eq('id', existing.id)
          .select('id')
          .single();
        if (updateError || !updatedMatch) {
          failed += 1;
          failures.push({ row: importRow.row_no, match_code: normalized.match_code, error: updateError?.message || 'update failed' });
          continue;
        }
        await client.from('tournament_schedule_import_rows').update({ action: 'update', matched_match_id: updatedMatch.id }).eq('id', importRow.id);
        updated += 1;
        ctx.matchIds.push(updatedMatch.id as string);
        if (isConfirmedPublishedRevision) {
          revisionsConfirmed += 1;
          categoryStageStatus.set(categoryStageKey, 'revision_required');
        } else if (!categoryStageStatus.has(categoryStageKey)) {
          categoryStageStatus.set(categoryStageKey, 'validated');
        }
      } else {
        const { data: createdMatch, error: createError } = await client
          .from('tournament_matches')
          .insert({ ...payload, version: 1, created_by: ACTOR_ID })
          .select('id')
          .single();
        if (createError || !createdMatch) {
          failed += 1;
          failures.push({ row: importRow.row_no, match_code: normalized.match_code, error: createError?.message || 'create failed' });
          continue;
        }
        await client.from('tournament_schedule_import_rows').update({ action: 'create', matched_match_id: createdMatch.id }).eq('id', importRow.id);
        created += 1;
        ctx.matchIds.push(createdMatch.id as string);
        if (!categoryStageStatus.has(categoryStageKey)) categoryStageStatus.set(categoryStageKey, 'validated');
      }
    }

    const versionInserts = Array.from(categoryStageStatus.entries()).map(([key, status]) => {
      const [categoryId, stage] = key.split('|');
      const nextVersion = (maxVersionByKey.get(key) || 0) + 1;
      return { category_id: categoryId, stage, version: nextVersion, status, batch_id: batchId, note: `Schedule import batch ${batchId}` };
    });
    if (versionInserts.length > 0) {
      const { data: insertedVersions, error: versionInsertError } = await client
        .from('tournament_schedule_versions')
        .insert(versionInserts)
        .select('id, category_id, stage');
      if (versionInsertError) {
        console.error(`[SAVE] version insert failed (non-fatal, matches real route behavior): ${versionInsertError.message}`);
      } else {
        (insertedVersions || []).forEach((row: { id: string }) => ctx.versionIds.push(row.id));
      }
    }

    const saveResult: SaveResultSummary = { created, updated, unchanged, skipped, failed, revisionsConfirmed, failures };
    const { error: finishError } = await client
      .from('tournament_schedule_batches')
      .update({ status: 'saved', saved_at: new Date().toISOString(), save_result: saveResult })
      .eq('id', batchId)
      .eq('status', 'saving');
    if (finishError) {
      await client
        .from('tournament_schedule_batches')
        .update({ status: 'failed', failed_at: new Date().toISOString(), failure_reason: finishError.message })
        .eq('id', batchId)
        .eq('status', 'saving');
      throw new Error(`batch finalization failed: ${finishError.message}`);
    }

    await logTournamentAdminAction({
      tournamentId: batch.tournament_id,
      admin: { id: ACTOR_ID, email: ACTOR_EMAIL },
      action: 'schedule.import.save',
      entityType: 'schedule_batch',
      entityId: batchId,
      entityLabel: batch.file_name,
      newData: saveResult,
    });

    return { batchId, status: 'saved', ...saveResult };
  } catch (err) {
    if (claimed) {
      const message = err instanceof Error ? err.message : String(err);
      await client
        .from('tournament_schedule_batches')
        .update({ status: 'failed', failed_at: new Date().toISOString(), failure_reason: message })
        .eq('id', batchId)
        .eq('status', 'saving');
    }
    throw err;
  }
}

// ============================================================================
// Scenario assertions (3-8)
// ============================================================================

async function scenarioSave(ctx: Ctx, batchId: string): Promise<SaveResponse> {
  const result = await performSave(ctx, batchId);
  assert(result.status === 'saved', `expected status 'saved', got '${result.status}'`);
  assert(!result.idempotent, `expected idempotent falsy on first save, got ${result.idempotent}`);
  assert(result.created === 2, `expected 2 created matches, got ${result.created}`);
  assert(result.failed === 0, `expected 0 failed rows, got ${result.failed}: ${JSON.stringify(result.failures)}`);

  const { data: batchRow, error } = await ctx.client.from('tournament_schedule_batches').select('status').eq('id', batchId).single();
  if (error || !batchRow) throw new Error(`batch re-fetch failed: ${error?.message}`);
  assert(batchRow.status === 'saved', `expected batch.status 'saved' after save, got '${batchRow.status}'`);

  return result;
}

async function scenarioSourceFieldsPreserved(ctx: Ctx, rawRows: RawScheduleImportRow[]): Promise<void> {
  const { data: matches, error } = await ctx.client
    .from('tournament_matches')
    .select('id, match_code, home_source_type, home_source_ref, away_source_type, away_source_ref')
    .in('id', ctx.matchIds);
  if (error) throw new Error(`match re-fetch failed: ${error.message}`);
  assert(matches && matches.length === 2, `expected 2 saved matches, got ${matches?.length}`);

  for (const raw of rawRows) {
    const normalized = normalizeScheduleImportRow(raw);
    const match = (matches || []).find((m: { match_code: string }) => m.match_code === normalized.match_code);
    assert(!!match, `expected saved match with match_code ${normalized.match_code}`);
    assert(match!.home_source_type === normalized.home_source_type, `home_source_type mismatch for ${normalized.match_code}`);
    assert(match!.home_source_ref === normalized.home_source_ref, `home_source_ref mismatch for ${normalized.match_code}`);
    assert(match!.away_source_type === normalized.away_source_type, `away_source_type mismatch for ${normalized.match_code}`);
    assert(match!.away_source_ref === normalized.away_source_ref, `away_source_ref mismatch for ${normalized.match_code}`);
  }
}

async function scenarioUnresolvedTeamIdNull(ctx: Ctx): Promise<void> {
  const { data: matches, error } = await ctx.client
    .from('tournament_matches')
    .select('id, match_code, home_source_type, home_team_id, away_team_id')
    .in('id', ctx.matchIds);
  if (error) throw new Error(`match re-fetch failed: ${error.message}`);
  assert(matches && matches.length === 2, `expected 2 matches, got ${matches?.length}`);

  for (const match of matches || []) {
    if (match.home_source_type === 'draw_selected') {
      assert(match.home_team_id === null, `expected home_team_id null for unresolved draw_selected match ${match.match_code}, got ${match.home_team_id}`);
    }
    assert(match.away_team_id !== null, `expected away_team_id resolved (team source) for match ${match.match_code}`);
  }
}

async function scenarioRetrySaveIdempotent(ctx: Ctx, batchId: string, firstResult: SaveResponse): Promise<void> {
  const before = await ctx.client.from('tournament_matches').select('id', { count: 'exact', head: true }).eq('tournament_id', ctx.tournamentId);
  const retryResult = await performSave(ctx, batchId);
  assert(retryResult.idempotent === true, `expected idempotent:true on retry, got ${retryResult.idempotent}`);
  assert(retryResult.status === 'saved', `expected status 'saved' on retry, got '${retryResult.status}'`);
  assert(retryResult.created === firstResult.created, `expected retry created count to match original save result (${firstResult.created}), got ${retryResult.created}`);
  const after = await ctx.client.from('tournament_matches').select('id', { count: 'exact', head: true }).eq('tournament_id', ctx.tournamentId);
  assert(before.count === after.count, `expected no new matches from retry: before=${before.count} after=${after.count}`);
  assert(after.count === 2, `expected exactly 2 matches total (no duplicates), got ${after.count}`);
}

async function scenarioNoBatchStuckSaving(ctx: Ctx, batchId: string): Promise<void> {
  const { data: batchRow, error } = await ctx.client.from('tournament_schedule_batches').select('status').eq('id', batchId).single();
  if (error || !batchRow) throw new Error(`batch re-fetch failed: ${error?.message}`);
  assert(batchRow.status !== 'saving', `expected batch not stuck in 'saving', got '${batchRow.status}'`);
  assert(batchRow.status === 'saved', `expected final batch status 'saved', got '${batchRow.status}'`);
}

async function scenarioRollback(): Promise<void> {
  throw new BlockedError(
    'No rollback workflow is implemented in this codebase for schedule import batches. ' +
      'app/api/tournament/admin/schedule/ contains only template/, import/preview/, and import/save/ routes — ' +
      'no rollback route file exists anywhere in the repo. tournament_schedule_batches has a "rolled_back" status ' +
      'value and rolled_back_at/rolled_back_by columns (schema-only, added by migration 011, never written by any ' +
      'code), and TOURNAMENT_V2_SCHEDULING_AND_IMPORT.md §9 documents an intended future ' +
      'POST /schedule/import/batches/{id}/rollback endpoint that has not been built. Implementing it now would be ' +
      'starting a new feature, which is explicitly out of scope for this runtime-verification task.'
  );
}

// ============================================================================
// Cleanup — direct disposable-row deletion (no rollback endpoint exists; see
// scenarioRollback above). Explicit deletes for rows that do NOT cascade from
// the tournament delete: tournament_matches and tournament_schedule_versions
// both have their batch_id FK as ON DELETE SET NULL (not cascade), and
// tournament_audit_logs.tournament_id is also ON DELETE SET NULL.
// ============================================================================

async function cleanup(ctx: Ctx): Promise<void> {
  console.log('\n[CLEANUP] Removing all disposable rows...');
  const client = ctx.client;
  const entityIds = [...ctx.batchIds, ...ctx.matchIds];

  if (entityIds.length > 0) {
    const { error: auditErr } = await client.from('tournament_audit_logs').delete().in('entity_id', entityIds);
    if (auditErr) console.error(`[CLEANUP] audit log delete failed: ${auditErr.message}`);
  }
  if (ctx.versionIds.length > 0) {
    const { error: versionErr } = await client.from('tournament_schedule_versions').delete().in('id', ctx.versionIds);
    if (versionErr) console.error(`[CLEANUP] schedule version delete failed: ${versionErr.message}`);
  }
  if (ctx.matchIds.length > 0) {
    const { error: matchErr } = await client.from('tournament_matches').delete().in('id', ctx.matchIds);
    if (matchErr) console.error(`[CLEANUP] match delete failed: ${matchErr.message}`);
  }
  if (ctx.batchIds.length > 0) {
    const { error: batchErr } = await client.from('tournament_schedule_batches').delete().in('id', ctx.batchIds);
    if (batchErr) console.error(`[CLEANUP] batch delete failed: ${batchErr.message}`);
  }

  const { error: tournamentErr } = await client.from('tournaments').delete().eq('id', ctx.tournamentId);
  if (tournamentErr) {
    throw new Error(`tournament delete failed: ${tournamentErr.message} — MANUAL CLEANUP REQUIRED for tournament ${ctx.tournamentId}`);
  }

  const [tAfter, mAfter, bAfter, vAfter, auditAfter] = await Promise.all([
    client.from('tournaments').select('id').eq('id', ctx.tournamentId).maybeSingle(),
    ctx.matchIds.length > 0
      ? client.from('tournament_matches').select('id').in('id', ctx.matchIds)
      : Promise.resolve({ data: [] as { id: string }[], error: null }),
    ctx.batchIds.length > 0
      ? client.from('tournament_schedule_batches').select('id').in('id', ctx.batchIds)
      : Promise.resolve({ data: [] as { id: string }[], error: null }),
    ctx.versionIds.length > 0
      ? client.from('tournament_schedule_versions').select('id').in('id', ctx.versionIds)
      : Promise.resolve({ data: [] as { id: string }[], error: null }),
    entityIds.length > 0
      ? client.from('tournament_audit_logs').select('id').in('entity_id', entityIds)
      : Promise.resolve({ data: [] as { id: string }[], error: null }),
  ]);

  assert(!tAfter.data, `tournament ${ctx.tournamentId} still exists after cleanup`);
  assert((mAfter.data || []).length === 0, `${(mAfter.data || []).length} match rows still exist after cleanup`);
  assert((bAfter.data || []).length === 0, `${(bAfter.data || []).length} batch rows still exist after cleanup`);
  assert((vAfter.data || []).length === 0, `${(vAfter.data || []).length} schedule version rows still exist after cleanup`);
  assert((auditAfter.data || []).length === 0, `${(auditAfter.data || []).length} audit log rows still exist after cleanup`);

  console.log('[CLEANUP] Confirmed: zero disposable rows remain.');
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const client = getTournamentServiceClient();
  console.log(`[INFO] Connected to Tournament Staging host: ${new URL(process.env.TOURNAMENT_SUPABASE_URL || '').host}`);
  console.log(`[INFO] RUN_TAG = ${RUN_TAG}`);

  const ctx = await setup(client);
  let preview: PreviewOutcome | null = null;
  let firstSave: SaveResponse | null = null;

  try {
    await run('Migration 012 indexes exist (uniq_tqualdraw_active_category_slot, uniq_tqualcand_selected_order)', () => checkMigration012Indexes(ctx));

    await run('1-2. Preview draw_selected rows -> Warning, not Error', async () => {
      preview = await scenarioPreview(ctx);
    });
    if (!preview) throw new Error('preview scenario did not produce a batch — aborting dependent scenarios');

    await run('3-4. Save batch successfully -> status becomes saved', async () => {
      firstSave = await scenarioSave(ctx, preview!.batchId);
    });
    if (!firstSave) throw new Error('save scenario failed — aborting dependent scenarios');

    await run('5. Saved Match preserves home/away source_type + source_ref', () => scenarioSourceFieldsPreserved(ctx, preview!.rawRows));
    await run('6. Unresolved draw_selected team_id remains null', () => scenarioUnresolvedTeamIdNull(ctx));
    await run('7. Retry Save on same batch -> idempotent, no duplicate Match', () => scenarioRetrySaveIdempotent(ctx, preview!.batchId, firstSave!));
    await run('8. No batch remains stuck in saving', () => scenarioNoBatchStuckSaving(ctx, preview!.batchId));
    await run('9. Supported rollback workflow', () => scenarioRollback());
  } finally {
    await run('10. Complete cleanup of all disposable rows', () => cleanup(ctx));
  }

  console.log('\n[SUMMARY]');
  let anyFailed = false;
  let anyBlocked = false;
  for (const r of results) {
    const marker = r.ok ? '✓' : r.blocked ? '⚠ BLOCKED' : '✗ FAILED';
    console.log(`  ${marker} ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
    if (!r.ok && !r.blocked) anyFailed = true;
    if (r.blocked) anyBlocked = true;
  }

  if (anyFailed) {
    throw new Error('One or more scenarios FAILED (not merely blocked) — see [SUMMARY] above.');
  }
  if (anyBlocked) {
    const passedCount = results.filter((r) => r.ok).length;
    console.log(`\n${passedCount}/${results.length} scenarios passed; ${results.length - passedCount} blocked (see above). Not all required scenarios could run.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nAll ${results.length} scenarios passed.`);
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((e) => {
    console.error('[FATAL]', e instanceof Error ? e.message : e);
    process.exit(1);
  });

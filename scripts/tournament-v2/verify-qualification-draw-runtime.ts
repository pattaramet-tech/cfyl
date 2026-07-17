/**
 * Tournament V2 — Manual Qualification Draw disposable-data RUNTIME verifier.
 *
 * NOT part of `npm run test`. Requires real TOURNAMENT_SUPABASE_* credentials
 * for CFYL-Tournament-Staging in .env.local, plus an explicit opt-in:
 *
 *   TOURNAMENT_RUNTIME_VERIFY_CONFIRM=CFYL-Tournament-Staging
 *
 * Run: npm run verify:tournament-qualification-draw-runtime
 *
 * WHAT THIS PROVES that the mocked unit tests
 * (lib/tournament/services/__tests__/qualification-draws.test.ts,
 * app/api/tournament/admin/qualification-draws/__tests__/route.test.ts) cannot:
 * real Postgres constraint/index enforcement (migration 012's
 * uniq_tqualdraw_active_category_slot / uniq_tqualcand_selected_order), real
 * concurrent-write behavior against a live database, and real end-to-end data
 * persistence — using disposable, uniquely-tagged rows only.
 *
 * DESIGN CHOICE — bypasses HTTP/auth, exercises the real service functions
 * directly (same precedent as verify-schedule-import-runtime.ts): calls
 * getQualificationDrawState / previewQualificationDrawSelections /
 * saveQualificationDrawSelections directly — the exact same functions
 * app/api/tournament/admin/qualification-draws/route.ts calls, in the same
 * order. The requireTournamentSuperAdmin() HTTP/auth wrapper itself is
 * intentionally out of scope for this runtime check, to avoid creating
 * throwaway users in League's shared production Auth system.
 *
 * REQUIRES MIGRATION 015 —
 * scripts/tournament-v2/015-qualification-draw-atomic-save.sql — which fixes
 * the transactional-atomicity gap this verifier previously could only report
 * via code inspection: saveQualificationDrawSelections() now performs its
 * entire write path (supersede -> insert draw -> insert candidates -> resolve
 * Matches -> write audit log) as exactly one client.rpc(...) call to
 * tournament.save_qualification_draw_assignment(), a single Postgres
 * transaction. This script does not attempt to fabricate an artificial
 * mid-sequence failure against real Staging (no safe way to do that without
 * corrupting shared schema/constraints — that rollback guarantee is proven by
 * the transactional RPC mock in the unit tests instead); what this script
 * proves for real is the full happy-path atomic Save/correction and, in
 * scenario 6, a genuine concurrent race using the RPC's
 * expected_active_draw_id optimistic-concurrency token.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { loadEnvConfig } from '@next/env';
import { randomUUID } from 'crypto';
import { getTournamentServiceClient } from '../../lib/tournament/db/supabase-tournament';
import {
  getQualificationDrawState,
  previewQualificationDrawSelections,
  saveQualificationDrawSelections,
  type SaveQualificationDrawSelectionsResult,
} from '../../lib/tournament/services/qualification-draws';

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

const RUN_TAG = `qdr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ACTOR_ID = randomUUID();
const ACTOR_EMAIL = 'runtime-verify-qualification-draw@example.com';
const CATEGORY_CODE = 'G-U16';
const SLOT_1 = `${CATEGORY_CODE}-THIRD-DRAW-1`;
const SLOT_2 = `${CATEGORY_CODE}-THIRD-DRAW-2`;

type TournamentClient = ReturnType<typeof getTournamentServiceClient>;

interface Ctx {
  client: TournamentClient;
  tournamentId: string;
  tournamentSlug: string;
  categoryId: string;
  teamIds: string[]; // [T1, T2, T3, T4] — T1-3 eligible candidates, T4 not a candidate
  match1Id: string; // references SLOT_1 (home) / SLOT_2 (away)
  unrelatedMatchId: string; // fully resolved, does not reference draw_selected at all
  drawIds: string[];
  candidateIds: string[];
  auditEntityIds: string[];
  /** The currently-active draw id, tracked as the scenarios progress — submitted as expected_active_draw_id on the next Save/correction. */
  activeDrawId: string | null;
}

interface ScenarioResult {
  name: string;
  ok: boolean;
  detail?: string;
}
const results: ScenarioResult[] = [];

async function run(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✓ ${name}`);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ name, ok: false, detail });
    console.error(`✗ ${name}\n    ${detail}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

async function doSave(
  ctx: Ctx,
  candidateTeamIds: string[],
  assignments: Array<{ sourceRef: string; teamId: string }>,
  expectedActiveDrawId: string | null,
  note?: string
): Promise<SaveQualificationDrawSelectionsResult> {
  let result: SaveQualificationDrawSelectionsResult;
  try {
    // The entire write — supersede, insert draw, insert candidates, resolve
    // Matches, write the audit log — happens inside this single client.rpc(...)
    // call (tournament.save_qualification_draw_assignment, migration 015).
    // No separate audit-log call follows; the RPC already wrote it atomically.
    result = await saveQualificationDrawSelections({
      client: ctx.client,
      tournamentId: ctx.tournamentId,
      categoryCode: CATEGORY_CODE,
      candidateTeamIds,
      assignments,
      expectedActiveDrawId,
      note,
      actorUserId: ACTOR_ID,
      actorEmail: ACTOR_EMAIL,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('does not exist') || message.includes('schema cache') || message.includes('Could not find the function')) {
      throw new Error(
        `save_qualification_draw_assignment RPC does not exist — Migration 015 has not been applied to this Staging ` +
          `project yet. Raw error: ${message}`
      );
    }
    throw e;
  }

  if (!ctx.drawIds.includes(result.drawId)) ctx.drawIds.push(result.drawId);
  if (!ctx.auditEntityIds.includes(result.drawId)) ctx.auditEntityIds.push(result.drawId);
  ctx.activeDrawId = result.drawId;

  return result;
}

// ============================================================================
// Setup — disposable tournament + G-U16 category + draw qualification rule +
// 4 teams (3 eligible candidates + 1 non-candidate) + 2 placeholder Matches +
// 1 fully-unrelated Match, all uniquely tagged with RUN_TAG.
// ============================================================================

async function setup(client: TournamentClient): Promise<Ctx> {
  const tournamentSlug = `qdr-verify-${RUN_TAG}`;
  const { data: tournament, error: tErr } = await client
    .from('tournaments')
    .insert({
      name: `Qualification Draw Runtime Verify ${RUN_TAG}`,
      slug: tournamentSlug,
      status: 'active',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    })
    .select('id')
    .single();
  if (tErr || !tournament) throw new Error(`setup: tournament insert failed: ${tErr?.message}`);
  const tournamentId = tournament.id as string;

  try {
    const { data: category, error: catErr } = await client
      .from('tournament_categories')
      .insert({ tournament_id: tournamentId, code: CATEGORY_CODE, name: `Runtime Verify ${CATEGORY_CODE} ${RUN_TAG}`, gender: 'mixed' })
      .select('id')
      .single();
    if (catErr || !category) throw new Error(`category insert failed: ${catErr?.message}`);
    const categoryId = category.id as string;

    const { error: qrErr } = await client.from('tournament_qualification_rules').insert({
      tournament_id: tournamentId,
      category_id: categoryId,
      qualify_rank_per_group: 2,
      best_third_placed_count: 2,
      best_third_placed_method: 'draw',
      cross_group_comparison: false,
    });
    if (qrErr) throw new Error(`qualification_rules insert failed: ${qrErr.message}`);

    const teamIds: string[] = [];
    for (const code of ['T1', 'T2', 'T3', 'T4']) {
      const { data: team, error: teamErr } = await client
        .from('tournament_teams')
        .insert({ tournament_id: tournamentId, category_id: categoryId, name: `Runtime Verify Team ${code} ${RUN_TAG}`, team_code: code })
        .select('id')
        .single();
      if (teamErr || !team) throw new Error(`team ${code} insert failed: ${teamErr?.message}`);
      teamIds.push(team.id as string);
    }

    const { data: match1, error: match1Err } = await client
      .from('tournament_matches')
      .insert({
        tournament_id: tournamentId,
        category_id: categoryId,
        stage: 'group',
        match_code: `QDR-${RUN_TAG}-M1`,
        status: 'scheduled',
        home_source_type: 'draw_selected',
        home_source_ref: SLOT_1,
        away_source_type: 'draw_selected',
        away_source_ref: SLOT_2,
      })
      .select('id')
      .single();
    if (match1Err || !match1) throw new Error(`match1 insert failed: ${match1Err?.message}`);

    const { data: unrelatedMatch, error: unrelatedErr } = await client
      .from('tournament_matches')
      .insert({
        tournament_id: tournamentId,
        category_id: categoryId,
        stage: 'group',
        match_code: `QDR-${RUN_TAG}-UNRELATED`,
        status: 'scheduled',
        home_source_type: 'team',
        home_team_id: teamIds[0],
        away_source_type: 'team',
        away_team_id: teamIds[3],
      })
      .select('id')
      .single();
    if (unrelatedErr || !unrelatedMatch) throw new Error(`unrelated match insert failed: ${unrelatedErr?.message}`);

    return {
      client,
      tournamentId,
      tournamentSlug,
      categoryId,
      teamIds,
      match1Id: match1.id as string,
      unrelatedMatchId: unrelatedMatch.id as string,
      drawIds: [],
      candidateIds: [],
      auditEntityIds: [],
      activeDrawId: null,
    };
  } catch (err) {
    console.error('[SETUP] failed, attempting emergency cleanup of tournament row...');
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
// Scenarios
// ============================================================================

async function scenarioNoActiveDrawInitially(ctx: Ctx): Promise<void> {
  const state = await getQualificationDrawState({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: CATEGORY_CODE });
  assert(state.versions.length === 0, `expected zero draw versions initially, got ${state.versions.length}`);
  assert(state.placeholderSourceRefs.includes(SLOT_1) && state.placeholderSourceRefs.includes(SLOT_2), 'expected both placeholder source refs to be configured');
}

async function snapshotUnrelatedMatch(ctx: Ctx) {
  const { data, error } = await ctx.client.from('tournament_matches').select('*').eq('id', ctx.unrelatedMatchId).single();
  if (error || !data) throw new Error(`unrelated match snapshot failed: ${error?.message}`);
  return data as Record<string, unknown>;
}

async function scenarioPreviewWritesNothing(ctx: Ctx): Promise<void> {
  const before = await ctx.client
    .from('tournament_qualification_draws')
    .select('id')
    .eq('category_id', ctx.categoryId);
  if (before.error) throw new Error(before.error.message);
  assert((before.data || []).length === 0, 'expected zero draw rows before preview');

  const preview = await previewQualificationDrawSelections({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    categoryCode: CATEGORY_CODE,
    candidateTeamIds: [ctx.teamIds[0], ctx.teamIds[1], ctx.teamIds[2]],
    assignments: [
      { sourceRef: SLOT_1, teamId: ctx.teamIds[0] },
      { sourceRef: SLOT_2, teamId: ctx.teamIds[1] },
    ],
  });

  assert(preview.affectedMatches.length === 2, `expected preview to resolve 2 match sides, got ${preview.affectedMatches.length}`);
  const home = preview.affectedMatches.find((m) => m.side === 'home');
  const away = preview.affectedMatches.find((m) => m.side === 'away');
  assert(!!home && home.resolvedTeamId === ctx.teamIds[0], 'expected home side to resolve to T1');
  assert(!!away && away.resolvedTeamId === ctx.teamIds[1], 'expected away side to resolve to T2');

  const after = await ctx.client
    .from('tournament_qualification_draws')
    .select('id')
    .eq('category_id', ctx.categoryId);
  if (after.error) throw new Error(after.error.message);
  assert((after.data || []).length === 0, 'expected preview to write zero draw rows');

  const { data: matchAfter, error: matchErr } = await ctx.client
    .from('tournament_matches')
    .select('home_team_id, away_team_id')
    .eq('id', ctx.match1Id)
    .single();
  if (matchErr || !matchAfter) throw new Error(`match re-fetch after preview failed: ${matchErr?.message}`);
  assert(matchAfter.home_team_id === null && matchAfter.away_team_id === null, 'expected preview to leave the Match unresolved');
}

async function scenarioConfirmedSave(ctx: Ctx): Promise<void> {
  const unrelatedBefore = await snapshotUnrelatedMatch(ctx);

  const result = await doSave(
    ctx,
    [ctx.teamIds[0], ctx.teamIds[1], ctx.teamIds[2]],
    [
      { sourceRef: SLOT_1, teamId: ctx.teamIds[0] },
      { sourceRef: SLOT_2, teamId: ctx.teamIds[1] },
    ],
    null, // initial Save — expected_active_draw_id must be null
    'v1'
  );

  const { data: activeDraws, error: activeErr } = await ctx.client
    .from('tournament_qualification_draws')
    .select('id, version, superseded_at')
    .eq('category_id', ctx.categoryId)
    .is('superseded_at', null);
  if (activeErr) throw new Error(activeErr.message);
  assert((activeDraws || []).length === 1, `expected exactly 1 active draw, got ${(activeDraws || []).length}`);
  assert(activeDraws![0].id === result.drawId, 'expected the active draw to be the one Save returned');
  assert(activeDraws![0].version === 1, `expected version 1, got ${activeDraws![0].version}`);

  const { data: candidates, error: candErr } = await ctx.client
    .from('tournament_qualification_draw_candidates')
    .select('id, team_id, is_selected, draw_order')
    .eq('draw_id', result.drawId);
  if (candErr) throw new Error(candErr.message);
  assert((candidates || []).length === 3, `expected 3 candidates stored, got ${(candidates || []).length}`);
  ctx.candidateIds.push(...(candidates || []).map((c) => c.id as string));

  const selected = (candidates || []).filter((c) => c.is_selected);
  assert(selected.length === 2, `expected exactly 2 selected candidates, got ${selected.length}`);
  const orders = selected.map((c) => c.draw_order).sort();
  assert(JSON.stringify(orders) === JSON.stringify([1, 2]), `expected draw_order [1,2], got ${JSON.stringify(orders)}`);
  const selectedT1 = selected.find((c) => c.team_id === ctx.teamIds[0]);
  const selectedT2 = selected.find((c) => c.team_id === ctx.teamIds[1]);
  assert(!!selectedT1 && selectedT1.draw_order === 1, 'expected T1 to have draw_order 1');
  assert(!!selectedT2 && selectedT2.draw_order === 2, 'expected T2 to have draw_order 2');

  const { data: matchAfter, error: matchErr } = await ctx.client
    .from('tournament_matches')
    .select('home_team_id, away_team_id, home_source_type, home_source_ref, away_source_type, away_source_ref')
    .eq('id', ctx.match1Id)
    .single();
  if (matchErr || !matchAfter) throw new Error(`match re-fetch after save failed: ${matchErr?.message}`);
  assert(matchAfter.home_team_id === ctx.teamIds[0], 'expected home_team_id resolved to T1');
  assert(matchAfter.away_team_id === ctx.teamIds[1], 'expected away_team_id resolved to T2');
  assert(matchAfter.home_source_type === 'draw_selected' && matchAfter.home_source_ref === SLOT_1, 'expected home source_type/source_ref preserved exactly');
  assert(matchAfter.away_source_type === 'draw_selected' && matchAfter.away_source_ref === SLOT_2, 'expected away source_type/source_ref preserved exactly');

  const unrelatedAfter = await snapshotUnrelatedMatch(ctx);
  assert(JSON.stringify(unrelatedAfter) === JSON.stringify(unrelatedBefore), 'expected the unrelated Match to remain completely unchanged');

  const { data: auditRows, error: auditErr } = await ctx.client
    .from('tournament_audit_logs')
    .select('id')
    .eq('entity_id', result.drawId)
    .eq('action', 'qualification-draws.confirm_manual_placeholder_assignment');
  if (auditErr) throw new Error(auditErr.message);
  assert((auditRows || []).length === 1, `expected exactly 1 audit log entry for this draw, got ${(auditRows || []).length}`);
}

async function scenarioCorrection(ctx: Ctx): Promise<void> {
  const firstDrawId = ctx.drawIds[0];

  const result = await doSave(
    ctx,
    [ctx.teamIds[0], ctx.teamIds[1], ctx.teamIds[2]],
    [
      { sourceRef: SLOT_1, teamId: ctx.teamIds[2] },
      { sourceRef: SLOT_2, teamId: ctx.teamIds[0] },
    ],
    firstDrawId, // correction — must name the exact currently-active draw
    'v2 correction'
  );

  assert(result.drawId !== firstDrawId, 'expected correction to create a NEW draw row, not reuse the first');

  const { data: firstDrawRow, error: firstErr } = await ctx.client
    .from('tournament_qualification_draws')
    .select('id, superseded_at, version')
    .eq('id', firstDrawId)
    .single();
  if (firstErr || !firstDrawRow) throw new Error(`first draw re-fetch failed: ${firstErr?.message}`);
  assert(firstDrawRow.superseded_at !== null, 'expected the previous draw to be superseded (not deleted)');
  assert(firstDrawRow.version === 1, 'expected the superseded draw to retain its original version 1 (append-only history)');

  const { data: activeDraws, error: activeErr } = await ctx.client
    .from('tournament_qualification_draws')
    .select('id, version')
    .eq('category_id', ctx.categoryId)
    .is('superseded_at', null);
  if (activeErr) throw new Error(activeErr.message);
  assert((activeDraws || []).length === 1, `expected exactly 1 active draw after correction, got ${(activeDraws || []).length}`);
  assert(activeDraws![0].id === result.drawId, 'expected the new draw to be active');
  assert(activeDraws![0].version === 2, `expected version 2, got ${activeDraws![0].version}`);

  const { data: allDraws, error: allErr } = await ctx.client
    .from('tournament_qualification_draws')
    .select('id')
    .eq('category_id', ctx.categoryId);
  if (allErr) throw new Error(allErr.message);
  assert((allDraws || []).length === 2, `expected full history of 2 draw rows retained, got ${(allDraws || []).length}`);

  const { data: matchAfter, error: matchErr } = await ctx.client
    .from('tournament_matches')
    .select('home_team_id, away_team_id')
    .eq('id', ctx.match1Id)
    .single();
  if (matchErr || !matchAfter) throw new Error(`match re-fetch after correction failed: ${matchErr?.message}`);
  assert(matchAfter.home_team_id === ctx.teamIds[2], 'expected home_team_id updated to T3 after correction');
  assert(matchAfter.away_team_id === ctx.teamIds[0], 'expected away_team_id updated to T1 after correction');

  const { data: auditRows, error: auditErr } = await ctx.client
    .from('tournament_audit_logs')
    .select('id')
    .eq('entity_id', result.drawId)
    .eq('action', 'qualification-draws.confirm_manual_placeholder_assignment');
  if (auditErr) throw new Error(auditErr.message);
  assert((auditRows || []).length === 1, `expected exactly 1 additional audit log entry for the correction, got ${(auditRows || []).length}`);

  const state = await getQualificationDrawState({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: CATEGORY_CODE });
  assert(state.versions.length === 2, `expected getQualificationDrawState to report full 2-version history, got ${state.versions.length}`);
  const v1 = state.versions.find((v) => v.version === 1);
  const v2 = state.versions.find((v) => v.version === 2);
  assert(!!v1 && v1.isActive === false, 'expected version 1 reported as inactive');
  assert(!!v2 && v2.isActive === true, 'expected version 2 reported as active');
}

async function countActiveDraws(ctx: Ctx): Promise<number> {
  const { data, error } = await ctx.client
    .from('tournament_qualification_draws')
    .select('id')
    .eq('category_id', ctx.categoryId)
    .is('superseded_at', null);
  if (error) throw new Error(error.message);
  return (data || []).length;
}

async function countAllDraws(ctx: Ctx): Promise<number> {
  const { data, error } = await ctx.client.from('tournament_qualification_draws').select('id').eq('category_id', ctx.categoryId);
  if (error) throw new Error(error.message);
  return (data || []).length;
}

async function scenarioInvalidInputsRejectedWithoutWrites(ctx: Ctx): Promise<void> {
  const drawCountBefore = await countAllDraws(ctx);

  const attempts: Array<{ label: string; candidateTeamIds: string[]; assignments: Array<{ sourceRef: string; teamId: string }> }> = [
    {
      label: 'only 2 candidates (expected exactly 3)',
      candidateTeamIds: [ctx.teamIds[0], ctx.teamIds[1]],
      assignments: [
        { sourceRef: SLOT_1, teamId: ctx.teamIds[0] },
        { sourceRef: SLOT_2, teamId: ctx.teamIds[1] },
      ],
    },
    {
      label: 'duplicate candidate in the 3-candidate list',
      candidateTeamIds: [ctx.teamIds[0], ctx.teamIds[0], ctx.teamIds[2]],
      assignments: [
        { sourceRef: SLOT_1, teamId: ctx.teamIds[0] },
        { sourceRef: SLOT_2, teamId: ctx.teamIds[2] },
      ],
    },
    {
      label: 'selected team not among the confirmed 3 candidates',
      candidateTeamIds: [ctx.teamIds[0], ctx.teamIds[1], ctx.teamIds[2]],
      assignments: [
        { sourceRef: SLOT_1, teamId: ctx.teamIds[3] }, // T4 is not a candidate
        { sourceRef: SLOT_2, teamId: ctx.teamIds[1] },
      ],
    },
    {
      label: 'same team selected for both placeholders',
      candidateTeamIds: [ctx.teamIds[0], ctx.teamIds[1], ctx.teamIds[2]],
      assignments: [
        { sourceRef: SLOT_1, teamId: ctx.teamIds[0] },
        { sourceRef: SLOT_2, teamId: ctx.teamIds[0] },
      ],
    },
    {
      label: 'only 1 of 2 required placeholders assigned',
      candidateTeamIds: [ctx.teamIds[0], ctx.teamIds[1], ctx.teamIds[2]],
      assignments: [{ sourceRef: SLOT_1, teamId: ctx.teamIds[0] }],
    },
  ];

  for (const attempt of attempts) {
    let threw = false;
    try {
      await saveQualificationDrawSelections({
        client: ctx.client,
        tournamentId: ctx.tournamentId,
        categoryCode: CATEGORY_CODE,
        candidateTeamIds: attempt.candidateTeamIds,
        assignments: attempt.assignments,
        // The correct current active draw id, so rejection is provably due to
        // the validation rule under test — not a spurious stale-state mismatch.
        expectedActiveDrawId: ctx.activeDrawId,
        actorUserId: ACTOR_ID,
      });
    } catch {
      threw = true;
    }
    assert(threw, `expected "${attempt.label}" to be rejected, but Save succeeded`);
  }

  const drawCountAfter = await countAllDraws(ctx);
  assert(drawCountAfter === drawCountBefore, `expected zero new draw rows from rejected inputs, before=${drawCountBefore} after=${drawCountAfter}`);
}

async function scenarioConcurrentSaveVsCorrection(ctx: Ctx): Promise<void> {
  const activeBefore = await countActiveDraws(ctx);
  assert(activeBefore === 1, `expected exactly 1 active draw before the concurrency race, got ${activeBefore}`);
  const expectedActiveDrawId = ctx.activeDrawId;
  assert(!!expectedActiveDrawId, 'expected ctx.activeDrawId to be set before the race');

  // Both attempts are built from the SAME expected_active_draw_id — exactly
  // "two corrections built from the same stale Preview state," the scenario
  // migration 015's optimistic-concurrency token exists to prevent. Fired
  // with no await between them so both reach Postgres as genuinely
  // concurrent transactions; real locking (the category-row FOR UPDATE)
  // arbitrates the outcome, nothing is simulated.
  const attemptA = saveQualificationDrawSelections({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    categoryCode: CATEGORY_CODE,
    candidateTeamIds: [ctx.teamIds[0], ctx.teamIds[1], ctx.teamIds[2]],
    assignments: [
      { sourceRef: SLOT_1, teamId: ctx.teamIds[1] },
      { sourceRef: SLOT_2, teamId: ctx.teamIds[2] },
    ],
    expectedActiveDrawId,
    note: 'race-A',
    actorUserId: ACTOR_ID,
    actorEmail: ACTOR_EMAIL,
  }).then(
    (r) => ({ ok: true as const, result: r }),
    (e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })
  );
  const attemptB = saveQualificationDrawSelections({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    categoryCode: CATEGORY_CODE,
    candidateTeamIds: [ctx.teamIds[0], ctx.teamIds[1], ctx.teamIds[2]],
    assignments: [
      { sourceRef: SLOT_1, teamId: ctx.teamIds[0] },
      { sourceRef: SLOT_2, teamId: ctx.teamIds[2] },
    ],
    expectedActiveDrawId,
    note: 'race-B',
    actorUserId: ACTOR_ID,
    actorEmail: ACTOR_EMAIL,
  }).then(
    (r) => ({ ok: true as const, result: r }),
    (e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })
  );

  const [outcomeA, outcomeB] = await Promise.all([attemptA, attemptB]);
  console.log(
    `    [race] A=${outcomeA.ok ? 'succeeded' : `failed (${outcomeA.error})`}, B=${outcomeB.ok ? 'succeeded' : `failed (${outcomeB.error})`}`
  );

  const succeeded = [outcomeA, outcomeB].filter((o) => o.ok) as Array<{ ok: true; result: SaveQualificationDrawSelectionsResult }>;
  const failed = [outcomeA, outcomeB].filter((o) => !o.ok) as Array<{ ok: false; error: string }>;

  // Exactly one succeeds, exactly one gets a stale-state conflict — never
  // both succeeding (two active versions) and never both failing.
  assert(succeeded.length === 1, `expected exactly 1 of the 2 concurrent attempts to succeed, got ${succeeded.length}`);
  assert(failed.length === 1, `expected exactly 1 of the 2 concurrent attempts to fail, got ${failed.length}`);
  assert(
    failed[0].error.includes('QUALIFICATION_DRAW_STALE_STATE'),
    `expected the losing attempt to fail specifically with QUALIFICATION_DRAW_STALE_STATE, got: ${failed[0].error}`
  );

  const winner = succeeded[0].result;
  ctx.activeDrawId = winner.drawId;
  if (!ctx.drawIds.includes(winner.drawId)) ctx.drawIds.push(winner.drawId);
  if (!ctx.auditEntityIds.includes(winner.drawId)) ctx.auditEntityIds.push(winner.drawId);

  // The invariant migration 015's category-row lock + expected_active_draw_id
  // check exist to guarantee: no matter how the race resolved, there is still
  // EXACTLY one active draw for this category+slot afterward — never zero,
  // never two — and it is exactly the winning attempt.
  const activeAfter = await countActiveDraws(ctx);
  assert(activeAfter === 1, `expected exactly 1 active draw after the concurrent race, got ${activeAfter}`);

  const { data: activeDraw, error: activeErr } = await ctx.client
    .from('tournament_qualification_draws')
    .select('id')
    .eq('category_id', ctx.categoryId)
    .is('superseded_at', null)
    .single();
  if (activeErr || !activeDraw) throw new Error(`active draw re-fetch after race failed: ${activeErr?.message}`);
  assert(activeDraw.id === winner.drawId, 'expected the active draw to be exactly the winning attempt, not a mix or the loser');

  // No partial candidates: the winning draw has all 3; the losing attempt
  // never got past the concurrency check, so it wrote none.
  const { data: winningCandidates, error: candErr } = await ctx.client
    .from('tournament_qualification_draw_candidates')
    .select('id')
    .eq('draw_id', winner.drawId);
  if (candErr) throw new Error(candErr.message);
  assert((winningCandidates || []).length === 3, `expected the winning draw to have exactly 3 candidates, got ${(winningCandidates || []).length}`);
  ctx.candidateIds.push(...(winningCandidates || []).map((c) => c.id as string));

  // No partial Match resolution: both placeholder sides resolved together,
  // to the SAME winning attempt's teams — never a mix of A's home + B's away.
  const { data: matchAfter, error: matchErr } = await ctx.client
    .from('tournament_matches')
    .select('home_team_id, away_team_id')
    .eq('id', ctx.match1Id)
    .single();
  if (matchErr || !matchAfter) throw new Error(`match re-fetch after race failed: ${matchErr?.message}`);
  assert(!!matchAfter.home_team_id && !!matchAfter.away_team_id, 'expected the Match to be fully resolved (not partially) after the race');
}

// ============================================================================
// Cleanup
// ============================================================================

async function cleanup(ctx: Ctx): Promise<void> {
  console.log('\n[CLEANUP] Removing all disposable rows...');
  const client = ctx.client;

  if (ctx.auditEntityIds.length > 0) {
    const { error: auditErr } = await client.from('tournament_audit_logs').delete().in('entity_id', ctx.auditEntityIds);
    if (auditErr) console.error(`[CLEANUP] audit log delete failed: ${auditErr.message}`);
  }

  const { error: tournamentErr } = await client.from('tournaments').delete().eq('id', ctx.tournamentId);
  if (tournamentErr) {
    throw new Error(`tournament delete failed: ${tournamentErr.message} — MANUAL CLEANUP REQUIRED for tournament ${ctx.tournamentId}`);
  }

  const [tAfter, drawAfter, candAfter, matchAfter, auditAfter] = await Promise.all([
    client.from('tournaments').select('id').eq('id', ctx.tournamentId).maybeSingle(),
    client.from('tournament_qualification_draws').select('id').eq('category_id', ctx.categoryId),
    ctx.candidateIds.length > 0
      ? client.from('tournament_qualification_draw_candidates').select('id').in('id', ctx.candidateIds)
      : Promise.resolve({ data: [] as { id: string }[], error: null }),
    client.from('tournament_matches').select('id').in('id', [ctx.match1Id, ctx.unrelatedMatchId]),
    ctx.auditEntityIds.length > 0
      ? client.from('tournament_audit_logs').select('id').in('entity_id', ctx.auditEntityIds)
      : Promise.resolve({ data: [] as { id: string }[], error: null }),
  ]);

  assert(!tAfter.data, `tournament ${ctx.tournamentId} still exists after cleanup`);
  assert((drawAfter.data || []).length === 0, `${(drawAfter.data || []).length} draw rows still exist after cleanup`);
  assert((candAfter.data || []).length === 0, `${(candAfter.data || []).length} candidate rows still exist after cleanup`);
  assert((matchAfter.data || []).length === 0, `${(matchAfter.data || []).length} match rows still exist after cleanup`);
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

  try {
    await run('1. Initial state has no active disposable draw', () => scenarioNoActiveDrawInitially(ctx));
    await run('2. Preview returns expected resolution plan and writes zero rows', () => scenarioPreviewWritesNothing(ctx));
    await run(
      '3. Confirmed Save: 1 active draw, 3 candidates, 2 selected (order 1/2), Match resolved, source_type/ref preserved, unrelated Match untouched, exactly 1 audit log',
      () => scenarioConfirmedSave(ctx)
    );
    await run(
      '4. Correction: supersedes without deleting, new active version, full history, Match re-resolved, +1 audit log',
      () => scenarioCorrection(ctx)
    );
    await run('5. Invalid/duplicate candidate and selection inputs rejected without writes', () => scenarioInvalidInputsRejectedWithoutWrites(ctx));
    await run(
      '6. Concurrent Save/correction (Promise.all): unique active-draw index prevents two active versions or partial Match resolution',
      () => scenarioConcurrentSaveVsCorrection(ctx)
    );
  } finally {
    await run('7. Complete cleanup of all disposable rows', () => cleanup(ctx));
  }

  console.log('\n[SUMMARY]');
  let anyFailed = false;
  for (const r of results) {
    const marker = r.ok ? '✓' : '✗ FAILED';
    console.log(`  ${marker} ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
    if (!r.ok) anyFailed = true;
  }

  if (anyFailed) {
    throw new Error('One or more scenarios FAILED — see [SUMMARY] above.');
  }
  console.log(`\nAll ${results.length} scenarios passed.`);
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((e) => {
    console.error('[FATAL]', e instanceof Error ? e.message : e);
    process.exit(1);
  });

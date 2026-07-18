// Tournament V2 — Migration 019 + 020 runtime verification.
// NOT part of `npm run test` — requires real TOURNAMENT_SUPABASE_* credentials
// pointed at CFYL-Tournament-Staging, where Migration 019
// (scripts/tournament-v2/019-qualification-cutoff-tie-draw.sql) AND Migration
// 020 (scripts/tournament-v2/020-qualification-cutoff-draw-resurrection-fix.sql)
// have been manually applied. Run:
//
//   npm run verify:tournament-qualification-cutoff-draw-runtime
//
// SAFETY: this script writes real rows to whatever TOURNAMENT_SUPABASE_URL
// points at. It refuses to run unless TOURNAMENT_RUNTIME_VERIFY_CONFIRM is
// set to the exact literal string "CFYL-Tournament-Staging". Every row this
// script creates is uniquely named (prefixed with a per-run tag) and is
// deleted again at the end, in a try/finally so cleanup runs even if a
// scenario fails or throws. This script never touches Production — it has
// no Production credentials — and never re-applies or modifies any
// migration.
//
// FIXTURE DESIGN (revised after the first Staging run found a
// fixture/scenario-ordering bug — see PR #13 discussion):
//
//  - MAIN group (code 'A', 5 teams A/B/C/D/E) exercises the "score
//    correction shrinks a tie cluster while a tie still straddles the
//    cutoff" path (scenarios 2, 3, 4, 5, 6, 6b, 7, 9, 10). A 4-team group
//    with an undefeated leader cannot produce a clean 2-way tie among the
//    remaining 3 teams after a single-match correction (proven: only a
//    3-way tie or a strict hierarchy is reachable — see PR #13 analysis).
//    5 teams are required: A beats everyone (12pts); B loses to everyone
//    (0pts); C/D/E each beat B AND form a 3-way cycle among themselves
//    (C beats D, D beats E, E beats C) — each of C/D/E ends with exactly 2
//    wins (1 vs B, 1 in the cycle) = 6pts, tied for the single remaining
//    slot behind A. Flipping the B-vs-E result (B beats E instead of E
//    beats B) removes E from the tie (E drops to 3pts, B rises to 3pts)
//    while leaving C and D — whose matches never involve B-vs-E — UNCHANGED
//    at 6pts each: a clean shrink from a 3-way tie {C,D,E} to a persisting
//    2-way tie {C,D}, which is exactly what a stale-draw regression needs
//    (the previous fixture's "correction" happened to leave zero tie
//    cluster, which is mathematically incapable of ever producing this
//    state — see the old scenario 5/6/8 failures on Staging).
//
//  - CONCURRENCY group (code 'B', 4 teams F/G/H/I) is a wholly separate,
//    disposable fixture used ONLY for scenario 8. Running concurrency
//    against the MAIN group after scenario 6b left it in 'draw_recorded',
//    not 'pending_draw'/'stale_draw' — the root cause of the original
//    Staging failure ("expected pending/stale draw scenario, got
//    resolved"/"got resolved"). This group is built fresh into
//    'pending_draw' and touched by nothing else.
//
//  - RESURRECTION group (code 'C', 4 teams J/K/L/M) is a third wholly
//    separate fixture used ONLY for the Section D regression: record a
//    draw while a tie cluster exists, correct a result so the tie cluster
//    disappears (qualification becomes 'resolved' by points alone), then
//    correct it BACK so the derived candidate id set + available slots
//    byte-match the original tie cluster again. Proves the old draw does
//    NOT silently resurrect as 'draw_recorded' — it must report
//    'stale_draw', because Migration 020's officialResultRevision
//    fingerprint changed even though the derived candidate set reverted.

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

const REQUIRED_CONFIRM = 'CFYL-Tournament-Staging';
if (process.env.TOURNAMENT_RUNTIME_VERIFY_CONFIRM !== REQUIRED_CONFIRM) {
  console.error(
    `[SAFETY] Refusing to run: set TOURNAMENT_RUNTIME_VERIFY_CONFIRM="${REQUIRED_CONFIRM}" in .env.local to confirm you intend to write disposable rows to that exact Staging project. This script never runs without that explicit confirmation.`
  );
  process.exit(1);
}

import { randomUUID } from 'crypto';
import { getTournamentServiceClient } from '../../lib/tournament/db/supabase-tournament';
import { previewFullMatchReport, publishFullMatchReport, type FullMatchReportInput } from '../../lib/tournament/services/fullMatchReport';
import { previewResultCorrection, publishResultCorrection, type CorrectedResultInput } from '../../lib/tournament/services/resultCorrection';
import {
  loadQualificationCutoffDrawContext,
  previewQualificationCutoffDraw,
  saveQualificationCutoffDraw,
  QualificationCutoffDrawError,
  type QualificationCutoffDrawContext,
} from '../../lib/tournament/services/qualification-cutoff-draws';
import { GET as publicStandingsGet } from '../../app/api/tournament/public/standings/route';

type TournamentClient = ReturnType<typeof getTournamentServiceClient>;

const RUN_TAG = `qcv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ACTOR_EMAIL = 'runtime-verify-qualification-cutoff@example.com';

console.log(`[VERIFY] Run tag: ${RUN_TAG}`);
console.log(`[VERIFY] TOURNAMENT_SUPABASE_URL host: ${new URL(process.env.TOURNAMENT_SUPABASE_URL || '').host}`);

interface GroupCtx {
  groupId: string;
  groupCode: string;
  teamIds: string[];
  matchIdByCode: Map<string, string>;
}

interface Ctx {
  client: TournamentClient;
  tournamentId: string;
  categoryId: string;
  categoryCode: string;
  venueId: string;
  actorId: string;
  matchIds: string[]; // every match created across every group, for cleanup + blanket checks
  main: GroupCtx; // 5 teams A/B/C/D/E
  concurrency: GroupCtx; // 4 teams F/G/H/I
  resurrection: GroupCtx; // 4 teams J/K/L/M
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
    console.log(`  ✓ ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, detail });
    console.error(`  ✗ ${name}: ${detail}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

function sortedIds(ids: string[]): string[] {
  return [...ids].sort();
}

function assertSameIdSet(actual: string[], expected: string[], message: string): void {
  assert(JSON.stringify(sortedIds(actual)) === JSON.stringify(sortedIds(expected)), message);
}

async function setup(client: TournamentClient): Promise<{ tournamentId: string; categoryId: string; categoryCode: string; venueId: string; actorId: string }> {
  console.log('\n[SETUP] Creating disposable tournament/category/venue/user profile...');

  const { data: tournament, error: tErr } = await client
    .from('tournaments')
    .insert({ name: `Runtime Verify Cutoff ${RUN_TAG}`, slug: `${RUN_TAG}-tour`, status: 'active' })
    .select('id')
    .single();
  if (tErr || !tournament) throw new Error(`tournament insert failed: ${tErr?.message}`);
  const tournamentId = (tournament as { id: string }).id;

  try {
    return await setupRemainder(client, tournamentId);
  } catch (error) {
    console.error(`[SETUP] Failed partway through — deleting the partially-created tournament ${tournamentId}...`);
    await client.from('tournaments').delete().eq('id', tournamentId);
    throw error;
  }
}

async function setupRemainder(client: TournamentClient, tournamentId: string): Promise<{ tournamentId: string; categoryId: string; categoryCode: string; venueId: string; actorId: string }> {
  const categoryCode = `RQC-${RUN_TAG.slice(-6).toUpperCase()}`;
  const { data: category, error: cErr } = await client
    .from('tournament_categories')
    .insert({ tournament_id: tournamentId, code: categoryCode, name: 'Runtime Verify Cutoff Category', gender: 'mixed' })
    .select('id')
    .single();
  if (cErr || !category) throw new Error(`category insert failed: ${cErr?.message}`);
  const categoryId = (category as { id: string }).id;

  const { data: venue, error: vErr } = await client
    .from('tournament_venues')
    .insert({ tournament_id: tournamentId, name: `RQC Venue ${RUN_TAG}`, code: `RQC-${RUN_TAG.slice(-4)}`, slug: `${RUN_TAG}-venue` })
    .select('id')
    .single();
  if (vErr || !venue) throw new Error(`venue insert failed: ${vErr?.message}`);
  const venueId = (venue as { id: string }).id;

  const { error: ruleErr } = await client
    .from('tournament_qualification_rules')
    .insert({ tournament_id: tournamentId, category_id: categoryId, qualify_rank_per_group: 2, best_third_placed_count: 0, best_third_placed_method: 'ranked', cross_group_comparison: false });
  if (ruleErr) throw new Error(`qualification rule insert failed: ${ruleErr.message}`);

  const actorId = randomUUID();
  const { error: profileErr } = await client
    .from('tournament_user_profiles')
    .insert({ id: actorId, email: ACTOR_EMAIL, full_name: `Runtime Verify Cutoff Actor ${RUN_TAG}`, active: true });
  if (profileErr) throw new Error(`actor profile insert failed: ${profileErr.message}`);

  console.log('[SETUP] Done.\n');
  return { tournamentId, categoryId, categoryCode, venueId, actorId };
}

/** Creates one group + its teams + group_members. Fully isolated from any
 * other group created by this script (distinct group code, distinct team
 * codes/names) so scenarios run against one group can never observe state
 * mutated by another group's scenarios. */
async function createGroupWithTeams(
  base: { client: TournamentClient; tournamentId: string; categoryId: string },
  groupCode: string,
  teamLetters: string[]
): Promise<GroupCtx> {
  const { data: group, error: gErr } = await base.client
    .from('tournament_groups')
    .insert({ tournament_id: base.tournamentId, category_id: base.categoryId, name: `Runtime Verify Cutoff Group ${groupCode}`, code: groupCode })
    .select('id')
    .single();
  if (gErr || !group) throw new Error(`group ${groupCode} insert failed: ${gErr?.message}`);
  const groupId = (group as { id: string }).id;

  const { data: teamsData, error: teamsErr } = await base.client
    .from('tournament_teams')
    .insert(teamLetters.map((letter) => ({ tournament_id: base.tournamentId, category_id: base.categoryId, name: `RQC ${groupCode}${letter} ${RUN_TAG}`, team_code: `RQC${groupCode}${letter}-${RUN_TAG.slice(-4)}` })))
    .select('id, name');
  if (teamsErr || !teamsData) throw new Error(`group ${groupCode} teams insert failed: ${teamsErr?.message}`);
  // Preserve teamLetters order — DB insert order is not guaranteed to match.
  const byName = new Map(((teamsData as { id: string; name: string }[])).map((t) => [t.name, t.id]));
  const teamIds = teamLetters.map((letter) => {
    const id = byName.get(`RQC ${groupCode}${letter} ${RUN_TAG}`);
    if (!id) throw new Error(`team ${groupCode}${letter} was not returned by insert`);
    return id;
  });

  const { error: gmErr } = await base.client
    .from('tournament_group_members')
    .insert(teamIds.map((teamId, i) => ({ group_id: groupId, team_id: teamId, slot_code: `${groupCode}${i + 1}` })));
  if (gmErr) throw new Error(`group ${groupCode} group_members insert failed: ${gmErr.message}`);

  return { groupId, groupCode, teamIds, matchIdByCode: new Map() };
}

async function createMatch(ctx: Ctx, group: GroupCtx, matchCode: string, homeTeamId: string, awayTeamId: string): Promise<string> {
  const fullCode = `${group.groupCode}-${matchCode}`;
  const { data, error } = await ctx.client
    .from('tournament_matches')
    .insert({
      tournament_id: ctx.tournamentId,
      category_id: ctx.categoryId,
      group_id: group.groupId,
      venue_id: ctx.venueId,
      match_code: `${RUN_TAG}-${fullCode}`,
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      status: 'in_progress',
      result_workflow_status: 'not_started',
      schedule_status: 'published',
      version: 1,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`match ${fullCode} insert failed: ${error?.message}`);
  const id = (data as { id: string }).id;
  ctx.matchIds.push(id);
  group.matchIdByCode.set(matchCode, id);
  return id;
}

async function publishRegulationResult(ctx: Ctx, matchId: string, homeTeamId: string, awayTeamId: string, homeScore: number, awayScore: number): Promise<void> {
  const winnerTeamId = homeScore > awayScore ? homeTeamId : awayTeamId;
  const input: FullMatchReportInput = {
    regulationHomeScore: homeScore,
    regulationAwayScore: awayScore,
    penaltyHomeScore: null,
    penaltyAwayScore: null,
    decidedBy: 'regulation',
    winnerTeamId,
    reportText: `Runtime verify cutoff draw ${RUN_TAG}`,
    goals: [],
    cards: [],
  };
  const preview = await previewFullMatchReport({ client: ctx.client, tournamentId: ctx.tournamentId, venueId: ctx.venueId, matchId, actorUserId: ctx.actorId, input });
  await publishFullMatchReport({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    venueId: ctx.venueId,
    matchId,
    expectedVersion: preview.currentVersion,
    idempotencyKey: `${RUN_TAG}-idem-fullreport-${matchId}`,
    previewToken: preview.previewToken,
    actorUserId: ctx.actorId,
    actorEmail: ACTOR_EMAIL,
    input,
  });
}

async function correctResult(ctx: Ctx, matchId: string, homeTeamId: string, awayTeamId: string, homeScore: number, awayScore: number, correctionTag: string): Promise<void> {
  const winnerTeamId = homeScore > awayScore ? homeTeamId : awayTeamId;
  const input: CorrectedResultInput = {
    regulationHomeScore: homeScore,
    regulationAwayScore: awayScore,
    penaltyHomeScore: null,
    penaltyAwayScore: null,
    decidedBy: 'regulation',
    winnerTeamId,
    correctionReason: `Runtime verify: score recorded incorrectly (${RUN_TAG}-${correctionTag})`,
  };
  const preview = await previewResultCorrection({ client: ctx.client, tournamentId: ctx.tournamentId, matchId, actorUserId: ctx.actorId, input });
  await publishResultCorrection({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    matchId,
    expectedVersion: preview.currentVersion,
    idempotencyKey: `${RUN_TAG}-idem-correction-${correctionTag}-${matchId}`,
    previewToken: preview.previewToken,
    actorUserId: ctx.actorId,
    actorEmail: ACTOR_EMAIL,
    input,
  });
}

function loadContext(ctx: Ctx, group: GroupCtx): Promise<QualificationCutoffDrawContext> {
  return loadQualificationCutoffDrawContext({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: group.groupCode });
}

/** Publishes the full 10-match round robin among A/B/C/D/E so that A wins
 * all 4 (12 pts, clear leader), B loses to everyone (0 pts), and C/D/E form
 * a 3-way cyclic tie at 6 pts each (each beats B, plus wins/loses exactly
 * once within the C->D->E->C cycle) — straddling a qualifyRankPerGroup=2
 * cutoff with 1 available slot. See the file header for why 5 teams (not
 * 4) are required for scenario 5's later single-match correction to shrink
 * the tie cluster without eliminating it. */
async function scenario2SetupOfficialResults(ctx: Ctx): Promise<void> {
  const [A, B, C, D, E] = ctx.main.teamIds;
  const g = ctx.main;

  const mAB = await createMatch(ctx, g, 'm-ab', A, B);
  await publishRegulationResult(ctx, mAB, A, B, 3, 0);
  const mAC = await createMatch(ctx, g, 'm-ac', A, C);
  await publishRegulationResult(ctx, mAC, A, C, 3, 0);
  const mAD = await createMatch(ctx, g, 'm-ad', A, D);
  await publishRegulationResult(ctx, mAD, A, D, 3, 0);
  const mAE = await createMatch(ctx, g, 'm-ae', A, E);
  await publishRegulationResult(ctx, mAE, A, E, 3, 0);
  const mBC = await createMatch(ctx, g, 'm-bc', B, C);
  await publishRegulationResult(ctx, mBC, B, C, 0, 3); // C wins
  const mBD = await createMatch(ctx, g, 'm-bd', B, D);
  await publishRegulationResult(ctx, mBD, B, D, 0, 3); // D wins
  const mBE = await createMatch(ctx, g, 'm-be', B, E);
  await publishRegulationResult(ctx, mBE, B, E, 0, 3); // E wins (flipped in scenario 5)
  const mCD = await createMatch(ctx, g, 'm-cd', C, D);
  await publishRegulationResult(ctx, mCD, C, D, 3, 0); // C wins (cycle)
  const mDE = await createMatch(ctx, g, 'm-de', D, E);
  await publishRegulationResult(ctx, mDE, D, E, 3, 0); // D wins (cycle)
  const mEC = await createMatch(ctx, g, 'm-ec', E, C);
  await publishRegulationResult(ctx, mEC, E, C, 3, 0); // E wins (cycle)

  const context = await loadContext(ctx, g);
  assert(context.qualificationState === 'pending_draw', `expected pending_draw, got ${context.qualificationState}`);
  assert(context.availableSlots === 1, `expected availableSlots=1, got ${context.availableSlots}`);
  assert(context.drawCandidates.length === 3, `expected 3 draw candidates, got ${context.drawCandidates.length}`);
  assertSameIdSet(context.drawCandidates.map((c) => c.teamId), [C, D, E], 'initial tie cluster is exactly {C,D,E}');
}

async function scenario3PreviewWritesZeroRows(ctx: Ctx): Promise<void> {
  const g = ctx.main;
  const { data: before } = await ctx.client.from('tournament_qualification_cutoff_draws').select('id').eq('group_id', g.groupId);
  const context = await loadContext(ctx, g);
  assert(context.drawCandidates.length > 0, 'draw candidates are non-empty before Preview');
  const candidate = context.drawCandidates[0].teamId;
  await previewQualificationCutoffDraw({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: g.groupCode, selectedTeamIds: [candidate], actorUserId: ctx.actorId });
  const { data: after } = await ctx.client.from('tournament_qualification_cutoff_draws').select('id').eq('group_id', g.groupId);
  assert((before || []).length === (after || []).length, 'Preview created no new draw rows');
}

async function scenario4DrawSaveSucceeds(ctx: Ctx): Promise<void> {
  const g = ctx.main;
  const [, , C] = ctx.main.teamIds;
  const preview = await previewQualificationCutoffDraw({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: g.groupCode, selectedTeamIds: [C], actorUserId: ctx.actorId });
  const result = await saveQualificationCutoffDraw({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    categoryCode: ctx.categoryCode,
    groupCode: g.groupCode,
    selectedTeamIds: [C],
    previewToken: preview.previewToken,
    idempotencyKey: `${RUN_TAG}-idem-draw-1`,
    actorUserId: ctx.actorId,
    actorEmail: ACTOR_EMAIL,
  });
  assert(result.idempotent === false, 'first save is not idempotent');
  assert(result.version === 1, `first draw is version 1, got ${result.version}`);

  const context = await loadContext(ctx, g);
  assert(context.qualificationState === 'draw_recorded', `expected draw_recorded, got ${context.qualificationState}`);
  assert(context.selectedByDraw.length === 1 && context.selectedByDraw[0] === C, 'C recorded as selected by draw');
}

/** SECTION A: Score Correction changes the candidate pool while a tie
 * cluster still straddles the cutoff. Flips the B-vs-E result (E no
 * longer beats B; B now beats E) — this changes ONLY E's and B's points
 * (C and D's matches never involve this fixture), shrinking the tie
 * cluster from {C,D,E} to {C,D} without ever eliminating it. */
async function scenario5ScoreCorrectionShrinksCandidatePool(ctx: Ctx): Promise<void> {
  const g = ctx.main;
  const beforeContext = await loadContext(ctx, g);
  const snapshotBefore = beforeContext.candidateSnapshot;
  assert(beforeContext.qualificationState === 'draw_recorded', `precondition: main group has a recorded draw before correction, got ${beforeContext.qualificationState}`);

  const [, B, C, D, E] = ctx.main.teamIds;
  const beMatchId = g.matchIdByCode.get('m-be');
  assert(!!beMatchId, 'the B-vs-E match id was recorded during setup');

  await correctResult(ctx, beMatchId as string, B, E, 2, 0, 'flip-be'); // B wins instead of E

  const afterContext = await loadContext(ctx, g);
  assert(afterContext.qualificationState === 'stale_draw', `expected stale_draw immediately after the correction, got ${afterContext.qualificationState}`);
  assert(afterContext.availableSlots === 1, `expected availableSlots=1, got ${afterContext.availableSlots}`);
  assertSameIdSet(afterContext.drawCandidates.map((c) => c.teamId), [C, D], 'new candidate pool is exactly {C,D} — E dropped out, C and D are unaffected');
  assert(afterContext.candidateSnapshot !== snapshotBefore, 'candidate snapshot changed after the Score Correction altered the candidate pool');
}

/** SECTION B (scenario 6): the draw recorded in scenario 4 is now stale —
 * assert state AND the candidate pool/availableSlots it should be recomputed
 * against, not just the bare state string. */
async function scenario6StaleDraw(ctx: Ctx): Promise<void> {
  const g = ctx.main;
  const [, , C, D] = ctx.main.teamIds;
  const context = await loadContext(ctx, g);
  assert(context.qualificationState === 'stale_draw', `expected stale_draw, got ${context.qualificationState}`);
  assert(context.availableSlots === 1, `expected availableSlots=1, got ${context.availableSlots}`);
  assertSameIdSet(context.drawCandidates.map((c) => c.teamId), [C, D], 'stale-draw candidate pool is exactly {C,D}');
}

/** SECTION B (scenario 6b): re-draw after stale. Fails closed if the
 * candidate pool were ever empty (would previously throw an undefined
 * "reading 'teamId'" TypeError deep inside the scenario instead of a clear
 * assertion failure), selects from the ACTUAL current pool (never a
 * hardcoded team), and checks version bump, supersession, Audit, and
 * Version History — not just the bare qualificationState. */
async function scenario6bReDrawAfterStale(ctx: Ctx): Promise<void> {
  const g = ctx.main;
  const before = await loadContext(ctx, g);
  assert(before.drawCandidates.length > 0, 'fail-fast: candidate pool must be non-empty before selecting drawCandidates[0]');
  const previousActiveDrawId = before.activeDrawId;
  assert(!!previousActiveDrawId, 'a stale draw is still the "active" row until superseded by the new save');

  const newCandidate = before.drawCandidates[0].teamId;
  const preview = await previewQualificationCutoffDraw({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: g.groupCode, selectedTeamIds: [newCandidate], actorUserId: ctx.actorId });
  const result = await saveQualificationCutoffDraw({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    categoryCode: ctx.categoryCode,
    groupCode: g.groupCode,
    selectedTeamIds: [newCandidate],
    previewToken: preview.previewToken,
    idempotencyKey: `${RUN_TAG}-idem-draw-2`,
    actorUserId: ctx.actorId,
    actorEmail: ACTOR_EMAIL,
  });
  assert(result.idempotent === false, 're-draw after stale is a genuinely new save');
  assert(result.version === 2, `re-draw after stale is version 2, got ${result.version}`);

  const after = await loadContext(ctx, g);
  assert(after.qualificationState === 'draw_recorded', `expected draw_recorded after Save, got ${after.qualificationState}`);
  assert(after.selectedByDraw.length === 1 && after.selectedByDraw[0] === newCandidate, `selectedByDraw matches the selected team ${newCandidate}`);
  assert(after.activeDrawId !== previousActiveDrawId, 'the new draw has a different (new) active draw id than the superseded one');

  // Version History — the old draw must show up as superseded, the new one as active.
  assert(after.versions.length >= 2, `expected at least 2 versions in history, got ${after.versions.length}`);
  const oldVersionEntry = after.versions.find((v) => v.drawId === previousActiveDrawId);
  const newVersionEntry = after.versions.find((v) => v.drawId === after.activeDrawId);
  assert(!!oldVersionEntry, 'the superseded draw is still present in version history');
  assert(oldVersionEntry?.isActive === false, 'the superseded draw is marked inactive in version history');
  assert(!!newVersionEntry, 'the new draw is present in version history');
  assert(newVersionEntry?.isActive === true, 'the new draw is marked active in version history');
  assert(newVersionEntry?.version === 2, `the new draw's version history entry reports version 2, got ${newVersionEntry?.version}`);

  // Audit — a save.qualification-cutoff-draw entry was recorded for this group.
  const { data: auditRows, error: auditErr } = await ctx.client
    .from('tournament_audit_logs')
    .select('id, action, entity_id')
    .eq('entity_id', g.groupId)
    .eq('action', 'qualification-cutoff-draw.save');
  if (auditErr) throw new Error(`audit log query failed: ${auditErr.message}`);
  assert((auditRows || []).length >= 2, `expected at least 2 audit log entries for this group's saves (scenario 4 + scenario 6b), got ${(auditRows || []).length}`);
}

async function scenario7QuickResultDoesNotChangeCandidatePool(ctx: Ctx): Promise<void> {
  const g = ctx.main;
  const before = await loadContext(ctx, g);

  const seedMatchId = g.matchIdByCode.get('m-ab');
  assert(!!seedMatchId, 'the A-vs-B match id was recorded during setup');
  const { error } = await ctx.client.from('tournament_result_submissions').insert({
    match_id: seedMatchId,
    stage: 'quick_result',
    payload: { home_score: 9, away_score: 9 },
    status: 'submitted',
    version: 1,
    idempotency_key: `${RUN_TAG}-qr-seed`,
    submitted_by: ctx.actorId,
  });
  if (error) throw new Error(`quick result seed insert failed: ${error.message}`);

  const after = await loadContext(ctx, g);
  assert(after.candidateSnapshot === before.candidateSnapshot, 'Quick Result submission did not change the candidate pool/snapshot');
}

/** Publishes a 6-match round robin among F/G/H/I so that F wins all 3
 * (9pts, clear leader) and G/H/I form a 3-way cyclic tie (3pts each) —
 * pending_draw, 1 available slot. Wholly separate group/teams from the
 * main fixture, used ONLY for the concurrency scenario so it is never
 * affected by the main group's draw_recorded end state. */
async function scenario8SetupConcurrencyGroup(ctx: Ctx): Promise<void> {
  const [F, G, H, I] = ctx.concurrency.teamIds;
  const g = ctx.concurrency;

  const mFG = await createMatch(ctx, g, 'm-fg', F, G);
  await publishRegulationResult(ctx, mFG, F, G, 3, 0);
  const mFH = await createMatch(ctx, g, 'm-fh', F, H);
  await publishRegulationResult(ctx, mFH, F, H, 3, 0);
  const mFI = await createMatch(ctx, g, 'm-fi', F, I);
  await publishRegulationResult(ctx, mFI, F, I, 3, 0);
  const mGH = await createMatch(ctx, g, 'm-gh', G, H);
  await publishRegulationResult(ctx, mGH, G, H, 3, 0); // G wins
  const mHI = await createMatch(ctx, g, 'm-hi', H, I);
  await publishRegulationResult(ctx, mHI, H, I, 3, 0); // H wins
  const mIG = await createMatch(ctx, g, 'm-ig', I, G);
  await publishRegulationResult(ctx, mIG, I, G, 3, 0); // I wins

  const context = await loadContext(ctx, g);
  assert(context.qualificationState === 'pending_draw', `expected pending_draw for the concurrency group, got ${context.qualificationState}`);
  assert(context.availableSlots === 1, `expected availableSlots=1 for the concurrency group, got ${context.availableSlots}`);
  assertSameIdSet(context.drawCandidates.map((c) => c.teamId), [G, H, I], 'concurrency group candidate pool is exactly {G,H,I}');
}

/** SECTION C: real concurrency, run against the DEDICATED concurrency group
 * (never against the main group, which by this point in the run is already
 * draw_recorded — reusing it was the root cause of the original Staging
 * failure "expected a pending/stale draw scenario ... got resolved"). Two
 * admins independently Preview against the same (null) active-draw state,
 * select DIFFERENT candidates (no duplicate candidates, to avoid a
 * false-positive "duplicate selection" rejection masking the real
 * concurrency check), then both Save with no await in between — the RPC's
 * row lock on the group arbitrates. */
async function scenario8RealConcurrency(ctx: Ctx): Promise<void> {
  const g = ctx.concurrency;
  const before = await loadContext(ctx, g);
  assert(before.qualificationState === 'pending_draw' || before.qualificationState === 'stale_draw', `expected a pending/stale draw scenario to test concurrency, got ${before.qualificationState}`);
  assert(before.drawCandidates.length >= 2, `expected at least 2 distinct candidates to select different ones, got ${before.drawCandidates.length}`);
  const [candidateX, candidateY] = before.drawCandidates;
  assert(candidateX.teamId !== candidateY.teamId, 'the two concurrent attempts select genuinely different candidates');

  const previewA = await previewQualificationCutoffDraw({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: g.groupCode, selectedTeamIds: [candidateX.teamId], actorUserId: ctx.actorId });
  const previewB = await previewQualificationCutoffDraw({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: g.groupCode, selectedTeamIds: [candidateY.teamId], actorUserId: ctx.actorId });

  const attemptA = saveQualificationCutoffDraw({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    categoryCode: ctx.categoryCode,
    groupCode: g.groupCode,
    selectedTeamIds: [candidateX.teamId],
    previewToken: previewA.previewToken,
    idempotencyKey: `${RUN_TAG}-idem-concurrent-a`,
    actorUserId: ctx.actorId,
    actorEmail: ACTOR_EMAIL,
  });
  const attemptB = saveQualificationCutoffDraw({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    categoryCode: ctx.categoryCode,
    groupCode: g.groupCode,
    selectedTeamIds: [candidateY.teamId],
    previewToken: previewB.previewToken,
    idempotencyKey: `${RUN_TAG}-idem-concurrent-b`,
    actorUserId: ctx.actorId,
    actorEmail: ACTOR_EMAIL,
  });

  const settled = await Promise.allSettled([attemptA, attemptB]);
  const fulfilled = settled.filter((s) => s.status === 'fulfilled');
  const rejected = settled.filter((s) => s.status === 'rejected');
  assert(fulfilled.length === 1, `exactly one concurrent draw save succeeded, got ${fulfilled.length}`);
  assert(rejected.length === 1, `exactly one concurrent draw save was rejected, got ${rejected.length}`);
  const rejectionReason = (rejected[0] as PromiseRejectedResult).reason;
  assert(
    rejectionReason instanceof QualificationCutoffDrawError &&
      (rejectionReason.code === 'QUALIFICATION_CUTOFF_DRAW_STALE_STATE' || rejectionReason.code === 'QUALIFICATION_CUTOFF_DRAW_PREVIEW_MISMATCH'),
    `the losing attempt failed with a stale-state class error, got ${rejectionReason instanceof Error ? rejectionReason.message : rejectionReason}`
  );

  const { data: activeDraws, error: activeErr } = await ctx.client
    .from('tournament_qualification_cutoff_draws')
    .select('id')
    .eq('group_id', g.groupId)
    .is('superseded_at', null);
  if (activeErr) throw new Error(`active draw query failed: ${activeErr.message}`);
  assert((activeDraws || []).length === 1, `exactly one active draw version exists for the concurrency group after concurrency, got ${(activeDraws || []).length}`);
}

async function scenario9NoMatchMutationAndG16Untouched(ctx: Ctx): Promise<void> {
  const { data: matchesAfter } = await ctx.client.from('tournament_matches').select('id, home_team_id, away_team_id, home_source_ref, away_source_ref').in('id', ctx.matchIds);
  for (const m of (matchesAfter || []) as { home_source_ref: string | null; away_source_ref: string | null }[]) {
    assert(!m.home_source_ref && !m.away_source_ref, 'Cutoff Draw Save never sets a draw_selected source_ref on any match');
  }

  const { data: g16Draws } = await ctx.client.from('tournament_qualification_draws').select('id').eq('category_id', ctx.categoryId);
  assert((g16Draws || []).length === 0, `G-U16 tournament_qualification_draws rows remain untouched (zero expected for this disposable category), got ${(g16Draws || []).length}`);
}

async function scenario10PublicApiPrivacy(ctx: Ctx): Promise<void> {
  const { data: tournamentRow } = await ctx.client.from('tournaments').select('slug').eq('id', ctx.tournamentId).single();
  const request = {
    nextUrl: { searchParams: new URLSearchParams({ tournament_slug: tournamentRow?.slug || '', category_code: ctx.categoryCode }) },
  } as unknown as Parameters<typeof publicStandingsGet>[0];
  const response = await publicStandingsGet(request);
  const body = await response.json();
  assert(response.status === 200, `public standings responded 200, got ${response.status}`);
  const raw = JSON.stringify(body);
  assert(!raw.includes('candidate_snapshot') && !raw.includes('candidateSnapshot'), 'public standings never exposes candidate_snapshot');
  assert(!raw.includes('idempotency'), 'public standings never exposes an idempotency key');
  assert(!raw.includes('drawn_by') && !raw.includes('drawnBy'), 'public standings never exposes the actor');
  assert(!raw.includes('preview_token') && !raw.includes('previewToken'), 'public standings never exposes a Preview Token');
}

/** Publishes a 6-match round robin among J/K/L/M so that J wins all 3
 * (9pts, clear leader) and K/L/M form a 3-way cyclic tie (3pts each, K
 * beats L, L beats M, M beats K) — pending_draw, 1 available slot. Used
 * ONLY for the Section D resurrection-safety regression. */
async function scenario11SetupResurrectionGroup(ctx: Ctx): Promise<void> {
  const [J, K, L, M] = ctx.resurrection.teamIds;
  const g = ctx.resurrection;

  const mJK = await createMatch(ctx, g, 'm-jk', J, K);
  await publishRegulationResult(ctx, mJK, J, K, 3, 0);
  const mJL = await createMatch(ctx, g, 'm-jl', J, L);
  await publishRegulationResult(ctx, mJL, J, L, 3, 0);
  const mJM = await createMatch(ctx, g, 'm-jm', J, M);
  await publishRegulationResult(ctx, mJM, J, M, 3, 0);
  const mKL = await createMatch(ctx, g, 'm-kl', K, L);
  await publishRegulationResult(ctx, mKL, K, L, 3, 0); // K wins
  const mLM = await createMatch(ctx, g, 'm-lm', L, M);
  await publishRegulationResult(ctx, mLM, L, M, 3, 0); // L wins
  const mMK = await createMatch(ctx, g, 'm-mk', M, K);
  await publishRegulationResult(ctx, mMK, M, K, 3, 0); // M wins (cycle closer — corrected in 11b/11c)

  const context = await loadContext(ctx, g);
  assert(context.qualificationState === 'pending_draw', `expected pending_draw for the resurrection group, got ${context.qualificationState}`);
  assertSameIdSet(context.drawCandidates.map((c) => c.teamId), [K, L, M], 'resurrection group candidate pool is exactly {K,L,M}');
}

async function scenario11bRecordDraw(ctx: Ctx): Promise<{ originalDrawId: string }> {
  const g = ctx.resurrection;
  const [, K] = ctx.resurrection.teamIds;
  const preview = await previewQualificationCutoffDraw({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: g.groupCode, selectedTeamIds: [K], actorUserId: ctx.actorId });
  const result = await saveQualificationCutoffDraw({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    categoryCode: ctx.categoryCode,
    groupCode: g.groupCode,
    selectedTeamIds: [K],
    previewToken: preview.previewToken,
    idempotencyKey: `${RUN_TAG}-idem-resurrection-draw-1`,
    actorUserId: ctx.actorId,
    actorEmail: ACTOR_EMAIL,
  });
  assert(result.idempotent === false, 'the resurrection group draw is a genuinely new save');
  const context = await loadContext(ctx, g);
  assert(context.qualificationState === 'draw_recorded', `expected draw_recorded after recording the resurrection group's draw, got ${context.qualificationState}`);
  assert(!!context.activeDrawId, 'active draw id is set after recording the draw');
  assert(context.activeDrawId === result.drawId, "the loaded context's active draw id matches the save result's drawId");
  return { originalDrawId: context.activeDrawId as string };
}

/** SECTION D, step 2: a Score Correction makes the tie cluster disappear —
 * flips the M-vs-K result (K wins instead of M) so K gains a 2nd win
 * (6pts) while M drops to 0 wins (0pts); L is unaffected (3pts). The
 * cutoff cluster collapses to {K} alone, which fits inside the 1 available
 * slot — qualification becomes decidable by points alone: 'resolved'. */
async function scenario11cCorrectionMakesTieDisappear(ctx: Ctx): Promise<void> {
  const g = ctx.resurrection;
  const [, K, , M] = ctx.resurrection.teamIds;
  const mkMatchId = g.matchIdByCode.get('m-mk');
  assert(!!mkMatchId, 'the M-vs-K match id was recorded during setup');

  await correctResult(ctx, mkMatchId as string, M, K, 0, 2, 'disappear'); // K wins instead of M

  const context = await loadContext(ctx, g);
  assert(context.qualificationState === 'resolved', `expected resolved once the tie cluster disappears, got ${context.qualificationState}`);
  assert(context.drawCandidates.length === 0, `expected zero draw candidates once resolved by points alone, got ${context.drawCandidates.length}`);
}

/** SECTION D, step 3 (the actual regression proof): revert the M-vs-K
 * correction back to the ORIGINAL result. The derived candidate id set
 * {K,L,M} and availableSlots=1 byte-match the original tie cluster from
 * scenario11a again — but the group's official results were revised twice
 * in between (m-mk's version incremented on both corrections), so
 * Migration 020's officialResultRevision fingerprint differs from what
 * was recorded in the original draw. The pre-fix bug (v1 snapshot format,
 * candidate-id-set only) would have silently reported 'draw_recorded'
 * here, resurrecting a draw that was recorded against results that no
 * longer exist in that form. The fix requires 'stale_draw' instead. */
async function scenario11dRevertDoesNotResurrectOldDraw(ctx: Ctx, originalDrawId: string): Promise<void> {
  const g = ctx.resurrection;
  const [, K, L, M] = ctx.resurrection.teamIds;
  const mkMatchId = g.matchIdByCode.get('m-mk');
  assert(!!mkMatchId, 'the M-vs-K match id was recorded during setup');

  await correctResult(ctx, mkMatchId as string, M, K, 3, 0, 'revert'); // back to M wins (the original result)

  const context = await loadContext(ctx, g);
  assertSameIdSet(context.drawCandidates.map((c) => c.teamId), [K, L, M], 'the reverted candidate pool byte-matches the original tie cluster {K,L,M}');
  assert(
    context.qualificationState === 'stale_draw',
    `CORE STALE-DETECTION BUG: expected stale_draw (the old draw must not silently resurrect after an intervening official-result revision), got ${context.qualificationState}`
  );
  assert(context.activeDrawId === originalDrawId, 'the still-"active" row in the database is indeed the original draw — proving this is a resurrection risk, not a fresh state');

  // Confirm the admin can still act: a fresh draw against the reverted
  // pool succeeds as a genuinely new version, never reusing the old
  // candidate/selection data.
  assert(context.drawCandidates.length > 0, 'fail-fast: candidate pool must be non-empty before re-drawing');
  const preview = await previewQualificationCutoffDraw({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: g.groupCode, selectedTeamIds: [K], actorUserId: ctx.actorId });
  const result = await saveQualificationCutoffDraw({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    categoryCode: ctx.categoryCode,
    groupCode: g.groupCode,
    selectedTeamIds: [K],
    previewToken: preview.previewToken,
    idempotencyKey: `${RUN_TAG}-idem-resurrection-draw-2`,
    actorUserId: ctx.actorId,
    actorEmail: ACTOR_EMAIL,
  });
  assert(result.idempotent === false, 're-draw after the resurrection-safe stale detection is a genuinely new save');
  const after = await loadContext(ctx, g);
  assert(after.qualificationState === 'draw_recorded', `expected draw_recorded after re-drawing, got ${after.qualificationState}`);
  assert(after.activeDrawId !== originalDrawId, 'the fresh draw has a new active draw id, distinct from the original');
}

async function cleanup(ctx: Ctx): Promise<void> {
  console.log('\n[CLEANUP] Removing all disposable rows...');

  const allGroupIds = [ctx.main.groupId, ctx.concurrency.groupId, ctx.resurrection.groupId];
  if (ctx.matchIds.length > 0) {
    await ctx.client.from('tournament_audit_logs').delete().in('entity_id', [...ctx.matchIds, ...allGroupIds]);
    await ctx.client.from('tournament_match_goals').delete().in('match_id', ctx.matchIds);
    await ctx.client.from('tournament_match_cards').delete().in('match_id', ctx.matchIds);
  }

  const { error: tournamentDeleteError } = await ctx.client.from('tournaments').delete().eq('id', ctx.tournamentId);
  if (tournamentDeleteError) {
    console.error(`[CLEANUP] tournament delete failed: ${tournamentDeleteError.message}`);
    throw new Error(`Cleanup failed to delete the disposable tournament — manual cleanup required for tournament id ${ctx.tournamentId}`);
  }

  const { error: profileDeleteError } = await ctx.client.from('tournament_user_profiles').delete().eq('id', ctx.actorId);
  if (profileDeleteError) {
    throw new Error(`Cleanup failed to delete the disposable actor profile — manual cleanup required for id ${ctx.actorId}`);
  }

  console.log('[CLEANUP] Verifying zero disposable rows remain...');
  const { data: tournamentAfter } = await ctx.client.from('tournaments').select('id').eq('id', ctx.tournamentId).maybeSingle();
  assert(!tournamentAfter, 'tournament row is gone');

  for (const groupId of allGroupIds) {
    const { data: cutoffDrawsAfter } = await ctx.client.from('tournament_qualification_cutoff_draws').select('id').eq('group_id', groupId);
    assert((cutoffDrawsAfter || []).length === 0, `zero cutoff draw rows remain for group ${groupId}, got ${(cutoffDrawsAfter || []).length}`);
  }

  const { data: profileAfter } = await ctx.client.from('tournament_user_profiles').select('id').eq('id', ctx.actorId).maybeSingle();
  assert(!profileAfter, 'disposable actor profile row is gone');

  console.log('[CLEANUP] Complete — zero disposable rows remain.\n');
}

async function main() {
  const client = getTournamentServiceClient();
  const base = await setup(client);

  const main = await createGroupWithTeams({ client, ...base }, 'A', ['A', 'B', 'C', 'D', 'E']);
  const concurrency = await createGroupWithTeams({ client, ...base }, 'B', ['F', 'G', 'H', 'I']);
  const resurrection = await createGroupWithTeams({ client, ...base }, 'C', ['J', 'K', 'L', 'M']);

  const ctx: Ctx = { client, ...base, matchIds: [], main, concurrency, resurrection };
  let originalResurrectionDrawId: string | null = null;

  try {
    console.log('[SCENARIOS]');
    await run('1. Clean initial state (main group)', async () => {
      const context = await loadContext(ctx, ctx.main);
      assert(context.qualificationState === 'incomplete', `freshly created group starts incomplete, got ${context.qualificationState}`);
    });
    await run('2. Full Report publish setup succeeds (5-team pending_draw fixture)', () => scenario2SetupOfficialResults(ctx));
    await run('3. Cutoff Draw Preview writes zero rows', () => scenario3PreviewWritesZeroRows(ctx));
    await run('4. Draw save succeeds atomically', () => scenario4DrawSaveSucceeds(ctx));
    await run('5. Score Correction SHRINKS the candidate pool ({C,D,E} -> {C,D}) without eliminating the tie', () => scenario5ScoreCorrectionShrinksCandidatePool(ctx));
    await run('6. The previously-recorded draw is now stale (state + candidate pool + availableSlots)', () => scenario6StaleDraw(ctx));
    await run('6b. Re-drawing after stale succeeds as a genuinely new save (version, supersession, Audit, Version History)', () => scenario6bReDrawAfterStale(ctx));
    await run('7. Quick Result does not change the candidate pool', () => scenario7QuickResultDoesNotChangeCandidatePool(ctx));
    await run('8a. Concurrency group setup (separate, disposable fixture)', () => scenario8SetupConcurrencyGroup(ctx));
    await run('8b. Real concurrency on the dedicated concurrency group: one success, one conflict', () => scenario8RealConcurrency(ctx));
    await run('9. No tournament_matches row mutated by Cutoff Draw Save; G-U16 draw rows untouched', () => scenario9NoMatchMutationAndG16Untouched(ctx));
    await run('10. Public API privacy holds', () => scenario10PublicApiPrivacy(ctx));
    await run('11a. Resurrection group setup (separate, disposable fixture)', () => scenario11SetupResurrectionGroup(ctx));
    await run('11b. Draw recorded while the tie cluster exists', async () => {
      const { originalDrawId } = await scenario11bRecordDraw(ctx);
      originalResurrectionDrawId = originalDrawId;
    });
    await run('11c. A later Score Correction makes the tie cluster disappear -> resolved', () => scenario11cCorrectionMakesTieDisappear(ctx));
    await run('11d. Reverting the correction restores the identical candidate pool but does NOT resurrect the old draw (stale_draw, then a fresh re-draw succeeds)', () =>
      scenario11dRevertDoesNotResurrectOldDraw(ctx, originalResurrectionDrawId as string)
    );
  } finally {
    await run('12. Complete cleanup of all disposable rows', () => cleanup(ctx));
  }

  console.log('\n[SUMMARY]');
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'} — ${r.name}${r.detail ? `: ${r.detail}` : ''}`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    throw new Error(`${failed.length}/${results.length} scenarios failed`);
  }
  console.log(`\nAll ${results.length} scenarios passed.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n[VERIFY] Runtime verification FAILED:', e instanceof Error ? e.message : e);
    process.exit(1);
  });

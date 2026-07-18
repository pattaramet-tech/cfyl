// Tournament V2 — Migration 019 runtime verification.
// NOT part of `npm run test` — requires real TOURNAMENT_SUPABASE_* credentials
// pointed at CFYL-Tournament-Staging, where Migration 019
// (scripts/tournament-v2/019-qualification-cutoff-tie-draw.sql) has been
// manually applied. Run:
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
// PER TASK INSTRUCTION: this script is added by this PR but is NOT run as
// part of it. Migration 019 must first be manually applied to
// CFYL-Tournament-Staging by the owner.

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
} from '../../lib/tournament/services/qualification-cutoff-draws';
import { GET as publicStandingsGet } from '../../app/api/tournament/public/standings/route';

type TournamentClient = ReturnType<typeof getTournamentServiceClient>;

const RUN_TAG = `qcv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ACTOR_EMAIL = 'runtime-verify-qualification-cutoff@example.com';

console.log(`[VERIFY] Run tag: ${RUN_TAG}`);
console.log(`[VERIFY] TOURNAMENT_SUPABASE_URL host: ${new URL(process.env.TOURNAMENT_SUPABASE_URL || '').host}`);

interface Ctx {
  client: TournamentClient;
  tournamentId: string;
  categoryId: string;
  categoryCode: string;
  groupId: string;
  groupCode: string;
  venueId: string;
  teamIds: [string, string, string, string]; // A, B, C, D
  actorId: string;
  matchIds: string[];
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

async function setup(client: TournamentClient): Promise<Ctx> {
  console.log('\n[SETUP] Creating disposable tournament/category/group/4 teams/user profile...');

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

async function setupRemainder(client: TournamentClient, tournamentId: string): Promise<Ctx> {
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

  const groupCode = 'A';
  const { data: group, error: gErr } = await client
    .from('tournament_groups')
    .insert({ tournament_id: tournamentId, category_id: categoryId, name: 'Runtime Verify Cutoff Group', code: groupCode })
    .select('id')
    .single();
  if (gErr || !group) throw new Error(`group insert failed: ${gErr?.message}`);
  const groupId = (group as { id: string }).id;

  const { error: ruleErr } = await client
    .from('tournament_qualification_rules')
    .insert({ tournament_id: tournamentId, category_id: categoryId, qualify_rank_per_group: 2, best_third_placed_count: 0, best_third_placed_method: 'ranked', cross_group_comparison: false });
  if (ruleErr) throw new Error(`qualification rule insert failed: ${ruleErr.message}`);

  const teamNames = ['A', 'B', 'C', 'D'];
  const { data: teamsData, error: teamsErr } = await client
    .from('tournament_teams')
    .insert(teamNames.map((n) => ({ tournament_id: tournamentId, category_id: categoryId, name: `RQC ${n} ${RUN_TAG}`, team_code: `RQC${n}-${RUN_TAG.slice(-4)}` })))
    .select('id');
  if (teamsErr || !teamsData) throw new Error(`teams insert failed: ${teamsErr?.message}`);
  const teamIds = (teamsData as { id: string }[]).map((t) => t.id) as [string, string, string, string];

  const { error: gmErr } = await client
    .from('tournament_group_members')
    .insert(teamIds.map((teamId, i) => ({ group_id: groupId, team_id: teamId, slot_code: `A${i + 1}` })));
  if (gmErr) throw new Error(`group_members insert failed: ${gmErr.message}`);

  const actorId = randomUUID();
  const { error: profileErr } = await client
    .from('tournament_user_profiles')
    .insert({ id: actorId, email: ACTOR_EMAIL, full_name: `Runtime Verify Cutoff Actor ${RUN_TAG}`, active: true });
  if (profileErr) throw new Error(`actor profile insert failed: ${profileErr.message}`);

  console.log('[SETUP] Done.\n');
  return { client, tournamentId, categoryId, categoryCode, groupId, groupCode, venueId, teamIds, actorId, matchIds: [] };
}

async function createMatch(ctx: Ctx, matchCode: string, homeTeamId: string, awayTeamId: string): Promise<string> {
  const { data, error } = await ctx.client
    .from('tournament_matches')
    .insert({
      tournament_id: ctx.tournamentId,
      category_id: ctx.categoryId,
      group_id: ctx.groupId,
      venue_id: ctx.venueId,
      match_code: `${RUN_TAG}-${matchCode}`,
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      status: 'in_progress',
      result_workflow_status: 'not_started',
      schedule_status: 'published',
      version: 1,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`match ${matchCode} insert failed: ${error?.message}`);
  const id = (data as { id: string }).id;
  ctx.matchIds.push(id);
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

/** Publishes the full 6-match round robin among A/B/C/D so that A wins all
 * 3 (9 pts, clear leader), and B/C/D form a 3-way cyclic tie (3 pts each) —
 * the exact fixture proven in unit tests to straddle a qualifyRankPerGroup=2
 * cutoff, requiring a draw for the single remaining slot. */
async function scenario2SetupOfficialResults(ctx: Ctx): Promise<void> {
  const [A, B, C, D] = ctx.teamIds;
  const m1 = await createMatch(ctx, 'm1-ab', A, B);
  await publishRegulationResult(ctx, m1, A, B, 3, 0);
  const m2 = await createMatch(ctx, 'm2-ac', A, C);
  await publishRegulationResult(ctx, m2, A, C, 3, 0);
  const m3 = await createMatch(ctx, 'm3-ad', A, D);
  await publishRegulationResult(ctx, m3, A, D, 3, 0);
  const m4 = await createMatch(ctx, 'm4-bc', B, C);
  await publishRegulationResult(ctx, m4, B, C, 5, 0);
  const m5 = await createMatch(ctx, 'm5-cd', C, D);
  await publishRegulationResult(ctx, m5, C, D, 3, 0);
  const m6 = await createMatch(ctx, 'm6-db', D, B);
  await publishRegulationResult(ctx, m6, D, B, 1, 0);

  const context = await loadQualificationCutoffDrawContext({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: ctx.groupCode });
  assert(context.qualificationState === 'pending_draw', `expected pending_draw, got ${context.qualificationState}`);
  assert(context.availableSlots === 1, `expected availableSlots=1, got ${context.availableSlots}`);
  assert(context.drawCandidates.length === 3, `expected 3 draw candidates, got ${context.drawCandidates.length}`);
}

async function scenario3PreviewWritesZeroRows(ctx: Ctx): Promise<void> {
  const { data: before } = await ctx.client.from('tournament_qualification_cutoff_draws').select('id').eq('group_id', ctx.groupId);
  const [, B] = ctx.teamIds;
  await previewQualificationCutoffDraw({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: ctx.groupCode, selectedTeamIds: [B], actorUserId: ctx.actorId });
  const { data: after } = await ctx.client.from('tournament_qualification_cutoff_draws').select('id').eq('group_id', ctx.groupId);
  assert((before || []).length === (after || []).length, 'Preview created no new draw rows');
}

async function scenario4DrawSaveSucceeds(ctx: Ctx): Promise<void> {
  const [, B] = ctx.teamIds;
  const preview = await previewQualificationCutoffDraw({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: ctx.groupCode, selectedTeamIds: [B], actorUserId: ctx.actorId });
  const result = await saveQualificationCutoffDraw({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    categoryCode: ctx.categoryCode,
    groupCode: ctx.groupCode,
    selectedTeamIds: [B],
    previewToken: preview.previewToken,
    idempotencyKey: `${RUN_TAG}-idem-draw-1`,
    actorUserId: ctx.actorId,
    actorEmail: ACTOR_EMAIL,
  });
  assert(result.idempotent === false, 'first save is not idempotent');

  const context = await loadQualificationCutoffDrawContext({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: ctx.groupCode });
  assert(context.qualificationState === 'draw_recorded', `expected draw_recorded, got ${context.qualificationState}`);
  assert(context.selectedByDraw.length === 1 && context.selectedByDraw[0] === B, 'B recorded as selected by draw');
}

async function scenario5ScoreCorrectionChangesCandidatePool(ctx: Ctx): Promise<void> {
  // Correct the B-vs-D match (originally D beat B 1-0) so that B now wins
  // instead — this changes the points distribution among B/C/D and must
  // therefore change the candidate_snapshot.
  const beforeContext = await loadQualificationCutoffDrawContext({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: ctx.groupCode });
  const snapshotBefore = beforeContext.candidateSnapshot;

  const [, B] = ctx.teamIds;
  const dbMatch = ctx.matchIds[5]; // m6-db, D home vs B away, originally D wins 1-0

  const input: CorrectedResultInput = {
    regulationHomeScore: 0,
    regulationAwayScore: 2,
    penaltyHomeScore: null,
    penaltyAwayScore: null,
    decidedBy: 'regulation',
    winnerTeamId: B,
    correctionReason: `Runtime verify: score recorded incorrectly (${RUN_TAG})`,
  };
  const preview = await previewResultCorrection({ client: ctx.client, tournamentId: ctx.tournamentId, matchId: dbMatch, actorUserId: ctx.actorId, input });
  await publishResultCorrection({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    matchId: dbMatch,
    expectedVersion: preview.currentVersion,
    idempotencyKey: `${RUN_TAG}-idem-correction-1`,
    previewToken: preview.previewToken,
    actorUserId: ctx.actorId,
    actorEmail: ACTOR_EMAIL,
    input,
  });

  const afterContext = await loadQualificationCutoffDrawContext({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: ctx.groupCode });
  assert(afterContext.candidateSnapshot !== snapshotBefore, 'candidate snapshot changed after a Score Correction altered team points');
}

async function scenario6StaleDraw(ctx: Ctx): Promise<void> {
  // The draw recorded in scenario 4 is now stale, because scenario 5's
  // Score Correction changed the points distribution after it was recorded.
  const context = await loadQualificationCutoffDrawContext({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: ctx.groupCode });
  assert(context.qualificationState === 'stale_draw', `expected stale_draw, got ${context.qualificationState}`);
}

async function scenario6bReDrawAfterStale(ctx: Ctx): Promise<void> {
  const context = await loadQualificationCutoffDrawContext({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: ctx.groupCode });
  const newCandidate = context.drawCandidates[0].teamId;
  const preview = await previewQualificationCutoffDraw({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: ctx.groupCode, selectedTeamIds: [newCandidate], actorUserId: ctx.actorId });
  const result = await saveQualificationCutoffDraw({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    categoryCode: ctx.categoryCode,
    groupCode: ctx.groupCode,
    selectedTeamIds: [newCandidate],
    previewToken: preview.previewToken,
    idempotencyKey: `${RUN_TAG}-idem-draw-2`,
    actorUserId: ctx.actorId,
    actorEmail: ACTOR_EMAIL,
  });
  assert(result.idempotent === false, 're-draw after stale is a genuinely new save');
}

async function scenario7QuickResultDoesNotChangeCandidatePool(ctx: Ctx): Promise<void> {
  const before = await loadQualificationCutoffDrawContext({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: ctx.groupCode });

  const { error } = await ctx.client.from('tournament_result_submissions').insert({
    match_id: ctx.matchIds[0],
    stage: 'quick_result',
    payload: { home_score: 9, away_score: 9 },
    status: 'submitted',
    version: 1,
    idempotency_key: `${RUN_TAG}-qr-seed`,
    submitted_by: ctx.actorId,
  });
  if (error) throw new Error(`quick result seed insert failed: ${error.message}`);

  const after = await loadQualificationCutoffDrawContext({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: ctx.groupCode });
  assert(after.candidateSnapshot === before.candidateSnapshot, 'Quick Result submission did not change the candidate pool/snapshot');
}

async function scenario8RealConcurrency(ctx: Ctx): Promise<void> {
  // Two admins independently Preview a correction against the SAME active
  // draw state, then both attempt to Save. Real concurrency: no await
  // between the two calls — the RPC's row lock on the group arbitrates.
  const before = await loadQualificationCutoffDrawContext({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: ctx.groupCode });
  const [candidateX, candidateY] = before.drawCandidates.length >= 2 ? before.drawCandidates : [before.drawCandidates[0], before.drawCandidates[0]];
  if (before.qualificationState !== 'pending_draw' && before.qualificationState !== 'stale_draw') {
    throw new Error(`expected a pending/stale draw scenario to test concurrency, got ${before.qualificationState}`);
  }

  const previewA = await previewQualificationCutoffDraw({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: ctx.groupCode, selectedTeamIds: [candidateX.teamId], actorUserId: ctx.actorId });
  const previewB = await previewQualificationCutoffDraw({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: ctx.groupCode, selectedTeamIds: [candidateY.teamId], actorUserId: ctx.actorId });

  const attemptA = saveQualificationCutoffDraw({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    categoryCode: ctx.categoryCode,
    groupCode: ctx.groupCode,
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
    groupCode: ctx.groupCode,
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

async function cleanup(ctx: Ctx): Promise<void> {
  console.log('\n[CLEANUP] Removing all disposable rows...');

  if (ctx.matchIds.length > 0) {
    await ctx.client.from('tournament_audit_logs').delete().in('entity_id', [...ctx.matchIds, ctx.groupId]);
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

  const { data: cutoffDrawsAfter } = await ctx.client.from('tournament_qualification_cutoff_draws').select('id').eq('group_id', ctx.groupId);
  assert((cutoffDrawsAfter || []).length === 0, `zero cutoff draw rows remain, got ${(cutoffDrawsAfter || []).length}`);

  const { data: profileAfter } = await ctx.client.from('tournament_user_profiles').select('id').eq('id', ctx.actorId).maybeSingle();
  assert(!profileAfter, 'disposable actor profile row is gone');

  console.log('[CLEANUP] Complete — zero disposable rows remain.\n');
}

async function main() {
  const client = getTournamentServiceClient();
  const ctx = await setup(client);

  try {
    console.log('[SCENARIOS]');
    await run('1. Clean initial state', async () => {
      const context = await loadQualificationCutoffDrawContext({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode, groupCode: ctx.groupCode });
      assert(context.qualificationState === 'incomplete', `freshly created group starts incomplete, got ${context.qualificationState}`);
    });
    await run('2. First Full Report publish setup succeeds (creates the pending_draw scenario)', () => scenario2SetupOfficialResults(ctx));
    await run('3. Cutoff Draw Preview writes zero rows', () => scenario3PreviewWritesZeroRows(ctx));
    await run('4. Draw save succeeds atomically', () => scenario4DrawSaveSucceeds(ctx));
    await run('5. Score Correction changes the candidate pool', () => scenario5ScoreCorrectionChangesCandidatePool(ctx));
    await run('6. The previously-recorded draw is now stale', () => scenario6StaleDraw(ctx));
    await run('6b. Re-drawing after stale succeeds as a genuinely new save', () => scenario6bReDrawAfterStale(ctx));
    await run('7. Quick Result does not change the candidate pool', () => scenario7QuickResultDoesNotChangeCandidatePool(ctx));
    await run('8. Real concurrency: two different draw saves from the same state — one success, one conflict', () => scenario8RealConcurrency(ctx));
    await run('9. No tournament_matches row mutated by Cutoff Draw Save; G-U16 draw rows untouched', () => scenario9NoMatchMutationAndG16Untouched(ctx));
    await run('10. Public API privacy holds', () => scenario10PublicApiPrivacy(ctx));
  } finally {
    await run('11. Complete cleanup of all disposable rows', () => cleanup(ctx));
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

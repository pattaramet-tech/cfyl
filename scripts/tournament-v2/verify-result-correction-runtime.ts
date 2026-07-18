// Tournament V2 — Migration 018 runtime verification.
// NOT part of `npm run test` — requires real TOURNAMENT_SUPABASE_* credentials
// pointed at CFYL-Tournament-Staging, where Migration 018
// (scripts/tournament-v2/018-score-only-result-correction.sql) has been
// manually applied. Run:
//
//   npm run verify:tournament-result-correction-runtime
//
// SAFETY: this script writes real rows to whatever TOURNAMENT_SUPABASE_URL
// points at. It refuses to run unless TOURNAMENT_RUNTIME_VERIFY_CONFIRM is
// set to the exact literal string "CFYL-Tournament-Staging" — this is a
// deliberate, explicit, human-set confirmation gate, not an automatic check
// of the URL itself. Every row this script creates is uniquely named
// (prefixed with a per-run tag) and is deleted again at the end, in a
// try/finally so cleanup runs even if a scenario fails or throws. This
// script never touches Production — it has no Production credentials — and
// never re-applies or modifies any migration.
//
// Exercises the REAL application code (lib/tournament/services/
// resultCorrection.ts, lib/tournament/services/fullMatchReport.ts,
// lib/tournament/services/standings.ts, the public schedule route) against
// the REAL tournament.correct_published_match_result() RPC — this is what
// actually proves Migration 018 works at runtime, which the repo's mock-RPC
// unit tests (lib/tournament/services/__tests__/mockCorrectRpc.ts) could
// not.
//
// PER TASK INSTRUCTION: this script is added by this PR but is NOT run as
// part of it. Migration 018 must first be manually applied to
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
import {
  previewResultCorrection,
  publishResultCorrection,
  ResultCorrectionError,
  type CorrectedResultInput,
} from '../../lib/tournament/services/resultCorrection';
import { getCategoryStandings } from '../../lib/tournament/services/standings';
import { GET as publicScheduleGet } from '../../app/api/tournament/public/schedule/route';

type TournamentClient = ReturnType<typeof getTournamentServiceClient>;

const RUN_TAG = `rcv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ACTOR_EMAIL = 'runtime-verify-correction@example.com';

console.log(`[VERIFY] Run tag: ${RUN_TAG}`);
console.log(`[VERIFY] TOURNAMENT_SUPABASE_URL host: ${new URL(process.env.TOURNAMENT_SUPABASE_URL || '').host}`);

interface Ctx {
  client: TournamentClient;
  tournamentId: string;
  categoryId: string;
  categoryCode: string;
  venueId: string;
  groupId: string;
  homeTeamId: string;
  awayTeamId: string;
  homePlayer1: string;
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
  console.log('\n[SETUP] Creating disposable tournament/category/venue/teams/players/group...');

  const { data: tournament, error: tErr } = await client
    .from('tournaments')
    .insert({ name: `Runtime Verify Correction ${RUN_TAG}`, slug: `${RUN_TAG}-tour`, status: 'active' })
    .select('id')
    .single();
  if (tErr || !tournament) throw new Error(`tournament insert failed: ${tErr?.message}`);
  const tournamentId = (tournament as { id: string }).id;

  try {
    return await setupRemainder(client, tournamentId);
  } catch (error) {
    console.error(`[SETUP] Failed partway through — deleting the partially-created tournament ${tournamentId} before re-throwing...`);
    const { error: deleteError } = await client.from('tournaments').delete().eq('id', tournamentId);
    if (deleteError) {
      console.error(`[SETUP] CLEANUP OF PARTIAL SETUP ALSO FAILED — manual cleanup required for tournament id ${tournamentId}: ${deleteError.message}`);
    } else {
      console.error(`[SETUP] Partial tournament ${tournamentId} deleted successfully.`);
    }
    throw error;
  }
}

async function setupRemainder(client: TournamentClient, tournamentId: string): Promise<Ctx> {
  const { data: category, error: cErr } = await client
    .from('tournament_categories')
    .insert({ tournament_id: tournamentId, code: `RCV-${RUN_TAG.slice(-6).toUpperCase()}`, name: 'Runtime Verify Correction Category', gender: 'mixed' })
    .select('id, code')
    .single();
  if (cErr || !category) throw new Error(`category insert failed: ${cErr?.message}`);
  const categoryId = (category as { id: string; code: string }).id;
  const categoryCode = (category as { id: string; code: string }).code;

  const { data: venue, error: vErr } = await client
    .from('tournament_venues')
    .insert({ tournament_id: tournamentId, name: `RCV Venue ${RUN_TAG}`, code: `RCV-${RUN_TAG.slice(-4)}`, slug: `${RUN_TAG}-venue` })
    .select('id')
    .single();
  if (vErr || !venue) throw new Error(`venue insert failed: ${vErr?.message}`);
  const venueId = (venue as { id: string }).id;

  const { data: group, error: gErr } = await client
    .from('tournament_groups')
    .insert({ tournament_id: tournamentId, category_id: categoryId, name: 'Runtime Verify Correction Group', code: 'A' })
    .select('id')
    .single();
  if (gErr || !group) throw new Error(`group insert failed: ${gErr?.message}`);
  const groupId = (group as { id: string }).id;

  const { data: homeTeam, error: htErr } = await client
    .from('tournament_teams')
    .insert({ tournament_id: tournamentId, category_id: categoryId, name: `RCV Home ${RUN_TAG}`, team_code: `RCVH-${RUN_TAG.slice(-4)}` })
    .select('id')
    .single();
  if (htErr || !homeTeam) throw new Error(`home team insert failed: ${htErr?.message}`);
  const homeTeamId = (homeTeam as { id: string }).id;

  const { data: awayTeam, error: atErr } = await client
    .from('tournament_teams')
    .insert({ tournament_id: tournamentId, category_id: categoryId, name: `RCV Away ${RUN_TAG}`, team_code: `RCVA-${RUN_TAG.slice(-4)}` })
    .select('id')
    .single();
  if (atErr || !awayTeam) throw new Error(`away team insert failed: ${atErr?.message}`);
  const awayTeamId = (awayTeam as { id: string }).id;

  const { error: gmErr } = await client.from('tournament_group_members').insert([
    { group_id: groupId, team_id: homeTeamId, slot_code: 'A1' },
    { group_id: groupId, team_id: awayTeamId, slot_code: 'A2' },
  ]);
  if (gmErr) throw new Error(`group_members insert failed: ${gmErr.message}`);

  const { data: players, error: pErr } = await client
    .from('tournament_players')
    .insert([{ tournament_id: tournamentId, category_id: categoryId, team_id: homeTeamId, player_code: `RCV-H1-${RUN_TAG.slice(-4)}`, full_name: 'RCV Home Player 1' }])
    .select('id');
  if (pErr || !players) throw new Error(`players insert failed: ${pErr?.message}`);
  const homePlayer1 = (players as { id: string }[])[0].id;

  // tournament_result_submissions.submitted_by / tournament_audit_logs.admin_id
  // and tournament_result_approvals.actor_id are FK'd to
  // tournament_user_profiles(id) — a fake/non-existent UUID here violates
  // that FK, so a real disposable profile row is required.
  const actorId = randomUUID();
  const { error: profileErr } = await client
    .from('tournament_user_profiles')
    .insert({ id: actorId, email: ACTOR_EMAIL, full_name: `Runtime Verify Correction Actor ${RUN_TAG}`, active: true });
  if (profileErr) throw new Error(`actor profile insert failed: ${profileErr.message}`);

  console.log('[SETUP] Done.\n');

  return { client, tournamentId, categoryId, categoryCode, venueId, groupId, homeTeamId, awayTeamId, homePlayer1, actorId, matchIds: [] };
}

async function createMatch(ctx: Ctx, matchCode: string): Promise<string> {
  const { data, error } = await ctx.client
    .from('tournament_matches')
    .insert({
      tournament_id: ctx.tournamentId,
      category_id: ctx.categoryId,
      group_id: ctx.groupId,
      venue_id: ctx.venueId,
      match_code: `${RUN_TAG}-${matchCode}`,
      home_team_id: ctx.homeTeamId,
      away_team_id: ctx.awayTeamId,
      status: 'in_progress',
      result_workflow_status: 'not_started',
      schedule_status: 'published',
      version: 1,
    })
    .select('id, version')
    .single();
  if (error || !data) throw new Error(`match ${matchCode} insert failed: ${error?.message}`);
  const id = (data as { id: string }).id;
  ctx.matchIds.push(id);
  return id;
}

async function getMatch(ctx: Ctx, matchId: string) {
  const { data, error } = await ctx.client.from('tournament_matches').select('*').eq('id', matchId).single();
  if (error || !data) throw new Error(`failed to load match ${matchId}: ${error?.message}`);
  return data as Record<string, unknown>;
}

function fullReportInput(overrides: Partial<FullMatchReportInput> = {}): FullMatchReportInput {
  return {
    regulationHomeScore: 2,
    regulationAwayScore: 0,
    penaltyHomeScore: null,
    penaltyAwayScore: null,
    decidedBy: 'regulation',
    winnerTeamId: '',
    reportText: `Runtime verify correction — original report ${RUN_TAG}`,
    goals: [],
    cards: [],
    ...overrides,
  };
}

function correctionInput(overrides: Partial<CorrectedResultInput> = {}): CorrectedResultInput {
  return {
    regulationHomeScore: 3,
    regulationAwayScore: 0,
    penaltyHomeScore: null,
    penaltyAwayScore: null,
    decidedBy: 'regulation',
    winnerTeamId: '',
    correctionReason: `Runtime verify: score recorded incorrectly at pitch-side (${RUN_TAG})`,
    ...overrides,
  };
}

/** Publishes an official Full Match Report result via the real Migration 014
 * RPC — this is the "already-published" baseline every correction scenario
 * needs, and doubles as scenario 2's own required check. */
async function publishBaseline(ctx: Ctx, matchId: string, input: FullMatchReportInput): Promise<void> {
  const preview = await previewFullMatchReport({ client: ctx.client, tournamentId: ctx.tournamentId, venueId: ctx.venueId, matchId, actorUserId: ctx.actorId, input });
  const result = await publishFullMatchReport({
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
  assert(result.idempotent === false, `baseline full report publish for ${matchId} is not idempotent`);
}

async function scenario1CleanInitialState(ctx: Ctx): Promise<string> {
  const matchId = await createMatch(ctx, 'm1-clean');
  const match = await getMatch(ctx, matchId);
  assert(match.result_workflow_status === 'not_started', 'freshly created disposable match starts not_started');
  const { data: submissionRows } = await ctx.client.from('tournament_result_submissions').select('id').eq('match_id', matchId);
  assert((submissionRows || []).length === 0, 'zero result submissions exist for a freshly created match');
  return matchId;
}

async function scenario2FullReportPublishSetup(ctx: Ctx, matchId: string): Promise<void> {
  await publishBaseline(ctx, matchId, fullReportInput({ winnerTeamId: ctx.homeTeamId, goals: [{ teamId: ctx.homeTeamId, playerId: ctx.homePlayer1, minute: 20, isOwnGoal: false, goals: 1, note: null }] }));
  const match = await getMatch(ctx, matchId);
  assert(match.result_workflow_status === 'published', `match is published after baseline Full Report publish, got ${match.result_workflow_status}`);
  assert(match.regulation_home_score === 2 && match.regulation_away_score === 0, 'baseline regulation score persisted (2-0)');
}

async function scenario3PreviewWritesZeroRows(ctx: Ctx, matchId: string): Promise<void> {
  const before = await getMatch(ctx, matchId);
  const { data: subsBefore } = await ctx.client.from('tournament_result_submissions').select('id').eq('match_id', matchId).eq('stage', 'correction');

  const preview = await previewResultCorrection({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    matchId,
    actorUserId: ctx.actorId,
    input: correctionInput({ winnerTeamId: ctx.homeTeamId }),
  });
  assert(!!preview.previewToken, 'preview token issued');

  const after = await getMatch(ctx, matchId);
  const { data: subsAfter } = await ctx.client.from('tournament_result_submissions').select('id').eq('match_id', matchId).eq('stage', 'correction');
  assert((subsAfter || []).length === (subsBefore || []).length, 'no new correction submission row was created by Preview');
  assert(after.version === before.version, 'match version unchanged by Preview');
  assert(after.regulation_home_score === before.regulation_home_score, 'official score unchanged by Preview');
}

async function scenario4RegulationCorrectionSucceeds(ctx: Ctx, matchId: string): Promise<void> {
  const input = correctionInput({ regulationHomeScore: 3, regulationAwayScore: 0, winnerTeamId: ctx.homeTeamId });
  const preview = await previewResultCorrection({ client: ctx.client, tournamentId: ctx.tournamentId, matchId, actorUserId: ctx.actorId, input });

  const result = await publishResultCorrection({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    matchId,
    expectedVersion: preview.currentVersion,
    idempotencyKey: `${RUN_TAG}-idem-reg-correction`,
    previewToken: preview.previewToken,
    actorUserId: ctx.actorId,
    actorEmail: ACTOR_EMAIL,
    input,
  });
  assert(result.idempotent === false, 'regulation correction is not idempotent on first call');

  const match = await getMatch(ctx, matchId);
  assert(match.regulation_home_score === 3 && match.regulation_away_score === 0, 'corrected regulation score persisted');
  assert(match.result_workflow_status === 'published', 'match remains published after correction');
  assert(match.status === 'finished', 'match remains finished after correction');
  assert(match.version === preview.currentVersion + 1, 'match version incremented exactly once');

  const { data: correctionSubs } = await ctx.client.from('tournament_result_submissions').select('id').eq('match_id', matchId).eq('stage', 'correction');
  assert((correctionSubs || []).length === 1, `exactly one correction submission, got ${(correctionSubs || []).length}`);
  const { data: approvals } = await ctx.client.from('tournament_result_approvals').select('id, action').eq('submission_id', (correctionSubs as { id: string }[])[0].id);
  assert((approvals || []).length === 1 && (approvals as { action: string }[])[0].action === 'corrected', 'exactly one Correction-only approval row recorded');
}

async function scenario5PenaltyCorrectionSucceeds(ctx: Ctx): Promise<string> {
  const matchId = await createMatch(ctx, 'm5-penalty');
  await publishBaseline(ctx, matchId, fullReportInput({ regulationHomeScore: 1, regulationAwayScore: 1, decidedBy: 'penalty', penaltyHomeScore: 3, penaltyAwayScore: 2, winnerTeamId: ctx.homeTeamId }));

  const input = correctionInput({ regulationHomeScore: 1, regulationAwayScore: 1, decidedBy: 'penalty', penaltyHomeScore: 5, penaltyAwayScore: 4, winnerTeamId: ctx.homeTeamId });
  const preview = await previewResultCorrection({ client: ctx.client, tournamentId: ctx.tournamentId, matchId, actorUserId: ctx.actorId, input });
  const result = await publishResultCorrection({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    matchId,
    expectedVersion: preview.currentVersion,
    idempotencyKey: `${RUN_TAG}-idem-pen-correction`,
    previewToken: preview.previewToken,
    actorUserId: ctx.actorId,
    actorEmail: ACTOR_EMAIL,
    input,
  });
  assert(result.idempotent === false, 'penalty correction is not idempotent on first call');

  const match = await getMatch(ctx, matchId);
  assert(match.penalty_home_score === 5 && match.penalty_away_score === 4, 'corrected penalty scores persisted');
  assert(match.regulation_home_score === 1 && match.regulation_away_score === 1, 'regulation scores remain tied');
  assert(match.result_type === 'penalty_decided', 'result_type remains penalty_decided');

  return matchId;
}

async function scenario6SameKeyConcurrentReplayIdempotent(ctx: Ctx): Promise<void> {
  const matchId = await createMatch(ctx, 'm6-idem');
  await publishBaseline(ctx, matchId, fullReportInput({ winnerTeamId: ctx.homeTeamId }));

  const input = correctionInput({ regulationHomeScore: 4, regulationAwayScore: 1, winnerTeamId: ctx.homeTeamId });
  const preview = await previewResultCorrection({ client: ctx.client, tournamentId: ctx.tournamentId, matchId, actorUserId: ctx.actorId, input });
  const idempotencyKey = `${RUN_TAG}-idem-m6`;

  const publishOnce = () =>
    publishResultCorrection({
      client: ctx.client,
      tournamentId: ctx.tournamentId,
      matchId,
      expectedVersion: preview.currentVersion,
      idempotencyKey,
      previewToken: preview.previewToken,
      actorUserId: ctx.actorId,
      actorEmail: ACTOR_EMAIL,
      input,
    });

  // Fired with no await between them — real concurrency guarantee comes
  // from Postgres's row lock inside the RPC, not from anything in this
  // script.
  const [first, second] = await Promise.all([publishOnce(), publishOnce()]);
  const freshCount = [first, second].filter((r) => !r.idempotent).length;
  const idempotentCount = [first, second].filter((r) => r.idempotent).length;
  assert(freshCount === 1, `exactly one fresh correction among the two concurrent calls, got ${freshCount}`);
  assert(idempotentCount === 1, `exactly one idempotent success among the two concurrent calls, got ${idempotentCount}`);
  assert(first.submissionId === second.submissionId, 'both calls resolved to the same submission id');

  const { data: submissionRows } = await ctx.client.from('tournament_result_submissions').select('id').eq('match_id', matchId).eq('stage', 'correction');
  assert((submissionRows || []).length === 1, `exactly one correction submission after both concurrent calls, got ${(submissionRows || []).length}`);

  const match = await getMatch(ctx, matchId);
  assert(match.version === preview.currentVersion + 1, `match version incremented exactly once, got ${match.version}`);
}

async function scenario7ConcurrentDifferentCorrectionsOneSuccessOneConflict(ctx: Ctx): Promise<void> {
  const matchId = await createMatch(ctx, 'm7-conflict');
  await publishBaseline(ctx, matchId, fullReportInput({ winnerTeamId: ctx.homeTeamId }));
  const baseline = await getMatch(ctx, matchId);
  const startingVersion = baseline.version as number;

  // Two DIFFERENT admins independently Preview a correction against the
  // same starting version, then both attempt to Publish. Real concurrency:
  // no await between the two calls.
  const previewA = await previewResultCorrection({ client: ctx.client, tournamentId: ctx.tournamentId, matchId, actorUserId: ctx.actorId, input: correctionInput({ regulationHomeScore: 5, regulationAwayScore: 0, winnerTeamId: ctx.homeTeamId }) });
  const previewB = await previewResultCorrection({ client: ctx.client, tournamentId: ctx.tournamentId, matchId, actorUserId: ctx.actorId, input: correctionInput({ regulationHomeScore: 6, regulationAwayScore: 1, winnerTeamId: ctx.homeTeamId }) });
  assert(previewA.currentVersion === startingVersion && previewB.currentVersion === startingVersion, 'both previews were taken against the same starting version');

  const attemptA = publishResultCorrection({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    matchId,
    expectedVersion: startingVersion,
    idempotencyKey: `${RUN_TAG}-idem-m7-a`,
    previewToken: previewA.previewToken,
    actorUserId: ctx.actorId,
    actorEmail: ACTOR_EMAIL,
    input: correctionInput({ regulationHomeScore: 5, regulationAwayScore: 0, winnerTeamId: ctx.homeTeamId }),
  });
  const attemptB = publishResultCorrection({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    matchId,
    expectedVersion: startingVersion,
    idempotencyKey: `${RUN_TAG}-idem-m7-b`,
    previewToken: previewB.previewToken,
    actorUserId: ctx.actorId,
    actorEmail: ACTOR_EMAIL,
    input: correctionInput({ regulationHomeScore: 6, regulationAwayScore: 1, winnerTeamId: ctx.homeTeamId }),
  });

  const settled = await Promise.allSettled([attemptA, attemptB]);
  const fulfilled = settled.filter((s) => s.status === 'fulfilled');
  const rejected = settled.filter((s) => s.status === 'rejected');
  assert(fulfilled.length === 1, `exactly one of the two concurrent different corrections succeeded, got ${fulfilled.length}`);
  assert(rejected.length === 1, `exactly one of the two concurrent different corrections was rejected, got ${rejected.length}`);
  const rejectionReason = (rejected[0] as PromiseRejectedResult).reason;
  assert(
    rejectionReason instanceof ResultCorrectionError && rejectionReason.code === 'RESULT_CORRECTION_VERSION_CONFLICT',
    `the losing attempt failed with RESULT_CORRECTION_VERSION_CONFLICT, got ${rejectionReason instanceof Error ? rejectionReason.message : rejectionReason}`
  );

  const { data: correctionSubs } = await ctx.client.from('tournament_result_submissions').select('id').eq('match_id', matchId).eq('stage', 'correction');
  assert((correctionSubs || []).length === 1, `exactly one physical correction was written, got ${(correctionSubs || []).length}`);

  const match = await getMatch(ctx, matchId);
  assert(match.version === startingVersion + 1, `match version incremented exactly once, got ${match.version}`);
}

async function scenario8InvalidStaleNoChangeWriteZeroRows(ctx: Ctx): Promise<void> {
  const matchId = await createMatch(ctx, 'm8-invalid');
  await publishBaseline(ctx, matchId, fullReportInput({ regulationHomeScore: 2, regulationAwayScore: 2, decidedBy: 'penalty', penaltyHomeScore: 3, penaltyAwayScore: 1, winnerTeamId: ctx.homeTeamId }));
  const before = await getMatch(ctx, matchId);

  // No-change: identical to the current official result.
  {
    let threw = false;
    try {
      await previewResultCorrection({
        client: ctx.client,
        tournamentId: ctx.tournamentId,
        matchId,
        actorUserId: ctx.actorId,
        input: correctionInput({ regulationHomeScore: 2, regulationAwayScore: 2, decidedBy: 'penalty', penaltyHomeScore: 3, penaltyAwayScore: 1, winnerTeamId: ctx.homeTeamId }),
      });
    } catch (error) {
      threw = true;
      assert(error instanceof ResultCorrectionError && error.code === 'RESULT_CORRECTION_NO_CHANGES', `expected RESULT_CORRECTION_NO_CHANGES, got ${error instanceof Error ? error.message : error}`);
    }
    assert(threw, 'identical-result correction was rejected at Preview');
  }

  // Stale version at Publish time (simulate a concurrent edit between Preview and Publish).
  {
    const preview = await previewResultCorrection({ client: ctx.client, tournamentId: ctx.tournamentId, matchId, actorUserId: ctx.actorId, input: correctionInput({ winnerTeamId: ctx.homeTeamId }) });
    let threw = false;
    try {
      await publishResultCorrection({
        client: ctx.client,
        tournamentId: ctx.tournamentId,
        matchId,
        expectedVersion: preview.currentVersion - 1, // deliberately stale
        idempotencyKey: `${RUN_TAG}-idem-m8-stale`,
        previewToken: preview.previewToken,
        actorUserId: ctx.actorId,
        actorEmail: ACTOR_EMAIL,
        input: correctionInput({ winnerTeamId: ctx.homeTeamId }),
      });
    } catch (error) {
      threw = true;
      assert(error instanceof ResultCorrectionError && error.code === 'RESULT_CORRECTION_PREVIEW_MISMATCH', `stale version claim mismatches the Preview Token first, got ${error instanceof Error ? error.message : error}`);
    }
    assert(threw, 'a deliberately stale expected_version was rejected');
  }

  // Invalid: winner not home/away.
  {
    let threw = false;
    try {
      await previewResultCorrection({
        client: ctx.client,
        tournamentId: ctx.tournamentId,
        matchId,
        actorUserId: ctx.actorId,
        input: correctionInput({ regulationHomeScore: 3, regulationAwayScore: 0, decidedBy: 'regulation', penaltyHomeScore: null, penaltyAwayScore: null, winnerTeamId: 'not-a-real-team' }),
      });
    } catch (error) {
      threw = true;
      assert(error instanceof Error && error.message.length > 0, 'invalid winner rejected with an error');
    }
    assert(threw, 'invalid winner_team_id was rejected');
  }

  const after = await getMatch(ctx, matchId);
  assert(after.version === before.version, 'match version unchanged by every rejected attempt in this scenario');
  const { data: correctionSubs } = await ctx.client.from('tournament_result_submissions').select('id').eq('match_id', matchId).eq('stage', 'correction');
  assert((correctionSubs || []).length === 0, `zero correction submissions written by any rejected attempt, got ${(correctionSubs || []).length}`);
}

async function scenario9UnchangedDataAndPublicPrivacy(ctx: Ctx, matchId: string): Promise<void> {
  // Seed a Quick Result submission and a Match Report + goal/card directly,
  // then correct the match, and prove none of them changed.
  const { error: qrErr } = await ctx.client
    .from('tournament_result_submissions')
    .insert({ match_id: matchId, stage: 'quick_result', payload: { home_score: 3, away_score: 0 }, status: 'submitted', version: 1, idempotency_key: `${RUN_TAG}-qr-seed`, submitted_by: ctx.actorId });
  if (qrErr) throw new Error(`quick result seed insert failed: ${qrErr.message}`);

  const { data: goalsBefore } = await ctx.client.from('tournament_match_goals').select('*').eq('match_id', matchId);
  const { data: cardsBefore } = await ctx.client.from('tournament_match_cards').select('*').eq('match_id', matchId);
  const { data: reportsBefore } = await ctx.client.from('tournament_match_reports').select('*').eq('match_id', matchId);
  const { data: fullReportSubBefore } = await ctx.client.from('tournament_result_submissions').select('*').eq('match_id', matchId).eq('stage', 'full_report');
  const { data: quickResultBefore } = await ctx.client.from('tournament_result_submissions').select('*').eq('match_id', matchId).eq('stage', 'quick_result');

  const input = correctionInput({ regulationHomeScore: 9, regulationAwayScore: 1, winnerTeamId: ctx.homeTeamId });
  const preview = await previewResultCorrection({ client: ctx.client, tournamentId: ctx.tournamentId, matchId, actorUserId: ctx.actorId, input });
  await publishResultCorrection({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    matchId,
    expectedVersion: preview.currentVersion,
    idempotencyKey: `${RUN_TAG}-idem-m9-privacy`,
    previewToken: preview.previewToken,
    actorUserId: ctx.actorId,
    actorEmail: ACTOR_EMAIL,
    input,
  });

  const { data: goalsAfter } = await ctx.client.from('tournament_match_goals').select('*').eq('match_id', matchId);
  const { data: cardsAfter } = await ctx.client.from('tournament_match_cards').select('*').eq('match_id', matchId);
  const { data: reportsAfter } = await ctx.client.from('tournament_match_reports').select('*').eq('match_id', matchId);
  const { data: fullReportSubAfter } = await ctx.client.from('tournament_result_submissions').select('*').eq('match_id', matchId).eq('stage', 'full_report');
  const { data: quickResultAfter } = await ctx.client.from('tournament_result_submissions').select('*').eq('match_id', matchId).eq('stage', 'quick_result');

  assert(JSON.stringify(goalsBefore) === JSON.stringify(goalsAfter), 'goals unchanged by correction');
  assert(JSON.stringify(cardsBefore) === JSON.stringify(cardsAfter), 'cards unchanged by correction');
  assert(JSON.stringify(reportsBefore) === JSON.stringify(reportsAfter), 'match report text unchanged by correction');
  assert(JSON.stringify(fullReportSubBefore) === JSON.stringify(fullReportSubAfter), 'original Full Report submission/version unchanged by correction');
  assert(JSON.stringify(quickResultBefore) === JSON.stringify(quickResultAfter), 'Quick Result submission unchanged by correction');

  // Public privacy: the public schedule response must never expose
  // correction-only internals, even after a correction has happened.
  const { data: tournamentRow } = await ctx.client.from('tournaments').select('slug').eq('id', ctx.tournamentId).single();
  const request = {
    nextUrl: { searchParams: new URLSearchParams({ tournament_slug: tournamentRow?.slug || '', category_code: ctx.categoryCode }) },
  } as unknown as Parameters<typeof publicScheduleGet>[0];
  const response = await publicScheduleGet(request);
  const body = await response.json();
  assert(response.status === 200, `public schedule responded 200, got ${response.status}`);
  const raw = JSON.stringify(body);
  assert(!raw.includes('correction_reason') && !raw.includes('correctionReason'), 'public schedule never exposes a correction reason');
  assert(!raw.includes('preview_token') && !raw.includes('previewToken'), 'public schedule never exposes a preview token');
  assert(!raw.includes('idempotency'), 'public schedule never exposes an idempotency key');
  assert(!raw.includes('audit'), 'public schedule never exposes audit data');
  assert(!raw.includes('old_data') && !raw.includes('new_data'), 'public schedule never exposes old_data/new_data');

  // Standings reflects the corrected score dynamically.
  const standings = await getCategoryStandings({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode });
  const home = standings.groups[0]?.rows.find((r) => r.teamId === ctx.homeTeamId);
  assert(!!home, 'home team appears in standings after correction');
}

async function cleanup(ctx: Ctx): Promise<void> {
  console.log('\n[CLEANUP] Removing all disposable rows...');

  if (ctx.matchIds.length > 0) {
    const { error: auditDeleteError } = await ctx.client.from('tournament_audit_logs').delete().eq('entity_type', 'tournament_match').in('entity_id', ctx.matchIds);
    if (auditDeleteError) console.error(`[CLEANUP] audit log delete failed: ${auditDeleteError.message}`);

    // Known Goals/Cards team_id FK delete-ordering gap (documented in PR
    // #11's README section, migration 005, not fixed here) — pre-delete
    // explicitly by match_id before deleting the tournament.
    const { error: goalsDeleteError } = await ctx.client.from('tournament_match_goals').delete().in('match_id', ctx.matchIds);
    if (goalsDeleteError) console.error(`[CLEANUP] match goals delete failed: ${goalsDeleteError.message}`);
    const { error: cardsDeleteError } = await ctx.client.from('tournament_match_cards').delete().in('match_id', ctx.matchIds);
    if (cardsDeleteError) console.error(`[CLEANUP] match cards delete failed: ${cardsDeleteError.message}`);
  }

  const { error: tournamentDeleteError } = await ctx.client.from('tournaments').delete().eq('id', ctx.tournamentId);
  if (tournamentDeleteError) {
    console.error(`[CLEANUP] tournament delete failed: ${tournamentDeleteError.message}`);
    throw new Error(`Cleanup failed to delete the disposable tournament — manual cleanup required for tournament id ${ctx.tournamentId}`);
  }

  const { error: profileDeleteError } = await ctx.client.from('tournament_user_profiles').delete().eq('id', ctx.actorId);
  if (profileDeleteError) {
    console.error(`[CLEANUP] actor profile delete failed: ${profileDeleteError.message}`);
    throw new Error(`Cleanup failed to delete the disposable actor profile — manual cleanup required for id ${ctx.actorId}`);
  }

  console.log('[CLEANUP] Verifying zero disposable rows remain...');
  const { data: tournamentAfter } = await ctx.client.from('tournaments').select('id').eq('id', ctx.tournamentId).maybeSingle();
  assert(!tournamentAfter, 'tournament row is gone');

  const { data: matchesAfter } = await ctx.client.from('tournament_matches').select('id').eq('tournament_id', ctx.tournamentId);
  assert((matchesAfter || []).length === 0, `zero matches remain, got ${(matchesAfter || []).length}`);

  const { data: profileAfter } = await ctx.client.from('tournament_user_profiles').select('id').eq('id', ctx.actorId).maybeSingle();
  assert(!profileAfter, 'disposable actor profile row is gone');

  if (ctx.matchIds.length > 0) {
    const { data: submissionsAfter } = await ctx.client.from('tournament_result_submissions').select('id').in('match_id', ctx.matchIds);
    assert((submissionsAfter || []).length === 0, `zero result submission rows remain, got ${(submissionsAfter || []).length}`);
    const { data: versionsAfter } = await ctx.client.from('tournament_result_versions').select('id').in('submission_id', (submissionsAfter || []).map((s: { id: string }) => s.id));
    assert((versionsAfter || []).length === 0, `zero result version rows remain, got ${(versionsAfter || []).length}`);
  }

  console.log('[CLEANUP] Complete — zero disposable rows remain.\n');
}

async function main() {
  const client = getTournamentServiceClient();
  const ctx = await setup(client);

  try {
    console.log('[SCENARIOS]');
    let match1Id = '';
    await run('1. Clean initial state', async () => {
      match1Id = await scenario1CleanInitialState(ctx);
    });
    await run('2. First Full Report publish setup succeeds', () => scenario2FullReportPublishSetup(ctx, match1Id));
    await run('3. Correction Preview writes zero rows', () => scenario3PreviewWritesZeroRows(ctx, match1Id));
    await run('4. Regulation correction succeeds atomically', () => scenario4RegulationCorrectionSucceeds(ctx, match1Id));
    let match5Id = '';
    await run('5. Penalty correction succeeds atomically', async () => {
      match5Id = await scenario5PenaltyCorrectionSucceeds(ctx);
    });
    await run('6. Same-key concurrent replay is idempotent', () => scenario6SameKeyConcurrentReplayIdempotent(ctx));
    await run('7. Different corrections from same prior version: one success, one version conflict', () => scenario7ConcurrentDifferentCorrectionsOneSuccessOneConflict(ctx));
    await run('8. Invalid/stale/no-change corrections write zero rows', () => scenario8InvalidStaleNoChangeWriteZeroRows(ctx));
    await run('9. Goals/cards/report/Quick Result unchanged and Public privacy holds', () => {
      if (!match5Id) throw new Error('scenario 5 did not produce a match to reuse');
      return scenario9UnchangedDataAndPublicPrivacy(ctx, match5Id);
    });
  } finally {
    await run('10. Complete cleanup of all disposable rows', () => cleanup(ctx));
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

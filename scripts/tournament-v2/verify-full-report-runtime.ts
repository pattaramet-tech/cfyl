// Tournament V2 — Migration 014 runtime verification.
// NOT part of `npm run test` — requires real TOURNAMENT_SUPABASE_* credentials
// pointed at CFYL-Tournament-Staging, where Migration 014
// (scripts/tournament-v2/014-full-result-publish-transaction.sql) has been
// manually applied. Run:
//
//   npm run verify:tournament-full-report-runtime
//
// SAFETY: this script writes real rows to whatever TOURNAMENT_SUPABASE_URL
// points at. It refuses to run unless TOURNAMENT_RUNTIME_VERIFY_CONFIRM is
// set to the exact literal string "CFYL-Tournament-Staging" — this is a
// deliberate, explicit, human-set confirmation gate, not an automatic check
// of the URL itself (a URL alone cannot prove which environment it is).
// Every row this script creates is uniquely named (prefixed with a
// per-run tag) and is deleted again at the end, in a try/finally so cleanup
// runs even if a scenario fails or throws. This script never touches
// Production — it has no Production credentials — and never re-applies or
// modifies any migration.
//
// Exercises the REAL application code (lib/tournament/services/
// fullMatchReport.ts, lib/tournament/services/standings.ts, the public
// schedule route) against the REAL tournament.publish_full_match_report()
// RPC — this is what actually proves Migration 014 works at runtime, which
// the repo's mock-RPC unit tests (lib/tournament/services/__tests__/
// mockPublishRpc.ts) could not.

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
import {
  previewFullMatchReport,
  publishFullMatchReport,
  FullMatchReportError,
  type FullMatchReportInput,
} from '../../lib/tournament/services/fullMatchReport';
import {
  verifyFullReportPreviewToken,
  FULL_REPORT_PREVIEW_TOKEN_PURPOSE,
  hashFullReportPayload,
  type FullReportPreviewClaims,
} from '../../lib/tournament/services/fullReportPreviewToken';
import { issueSignedToken } from '../../lib/tournament/services/signedToken';
import { getCategoryStandings } from '../../lib/tournament/services/standings';
import { GET as publicScheduleGet } from '../../app/api/tournament/public/schedule/route';

type TournamentClient = ReturnType<typeof getTournamentServiceClient>;

const RUN_TAG = `rtv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ACTOR_EMAIL = 'runtime-verify@example.com';

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
  homePlayer2: string;
  awayPlayer1: string;
  // tournament_result_submissions.submitted_by and tournament_audit_logs.admin_id
  // are FK'd to tournament_user_profiles(id) — a fake/non-existent UUID here
  // violates that FK, so setup() creates one real disposable profile row and
  // this is its id (tracked and deleted explicitly in cleanup(), since
  // tournament_user_profiles has no tournament_id column at all and so
  // cannot cascade from the tournament delete).
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

/**
 * If ANY step after the tournament row is created fails, this function
 * deletes that tournament row (cascading away whatever partial rows were
 * created before the failure) before re-throwing — otherwise a mid-setup
 * failure would leave orphaned disposable rows with no later cleanup
 * attempt, since main()'s try/finally only wraps the code that runs AFTER
 * setup() successfully returns.
 */
async function setup(client: TournamentClient): Promise<Ctx> {
  console.log('\n[SETUP] Creating disposable tournament/category/venue/teams/players/group...');

  const { data: tournament, error: tErr } = await client
    .from('tournaments')
    .insert({ name: `Runtime Verify ${RUN_TAG}`, slug: `${RUN_TAG}-tour`, status: 'active' })
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
    .insert({ tournament_id: tournamentId, code: `RTV-${RUN_TAG.slice(-6).toUpperCase()}`, name: 'Runtime Verify Category', gender: 'mixed' })
    .select('id, code')
    .single();
  if (cErr || !category) throw new Error(`category insert failed: ${cErr?.message}`);
  const categoryId = (category as { id: string; code: string }).id;
  const categoryCode = (category as { id: string; code: string }).code;

  const { data: venue, error: vErr } = await client
    .from('tournament_venues')
    .insert({ tournament_id: tournamentId, name: `RTV Venue ${RUN_TAG}`, code: `RTV-${RUN_TAG.slice(-4)}`, slug: `${RUN_TAG}-venue` })
    .select('id')
    .single();
  if (vErr || !venue) throw new Error(`venue insert failed: ${vErr?.message}`);
  const venueId = (venue as { id: string }).id;

  const { data: group, error: gErr } = await client
    .from('tournament_groups')
    .insert({ tournament_id: tournamentId, category_id: categoryId, name: 'Runtime Verify Group', code: 'A' })
    .select('id')
    .single();
  if (gErr || !group) throw new Error(`group insert failed: ${gErr?.message}`);
  const groupId = (group as { id: string }).id;

  const { data: homeTeam, error: htErr } = await client
    .from('tournament_teams')
    .insert({ tournament_id: tournamentId, category_id: categoryId, name: `RTV Home ${RUN_TAG}`, team_code: `RTVH-${RUN_TAG.slice(-4)}` })
    .select('id')
    .single();
  if (htErr || !homeTeam) throw new Error(`home team insert failed: ${htErr?.message}`);
  const homeTeamId = (homeTeam as { id: string }).id;

  const { data: awayTeam, error: atErr } = await client
    .from('tournament_teams')
    .insert({ tournament_id: tournamentId, category_id: categoryId, name: `RTV Away ${RUN_TAG}`, team_code: `RTVA-${RUN_TAG.slice(-4)}` })
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
    .insert([
      { tournament_id: tournamentId, category_id: categoryId, team_id: homeTeamId, player_code: `RTV-H1-${RUN_TAG.slice(-4)}`, full_name: 'RTV Home Player 1' },
      { tournament_id: tournamentId, category_id: categoryId, team_id: homeTeamId, player_code: `RTV-H2-${RUN_TAG.slice(-4)}`, full_name: 'RTV Home Player 2' },
      { tournament_id: tournamentId, category_id: categoryId, team_id: awayTeamId, player_code: `RTV-A1-${RUN_TAG.slice(-4)}`, full_name: 'RTV Away Player 1' },
    ])
    .select('id');
  if (pErr || !players) throw new Error(`players insert failed: ${pErr?.message}`);
  const [homePlayer1, homePlayer2, awayPlayer1] = (players as { id: string }[]).map((p) => p.id);

  // tournament_user_profiles.id has no default and is not FK'd to any other
  // Tournament table by tournament_id — it must be created explicitly and
  // is cleaned up by its own id, not via the tournament cascade.
  const actorId = randomUUID();
  const { error: profileErr } = await client
    .from('tournament_user_profiles')
    .insert({ id: actorId, email: ACTOR_EMAIL, full_name: `Runtime Verify Actor ${RUN_TAG}`, active: true });
  if (profileErr) throw new Error(`actor profile insert failed: ${profileErr.message}`);

  console.log('[SETUP] Done.\n');

  return {
    client,
    tournamentId,
    categoryId,
    categoryCode,
    venueId,
    groupId,
    homeTeamId,
    awayTeamId,
    homePlayer1,
    homePlayer2,
    awayPlayer1,
    actorId,
    matchIds: [],
  };
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

function baseInput(overrides: Partial<FullMatchReportInput> = {}): FullMatchReportInput {
  return {
    regulationHomeScore: 3,
    regulationAwayScore: 1,
    penaltyHomeScore: null,
    penaltyAwayScore: null,
    decidedBy: 'regulation',
    winnerTeamId: '',
    reportText: `Runtime verify report ${RUN_TAG}`,
    goals: [],
    cards: [],
    ...overrides,
  };
}

async function scenario1RegulationPublish(ctx: Ctx): Promise<string> {
  const matchId = await createMatch(ctx, 'm1-regulation');
  const input = baseInput({
    regulationHomeScore: 3,
    regulationAwayScore: 1,
    winnerTeamId: ctx.homeTeamId,
    goals: [{ teamId: ctx.homeTeamId, playerId: ctx.homePlayer1, minute: 12, isOwnGoal: false, goals: 1, note: null }],
    cards: [{ teamId: ctx.awayTeamId, playerId: ctx.awayPlayer1, cardType: 'yellow', minute: 55, note: null }],
  });

  const preview = await previewFullMatchReport({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    venueId: ctx.venueId,
    matchId,
    actorUserId: ctx.actorId,
    input,
  });
  assert(preview.previewToken, 'preview token issued');

  const idempotencyKey = `${RUN_TAG}-idem-m1`;
  const result = await publishFullMatchReport({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    venueId: ctx.venueId,
    matchId,
    expectedVersion: preview.currentVersion,
    idempotencyKey,
    previewToken: preview.previewToken,
    actorUserId: ctx.actorId,
    actorEmail: ACTOR_EMAIL,
    input,
  });
  assert(result.idempotent === false, 'first publish is not idempotent');

  const match = await getMatch(ctx, matchId);
  assert(match.status === 'finished', `status is finished, got ${match.status}`);
  assert(match.result_workflow_status === 'published', `result_workflow_status is published, got ${match.result_workflow_status}`);
  assert(match.regulation_home_score === 3 && match.regulation_away_score === 1, 'regulation score persisted correctly');
  assert(match.winner_team_id === ctx.homeTeamId, 'winner persisted correctly');
  assert(match.penalty_home_score === null && match.penalty_away_score === null, 'no penalty scores for a regulation-decided match');

  const { data: goalsRows } = await ctx.client.from('tournament_match_goals').select('*').eq('match_id', matchId);
  assert((goalsRows || []).length === 1, `exactly one goal row persisted, got ${(goalsRows || []).length}`);
  const { data: cardsRows } = await ctx.client.from('tournament_match_cards').select('*').eq('match_id', matchId);
  assert((cardsRows || []).length === 1, `exactly one card row persisted, got ${(cardsRows || []).length}`);
  const { data: submissionRows } = await ctx.client.from('tournament_result_submissions').select('*').eq('match_id', matchId).eq('stage', 'full_report');
  assert((submissionRows || []).length === 1, `exactly one full_report submission, got ${(submissionRows || []).length}`);
  const { data: auditRows } = await ctx.client.from('tournament_audit_logs').select('id').eq('entity_type', 'tournament_match').eq('entity_id', matchId);
  assert((auditRows || []).length === 1, `exactly one audit log entry, got ${(auditRows || []).length}`);

  return matchId;
}

async function scenario2PenaltyPublish(ctx: Ctx): Promise<string> {
  const matchId = await createMatch(ctx, 'm2-penalty');
  const input = baseInput({
    regulationHomeScore: 1,
    regulationAwayScore: 1,
    decidedBy: 'penalty',
    penaltyHomeScore: 5,
    penaltyAwayScore: 4,
    winnerTeamId: ctx.homeTeamId,
    goals: [
      { teamId: ctx.homeTeamId, playerId: ctx.homePlayer2, minute: 30, isOwnGoal: false, goals: 1, note: null },
      { teamId: ctx.awayTeamId, playerId: ctx.awayPlayer1, minute: 60, isOwnGoal: false, goals: 1, note: null },
    ],
  });

  const preview = await previewFullMatchReport({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    venueId: ctx.venueId,
    matchId,
    actorUserId: ctx.actorId,
    input,
  });

  const result = await publishFullMatchReport({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    venueId: ctx.venueId,
    matchId,
    expectedVersion: preview.currentVersion,
    idempotencyKey: `${RUN_TAG}-idem-m2`,
    previewToken: preview.previewToken,
    actorUserId: ctx.actorId,
    actorEmail: ACTOR_EMAIL,
    input,
  });
  assert(result.idempotent === false, 'penalty publish is not idempotent');

  const match = await getMatch(ctx, matchId);
  assert(match.result_workflow_status === 'published', 'penalty match published');
  assert(match.decided_by === 'penalty', 'decided_by=penalty persisted');
  assert(match.result_type === 'penalty_decided', 'result_type=penalty_decided persisted');
  assert(match.penalty_home_score === 5 && match.penalty_away_score === 4, 'penalty scores persisted correctly');
  assert(match.regulation_home_score === 1 && match.regulation_away_score === 1, 'regulation scores persisted (tied)');

  return matchId;
}

async function scenario3ConcurrentSameKeyIdempotency(ctx: Ctx): Promise<void> {
  const matchId = await createMatch(ctx, 'm3-idem');
  const input = baseInput({ regulationHomeScore: 2, regulationAwayScore: 0, winnerTeamId: ctx.homeTeamId });
  const preview = await previewFullMatchReport({ client: ctx.client, tournamentId: ctx.tournamentId, venueId: ctx.venueId, matchId, actorUserId: ctx.actorId, input });
  const idempotencyKey = `${RUN_TAG}-idem-m3`;

  const publishOnce = () =>
    publishFullMatchReport({
      client: ctx.client,
      tournamentId: ctx.tournamentId,
      venueId: ctx.venueId,
      matchId,
      expectedVersion: preview.currentVersion,
      idempotencyKey,
      previewToken: preview.previewToken,
      actorUserId: ctx.actorId,
      actorEmail: ACTOR_EMAIL,
      input,
    });

  // Fire both "concurrently" from Node's perspective (no await between the
  // two calls) — the real concurrency guarantee comes from Postgres's row
  // lock inside the RPC (SELECT ... FOR UPDATE before the idempotency
  // check), not from anything in this script; this proves the CONTRACT
  // (exactly one physical publish, one idempotent success) holds against
  // the live database.
  const [first, second] = await Promise.all([publishOnce(), publishOnce()]);
  const idempotentCount = [first, second].filter((r) => r.idempotent).length;
  const freshCount = [first, second].filter((r) => !r.idempotent).length;
  assert(freshCount === 1, `exactly one fresh publish among the two concurrent calls, got ${freshCount}`);
  assert(idempotentCount === 1, `exactly one idempotent success among the two concurrent calls, got ${idempotentCount}`);
  assert(first.submissionId === second.submissionId, 'both calls resolved to the same submission id');

  const { data: submissionRows } = await ctx.client.from('tournament_result_submissions').select('id').eq('match_id', matchId).eq('stage', 'full_report');
  assert((submissionRows || []).length === 1, `exactly one submission row exists after both calls, got ${(submissionRows || []).length}`);
  const { data: versionRows } = await ctx.client.from('tournament_result_versions').select('id').eq('submission_id', (submissionRows as { id: string }[])[0].id);
  assert((versionRows || []).length === 1, `exactly one result version exists, got ${(versionRows || []).length}`);
  const { data: auditRows } = await ctx.client.from('tournament_audit_logs').select('id').eq('entity_type', 'tournament_match').eq('entity_id', matchId);
  assert((auditRows || []).length === 1, `exactly one audit log entry exists, got ${(auditRows || []).length}`);

  const match = await getMatch(ctx, matchId);
  assert(match.version === 2, `match version incremented exactly once (1 -> 2), got ${match.version}`);
}

async function scenario4SameKeyDifferentPayloadRejected(ctx: Ctx): Promise<void> {
  const matchId = await createMatch(ctx, 'm4-mismatch');
  const inputA = baseInput({ regulationHomeScore: 2, regulationAwayScore: 0, winnerTeamId: ctx.homeTeamId });
  const preview = await previewFullMatchReport({ client: ctx.client, tournamentId: ctx.tournamentId, venueId: ctx.venueId, matchId, actorUserId: ctx.actorId, input: inputA });
  const idempotencyKey = `${RUN_TAG}-idem-m4`;

  await publishFullMatchReport({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    venueId: ctx.venueId,
    matchId,
    expectedVersion: preview.currentVersion,
    idempotencyKey,
    previewToken: preview.previewToken,
    actorUserId: ctx.actorId,
    actorEmail: ACTOR_EMAIL,
    input: inputA,
  });

  const inputB = baseInput({ regulationHomeScore: 9, regulationAwayScore: 0, winnerTeamId: ctx.homeTeamId });
  let threw = false;
  try {
    await publishFullMatchReport({
      client: ctx.client,
      tournamentId: ctx.tournamentId,
      venueId: ctx.venueId,
      matchId,
      expectedVersion: preview.currentVersion,
      idempotencyKey,
      previewToken: '',
      actorUserId: ctx.actorId,
      actorEmail: ACTOR_EMAIL,
      input: inputB,
    });
  } catch (error) {
    threw = true;
    assert(error instanceof FullMatchReportError, 'error is a FullMatchReportError');
    assert((error as FullMatchReportError).code === 'FULL_REPORT_IDEMPOTENCY_PAYLOAD_MISMATCH', `expected IDEMPOTENCY_PAYLOAD_MISMATCH, got ${(error as FullMatchReportError).code}`);
  }
  assert(threw, 'same key + different payload was rejected');

  const { data: submissionRows } = await ctx.client.from('tournament_result_submissions').select('id, payload').eq('match_id', matchId).eq('stage', 'full_report');
  assert((submissionRows || []).length === 1, 'still exactly one submission (the original)');
  const payload = (submissionRows as { payload: Record<string, unknown> }[])[0].payload;
  assert(payload.regulationHomeScore === 2, 'stored payload still reflects the ORIGINAL score, not the rejected one');
}

async function scenario5DifferentKeyAlreadyPublishedRejected(ctx: Ctx, publishedMatchId: string): Promise<void> {
  const match = await getMatch(ctx, publishedMatchId);
  let threw = false;
  try {
    await publishFullMatchReport({
      client: ctx.client,
      tournamentId: ctx.tournamentId,
      venueId: ctx.venueId,
      matchId: publishedMatchId,
      expectedVersion: match.version as number,
      idempotencyKey: `${RUN_TAG}-idem-m1-second-attempt`,
      previewToken: '',
      actorUserId: ctx.actorId,
      actorEmail: ACTOR_EMAIL,
      input: baseInput({ winnerTeamId: ctx.homeTeamId }),
    });
  } catch (error) {
    threw = true;
    assert((error as FullMatchReportError).code === 'FULL_REPORT_ALREADY_PUBLISHED_USE_CORRECTION', `expected ALREADY_PUBLISHED_USE_CORRECTION at the app layer, got ${(error as FullMatchReportError).code}`);
  }
  assert(threw, 'app layer rejected a different-key publish attempt against an already-published match');

  // Also exercise the RPC's OWN copy of this guard directly (bypassing the
  // app layer entirely), since the app layer's assertEligible() short-
  // circuits before ever calling the RPC for this case.
  const { data: rpcData, error: rpcError } = await ctx.client.rpc('publish_full_match_report', {
    p_match_id: publishedMatchId,
    p_tournament_id: ctx.tournamentId,
    p_expected_version: match.version,
    p_actor_user_id: ctx.actorId,
    p_actor_email: ACTOR_EMAIL,
    p_idempotency_key: `${RUN_TAG}-idem-m1-direct-rpc-attempt`,
    p_regulation_home_score: 3,
    p_regulation_away_score: 1,
    p_penalty_home_score: null,
    p_penalty_away_score: null,
    p_decided_by: 'regulation',
    p_winner_team_id: ctx.homeTeamId,
    p_result_type: 'normal',
    p_goals: [],
    p_cards: [],
    p_report_text: null,
    p_quick_result_comparison: null,
  });
  assert(rpcData === null, 'direct RPC call against an already-published match returns no data');
  assert(!!rpcError, 'direct RPC call against an already-published match returns an error');
  assert((rpcError?.message || '').includes('FULL_REPORT_ALREADY_PUBLISHED_USE_CORRECTION'), `expected ALREADY_PUBLISHED_USE_CORRECTION from the live RPC itself, got: ${rpcError?.message}`);
}

async function scenario6RollbackAfterCardConstraintFailure(ctx: Ctx): Promise<void> {
  const matchId = await createMatch(ctx, 'm6-rollback');

  // Pre-seed ONE card row directly (bypassing the RPC entirely) so that the
  // RPC's own in-transaction duplicate check (which only looks at the
  // CURRENTLY submitted array) cannot catch it — this forces the real
  // Postgres unique(match_id, player_id, card_type) constraint itself to
  // fire during the RPC's INSERT, proving the whole transaction rolls back.
  const { error: seedError } = await ctx.client
    .from('tournament_match_cards')
    .insert({ match_id: matchId, player_id: ctx.homePlayer1, team_id: ctx.homeTeamId, card_type: 'yellow', minute: 5 });
  if (seedError) throw new Error(`pre-seed card insert failed: ${seedError.message}`);

  const input = baseInput({
    regulationHomeScore: 2,
    regulationAwayScore: 0,
    winnerTeamId: ctx.homeTeamId,
    goals: [{ teamId: ctx.homeTeamId, playerId: ctx.homePlayer2, minute: 10, isOwnGoal: false, goals: 1, note: null }],
    cards: [{ teamId: ctx.homeTeamId, playerId: ctx.homePlayer1, cardType: 'yellow', minute: 40, note: null }],
  });

  const preview = await previewFullMatchReport({ client: ctx.client, tournamentId: ctx.tournamentId, venueId: ctx.venueId, matchId, actorUserId: ctx.actorId, input });

  let threw = false;
  try {
    await publishFullMatchReport({
      client: ctx.client,
      tournamentId: ctx.tournamentId,
      venueId: ctx.venueId,
      matchId,
      expectedVersion: preview.currentVersion,
      idempotencyKey: `${RUN_TAG}-idem-m6`,
      previewToken: preview.previewToken,
      actorUserId: ctx.actorId,
      actorEmail: ACTOR_EMAIL,
      input,
    });
  } catch {
    threw = true;
  }
  assert(threw, 'publish with a card colliding against a pre-existing DB row failed');

  const match = await getMatch(ctx, matchId);
  assert(match.result_workflow_status === 'not_started', 'match remains unpublished after the injected constraint failure');
  assert(match.status !== 'finished', 'match status was never set to finished');
  assert(match.version === 1, 'match version was never incremented');

  const { data: cardsRows } = await ctx.client.from('tournament_match_cards').select('id').eq('match_id', matchId);
  assert((cardsRows || []).length === 1, `only the pre-seeded card row remains — no partial insert (got ${(cardsRows || []).length})`);
  const { data: goalsRows } = await ctx.client.from('tournament_match_goals').select('id').eq('match_id', matchId);
  assert((goalsRows || []).length === 0, `the otherwise-valid goal was NOT persisted — full rollback (got ${(goalsRows || []).length})`);
  const { data: submissionRows } = await ctx.client.from('tournament_result_submissions').select('id').eq('match_id', matchId).eq('stage', 'full_report');
  assert((submissionRows || []).length === 0, 'no submission row was created');
  const { data: auditRows } = await ctx.client.from('tournament_audit_logs').select('id').eq('entity_type', 'tournament_match').eq('entity_id', matchId);
  assert((auditRows || []).length === 0, 'no audit log entry was created');
}

async function scenario7PreviewTokenCases(ctx: Ctx): Promise<void> {
  const matchId = await createMatch(ctx, 'm7-token');
  const input = baseInput({ regulationHomeScore: 4, regulationAwayScore: 2, winnerTeamId: ctx.homeTeamId });

  // required
  {
    let threw = false;
    try {
      await publishFullMatchReport({
        client: ctx.client,
        tournamentId: ctx.tournamentId,
        venueId: ctx.venueId,
        matchId,
        expectedVersion: 1,
        idempotencyKey: `${RUN_TAG}-idem-m7-required`,
        previewToken: '',
        actorUserId: ctx.actorId,
        actorEmail: ACTOR_EMAIL,
        input,
      });
    } catch (error) {
      threw = true;
      assert((error as FullMatchReportError).code === 'FULL_REPORT_PREVIEW_REQUIRED', `expected PREVIEW_REQUIRED, got ${(error as FullMatchReportError).code}`);
    }
    assert(threw, 'publish without a preview token was rejected');
  }

  const preview = await previewFullMatchReport({ client: ctx.client, tournamentId: ctx.tournamentId, venueId: ctx.venueId, matchId, actorUserId: ctx.actorId, input });

  // tampered
  {
    const [payload, signature] = preview.previewToken.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    decoded.expectedMatchVersion = 999;
    const tamperedToken = `${Buffer.from(JSON.stringify(decoded), 'utf-8').toString('base64url')}.${signature}`;

    let threw = false;
    try {
      await publishFullMatchReport({
        client: ctx.client,
        tournamentId: ctx.tournamentId,
        venueId: ctx.venueId,
        matchId,
        expectedVersion: preview.currentVersion,
        idempotencyKey: `${RUN_TAG}-idem-m7-tampered`,
        previewToken: tamperedToken,
        actorUserId: ctx.actorId,
        actorEmail: ACTOR_EMAIL,
        input,
      });
    } catch (error) {
      threw = true;
      assert((error as FullMatchReportError).code === 'FULL_REPORT_PREVIEW_INVALID', `expected PREVIEW_INVALID, got ${(error as FullMatchReportError).code}`);
    }
    assert(threw, 'publish with a tampered preview token was rejected');
  }

  // expired (hand-signed with a negative TTL using the real secret, rather than waiting 15 minutes)
  {
    const claims: Omit<FullReportPreviewClaims, 'purpose' | 'issuedAt' | 'expiresAt'> = {
      tournamentId: ctx.tournamentId,
      matchId,
      venueId: ctx.venueId,
      actorUserId: ctx.actorId,
      expectedMatchVersion: preview.currentVersion,
      payloadHash: hashFullReportPayload('irrelevant-for-this-check'),
      quickResultComparisonHash: null,
    };
    const expiredToken = issueSignedToken<FullReportPreviewClaims>({
      claims: { ...claims, purpose: FULL_REPORT_PREVIEW_TOKEN_PURPOSE },
      ttlMs: -1000,
      secretEnvVar: 'TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET',
    });
    const verification = verifyFullReportPreviewToken(expiredToken.token);
    assert(!verification.ok && verification.code === 'FULL_REPORT_PREVIEW_EXPIRED', `hand-signed expired token verifies as FULL_REPORT_PREVIEW_EXPIRED, got ${JSON.stringify(verification)}`);

    let threw = false;
    try {
      await publishFullMatchReport({
        client: ctx.client,
        tournamentId: ctx.tournamentId,
        venueId: ctx.venueId,
        matchId,
        expectedVersion: preview.currentVersion,
        idempotencyKey: `${RUN_TAG}-idem-m7-expired`,
        previewToken: expiredToken.token,
        actorUserId: ctx.actorId,
        actorEmail: ACTOR_EMAIL,
        input,
      });
    } catch (error) {
      threw = true;
      assert((error as FullMatchReportError).code === 'FULL_REPORT_PREVIEW_EXPIRED', `expected PREVIEW_EXPIRED, got ${(error as FullMatchReportError).code}`);
    }
    assert(threw, 'publish with an expired preview token was rejected');
  }

  // mismatch (valid, unexpired token, but the submitted score differs from what was previewed)
  {
    const mismatchedInput = baseInput({ regulationHomeScore: 4, regulationAwayScore: 3, winnerTeamId: ctx.homeTeamId });
    let threw = false;
    try {
      await publishFullMatchReport({
        client: ctx.client,
        tournamentId: ctx.tournamentId,
        venueId: ctx.venueId,
        matchId,
        expectedVersion: preview.currentVersion,
        idempotencyKey: `${RUN_TAG}-idem-m7-mismatch`,
        previewToken: preview.previewToken,
        actorUserId: ctx.actorId,
        actorEmail: ACTOR_EMAIL,
        input: mismatchedInput,
      });
    } catch (error) {
      threw = true;
      assert((error as FullMatchReportError).code === 'FULL_REPORT_PREVIEW_MISMATCH', `expected PREVIEW_MISMATCH, got ${(error as FullMatchReportError).code}`);
    }
    assert(threw, 'publish with a payload that diverges from the preview was rejected');
  }

  const match = await getMatch(ctx, matchId);
  assert(match.result_workflow_status === 'not_started', 'match m7 was never published by any of the rejected attempts');
  assert(match.version === 1, 'match m7 version never changed');
}

async function scenario8PublicSchedule(ctx: Ctx): Promise<void> {
  const { data: tournamentRow } = await ctx.client.from('tournaments').select('slug').eq('id', ctx.tournamentId).single();
  const request = {
    nextUrl: {
      searchParams: new URLSearchParams({ tournament_slug: tournamentRow?.slug || '', category_code: ctx.categoryCode }),
    },
  } as unknown as Parameters<typeof publicScheduleGet>[0];

  const response = await publicScheduleGet(request);
  const body = await response.json();
  assert(response.status === 200, `public schedule responded 200, got ${response.status}`);

  // Locate our match by team name (the public payload has no internal id
  // field to match against directly).
  const ourMatch = (body.data || []).find(
    (m: { home_team?: string; away_team?: string }) => m.home_team === `RTV Home ${RUN_TAG}` && m.away_team === `RTV Away ${RUN_TAG}`
  );
  assert(!!ourMatch, 'the published match appears in the public schedule response, resolved by team name');

  const raw = JSON.stringify(body);
  assert(!raw.includes('report'), 'public schedule response never mentions "report"');
  assert(!raw.includes('preview_token') && !raw.includes('previewToken'), 'public schedule response never exposes a preview token');
  assert(!raw.includes('idempotency'), 'public schedule response never exposes an idempotency key');
  assert(!raw.includes('audit'), 'public schedule response never exposes audit data');
  assert(!raw.includes('regulation_home_score') && !raw.includes('regulationHomeScore'), 'public schedule response never exposes a score field');
}

async function scenario9Standings(ctx: Ctx): Promise<void> {
  const standings = await getCategoryStandings({ client: ctx.client, tournamentId: ctx.tournamentId, categoryCode: ctx.categoryCode });
  assert(standings.groups.length === 1, `exactly one group in standings, got ${standings.groups.length}`);
  const rows = standings.groups[0].rows;
  const home = rows.find((r) => r.teamId === ctx.homeTeamId);
  const away = rows.find((r) => r.teamId === ctx.awayTeamId);
  assert(!!home && !!away, 'both teams appear in standings');

  // By the time this scenario runs, FOUR matches between the same two
  // disposable teams have actually been published (scenarios that only
  // exercise rejection paths — 5, 6, 7 — never publish a new match):
  //   scenario 1: home 3-1 away (regulation)
  //   scenario 2: home 1-1 away (regulation), penalty 5-4 to home
  //   scenario 3: home 2-0 away (regulation) — the concurrency test's
  //     "first" call among the two concurrent publishOnce() calls succeeds
  //   scenario 4: home 2-0 away (regulation) — inputA's first, successful
  //     publish, before the same-key different-payload attempt is rejected
  // Penalty goals (5-4 in scenario 2) must NOT be added to goalsFor/goalsAgainst.
  assert(home!.played === 4, `home played 4 matches, got ${home!.played}`);
  assert(home!.goalsFor === 3 + 1 + 2 + 2, `home goalsFor = 8 (regulation only, penalty 5 excluded), got ${home!.goalsFor}`);
  assert(home!.goalsAgainst === 1 + 1 + 0 + 0, `home goalsAgainst = 2 (regulation only, penalty 4 excluded), got ${home!.goalsAgainst}`);
  assert(home!.goalDifference === 6, `home goalDifference = 6, got ${home!.goalDifference}`);
  // D-09: no draws — the penalty-decided match still awards 3/0, not 1/1.
  assert(home!.points === 12, `home points = 12 (won all four, including the penalty-decided one), got ${home!.points}`);
  assert(away!.points === 0, `away points = 0 (lost all four), got ${away!.points}`);
  assert(away!.goalsFor === 1 + 1 + 0 + 0, `away goalsFor = 2, got ${away!.goalsFor}`);
  assert(away!.goalsAgainst === 3 + 1 + 2 + 2, `away goalsAgainst = 8, got ${away!.goalsAgainst}`);
}

async function cleanup(ctx: Ctx): Promise<void> {
  console.log('\n[CLEANUP] Removing all disposable rows...');

  // tournament_audit_logs.tournament_id is ON DELETE SET NULL, not CASCADE —
  // these must be deleted explicitly, or they would be orphaned forever.
  if (ctx.matchIds.length > 0) {
    const { error: auditDeleteError } = await ctx.client
      .from('tournament_audit_logs')
      .delete()
      .eq('entity_type', 'tournament_match')
      .in('entity_id', ctx.matchIds);
    if (auditDeleteError) console.error(`[CLEANUP] audit log delete failed: ${auditDeleteError.message}`);

    // SCHEMA GAP FOUND DURING RUNTIME VERIFICATION: tournament_match_goals.team_id
    // and tournament_match_cards.team_id reference tournament_teams(id) with
    // NO "on delete cascade" (unlike their match_id FK, which does cascade).
    // Deleting the tournament triggers cascading deletes of BOTH
    // tournament_teams (via tournament_id) and tournament_matches (via
    // tournament_id, which further cascades to these event tables via
    // match_id) — but Postgres does not guarantee the match-side cascade
    // completes before the team-side cascade is attempted, so a card/goal
    // row can still be referencing a team_id that Postgres is simultaneously
    // trying to delete, and the whole DELETE fails with a foreign key
    // violation. Deleting these event rows explicitly, by match_id, BEFORE
    // deleting the tournament sidesteps the gap without requiring a schema
    // migration (out of scope for this verification task — see the final
    // report's Blockers section).
    const { error: goalsDeleteError } = await ctx.client.from('tournament_match_goals').delete().in('match_id', ctx.matchIds);
    if (goalsDeleteError) console.error(`[CLEANUP] match goals delete failed: ${goalsDeleteError.message}`);
    const { error: cardsDeleteError } = await ctx.client.from('tournament_match_cards').delete().in('match_id', ctx.matchIds);
    if (cardsDeleteError) console.error(`[CLEANUP] match cards delete failed: ${cardsDeleteError.message}`);
  }

  // Deleting the tournament cascades categories, teams, players, groups,
  // group_members, matches, and (via match_id cascade) reports/
  // result_submissions/result_versions.
  const { error: tournamentDeleteError } = await ctx.client.from('tournaments').delete().eq('id', ctx.tournamentId);
  if (tournamentDeleteError) {
    console.error(`[CLEANUP] tournament delete failed: ${tournamentDeleteError.message}`);
    throw new Error(`Cleanup failed to delete the disposable tournament — manual cleanup required for tournament id ${ctx.tournamentId}`);
  }

  // tournament_user_profiles has no tournament_id column at all, so it
  // cannot cascade from the tournament delete — must be removed explicitly.
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

  const { data: teamsAfter } = await ctx.client.from('tournament_teams').select('id').eq('tournament_id', ctx.tournamentId);
  assert((teamsAfter || []).length === 0, `zero teams remain, got ${(teamsAfter || []).length}`);

  const { data: auditAfter } = await ctx.client.from('tournament_audit_logs').select('id').eq('entity_type', 'tournament_match').in('entity_id', ctx.matchIds);
  assert((auditAfter || []).length === 0, `zero audit log rows remain for our matches, got ${(auditAfter || []).length}`);

  const { data: profileAfter } = await ctx.client.from('tournament_user_profiles').select('id').eq('id', ctx.actorId).maybeSingle();
  assert(!profileAfter, 'disposable actor profile row is gone');

  if (ctx.matchIds.length > 0) {
    const { data: goalsAfter } = await ctx.client.from('tournament_match_goals').select('id').in('match_id', ctx.matchIds);
    assert((goalsAfter || []).length === 0, `zero goal rows remain, got ${(goalsAfter || []).length}`);
    const { data: cardsAfter } = await ctx.client.from('tournament_match_cards').select('id').in('match_id', ctx.matchIds);
    assert((cardsAfter || []).length === 0, `zero card rows remain, got ${(cardsAfter || []).length}`);
    const { data: submissionsAfter } = await ctx.client.from('tournament_result_submissions').select('id').in('match_id', ctx.matchIds);
    assert((submissionsAfter || []).length === 0, `zero result submission rows remain, got ${(submissionsAfter || []).length}`);
  }

  console.log('[CLEANUP] Complete — zero disposable rows remain.\n');
}

async function main() {
  const client = getTournamentServiceClient();
  const ctx = await setup(client);

  try {
    console.log('[SCENARIOS]');
    let match1Id = '';
    await run('1. Regulation result publication', async () => {
      match1Id = await scenario1RegulationPublish(ctx);
    });
    await run('2. Penalty-decided result publication', async () => {
      await scenario2PenaltyPublish(ctx);
    });
    await run('3. Concurrent same-key idempotency', () => scenario3ConcurrentSameKeyIdempotency(ctx));
    await run('4. Same-key different-payload rejection', () => scenario4SameKeyDifferentPayloadRejected(ctx));
    await run('5. Different-key already-published rejection', () => {
      if (!match1Id) throw new Error('scenario 1 did not produce a published match to reuse');
      return scenario5DifferentKeyAlreadyPublishedRejected(ctx, match1Id);
    });
    await run('6. Full transaction rollback after injected card constraint failure', () => scenario6RollbackAfterCardConstraintFailure(ctx));
    await run('7. Preview Token required/tampered/expired/mismatch', () => scenario7PreviewTokenCases(ctx));
    await run('8. Public Schedule reflects only the published official result', () => scenario8PublicSchedule(ctx));
    await run('9. Standings uses regulation scores, excludes penalty scores from GF/GA/GD', () => scenario9Standings(ctx));
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

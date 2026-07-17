/**
 * Tournament V2 — Quick Result disposable-data RUNTIME verifier.
 *
 * NOT part of `npm run test`. Requires real TOURNAMENT_SUPABASE_* credentials
 * for CFYL-Tournament-Staging in .env.local, plus an explicit opt-in:
 *
 *   TOURNAMENT_RUNTIME_VERIFY_CONFIRM=CFYL-Tournament-Staging
 *
 * Run: npm run verify:tournament-quick-result-runtime
 *
 * WHAT THIS PROVES that the mocked unit tests
 * (lib/tournament/services/__tests__/quickResult.test.ts,
 * app/api/tournament/admin/matches/[matchId]/quick-result/__tests__/route.test.ts)
 * cannot: real Postgres row-locking, real concurrent-write behavior against a
 * live database, and real end-to-end data persistence — using disposable,
 * uniquely-tagged rows only.
 *
 * REQUIRES MIGRATION 016 —
 * scripts/tournament-v2/016-quick-result-atomic-submit.sql — which fixes the
 * transactional-atomicity gap this feature previously had: submitQuickResult()
 * now performs its entire write path (idempotency decision, version claim,
 * submission insert, result-version insert, audit log) as exactly one
 * client.rpc(...) call to tournament.submit_quick_result(), a single
 * Postgres transaction.
 *
 * DESIGN CHOICE — bypasses HTTP/auth, exercises the real service functions
 * directly (same precedent as verify-qualification-draw-runtime.ts and
 * verify-schedule-import-runtime.ts): calls previewQuickResult /
 * submitQuickResult directly — the exact same functions
 * app/api/tournament/admin/matches/[matchId]/quick-result/route.ts calls, in
 * the same order. The requireTournamentResultOperator() HTTP/auth wrapper
 * itself is intentionally out of scope for this runtime check, to avoid
 * creating throwaway users in League's shared production Auth system. The
 * Preview Token's HMAC secret (TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET) is
 * read from the same .env.local as the Tournament Supabase credentials.
 *
 * Does not add a production failure-injection backdoor merely to test
 * rollback — mid-transaction failure paths (submission/result-version/audit
 * insert failing) are covered by the transactional RPC mock in
 * lib/tournament/services/__tests__/mockSubmitQuickResultRpc.ts instead, the
 * same approach PR #7 used for its own atomic RPC.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { loadEnvConfig } from '@next/env';
import { randomUUID } from 'crypto';
import { getTournamentServiceClient } from '../../lib/tournament/db/supabase-tournament';
import {
  previewQuickResult,
  submitQuickResult,
  type SubmitQuickResultResult,
} from '../../lib/tournament/services/quickResult';

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
if (!process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET) {
  console.error(
    '[SAFETY] Refusing to run: TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET is not set in .env.local — ' +
      'Preview Token issuance/verification requires it.'
  );
  process.exit(1);
}

const RUN_TAG = `qr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ACTOR_ID = randomUUID();
const ACTOR_EMAIL = 'runtime-verify-quick-result@example.com';
const CATEGORY_CODE = 'B-U12';

type TournamentClient = ReturnType<typeof getTournamentServiceClient>;

interface Ctx {
  client: TournamentClient;
  tournamentId: string;
  categoryId: string;
  venueId: string;
  courtId: string;
  teamAId: string;
  teamBId: string;
  matchId: string; // primary disposable match used for most scenarios
  matchIds: string[]; // every match created — for cleanup
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

async function callSubmit(
  ctx: Ctx,
  overrides: Partial<{
    matchId: string;
    homeScore: number;
    awayScore: number;
    expectedVersion: number;
    idempotencyKey: string;
    previewToken: string;
    venueId: string | null;
    sessionId: string | null;
    deviceMetadata: Record<string, unknown> | null;
  }> = {}
): Promise<SubmitQuickResultResult> {
  try {
    return await submitQuickResult({
      client: ctx.client,
      tournamentId: ctx.tournamentId,
      venueId: overrides.venueId !== undefined ? overrides.venueId : ctx.venueId,
      matchId: overrides.matchId || ctx.matchId,
      homeScore: overrides.homeScore ?? 2,
      awayScore: overrides.awayScore ?? 1,
      expectedVersion: overrides.expectedVersion as number,
      idempotencyKey: overrides.idempotencyKey || `${RUN_TAG}-key`,
      previewToken: overrides.previewToken as string,
      actorUserId: ACTOR_ID,
      actorEmail: ACTOR_EMAIL,
      sessionId: overrides.sessionId !== undefined ? overrides.sessionId : `${RUN_TAG}-session`,
      deviceMetadata: overrides.deviceMetadata !== undefined ? overrides.deviceMetadata : { platform: 'runtime-verify' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('does not exist') || message.includes('schema cache') || message.includes('Could not find the function')) {
      throw new Error(
        `submit_quick_result RPC does not exist — Migration 016 has not been applied to this Staging project yet. Raw error: ${message}`
      );
    }
    throw e;
  }
}

// ============================================================================
// Setup — disposable tournament + B-U12 category + venue/court + 2 teams +
// 1 eligible Match, all uniquely tagged with RUN_TAG.
// ============================================================================

async function setup(client: TournamentClient): Promise<Ctx> {
  const { data: tournament, error: tErr } = await client
    .from('tournaments')
    .insert({
      name: `Quick Result Runtime Verify ${RUN_TAG}`,
      slug: `qr-verify-${RUN_TAG}`,
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

    const { data: venue, error: venueErr } = await client
      .from('tournament_venues')
      .insert({ tournament_id: tournamentId, name: `Runtime Verify Venue ${RUN_TAG}`, code: 'V1', slug: `qr-v1-${RUN_TAG}` })
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

    const matchId = await createMatch(client, {
      tournamentId,
      categoryId,
      venueId,
      courtId,
      teamAId: teamA.id as string,
      teamBId: teamB.id as string,
      suffix: 'M1',
    });

    return {
      client,
      tournamentId,
      categoryId,
      venueId,
      courtId,
      teamAId: teamA.id as string,
      teamBId: teamB.id as string,
      matchId,
      matchIds: [matchId],
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

async function createMatch(
  client: TournamentClient,
  params: { tournamentId: string; categoryId: string; venueId: string; courtId: string; teamAId: string; teamBId: string; suffix: string }
): Promise<string> {
  const { data: match, error } = await client
    .from('tournament_matches')
    .insert({
      tournament_id: params.tournamentId,
      category_id: params.categoryId,
      venue_id: params.venueId,
      court_id: params.courtId,
      stage: 'group',
      match_code: `QR-${RUN_TAG}-${params.suffix}`,
      status: 'scheduled',
      home_source_type: 'team',
      home_team_id: params.teamAId,
      away_source_type: 'team',
      away_team_id: params.teamBId,
    })
    .select('id')
    .single();
  if (error || !match) throw new Error(`match ${params.suffix} insert failed: ${error?.message}`);
  return match.id as string;
}

async function getMatchVersion(ctx: Ctx, matchId: string): Promise<number> {
  const { data, error } = await ctx.client.from('tournament_matches').select('version').eq('id', matchId).single();
  if (error || !data) throw new Error(`match version re-fetch failed: ${error?.message}`);
  return data.version as number;
}

// ============================================================================
// Scenarios
// ============================================================================

async function scenarioCleanInitialState(ctx: Ctx): Promise<void> {
  const { data, error } = await ctx.client
    .from('tournament_result_submissions')
    .select('id')
    .eq('match_id', ctx.matchId)
    .eq('stage', 'quick_result');
  if (error) throw new Error(error.message);
  assert((data || []).length === 0, `expected zero quick_result submissions initially, got ${(data || []).length}`);
  const version = await getMatchVersion(ctx, ctx.matchId);
  assert(version === 1, `expected initial Match version 1, got ${version}`);
}

async function scenarioPreviewWritesNothing(ctx: Ctx): Promise<{ previewToken: string; expectedVersion: number }> {
  const preview = await previewQuickResult({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    venueId: ctx.venueId,
    matchId: ctx.matchId,
    homeScore: 2,
    awayScore: 1,
    actorUserId: ACTOR_ID,
  });
  assert(!!preview.previewToken, 'expected a signed preview token');
  assert(preview.previewToken.split('.').length === 2, 'expected preview token to have payload.signature shape');
  assert(preview.currentVersion === 1, `expected currentVersion 1, got ${preview.currentVersion}`);

  const { data, error } = await ctx.client
    .from('tournament_result_submissions')
    .select('id')
    .eq('match_id', ctx.matchId)
    .eq('stage', 'quick_result');
  if (error) throw new Error(error.message);
  assert((data || []).length === 0, 'expected preview to write zero submission rows');

  const version = await getMatchVersion(ctx, ctx.matchId);
  assert(version === 1, `expected preview to leave Match version unchanged at 1, got ${version}`);

  return { previewToken: preview.previewToken, expectedVersion: preview.currentVersion };
}

async function scenarioAtomicSubmit(ctx: Ctx, previewToken: string, expectedVersion: number): Promise<void> {
  const idempotencyKey = `${RUN_TAG}-submit-1`;
  const result = await callSubmit(ctx, { expectedVersion, previewToken, idempotencyKey });

  assert(!result.idempotent, 'expected a genuinely new submission');
  assert(result.newMatchVersion === expectedVersion + 1, `expected version to increment exactly once, got ${result.newMatchVersion}`);

  const version = await getMatchVersion(ctx, ctx.matchId);
  assert(version === expectedVersion + 1, `expected Match version to increment exactly once, got ${version}`);

  const { data: submissions, error: subErr } = await ctx.client
    .from('tournament_result_submissions')
    .select('id')
    .eq('match_id', ctx.matchId)
    .eq('stage', 'quick_result');
  if (subErr) throw new Error(subErr.message);
  assert((submissions || []).length === 1, `expected exactly 1 submission, got ${(submissions || []).length}`);

  const { data: versions, error: verErr } = await ctx.client
    .from('tournament_result_versions')
    .select('id')
    .eq('submission_id', result.submissionId);
  if (verErr) throw new Error(verErr.message);
  assert((versions || []).length === 1, `expected exactly 1 result-version row, got ${(versions || []).length}`);

  const { data: audits, error: auditErr } = await ctx.client
    .from('tournament_audit_logs')
    .select('id')
    .eq('entity_id', ctx.matchId)
    .eq('action', 'tournament.quick_result.submit');
  if (auditErr) throw new Error(auditErr.message);
  assert((audits || []).length === 1, `expected exactly 1 audit log entry, got ${(audits || []).length}`);

  const { data: matchAfter, error: matchErr } = await ctx.client
    .from('tournament_matches')
    .select('result_workflow_status, result_type, status, schedule_status, regulation_home_score, regulation_away_score, winner_team_id, home_team_id, away_team_id')
    .eq('id', ctx.matchId)
    .single();
  if (matchErr || !matchAfter) throw new Error(`match re-fetch failed: ${matchErr?.message}`);
  assert(matchAfter.result_workflow_status === 'not_started', 'expected result_workflow_status to remain not_started');
  assert(matchAfter.regulation_home_score === null, 'expected regulation_home_score to remain null (provisional only)');
  assert(matchAfter.regulation_away_score === null, 'expected regulation_away_score to remain null (provisional only)');
  assert(matchAfter.winner_team_id === null, 'expected winner_team_id to remain null');
  assert(matchAfter.home_team_id === ctx.teamAId, 'expected home_team_id unchanged');
  assert(matchAfter.away_team_id === ctx.teamBId, 'expected away_team_id unchanged');
}

async function scenarioIdempotentReplay(ctx: Ctx, previewToken: string, expectedVersion: number): Promise<void> {
  const idempotencyKey = `${RUN_TAG}-submit-1`; // same key as scenarioAtomicSubmit
  const versionBefore = await getMatchVersion(ctx, ctx.matchId);
  const { count: subsBefore } = await countRows(ctx, 'tournament_result_submissions', 'match_id', ctx.matchId);

  const result = await callSubmit(ctx, { expectedVersion, previewToken, idempotencyKey });
  assert(result.idempotent, 'expected an idempotent replay');

  const versionAfter = await getMatchVersion(ctx, ctx.matchId);
  assert(versionAfter === versionBefore, `expected zero additional version increments, before=${versionBefore} after=${versionAfter}`);

  const { count: subsAfter } = await countRows(ctx, 'tournament_result_submissions', 'match_id', ctx.matchId);
  assert(subsAfter === subsBefore, `expected zero additional submission rows, before=${subsBefore} after=${subsAfter}`);
}

async function countRows(ctx: Ctx, table: string, col: string, val: string): Promise<{ count: number }> {
  const { data, error } = await ctx.client.from(table).select('id').eq(col, val);
  if (error) throw new Error(error.message);
  return { count: (data || []).length };
}

async function scenarioSameKeyDifferentPayloadRejected(ctx: Ctx): Promise<void> {
  const idempotencyKey = `${RUN_TAG}-submit-1`; // reuse the already-submitted key
  const versionBefore = await getMatchVersion(ctx, ctx.matchId);
  const { count: subsBefore } = await countRows(ctx, 'tournament_result_submissions', 'match_id', ctx.matchId);

  // A fresh preview for a DIFFERENT score, but the SAME idempotency key.
  const preview = await previewQuickResult({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    venueId: ctx.venueId,
    matchId: ctx.matchId,
    homeScore: 5,
    awayScore: 5,
    actorUserId: ACTOR_ID,
  });

  let threw = false;
  let code = '';
  try {
    await callSubmit(ctx, {
      homeScore: 5,
      awayScore: 5,
      expectedVersion: preview.currentVersion,
      previewToken: preview.previewToken,
      idempotencyKey,
    });
  } catch (e) {
    threw = true;
    code = e instanceof Error && 'code' in e ? String((e as { code: unknown }).code) : '';
  }
  assert(threw, 'expected same-key-different-payload to be rejected');
  assert(code === 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH', `expected IDEMPOTENCY_KEY_PAYLOAD_MISMATCH, got ${code}`);

  const versionAfter = await getMatchVersion(ctx, ctx.matchId);
  assert(versionAfter === versionBefore, 'expected zero writes from the rejected mismatch');
  const { count: subsAfter } = await countRows(ctx, 'tournament_result_submissions', 'match_id', ctx.matchId);
  assert(subsAfter === subsBefore, 'expected zero additional submission rows from the rejected mismatch');
}

async function scenarioConcurrentSameKey(ctx: Ctx): Promise<void> {
  const matchId = await createMatch(ctx.client, {
    tournamentId: ctx.tournamentId,
    categoryId: ctx.categoryId,
    venueId: ctx.venueId,
    courtId: ctx.courtId,
    teamAId: ctx.teamAId,
    teamBId: ctx.teamBId,
    suffix: 'M2',
  });
  ctx.matchIds.push(matchId);

  const preview = await previewQuickResult({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    venueId: ctx.venueId,
    matchId,
    homeScore: 3,
    awayScore: 2,
    actorUserId: ACTOR_ID,
  });
  const idempotencyKey = `${RUN_TAG}-concurrent-same-key`;

  // Real concurrent requests — no await between them — so both reach
  // Postgres as genuinely independent transactions.
  const [a, b] = await Promise.all([
    callSubmit(ctx, { matchId, homeScore: 3, awayScore: 2, expectedVersion: preview.currentVersion, previewToken: preview.previewToken, idempotencyKey }).then(
      (r) => ({ ok: true as const, result: r }),
      (e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })
    ),
    callSubmit(ctx, { matchId, homeScore: 3, awayScore: 2, expectedVersion: preview.currentVersion, previewToken: preview.previewToken, idempotencyKey }).then(
      (r) => ({ ok: true as const, result: r }),
      (e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })
    ),
  ]);

  assert(a.ok && b.ok, `expected both concurrent same-key calls to resolve successfully (one new, one idempotent) — got a=${JSON.stringify(a)} b=${JSON.stringify(b)}`);
  const results = [a, b].map((o) => (o.ok ? o.result : null)).filter((r): r is SubmitQuickResultResult => !!r);
  const newCount = results.filter((r) => !r.idempotent).length;
  const idempotentCount = results.filter((r) => r.idempotent).length;
  assert(newCount === 1, `expected exactly 1 genuinely new submission, got ${newCount}`);
  assert(idempotentCount === 1, `expected exactly 1 idempotent response, got ${idempotentCount}`);

  const { count: subs } = await countRows(ctx, 'tournament_result_submissions', 'match_id', matchId);
  assert(subs === 1, `expected exactly 1 physical submission row, got ${subs}`);

  const version = await getMatchVersion(ctx, matchId);
  assert(version === preview.currentVersion + 1, `expected version to increment exactly once, got ${version}`);
}

async function scenarioConcurrentDifferentKeySameVersion(ctx: Ctx): Promise<void> {
  const matchId = await createMatch(ctx.client, {
    tournamentId: ctx.tournamentId,
    categoryId: ctx.categoryId,
    venueId: ctx.venueId,
    courtId: ctx.courtId,
    teamAId: ctx.teamAId,
    teamBId: ctx.teamBId,
    suffix: 'M3',
  });
  ctx.matchIds.push(matchId);

  const preview = await previewQuickResult({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    venueId: ctx.venueId,
    matchId,
    homeScore: 1,
    awayScore: 0,
    actorUserId: ACTOR_ID,
  });

  const [a, b] = await Promise.all([
    callSubmit(ctx, { matchId, homeScore: 1, awayScore: 0, expectedVersion: preview.currentVersion, previewToken: preview.previewToken, idempotencyKey: `${RUN_TAG}-race-A` }).then(
      (r) => ({ ok: true as const, result: r }),
      (e) => ({ ok: false as const, error: e instanceof Error && 'code' in e ? String((e as { code: unknown }).code) : String(e) })
    ),
    callSubmit(ctx, { matchId, homeScore: 1, awayScore: 0, expectedVersion: preview.currentVersion, previewToken: preview.previewToken, idempotencyKey: `${RUN_TAG}-race-B` }).then(
      (r) => ({ ok: true as const, result: r }),
      (e) => ({ ok: false as const, error: e instanceof Error && 'code' in e ? String((e as { code: unknown }).code) : String(e) })
    ),
  ]);

  const succeeded = [a, b].filter((o) => o.ok);
  const failed = [a, b].filter((o) => !o.ok) as Array<{ ok: false; error: string }>;
  assert(succeeded.length === 1, `expected exactly 1 of the 2 concurrent attempts to succeed, got ${succeeded.length}`);
  assert(failed.length === 1, `expected exactly 1 of the 2 concurrent attempts to fail, got ${failed.length}`);
  assert(failed[0].error === 'QUICK_RESULT_VERSION_CONFLICT', `expected the losing attempt to fail with QUICK_RESULT_VERSION_CONFLICT, got ${failed[0].error}`);

  const { count: subs } = await countRows(ctx, 'tournament_result_submissions', 'match_id', matchId);
  assert(subs === 1, `expected exactly 1 submission row (no partial rows), got ${subs}`);
  const version = await getMatchVersion(ctx, matchId);
  assert(version === preview.currentVersion + 1, `expected version to increment exactly once, got ${version}`);
}

async function scenarioInvalidInputsRejectedWithoutWrites(ctx: Ctx): Promise<void> {
  const matchId = await createMatch(ctx.client, {
    tournamentId: ctx.tournamentId,
    categoryId: ctx.categoryId,
    venueId: ctx.venueId,
    courtId: ctx.courtId,
    teamAId: ctx.teamAId,
    teamBId: ctx.teamBId,
    suffix: 'M4',
  });
  ctx.matchIds.push(matchId);

  // Wrong venue.
  {
    let threw = false;
    try {
      await previewQuickResult({
        client: ctx.client,
        tournamentId: ctx.tournamentId,
        venueId: randomUUID(),
        matchId,
        homeScore: 1,
        awayScore: 0,
        actorUserId: ACTOR_ID,
      });
    } catch {
      threw = true;
    }
    assert(threw, 'expected wrong-venue Preview to be rejected');
  }

  // Incompatible status (cancelled).
  {
    await ctx.client.from('tournament_matches').update({ status: 'cancelled' }).eq('id', matchId);
    let threw = false;
    try {
      await previewQuickResult({ client: ctx.client, tournamentId: ctx.tournamentId, venueId: ctx.venueId, matchId, homeScore: 1, awayScore: 0, actorUserId: ACTOR_ID });
    } catch {
      threw = true;
    }
    assert(threw, 'expected cancelled-match Preview to be rejected');
    await ctx.client.from('tournament_matches').update({ status: 'scheduled' }).eq('id', matchId);
  }

  // Already published.
  {
    await ctx.client.from('tournament_matches').update({ result_workflow_status: 'published' }).eq('id', matchId);
    let threw = false;
    try {
      await previewQuickResult({ client: ctx.client, tournamentId: ctx.tournamentId, venueId: ctx.venueId, matchId, homeScore: 1, awayScore: 0, actorUserId: ACTOR_ID });
    } catch {
      threw = true;
    }
    assert(threw, 'expected already-published Preview to be rejected');
    await ctx.client.from('tournament_matches').update({ result_workflow_status: 'not_started' }).eq('id', matchId);
  }

  // Unresolved away team.
  {
    await ctx.client.from('tournament_matches').update({ away_team_id: null }).eq('id', matchId);
    let threw = false;
    try {
      await previewQuickResult({ client: ctx.client, tournamentId: ctx.tournamentId, venueId: ctx.venueId, matchId, homeScore: 1, awayScore: 0, actorUserId: ACTOR_ID });
    } catch {
      threw = true;
    }
    assert(threw, 'expected unresolved-away-team Preview to be rejected');
    await ctx.client.from('tournament_matches').update({ away_team_id: ctx.teamBId }).eq('id', matchId);
  }

  const { count: subs } = await countRows(ctx, 'tournament_result_submissions', 'match_id', matchId);
  assert(subs === 0, `expected zero submission rows from all rejected attempts, got ${subs}`);
  const version = await getMatchVersion(ctx, matchId);
  assert(version === 1, `expected Match version untouched by rejected attempts, got ${version}`);
}

async function scenarioAbsentFromPublicOfficialResultOutput(ctx: Ctx): Promise<void> {
  // ctx.matchId already has a successful Quick Result submission from
  // scenarioAtomicSubmit. Confirm the columns any public consumer would read
  // as "the official result" show nothing from that provisional submission —
  // both on the base table and through tournament.public_matches_view.
  const { data: baseRow, error: baseErr } = await ctx.client
    .from('tournament_matches')
    .select('regulation_home_score, regulation_away_score, winner_team_id, result_workflow_status, decided_by')
    .eq('id', ctx.matchId)
    .single();
  if (baseErr || !baseRow) throw new Error(`base match re-fetch failed: ${baseErr?.message}`);
  assert(baseRow.regulation_home_score === null, 'expected no official home score to leak from Quick Result');
  assert(baseRow.regulation_away_score === null, 'expected no official away score to leak from Quick Result');
  assert(baseRow.winner_team_id === null, 'expected no winner to be derived from a Quick Result submission');
  assert(baseRow.result_workflow_status === 'not_started', 'expected result_workflow_status to never reach published via Quick Result');

  const { data: viewRow, error: viewErr } = await ctx.client
    .from('public_matches_view')
    .select('regulation_home_score, regulation_away_score, result_workflow_status')
    .eq('id', ctx.matchId)
    .maybeSingle();
  if (viewErr) throw new Error(`public_matches_view query failed: ${viewErr.message}`);
  if (viewRow) {
    assert(viewRow.regulation_home_score === null, 'expected public_matches_view to show no official home score for a Quick-Result-only match');
    assert(viewRow.regulation_away_score === null, 'expected public_matches_view to show no official away score for a Quick-Result-only match');
    assert(viewRow.result_workflow_status !== 'published', 'expected public_matches_view to never show this match as published via Quick Result');
  }

  const { data: submissionRows, error: subErr } = await ctx.client
    .from('tournament_result_submissions')
    .select('id')
    .eq('match_id', ctx.matchId)
    .eq('stage', 'quick_result');
  if (subErr) throw new Error(subErr.message);
  assert((submissionRows || []).length > 0, 'expected the Quick Result submission itself to exist (sanity check on the scenario setup)');
}

// ============================================================================
// Cleanup
// ============================================================================

async function cleanup(ctx: Ctx): Promise<void> {
  console.log('\n[CLEANUP] Removing all disposable rows...');
  const client = ctx.client;

  const { data: submissions } = await client.from('tournament_result_submissions').select('id').in('match_id', ctx.matchIds);
  const submissionIds = ((submissions || []) as { id: string }[]).map((s) => s.id);
  if (submissionIds.length > 0) {
    const { error: versionsErr } = await client.from('tournament_result_versions').delete().in('submission_id', submissionIds);
    if (versionsErr) console.error(`[CLEANUP] result_versions delete failed: ${versionsErr.message}`);
  }
  const { error: submissionsErr } = await client.from('tournament_result_submissions').delete().in('match_id', ctx.matchIds);
  if (submissionsErr) console.error(`[CLEANUP] result_submissions delete failed: ${submissionsErr.message}`);

  const { error: auditErr } = await client.from('tournament_audit_logs').delete().in('entity_id', ctx.matchIds);
  if (auditErr) console.error(`[CLEANUP] audit log delete failed: ${auditErr.message}`);

  const { error: tournamentErr } = await client.from('tournaments').delete().eq('id', ctx.tournamentId);
  if (tournamentErr) {
    throw new Error(`tournament delete failed: ${tournamentErr.message} — MANUAL CLEANUP REQUIRED for tournament ${ctx.tournamentId}`);
  }

  const [tAfter, matchAfter, subAfter, verAfter, auditAfter] = await Promise.all([
    client.from('tournaments').select('id').eq('id', ctx.tournamentId).maybeSingle(),
    client.from('tournament_matches').select('id').in('id', ctx.matchIds),
    client.from('tournament_result_submissions').select('id').in('match_id', ctx.matchIds),
    submissionIds.length > 0
      ? client.from('tournament_result_versions').select('id').in('submission_id', submissionIds)
      : Promise.resolve({ data: [] as { id: string }[], error: null }),
    client.from('tournament_audit_logs').select('id').in('entity_id', ctx.matchIds),
  ]);

  assert(!tAfter.data, `tournament ${ctx.tournamentId} still exists after cleanup`);
  assert((matchAfter.data || []).length === 0, `${(matchAfter.data || []).length} match rows still exist after cleanup`);
  assert((subAfter.data || []).length === 0, `${(subAfter.data || []).length} submission rows still exist after cleanup`);
  assert((verAfter.data || []).length === 0, `${(verAfter.data || []).length} result-version rows still exist after cleanup`);
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
  const box: { previewToken: string | null; expectedVersion: number | null } = { previewToken: null, expectedVersion: null };

  try {
    await run('1. Initial disposable state is clean', () => scenarioCleanInitialState(ctx));
    await run('2. Preview returns the signed token and writes zero rows', async () => {
      const r = await scenarioPreviewWritesNothing(ctx);
      box.previewToken = r.previewToken;
      box.expectedVersion = r.expectedVersion;
    });
    if (box.previewToken && box.expectedVersion !== null) {
      const previewToken = box.previewToken;
      const expectedVersion = box.expectedVersion;
      await run(
        '3. Atomic successful Submit: version increments once, 1 submission, 1 result version, 1 audit, no official-result fields changed',
        () => scenarioAtomicSubmit(ctx, previewToken, expectedVersion)
      );
      await run('4. Same-key replay: idempotent success, zero additional writes', () => scenarioIdempotentReplay(ctx, previewToken, expectedVersion));
    }
    await run('5. Same-key different payload: rejected, zero additional writes', () => scenarioSameKeyDifferentPayloadRejected(ctx));
    await run('6. Real Promise.all same-key concurrency: exactly one physical submission, one idempotent response', () => scenarioConcurrentSameKey(ctx));
    await run('7. Real Promise.all different-key same-version concurrency: exactly one success, one QUICK_RESULT_VERSION_CONFLICT', () =>
      scenarioConcurrentDifferentKeySameVersion(ctx)
    );
    await run('8. Invalid venue/status/published/unresolved-team inputs rejected without writes', () => scenarioInvalidInputsRejectedWithoutWrites(ctx));
    await run('9. Quick Result remains absent from public official-result output', () => scenarioAbsentFromPublicOfficialResultOutput(ctx));
  } finally {
    await run('10. Complete cleanup of all disposable rows', () => cleanup(ctx));
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

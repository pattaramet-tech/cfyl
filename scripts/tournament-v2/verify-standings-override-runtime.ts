/**
 * Tournament V2 — Manual Standings Override disposable-data RUNTIME verifier.
 *
 * NOT part of `npm run test`. Requires real TOURNAMENT_SUPABASE_* credentials
 * for CFYL-Tournament-Staging in .env.local, plus an explicit opt-in:
 *
 *   TOURNAMENT_RUNTIME_VERIFY_CONFIRM=CFYL-Tournament-Staging
 *
 * Run: npm run verify:tournament-standings-override-runtime
 *
 * WHAT THIS PROVES that the mocked unit tests
 * (lib/tournament/services/__tests__/standingsOverride.test.ts,
 * app/api/tournament/admin/standings/__tests__/route.test.ts) cannot: real
 * Postgres row-locking, real concurrent-write behavior against a live
 * database, and real end-to-end data persistence — using disposable,
 * uniquely-tagged rows only.
 *
 * REQUIRES MIGRATION 017 —
 * scripts/tournament-v2/017-standings-override-atomic-save.sql — which fixes
 * the transactional-atomicity gap this feature previously had:
 * saveStandingsOverride() now performs its entire write path (authoritative
 * scope/rank/duplicate revalidation, expected-before-state check, override
 * upsert, audit log) as exactly one client.rpc(...) call to
 * tournament.save_standings_override(), a single Postgres transaction, with
 * the target Group locked first.
 *
 * DESIGN CHOICE — bypasses HTTP/auth, exercises the real service functions
 * directly (same precedent as verify-quick-result-runtime.ts and
 * verify-qualification-draw-runtime.ts): calls previewStandingsOverride /
 * saveStandingsOverride directly — the exact same functions
 * app/api/tournament/admin/standings/route.ts calls, in the same order. The
 * requireTournamentSuperAdmin() HTTP/auth wrapper itself is intentionally out
 * of scope for this runtime check, to avoid creating throwaway users in
 * League's shared production Auth system. The Public Standings scenario (9)
 * does call the real public route's exported GET handler directly (same
 * technique its own unit tests use) since that route needs no auth. The
 * Preview Token's HMAC secret (TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET) is
 * read from the same .env.local as the Tournament Supabase credentials.
 *
 * Does not add a production failure-injection backdoor merely to test
 * rollback — mid-transaction failure paths (override/audit insert failing)
 * are covered by the transactional RPC mock in
 * lib/tournament/services/__tests__/mockSaveStandingsOverrideRpc.ts instead,
 * the same approach PR #7/#9 used for their own atomic RPCs.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { loadEnvConfig } from '@next/env';
import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { getTournamentServiceClient } from '../../lib/tournament/db/supabase-tournament';
import {
  previewStandingsOverride,
  saveStandingsOverride,
  type SaveStandingsOverrideResult,
} from '../../lib/tournament/services/standingsOverride';
import { GET as getPublicStandings } from '../../app/api/tournament/public/standings/route';

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
      'Standings Override Preview Token issuance/verification requires it (shared secret with Quick Result).'
  );
  process.exit(1);
}

const RUN_TAG = `so-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ACTOR_EMAIL = 'runtime-verify-standings-override@example.com';
const CATEGORY_CODE = 'C-U14';

type TournamentClient = ReturnType<typeof getTournamentServiceClient>;

interface Ctx {
  client: TournamentClient;
  tournamentId: string;
  categoryId: string;
  groupId: string;
  teamIds: string[]; // 3 resolved teams, group A, in finishing order [1st, 2nd, 3rd]
  matchIds: string[];
  // tournament_standing_overrides.created_by and tournament_audit_logs.admin_id
  // are both plain uuid columns without an FK to tournament_user_profiles, but
  // this verifier still creates and tracks a real disposable profile row for
  // parity with the other runtime verifiers and in case a future migration
  // adds that FK — see verify-quick-result-runtime.ts for the precedent this
  // guards against (a bare randomUUID() actor silently working today but
  // breaking the moment such an FK is added).
  actorId: string;
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

async function callSave(
  ctx: Ctx,
  params: { groupId: string; teamId: string; overrideRank: number; reason: string; previewToken: string }
): Promise<SaveStandingsOverrideResult> {
  try {
    return await saveStandingsOverride({
      client: ctx.client,
      tournamentId: ctx.tournamentId,
      groupId: params.groupId,
      teamId: params.teamId,
      overrideRank: params.overrideRank,
      reason: params.reason,
      actorUserId: ctx.actorId,
      actorEmail: ACTOR_EMAIL,
      previewToken: params.previewToken,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('does not exist') || message.includes('schema cache') || message.includes('Could not find the function')) {
      throw new Error(
        `save_standings_override RPC does not exist — Migration 017 has not been applied to this Staging project yet. Raw error: ${message}`
      );
    }
    throw e;
  }
}

async function doPreview(ctx: Ctx, params: { groupId: string; teamId: string; overrideRank: number; reason: string }) {
  return previewStandingsOverride({
    client: ctx.client,
    tournamentId: ctx.tournamentId,
    groupId: params.groupId,
    teamId: params.teamId,
    overrideRank: params.overrideRank,
    reason: params.reason,
    actorUserId: ctx.actorId,
  });
}

// ============================================================================
// Setup — disposable tournament + C-U14 category + 1 group of 3 resolved
// teams + a published, finished round-robin (so the group is a genuine,
// complete Standings result: team[0] 1st, team[1] 2nd, team[2] 3rd), all
// uniquely tagged with RUN_TAG.
// ============================================================================

async function setup(client: TournamentClient): Promise<Ctx> {
  const { data: tournament, error: tErr } = await client
    .from('tournaments')
    .insert({
      name: `Standings Override Runtime Verify ${RUN_TAG}`,
      slug: `so-verify-${RUN_TAG}`,
      status: 'active',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    })
    .select('id')
    .single();
  if (tErr || !tournament) throw new Error(`setup: tournament insert failed: ${tErr?.message}`);
  const tournamentId = tournament.id as string;

  let actorId: string | null = null;

  try {
    actorId = randomUUID();
    const { error: profileErr } = await client
      .from('tournament_user_profiles')
      .insert({ id: actorId, email: ACTOR_EMAIL, full_name: `Runtime Verify Actor ${RUN_TAG}`, active: true });
    if (profileErr) throw new Error(`actor profile insert failed: ${profileErr.message}`);

    const { data: category, error: catErr } = await client
      .from('tournament_categories')
      .insert({ tournament_id: tournamentId, code: CATEGORY_CODE, name: `Runtime Verify ${CATEGORY_CODE} ${RUN_TAG}`, gender: 'mixed' })
      .select('id')
      .single();
    if (catErr || !category) throw new Error(`category insert failed: ${catErr?.message}`);
    const categoryId = category.id as string;

    const { data: group, error: groupErr } = await client
      .from('tournament_groups')
      .insert({ tournament_id: tournamentId, category_id: categoryId, name: `Runtime Verify Group A ${RUN_TAG}`, code: 'A' })
      .select('id')
      .single();
    if (groupErr || !group) throw new Error(`group insert failed: ${groupErr?.message}`);
    const groupId = group.id as string;

    const teamIds: string[] = [];
    for (const suffix of ['1', '2', '3']) {
      const { data: team, error: teamErr } = await client
        .from('tournament_teams')
        .insert({ tournament_id: tournamentId, category_id: categoryId, name: `Runtime Verify Team ${suffix} ${RUN_TAG}`, team_code: `T${suffix}` })
        .select('id')
        .single();
      if (teamErr || !team) throw new Error(`team ${suffix} insert failed: ${teamErr?.message}`);
      teamIds.push(team.id as string);
    }

    const { error: membersErr } = await client
      .from('tournament_group_members')
      .insert(teamIds.map((teamId, index) => ({ group_id: groupId, slot_code: `A-S${index + 1}`, team_id: teamId })));
    if (membersErr) throw new Error(`group members insert failed: ${membersErr.message}`);

    // Round-robin, all decided by regulation, published/finished — team[0]
    // beats both others, team[1] beats team[2]: a genuine, unambiguous
    // 1st/2nd/3rd with no tiebreak needed, so the group is complete and
    // countedMatches are equal (2 each) — a clean base for override tests.
    const matchIds: string[] = [];
    const pairs: Array<[number, number]> = [
      [0, 1],
      [0, 2],
      [1, 2],
    ];
    for (const [homeIdx, awayIdx] of pairs) {
      const { data: match, error: matchErr } = await client
        .from('tournament_matches')
        .insert({
          tournament_id: tournamentId,
          category_id: categoryId,
          group_id: groupId,
          stage: 'group',
          match_code: `SO-${RUN_TAG}-${homeIdx}v${awayIdx}`,
          status: 'finished',
          result_workflow_status: 'published',
          home_source_type: 'team',
          home_team_id: teamIds[homeIdx],
          away_source_type: 'team',
          away_team_id: teamIds[awayIdx],
          regulation_home_score: 2,
          regulation_away_score: 0,
          winner_team_id: teamIds[homeIdx],
          decided_by: 'regulation',
        })
        .select('id')
        .single();
      if (matchErr || !match) throw new Error(`match ${homeIdx}v${awayIdx} insert failed: ${matchErr?.message}`);
      matchIds.push(match.id as string);
    }

    return { client, tournamentId, categoryId, groupId, teamIds, matchIds, actorId };
  } catch (err) {
    console.error('[SETUP] failed, attempting emergency cleanup...');
    const { error: cleanupErr } = await client.from('tournaments').delete().eq('id', tournamentId);
    if (cleanupErr) {
      console.error(`[SETUP] emergency tournament cleanup ALSO failed: ${cleanupErr.message} — manual cleanup required for tournament ${tournamentId}`);
    } else {
      console.error('[SETUP] emergency tournament cleanup succeeded.');
    }
    if (actorId) {
      const { error: profileCleanupErr } = await client.from('tournament_user_profiles').delete().eq('id', actorId);
      if (profileCleanupErr) {
        console.error(
          `[SETUP] emergency actor profile cleanup ALSO failed: ${profileCleanupErr.message} — manual cleanup required for tournament_user_profiles id ${actorId}`
        );
      } else {
        console.error('[SETUP] emergency actor profile cleanup succeeded.');
      }
    }
    throw err;
  }
}

async function countOverrides(ctx: Ctx): Promise<number> {
  const { data, error } = await ctx.client.from('tournament_standing_overrides').select('group_id').eq('group_id', ctx.groupId);
  if (error) throw new Error(error.message);
  return (data || []).length;
}

async function countAuditRows(ctx: Ctx): Promise<number> {
  const { data, error } = await ctx.client
    .from('tournament_audit_logs')
    .select('id')
    .eq('action', 'standings.manual_override')
    .in('entity_id', ctx.teamIds);
  if (error) throw new Error(error.message);
  return (data || []).length;
}

// ============================================================================
// Scenarios
// ============================================================================

async function scenarioCleanInitialState(ctx: Ctx): Promise<void> {
  assert((await countOverrides(ctx)) === 0, 'expected zero standing overrides initially');
  assert((await countAuditRows(ctx)) === 0, 'expected zero manual-override audit rows initially');
}

async function scenarioPreviewWritesNothing(ctx: Ctx): Promise<{ previewToken: string }> {
  const preview = await doPreview(ctx, { groupId: ctx.groupId, teamId: ctx.teamIds[2], overrideRank: 1, reason: `${RUN_TAG} เหตุผลทดสอบ` });
  assert(!!preview.previewToken, 'expected a signed preview token');
  assert(preview.previewToken.split('.').length === 2, 'expected preview token to have payload.signature shape');
  assert(preview.before === null, 'expected no prior override for team[2] before this scenario');

  assert((await countOverrides(ctx)) === 0, 'expected Preview to write zero override rows');
  assert((await countAuditRows(ctx)) === 0, 'expected Preview to write zero audit rows');

  return { previewToken: preview.previewToken };
}

async function scenarioAtomicNewSave(ctx: Ctx, previewToken: string): Promise<void> {
  const reason = `${RUN_TAG} เหตุผลทดสอบ`;
  const result = await callSave(ctx, { groupId: ctx.groupId, teamId: ctx.teamIds[2], overrideRank: 1, reason, previewToken });
  assert(result.auditLogged, 'expected auditLogged=true');
  assert(result.overrideRank === 1, `expected overrideRank 1, got ${result.overrideRank}`);

  const { data: overrides, error } = await ctx.client
    .from('tournament_standing_overrides')
    .select('group_id, team_id, override_rank, reason')
    .eq('group_id', ctx.groupId)
    .eq('team_id', ctx.teamIds[2]);
  if (error) throw new Error(error.message);
  assert((overrides || []).length === 1, `expected exactly 1 override row, got ${(overrides || []).length}`);
  assert(overrides![0].override_rank === 1, 'expected the override row to carry rank 1');

  const { data: audits, error: auditErr } = await ctx.client
    .from('tournament_audit_logs')
    .select('id, entity_id, old_data, new_data')
    .eq('action', 'standings.manual_override')
    .eq('entity_id', ctx.teamIds[2]);
  if (auditErr) throw new Error(auditErr.message);
  assert((audits || []).length === 1, `expected exactly 1 audit row, got ${(audits || []).length}`);
  assert(audits![0].old_data === null, 'expected old_data to be null for a genuinely new override');
  const newData = audits![0].new_data as { override_rank: number; reason: string };
  assert(newData.override_rank === 1, 'expected new_data.override_rank to be 1');
  assert(newData.reason === reason, 'expected new_data.reason to match the saved reason exactly');
}

async function scenarioExistingOverrideUpdate(ctx: Ctx): Promise<void> {
  // ctx.teamIds[2] already has an override (rank 1, from scenarioAtomicNewSave).
  const newReason = `${RUN_TAG} เหตุผลใหม่`;
  const preview = await doPreview(ctx, { groupId: ctx.groupId, teamId: ctx.teamIds[2], overrideRank: 2, reason: newReason });
  assert(preview.before !== null, 'expected Preview to report an existing prior override');
  assert(preview.before!.overrideRank === 1, 'expected the prior override rank to be 1');

  await callSave(ctx, { groupId: ctx.groupId, teamId: ctx.teamIds[2], overrideRank: 2, reason: newReason, previewToken: preview.previewToken });

  const { data: overrides, error } = await ctx.client
    .from('tournament_standing_overrides')
    .select('group_id, team_id, override_rank, reason')
    .eq('group_id', ctx.groupId)
    .eq('team_id', ctx.teamIds[2]);
  if (error) throw new Error(error.message);
  assert((overrides || []).length === 1, `expected still exactly 1 override row (update, not a second row), got ${(overrides || []).length}`);
  assert(overrides![0].override_rank === 2, 'expected the override row to now carry rank 2');
  assert(overrides![0].reason === newReason, 'expected the override row to carry the new reason');

  const { data: audits, error: auditErr } = await ctx.client
    .from('tournament_audit_logs')
    .select('id, old_data, new_data')
    .eq('action', 'standings.manual_override')
    .eq('entity_id', ctx.teamIds[2])
    .order('created_at', { ascending: false })
    .limit(1);
  if (auditErr) throw new Error(auditErr.message);
  assert((audits || []).length === 1, 'expected the latest audit row to be found');
  const oldData = audits![0].old_data as { override_rank: number; reason: string };
  const newData = audits![0].new_data as { override_rank: number; reason: string };
  assert(oldData.override_rank === 1, `expected old_data.override_rank 1, got ${oldData.override_rank}`);
  assert(newData.override_rank === 2, `expected new_data.override_rank 2, got ${newData.override_rank}`);
  assert(newData.reason === newReason, 'expected new_data.reason to match the new reason');
}

async function scenarioStalePreviewRejected(ctx: Ctx): Promise<void> {
  // ctx.teamIds[2] currently has an override at rank 2. Preview against that
  // state, then let another Save land in between (simulated by directly
  // updating the row underneath this operator), then attempt to use the
  // stale preview — must be rejected, zero additional writes.
  const preview = await doPreview(ctx, { groupId: ctx.groupId, teamId: ctx.teamIds[2], overrideRank: 3, reason: `${RUN_TAG} stale attempt` });

  const { error: raceErr } = await ctx.client
    .from('tournament_standing_overrides')
    .update({ override_rank: 2, reason: `${RUN_TAG} changed by someone else` })
    .eq('group_id', ctx.groupId)
    .eq('team_id', ctx.teamIds[2]);
  if (raceErr) throw new Error(`simulated concurrent race update failed: ${raceErr.message}`);

  const overridesBefore = await countOverrides(ctx);
  const auditBefore = await countAuditRows(ctx);

  let threw = false;
  let code = '';
  try {
    await callSave(ctx, { groupId: ctx.groupId, teamId: ctx.teamIds[2], overrideRank: 3, reason: `${RUN_TAG} stale attempt`, previewToken: preview.previewToken });
  } catch (e) {
    threw = true;
    code = e instanceof Error && 'code' in e ? String((e as { code: unknown }).code) : '';
  }
  assert(threw, 'expected the stale Preview to be rejected');
  assert(code === 'STANDINGS_OVERRIDE_STATE_CHANGED', `expected STANDINGS_OVERRIDE_STATE_CHANGED, got ${code}`);

  assert((await countOverrides(ctx)) === overridesBefore, 'expected zero additional override rows from the rejected stale Save');
  assert((await countAuditRows(ctx)) === auditBefore, 'expected zero additional audit rows from the rejected stale Save');
}

async function scenarioConcurrentSameRankDifferentTeams(ctx: Ctx): Promise<string> {
  // team[0] and team[1] currently have no overrides. Both request rank 3
  // (free — team[2] currently occupies rank 2) concurrently. Returns the
  // loser's team id — guaranteed to still have zero override rows — for
  // scenario 7 to use as a genuinely clean starting point.
  const previewA = await doPreview(ctx, { groupId: ctx.groupId, teamId: ctx.teamIds[0], overrideRank: 3, reason: `${RUN_TAG} race A` });
  const previewB = await doPreview(ctx, { groupId: ctx.groupId, teamId: ctx.teamIds[1], overrideRank: 3, reason: `${RUN_TAG} race B` });

  const [a, b] = await Promise.all([
    callSave(ctx, { groupId: ctx.groupId, teamId: ctx.teamIds[0], overrideRank: 3, reason: `${RUN_TAG} race A`, previewToken: previewA.previewToken }).then(
      (r) => ({ ok: true as const, teamId: ctx.teamIds[0], result: r }),
      (e) => ({ ok: false as const, teamId: ctx.teamIds[0], error: e instanceof Error && 'code' in e ? String((e as { code: unknown }).code) : String(e) })
    ),
    callSave(ctx, { groupId: ctx.groupId, teamId: ctx.teamIds[1], overrideRank: 3, reason: `${RUN_TAG} race B`, previewToken: previewB.previewToken }).then(
      (r) => ({ ok: true as const, teamId: ctx.teamIds[1], result: r }),
      (e) => ({ ok: false as const, teamId: ctx.teamIds[1], error: e instanceof Error && 'code' in e ? String((e as { code: unknown }).code) : String(e) })
    ),
  ]);

  const succeeded = [a, b].filter((o) => o.ok);
  const failed = [a, b].filter((o) => !o.ok) as Array<{ ok: false; teamId: string; error: string }>;
  assert(succeeded.length === 1, `expected exactly 1 of the 2 concurrent same-rank attempts to succeed, got ${succeeded.length}`);
  assert(failed.length === 1, `expected exactly 1 of the 2 concurrent same-rank attempts to fail, got ${failed.length}`);
  assert(failed[0].error === 'STANDINGS_OVERRIDE_RANK_CONFLICT', `expected the losing attempt to fail with STANDINGS_OVERRIDE_RANK_CONFLICT, got ${failed[0].error}`);

  const { data: rank3Rows, error } = await ctx.client
    .from('tournament_standing_overrides')
    .select('team_id')
    .eq('group_id', ctx.groupId)
    .eq('override_rank', 3);
  if (error) throw new Error(error.message);
  assert((rank3Rows || []).length === 1, `expected exactly 1 team holding rank 3 (no duplicate rank), got ${(rank3Rows || []).length}`);

  return failed[0].teamId;
}

async function scenarioConcurrentSameTeamDifferentRanks(ctx: Ctx, cleanTeamId: string): Promise<void> {
  // cleanTeamId is the loser of scenario 6 — guaranteed to still have zero
  // override rows. Two concurrent Saves for it from the SAME starting state
  // (no prior override) but different target ranks — rank 1 is free
  // (team[2] holds 2, the winner of scenario 6 holds 3).
  const previewA = await doPreview(ctx, { groupId: ctx.groupId, teamId: cleanTeamId, overrideRank: 1, reason: `${RUN_TAG} same-team A` });
  const previewB = await doPreview(ctx, { groupId: ctx.groupId, teamId: cleanTeamId, overrideRank: 1, reason: `${RUN_TAG} same-team B` });
  // Both previews see "no existing override" as the before-state — a second
  // distinct token binding a DIFFERENT reason at the same starting state, so
  // both attempts genuinely race from the same pre-Preview state per section
  // G's contract, even though this particular pair share the same rank too
  // (proving STATE_CHANGED, not RANK_CONFLICT, is what actually fires once
  // the first writer commits and the row now exists).

  const [a, b] = await Promise.all([
    callSave(ctx, { groupId: ctx.groupId, teamId: cleanTeamId, overrideRank: 1, reason: `${RUN_TAG} same-team A`, previewToken: previewA.previewToken }).then(
      (r) => ({ ok: true as const, result: r }),
      (e) => ({ ok: false as const, error: e instanceof Error && 'code' in e ? String((e as { code: unknown }).code) : String(e) })
    ),
    callSave(ctx, { groupId: ctx.groupId, teamId: cleanTeamId, overrideRank: 1, reason: `${RUN_TAG} same-team B`, previewToken: previewB.previewToken }).then(
      (r) => ({ ok: true as const, result: r }),
      (e) => ({ ok: false as const, error: e instanceof Error && 'code' in e ? String((e as { code: unknown }).code) : String(e) })
    ),
  ]);

  const succeeded = [a, b].filter((o) => o.ok);
  const failed = [a, b].filter((o) => !o.ok) as Array<{ ok: false; error: string }>;
  assert(succeeded.length === 1, `expected exactly 1 of the 2 concurrent same-team attempts to succeed, got ${succeeded.length}`);
  assert(failed.length === 1, `expected exactly 1 of the 2 concurrent same-team attempts to fail, got ${failed.length}`);
  assert(failed[0].error === 'STANDINGS_OVERRIDE_STATE_CHANGED', `expected the losing attempt to fail with STANDINGS_OVERRIDE_STATE_CHANGED (no lost update), got ${failed[0].error}`);

  const { data: teamRows, error } = await ctx.client
    .from('tournament_standing_overrides')
    .select('reason')
    .eq('group_id', ctx.groupId)
    .eq('team_id', cleanTeamId);
  if (error) throw new Error(error.message);
  assert((teamRows || []).length === 1, `expected exactly 1 override row for the clean team (no lost update / no duplicate), got ${(teamRows || []).length}`);
}

async function scenarioInvalidInputsRejectedWithoutWrites(ctx: Ctx): Promise<void> {
  const overridesBefore = await countOverrides(ctx);
  const auditBefore = await countAuditRows(ctx);

  // Nonexistent group.
  {
    let threw = false;
    try {
      await doPreview(ctx, { groupId: randomUUID(), teamId: ctx.teamIds[0], overrideRank: 1, reason: `${RUN_TAG} bad group` });
    } catch {
      threw = true;
    }
    assert(threw, 'expected a nonexistent Group to be rejected at Preview');
  }

  // Nonexistent team.
  {
    let threw = false;
    try {
      await doPreview(ctx, { groupId: ctx.groupId, teamId: randomUUID(), overrideRank: 1, reason: `${RUN_TAG} bad team` });
    } catch {
      threw = true;
    }
    assert(threw, 'expected a nonexistent Team to be rejected at Preview');
  }

  // Team not a member of the group.
  {
    const { data: outsider, error } = await ctx.client
      .from('tournament_teams')
      .insert({ tournament_id: ctx.tournamentId, category_id: ctx.categoryId, name: `Runtime Verify Outsider ${RUN_TAG}`, team_code: 'TX' })
      .select('id')
      .single();
    if (error || !outsider) throw new Error(`outsider team insert failed: ${error?.message}`);
    let threw = false;
    try {
      await doPreview(ctx, { groupId: ctx.groupId, teamId: outsider.id as string, overrideRank: 1, reason: `${RUN_TAG} outsider` });
    } catch {
      threw = true;
    }
    assert(threw, 'expected a Team not in the Group to be rejected at Preview');
    await ctx.client.from('tournament_teams').delete().eq('id', outsider.id as string);
  }

  // Rank out of range (group has 3 resolved teams).
  {
    let threw = false;
    try {
      await doPreview(ctx, { groupId: ctx.groupId, teamId: ctx.teamIds[0], overrideRank: 999, reason: `${RUN_TAG} bad rank` });
    } catch {
      threw = true;
    }
    assert(threw, 'expected an out-of-range rank to be rejected at Preview');
  }

  assert((await countOverrides(ctx)) === overridesBefore, 'expected zero additional override rows from all rejected invalid attempts');
  assert((await countAuditRows(ctx)) === auditBefore, 'expected zero additional audit rows from all rejected invalid attempts');
}

async function scenarioPublicStandingsNoReasonOrAudit(ctx: Ctx): Promise<void> {
  const { data: tournamentRow, error } = await ctx.client.from('tournaments').select('slug').eq('id', ctx.tournamentId).single();
  if (error || !tournamentRow) throw new Error(`tournament re-fetch failed: ${error?.message}`);

  const request = {
    nextUrl: { searchParams: new URLSearchParams({ tournament_slug: tournamentRow.slug as string, category_code: CATEGORY_CODE }) },
  } as unknown as NextRequest;

  const response = await getPublicStandings(request);
  const body = (await response.json()) as {
    data?: { groups: Array<{ group_code: string; rows: Array<Record<string, unknown>> }> };
  };
  assert(response.status === 200, `expected public standings 200, got ${response.status}`);
  assert(!!body.data, 'expected a data payload from public standings');

  const group = body.data!.groups.find((g) => g.group_code === 'A');
  assert(!!group, 'expected group A in the public standings payload');

  const overriddenRow = group!.rows.find((r) => r.override_applied === true);
  assert(!!overriddenRow, 'expected at least one row with override_applied=true (team[2] or team[0] from earlier scenarios)');
  assert(overriddenRow!.override_applied === true, 'expected override_applied to be exactly true on the located row');

  // Read the ACTUAL private reason for this specific team directly from
  // tournament_standing_overrides — never assert against RUN_TAG globally,
  // since RUN_TAG is also legitimately embedded in team_name and other
  // disposable public fixture names (this verifier's own setup() names every
  // team "Runtime Verify Team <n> ${RUN_TAG}"), so a blanket "public payload
  // must not contain RUN_TAG" check is a false positive by construction —
  // the public row correctly includes team_name even when the private
  // override reason is fully stripped. Comparing against the exact private
  // reason string is the only assertion that actually distinguishes "the
  // reason leaked" from "an unrelated field happens to share a tag."
  const teamId = overriddenRow!.team_id as string;
  const { data: overrideRows, error: overrideErr } = await ctx.client
    .from('tournament_standing_overrides')
    .select('reason')
    .eq('group_id', ctx.groupId)
    .eq('team_id', teamId);
  if (overrideErr) throw new Error(`private override re-fetch failed: ${overrideErr.message}`);
  assert((overrideRows || []).length === 1, `expected exactly 1 private override row for team ${teamId}, got ${(overrideRows || []).length}`);
  const privateReason = (overrideRows![0] as { reason: string }).reason;
  assert(!!privateReason && privateReason.trim().length > 0, 'expected the private override reason to be non-empty (sanity check before asserting its absence publicly)');
  assert(privateReason.includes(RUN_TAG), 'expected the private override reason to contain RUN_TAG (sanity check that this is really the reason this verifier wrote)');

  const serialized = JSON.stringify(overriddenRow);
  assert(!serialized.includes(privateReason), 'expected the exact private override reason string to never appear anywhere in the public payload');
  assert(overriddenRow!.tiebreak_explanation === 'จัดอันดับโดย Admin', `expected tiebreak_explanation to be the reason-free placeholder, got ${JSON.stringify(overriddenRow!.tiebreak_explanation)}`);
  assert(!('override_reason' in overriddenRow!), 'expected override_reason to be entirely absent from the public row shape');
  assert(!('reason' in overriddenRow!), 'expected reason to be entirely absent from the public row shape');
  assert(!('created_by' in overriddenRow!), 'expected created_by (audit actor) to be entirely absent from the public row shape');
  assert(!('old_data' in overriddenRow!), 'expected old_data (audit payload) to be entirely absent from the public row shape');
  assert(!('new_data' in overriddenRow!), 'expected new_data (audit payload) to be entirely absent from the public row shape');
  assert(!('admin_id' in overriddenRow!), 'expected admin_id (audit actor) to be entirely absent from the public row shape');
  assert(!('admin_email' in overriddenRow!), 'expected admin_email (audit actor) to be entirely absent from the public row shape');
}

// ============================================================================
// Cleanup
// ============================================================================

async function cleanup(ctx: Ctx): Promise<void> {
  console.log('\n[CLEANUP] Removing all disposable rows...');
  const client = ctx.client;

  const { error: overridesErr } = await client.from('tournament_standing_overrides').delete().eq('group_id', ctx.groupId);
  if (overridesErr) console.error(`[CLEANUP] standing_overrides delete failed: ${overridesErr.message}`);

  const { error: auditErr } = await client.from('tournament_audit_logs').delete().in('entity_id', ctx.teamIds);
  if (auditErr) console.error(`[CLEANUP] audit log delete failed: ${auditErr.message}`);

  const { error: tournamentErr } = await client.from('tournaments').delete().eq('id', ctx.tournamentId);
  if (tournamentErr) {
    throw new Error(`tournament delete failed: ${tournamentErr.message} — MANUAL CLEANUP REQUIRED for tournament ${ctx.tournamentId}`);
  }

  const { error: profileErr } = await client.from('tournament_user_profiles').delete().eq('id', ctx.actorId);
  if (profileErr) {
    throw new Error(`actor profile delete failed: ${profileErr.message} — MANUAL CLEANUP REQUIRED for tournament_user_profiles id ${ctx.actorId}`);
  }

  const [tAfter, groupAfter, overridesAfter, auditAfter, profileAfter] = await Promise.all([
    client.from('tournaments').select('id').eq('id', ctx.tournamentId).maybeSingle(),
    client.from('tournament_groups').select('id').eq('id', ctx.groupId).maybeSingle(),
    client.from('tournament_standing_overrides').select('group_id').eq('group_id', ctx.groupId),
    client.from('tournament_audit_logs').select('id').in('entity_id', ctx.teamIds),
    client.from('tournament_user_profiles').select('id').eq('id', ctx.actorId).maybeSingle(),
  ]);

  assert(!tAfter.data, `tournament ${ctx.tournamentId} still exists after cleanup`);
  assert(!groupAfter.data, `group ${ctx.groupId} still exists after cleanup (should have cascaded from the tournament delete)`);
  assert((overridesAfter.data || []).length === 0, `${(overridesAfter.data || []).length} standing_override rows still exist after cleanup`);
  assert((auditAfter.data || []).length === 0, `${(auditAfter.data || []).length} audit log rows still exist after cleanup`);
  assert(!profileAfter.data, `disposable actor profile ${ctx.actorId} still exists after cleanup`);

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
  const box: { previewToken: string | null; raceLoserTeamId: string | null } = { previewToken: null, raceLoserTeamId: null };

  try {
    await run('1. Initial disposable state is clean', () => scenarioCleanInitialState(ctx));
    await run('2. Preview returns the signed token and writes zero rows', async () => {
      const r = await scenarioPreviewWritesNothing(ctx);
      box.previewToken = r.previewToken;
    });
    if (box.previewToken) {
      const previewToken = box.previewToken;
      await run('3. Atomic new Save: exactly 1 Override row and 1 Audit row, old_data null', () => scenarioAtomicNewSave(ctx, previewToken));
    }
    await run('4. Existing Override update: still exactly 1 row, old_data/new_data correct', () => scenarioExistingOverrideUpdate(ctx));
    await run('5. Stale Preview (state changed underneath) rejected without writes', () => scenarioStalePreviewRejected(ctx));
    await run('6. Real Promise.all, different teams requesting the same rank: exactly 1 success, 1 STANDINGS_OVERRIDE_RANK_CONFLICT, no duplicate rank', async () => {
      box.raceLoserTeamId = await scenarioConcurrentSameRankDifferentTeams(ctx);
    });
    if (box.raceLoserTeamId) {
      const cleanTeamId = box.raceLoserTeamId;
      await run('7. Real Promise.all, same team from the same prior state, different ranks: exactly 1 success, 1 STANDINGS_OVERRIDE_STATE_CHANGED, no lost update', () =>
        scenarioConcurrentSameTeamDifferentRanks(ctx, cleanTeamId)
      );
    }
    await run('8. Invalid Tournament/Group/Team/membership/rank inputs rejected without writes', () => scenarioInvalidInputsRejectedWithoutWrites(ctx));
    await run('9. Public Standings expose no reason text or private Audit data', () => scenarioPublicStandingsNoReasonOrAudit(ctx));
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

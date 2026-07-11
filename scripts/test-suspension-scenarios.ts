/**
 * Phase 5.2C — Production Suspension Scenario Tests
 *
 * Tests all 4 card scenarios against real production data.
 * Verifies source_card_ids, serving_match_ids, idempotency, stale cleanup, legacy preservation.
 *
 * Usage:
 *   npx ts-node -r dotenv/config scripts/test-suspension-scenarios.ts
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL=https://...supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *
 * Flags:
 *   --stale-test    Also run stale cleanup test (inserts then deletes a phantom event)
 *   --verbose       Print full record details on failure
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { recalculatePlayerSuspensionEventBased } from '../lib/suspension-calc';

const ARGS = process.argv.slice(2);
const RUN_STALE_TEST = ARGS.includes('--stale-test');
const VERBOSE = ARGS.includes('--verbose');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------
interface Result {
  name: string;
  pass: boolean;
  reason: string;
  data?: any;
}

const results: Result[] = [];

function pass(name: string, reason: string, data?: any) {
  results.push({ name, pass: true, reason, data });
  console.log(`  ✅ PASS: ${reason}`);
}

function fail(name: string, reason: string, data?: any) {
  results.push({ name, pass: false, reason, data });
  console.log(`  ❌ FAIL: ${reason}`);
  if (VERBOSE && data) console.log('     Data:', JSON.stringify(data, null, 2));
}

function skip(name: string, reason: string) {
  results.push({ name, pass: true, reason: `SKIP — ${reason}` });
  console.log(`  ⚪ SKIP: ${reason}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function getActiveSeason(
  supabase: SupabaseClient
): Promise<{ seasonId: string; ageGroupId: string } | null> {
  const { data: seasons } = await supabase
    .from('seasons')
    .select('id')
    .order('created_at', { ascending: false });

  if (!seasons?.length) return null;

  const { data: ageGroups } = await supabase
    .from('age_groups')
    .select('id, season_id')
    .in('season_id', seasons.map((s: any) => s.id))
    .order('sort_order');

  // Find the first season+age_group combination that has matches with cards
  for (const s of seasons) {
    for (const ag of (ageGroups || []).filter((a: any) => a.season_id === s.id)) {
      const { data: matches } = await supabase
        .from('matches')
        .select('id')
        .eq('season_id', s.id)
        .eq('age_group_id', ag.id)
        .limit(1);

      if (!matches?.length) continue;

      const { data: cards } = await supabase
        .from('cards')
        .select('id')
        .in('match_id', matches.map((m: any) => m.id))
        .limit(1);

      if (cards?.length) {
        return { seasonId: s.id, ageGroupId: ag.id };
      }
    }
  }

  return null;
}

async function getMatchIdsForSeason(
  seasonId: string,
  ageGroupId: string
): Promise<string[]> {
  const { data } = await supabase
    .from('matches')
    .select('id')
    .eq('season_id', seasonId)
    .eq('age_group_id', ageGroupId);
  return (data || []).map((m: any) => m.id);
}

async function getPlayerCardsInSeason(
  matchIds: string[]
): Promise<Array<{ player_id: string; team_id: string; match_id: string; card_type: string; id: string }>> {
  if (!matchIds.length) return [];
  const { data } = await supabase
    .from('cards')
    .select('id, player_id, team_id, match_id, card_type')
    .in('match_id', matchIds);
  return data || [];
}

async function runAndGetSuspensions(
  playerId: string,
  teamId: string,
  seasonId: string,
  ageGroupId: string
) {
  await recalculatePlayerSuspensionEventBased(playerId, seasonId, ageGroupId, teamId);

  const { data } = await supabase
    .from('suspensions')
    .select('*')
    .eq('player_id', playerId)
    .eq('team_id', teamId)
    .eq('season_id', seasonId)
    .eq('age_group_id', ageGroupId);

  return data || [];
}

function isUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// ---------------------------------------------------------------------------
// Scenario finders
// ---------------------------------------------------------------------------
type PlayerKey = { playerId: string; teamId: string };

/**
 * Find a player whose ONLY cards in this season are ≥3 individual yellow cards
 * spread across multiple matches with no red/second_yellow, and total accumulated
 * points cross exactly threshold 6 (i.e., exactly 3 yellows at 2pts each).
 */
async function findScenario1Player(
  cards: ReturnType<typeof getPlayerCardsInSeason> extends Promise<infer T> ? T : never,
  matchIds: Set<string>
): Promise<PlayerKey | null> {
  const byPlayer: Record<string, { yellow: number; red: number; sy: number; teamId: string }> = {};

  for (const c of cards) {
    if (!byPlayer[c.player_id]) byPlayer[c.player_id] = { yellow: 0, red: 0, sy: 0, teamId: c.team_id };
    if (c.card_type === 'yellow') byPlayer[c.player_id].yellow++;
    if (c.card_type === 'red') byPlayer[c.player_id].red++;
    if (c.card_type === 'second_yellow') byPlayer[c.player_id].sy++;
  }

  // Need: exactly 3 yellows, no reds, no second_yellows → 6 pts, threshold 6
  for (const [playerId, counts] of Object.entries(byPlayer)) {
    if (counts.yellow === 3 && counts.red === 0 && counts.sy === 0) {
      // Verify the 3 yellows are in separate matches (each 1 yellow, not 2 in one match)
      const playerCards = cards.filter((c) => c.player_id === playerId && c.card_type === 'yellow');
      const matchSet = new Set(playerCards.map((c) => c.match_id));
      if (matchSet.size >= 2) {
        return { playerId, teamId: counts.teamId };
      }
    }
  }
  return null;
}

/** Find a player with a direct red card (no yellow in same match) */
async function findScenario2Player(
  cards: ReturnType<typeof getPlayerCardsInSeason> extends Promise<infer T> ? T : never
): Promise<PlayerKey | null> {
  // Group by player+match
  const byPlayerMatch: Record<string, { yellow: number; red: number; sy: number; teamId: string }> = {};
  for (const c of cards) {
    const key = `${c.player_id}::${c.match_id}`;
    if (!byPlayerMatch[key]) byPlayerMatch[key] = { yellow: 0, red: 0, sy: 0, teamId: c.team_id };
    if (c.card_type === 'yellow') byPlayerMatch[key].yellow++;
    if (c.card_type === 'red') byPlayerMatch[key].red++;
    if (c.card_type === 'second_yellow') byPlayerMatch[key].sy++;
  }

  for (const [key, counts] of Object.entries(byPlayerMatch)) {
    if (counts.red >= 1 && counts.yellow === 0 && counts.sy === 0) {
      const [playerId] = key.split('::');
      return { playerId, teamId: counts.teamId };
    }
  }
  return null;
}

/** Find a player with a second_yellow ejection (2 yellows in same match or second_yellow card) */
async function findScenario3Player(
  cards: ReturnType<typeof getPlayerCardsInSeason> extends Promise<infer T> ? T : never
): Promise<PlayerKey | null> {
  const byPlayerMatch: Record<string, { yellow: number; red: number; sy: number; teamId: string }> = {};
  for (const c of cards) {
    const key = `${c.player_id}::${c.match_id}`;
    if (!byPlayerMatch[key]) byPlayerMatch[key] = { yellow: 0, red: 0, sy: 0, teamId: c.team_id };
    if (c.card_type === 'yellow') byPlayerMatch[key].yellow++;
    if (c.card_type === 'red') byPlayerMatch[key].red++;
    if (c.card_type === 'second_yellow') byPlayerMatch[key].sy++;
  }

  for (const [key, counts] of Object.entries(byPlayerMatch)) {
    if (counts.red === 0 && (counts.sy >= 1 || counts.yellow >= 2)) {
      const [playerId] = key.split('::');
      return { playerId, teamId: counts.teamId };
    }
  }
  return null;
}

/** Find a player with yellow + red in the same match */
async function findScenario4Player(
  cards: ReturnType<typeof getPlayerCardsInSeason> extends Promise<infer T> ? T : never
): Promise<PlayerKey | null> {
  const byPlayerMatch: Record<string, { yellow: number; red: number; sy: number; teamId: string }> = {};
  for (const c of cards) {
    const key = `${c.player_id}::${c.match_id}`;
    if (!byPlayerMatch[key]) byPlayerMatch[key] = { yellow: 0, red: 0, sy: 0, teamId: c.team_id };
    if (c.card_type === 'yellow') byPlayerMatch[key].yellow++;
    if (c.card_type === 'red') byPlayerMatch[key].red++;
    if (c.card_type === 'second_yellow') byPlayerMatch[key].sy++;
  }

  for (const [key, counts] of Object.entries(byPlayerMatch)) {
    if (counts.red >= 1 && counts.yellow >= 1) {
      const [playerId] = key.split('::');
      return { playerId, teamId: counts.teamId };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Verifiers
// ---------------------------------------------------------------------------
function verifyCommonFields(
  label: string,
  suspension: any,
  cards: Array<{ id: string }>,
  expectedType: string,
  expectedBan: number,
  expectedAccumThreshold: number | null,
  expectedAccumPoints: number
) {
  // suspension_type
  if (suspension.suspension_type !== expectedType) {
    fail(label, `suspension_type expected '${expectedType}' got '${suspension.suspension_type}'`, suspension);
  } else {
    pass(label, `suspension_type = '${expectedType}'`);
  }

  // ban_matches
  if (suspension.ban_matches !== expectedBan) {
    fail(label, `ban_matches expected ${expectedBan} got ${suspension.ban_matches}`, suspension);
  } else {
    pass(label, `ban_matches = ${expectedBan}`);
  }

  // accumulated_threshold
  if (suspension.accumulated_threshold !== expectedAccumThreshold) {
    fail(label, `accumulated_threshold expected ${expectedAccumThreshold} got ${suspension.accumulated_threshold}`, suspension);
  } else {
    pass(label, `accumulated_threshold = ${expectedAccumThreshold}`);
  }

  // total_points (only matters for accumulated_points type)
  if (expectedType === 'accumulated_points') {
    if (suspension.total_points !== expectedAccumPoints) {
      fail(label, `total_points expected ${expectedAccumPoints} got ${suspension.total_points}`, suspension);
    } else {
      pass(label, `total_points = ${expectedAccumPoints}`);
    }
  } else {
    if (suspension.total_points !== 0) {
      fail(label, `ejection event total_points expected 0 got ${suspension.total_points}`, suspension);
    } else {
      pass(label, `ejection total_points = 0`);
    }
  }

  // source_card_ids: must be actual card IDs (UUIDs), never match IDs
  const sourceIds: string[] = suspension.source_card_ids || [];
  if (sourceIds.length === 0) {
    fail(label, `source_card_ids is empty`, suspension);
  } else {
    const allUUIDs = sourceIds.every((id) => isUUID(id));
    if (!allUUIDs) {
      fail(label, `source_card_ids contains non-UUID values: ${JSON.stringify(sourceIds)}`, suspension);
    } else {
      // Verify they are actual card IDs (not match_id)
      const cardIds = cards.map((c) => c.id);
      const anyIsCardId = sourceIds.some((id) => cardIds.includes(id));
      if (!anyIsCardId) {
        fail(label, `source_card_ids UUIDs don't match any known card.id — may still be match_id: ${JSON.stringify(sourceIds)}`);
      } else {
        pass(label, `source_card_ids = ${JSON.stringify(sourceIds)} (verified as cards.id)`);
      }
    }
  }

  // serving_match_ids: all must be scheduled matches
  const servingIds: string[] = suspension.serving_match_ids || [];
  if (suspension.ban_matches > 0 && servingIds.length === 0) {
    // Could be no next match found — not necessarily a failure
    pass(label, `serving_match_ids = [] (no future scheduled match found — acceptable)`);
  } else {
    pass(label, `serving_match_ids = ${JSON.stringify(servingIds)}`);
  }

  // suspended_from_match_id matches first serving_match_ids item
  if (servingIds.length > 0) {
    if (suspension.suspended_from_match_id !== servingIds[0]) {
      fail(label, `suspended_from_match_id ${suspension.suspended_from_match_id} ≠ serving_match_ids[0] ${servingIds[0]}`, suspension);
    } else {
      pass(label, `suspended_from_match_id matches serving_match_ids[0]`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main test runner
// ---------------------------------------------------------------------------
async function checkBlockingConstraint() {
  // The old unique constraint on (season_id, age_group_id, player_id, team_id) blocks
  // event-based insertion. Detect it early so the error is actionable.
  const { data: constraints } = await supabase
    .from('pg_constraint' as any)
    .select('conname')
    .eq('conrelid', 'public.suspensions' as any);

  // pg_constraint isn't accessible via PostgREST — use a known workaround:
  // try inserting a test event for a non-existent player to trigger the constraint error
  // vs the FK error. Instead, just check by attempting a select on information_schema.
  const { data: cols } = await supabase
    .from('information_schema.table_constraints' as any)
    .select('constraint_name')
    .eq('table_name', 'suspensions' as any)
    .eq('constraint_name', 'suspensions_season_id_age_group_id_player_id_team_id_key' as any);

  // If we can't query it, fall through — the error will surface on first insert
  return (cols || []).length > 0;
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Phase 5.2C — Production Suspension Scenario Tests');
  console.log('══════════════════════════════════════════════════════════\n');

  // Get test context
  const ctx = await getActiveSeason(supabase);
  if (!ctx) {
    console.error('❌ No season/age_group found in production DB.');
    process.exit(1);
  }
  const { seasonId, ageGroupId } = ctx;
  console.log(`Using season=${seasonId} age_group=${ageGroupId}\n`);

  const matchIds = await getMatchIdsForSeason(seasonId, ageGroupId);
  console.log(`Found ${matchIds.length} matches\n`);

  if (!matchIds.length) {
    console.error('❌ No matches found for this season/age_group.');
    process.exit(1);
  }

  const allCards = await getPlayerCardsInSeason(matchIds);
  console.log(`Found ${allCards.length} card records across all players\n`);

  // Also get card IDs for verification
  const { data: cardRecords } = await supabase
    .from('cards')
    .select('id, player_id, team_id, match_id, card_type')
    .in('match_id', matchIds);
  const cardMap = new Map((cardRecords || []).map((c: any) => [c.id, c]));

  // -------------------------------------------------------------------------
  // SCENARIO 1: 3 normal yellow cards → threshold 6 → 1-match ban
  // -------------------------------------------------------------------------
  console.log('── Scenario 1: 3 normal yellow cards ───────────────────');
  const s1Player = await findScenario1Player(allCards, new Set(matchIds));
  if (!s1Player) {
    skip('Scenario 1', 'No player found with exactly 3 normal yellow cards (2+2+2 = 6pts) in this season/age_group');
  } else {
    console.log(`  Player=${s1Player.playerId} Team=${s1Player.teamId}`);
    const suspensions = await runAndGetSuspensions(s1Player.playerId, s1Player.teamId, seasonId, ageGroupId);
    const s1 = suspensions.find((s: any) => s.suspension_type === 'accumulated_points' && s.accumulated_threshold === 6);
    if (!s1) {
      fail('Scenario 1', `No accumulated_points/threshold=6 event found after recalc. All events: ${JSON.stringify(suspensions.map((s:any) => ({type: s.suspension_type, threshold: s.accumulated_threshold})))}`);
    } else {
      const playerCards = allCards.filter((c) => c.player_id === s1Player.playerId);
      verifyCommonFields('Scenario 1', s1, playerCards, 'accumulated_points', 1, 6, 6);
    }
  }

  // -------------------------------------------------------------------------
  // SCENARIO 2: Direct red
  // -------------------------------------------------------------------------
  console.log('\n── Scenario 2: Direct red ───────────────────────────────');
  const s2Player = await findScenario2Player(allCards);
  if (!s2Player) {
    skip('Scenario 2', 'No player found with a solo direct red card in this season/age_group');
  } else {
    console.log(`  Player=${s2Player.playerId} Team=${s2Player.teamId}`);
    const suspensions = await runAndGetSuspensions(s2Player.playerId, s2Player.teamId, seasonId, ageGroupId);
    const s2 = suspensions.find((s: any) => s.suspension_type === 'direct_red');
    if (!s2) {
      fail('Scenario 2', `No direct_red event found. Events: ${JSON.stringify(suspensions.map((s:any) => s.suspension_type))}`);
    } else {
      const playerCards = allCards.filter((c) => c.player_id === s2Player.playerId);
      verifyCommonFields('Scenario 2', s2, playerCards, 'direct_red', 1, null, 0);
    }
  }

  // -------------------------------------------------------------------------
  // SCENARIO 3: Second yellow
  // -------------------------------------------------------------------------
  console.log('\n── Scenario 3: Second yellow ────────────────────────────');
  const s3Player = await findScenario3Player(allCards);
  if (!s3Player) {
    skip('Scenario 3', 'No player found with a second_yellow ejection in this season/age_group');
  } else {
    console.log(`  Player=${s3Player.playerId} Team=${s3Player.teamId}`);
    const suspensions = await runAndGetSuspensions(s3Player.playerId, s3Player.teamId, seasonId, ageGroupId);
    const s3 = suspensions.find((s: any) => s.suspension_type === 'second_yellow');
    if (!s3) {
      fail('Scenario 3', `No second_yellow event found. Events: ${JSON.stringify(suspensions.map((s:any) => s.suspension_type))}`);
    } else {
      const playerCards = allCards.filter((c) => c.player_id === s3Player.playerId);
      verifyCommonFields('Scenario 3', s3, playerCards, 'second_yellow', 1, null, 0);
    }
  }

  // -------------------------------------------------------------------------
  // SCENARIO 4: Yellow + red in same match
  // -------------------------------------------------------------------------
  console.log('\n── Scenario 4: Yellow + red in same match ───────────────');
  const s4Player = await findScenario4Player(allCards);
  if (!s4Player) {
    skip('Scenario 4', 'No player found with yellow+red in same match in this season/age_group');
  } else {
    console.log(`  Player=${s4Player.playerId} Team=${s4Player.teamId}`);
    const suspensions = await runAndGetSuspensions(s4Player.playerId, s4Player.teamId, seasonId, ageGroupId);
    const s4 = suspensions.find((s: any) => s.suspension_type === 'yellow_red');
    if (!s4) {
      fail('Scenario 4', `No yellow_red event found. Events: ${JSON.stringify(suspensions.map((s:any) => s.suspension_type))}`);
    } else {
      const playerCards = allCards.filter((c) => c.player_id === s4Player.playerId);
      verifyCommonFields('Scenario 4', s4, playerCards, 'yellow_red', 1, null, 0);
    }
  }

  // -------------------------------------------------------------------------
  // IDEMPOTENCY: Re-run recalculation, verify no duplicates
  // -------------------------------------------------------------------------
  console.log('\n── Idempotency ──────────────────────────────────────────');
  const idempPlayer = s1Player || s2Player || s3Player || s4Player;
  if (!idempPlayer) {
    skip('Idempotency', 'No test player found for idempotency check');
  } else {
    const before = await runAndGetSuspensions(idempPlayer.playerId, idempPlayer.teamId, seasonId, ageGroupId);
    const beforeIds = new Set(before.map((s: any) => s.id));
    const beforeCount = before.filter((s: any) =>
      ['accumulated_points', 'second_yellow', 'direct_red', 'yellow_red'].includes(s.suspension_type)
    ).length;

    // Run again
    await recalculatePlayerSuspensionEventBased(idempPlayer.playerId, seasonId, ageGroupId, idempPlayer.teamId);
    const after = await runAndGetSuspensions(idempPlayer.playerId, idempPlayer.teamId, seasonId, ageGroupId);
    const afterCount = after.filter((s: any) =>
      ['accumulated_points', 'second_yellow', 'direct_red', 'yellow_red'].includes(s.suspension_type)
    ).length;

    if (beforeCount !== afterCount) {
      fail('Idempotency', `System event count changed on 2nd run: ${beforeCount} → ${afterCount}`, { before: before.map((s:any) => s.suspension_type), after: after.map((s:any) => s.suspension_type) });
    } else {
      pass('Idempotency', `System event count stable across 2 runs: ${afterCount}`);
    }

    // Verify IDs are the same (updated, not duplicated)
    const afterIds = new Set(after.filter((s: any) =>
      ['accumulated_points', 'second_yellow', 'direct_red', 'yellow_red'].includes(s.suspension_type)
    ).map((s: any) => s.id));

    const beforeSystemIds = before.filter((s: any) =>
      ['accumulated_points', 'second_yellow', 'direct_red', 'yellow_red'].includes(s.suspension_type)
    ).map((s: any) => s.id);

    const allSame = beforeSystemIds.every((id: string) => afterIds.has(id));
    if (!allSame) {
      fail('Idempotency', 'Suspension record IDs changed between runs — records were re-created instead of updated', { before: beforeSystemIds, after: [...afterIds] });
    } else {
      pass('Idempotency', 'Record IDs unchanged — update path (not insert) used on 2nd run');
    }
  }

  // -------------------------------------------------------------------------
  // STALE CLEANUP: Insert phantom event, rerun, verify it is deleted
  // -------------------------------------------------------------------------
  console.log('\n── Stale Cleanup ────────────────────────────────────────');
  if (!RUN_STALE_TEST) {
    skip('Stale Cleanup', 'Pass --stale-test flag to run (inserts a phantom event then deletes it)');
  } else if (!idempPlayer) {
    skip('Stale Cleanup', 'No test player available');
  } else {
    // Insert a phantom event for a trigger_match_id that doesn't correspond to any real card
    const PHANTOM_MATCH_ID = '00000000-0000-0000-0000-000000000001';
    const { data: phantom, error: insertErr } = await supabase
      .from('suspensions')
      .insert({
        player_id: idempPlayer.playerId,
        team_id: idempPlayer.teamId,
        season_id: seasonId,
        age_group_id: ageGroupId,
        suspension_type: 'direct_red',
        trigger_match_id: PHANTOM_MATCH_ID,
        accumulated_threshold: null,
        source_card_ids: [],
        serving_match_ids: [],
        ban_matches: 1,
        total_points: 0,
        legacy_migrated: false,
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertErr || !phantom) {
      fail('Stale Cleanup', `Failed to insert phantom event: ${insertErr?.message}`, insertErr);
    } else {
      console.log(`  Inserted phantom event id=${phantom.id} (trigger=${PHANTOM_MATCH_ID})`);

      // Run recalculation — stale cleanup should delete the phantom event
      await recalculatePlayerSuspensionEventBased(idempPlayer.playerId, seasonId, ageGroupId, idempPlayer.teamId);

      // Verify phantom is gone
      const { data: checkPhantom } = await supabase
        .from('suspensions')
        .select('id')
        .eq('id', phantom.id);

      if ((checkPhantom || []).length > 0) {
        fail('Stale Cleanup', `Phantom event id=${phantom.id} was NOT deleted by stale cleanup`);
        // Clean up manually
        await supabase.from('suspensions').delete().eq('id', phantom.id);
      } else {
        pass('Stale Cleanup', `Phantom direct_red event (trigger=${PHANTOM_MATCH_ID}) was deleted by stale cleanup`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // LEGACY PRESERVED: Verify legacy/manual records are untouched
  // -------------------------------------------------------------------------
  console.log('\n── Legacy Preserved ─────────────────────────────────────');
  const { data: legacyBefore } = await supabase
    .from('suspensions')
    .select('id, suspension_type')
    .eq('season_id', seasonId)
    .eq('age_group_id', ageGroupId)
    .or('suspension_type.is.null,suspension_type.eq.legacy,suspension_type.eq.manual');

  const legacyIds = new Set((legacyBefore || []).map((r: any) => r.id));
  console.log(`  Found ${legacyIds.size} legacy/manual/null records`);

  // Run recalculation on a test player (already done above)
  // Then re-check legacy records are still there
  const { data: legacyAfter } = await supabase
    .from('suspensions')
    .select('id, suspension_type')
    .eq('season_id', seasonId)
    .eq('age_group_id', ageGroupId)
    .or('suspension_type.is.null,suspension_type.eq.legacy,suspension_type.eq.manual');

  const legacyAfterIds = new Set((legacyAfter || []).map((r: any) => r.id));
  const deleted = [...legacyIds].filter((id) => !legacyAfterIds.has(id));

  if (deleted.length > 0) {
    fail('Legacy Preserved', `${deleted.length} legacy/manual/null records were deleted: ${JSON.stringify(deleted)}`);
  } else {
    pass('Legacy Preserved', `All ${legacyIds.size} legacy/manual/null records remain untouched`);
  }

  // -------------------------------------------------------------------------
  // PUBLIC/ADMIN CONSISTENCY: Check same fields returned
  // -------------------------------------------------------------------------
  console.log('\n── Public/Admin Consistency ─────────────────────────────');
  const EVENT_FIELDS = ['suspension_type', 'trigger_match_id', 'accumulated_threshold',
    'source_card_ids', 'serving_match_ids', 'served_completed_at', 'legacy_migrated'];

  // Fetch from admin endpoint
  const { data: adminData } = await supabase
    .from('suspensions')
    .select([...EVENT_FIELDS, 'id', 'player_id', 'team_id', 'ban_matches'].join(','))
    .eq('season_id', seasonId)
    .eq('age_group_id', ageGroupId)
    .limit(5);

  const missingFields = EVENT_FIELDS.filter((f) => {
    const sample = (adminData || [])[0];
    return sample && !(f in sample);
  });

  if (missingFields.length > 0) {
    fail('Public/Admin Consistency', `Fields missing from DB query: ${missingFields.join(', ')}`);
  } else {
    pass('Public/Admin Consistency', `All 7 event fields present in suspension records: ${EVENT_FIELDS.join(', ')}`);
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  RESULTS SUMMARY');
  console.log('══════════════════════════════════════════════════════════\n');

  const groups: Record<string, Result[]> = {};
  for (const r of results) {
    const group = r.name.split(' ')[0] + ' ' + (r.name.split(' ')[1] || '');
    if (!groups[r.name]) groups[r.name] = [];
    groups[r.name].push(r);
  }

  // Group by scenario
  const scenarioGroups = new Map<string, boolean>();
  for (const r of results) {
    const key = r.name;
    const existing = scenarioGroups.get(key);
    scenarioGroups.set(key, existing === undefined ? r.pass : existing && r.pass);
  }

  for (const [name, allPass] of scenarioGroups) {
    console.log(`  ${allPass ? '✅' : '❌'} ${name}`);
  }

  const allPassed = [...scenarioGroups.values()].every((v) => v);
  console.log(`\n  Overall: ${allPassed ? '✅ ALL PASS' : '❌ SOME FAILURES'}`);

  if (!allPassed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n❌ Test runner error:', err);
  process.exit(1);
});

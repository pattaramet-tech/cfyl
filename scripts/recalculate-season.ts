/**
 * Phase 5.2D — Controlled Season-wide Suspension Recalculation
 *
 * Runs age-group-by-age-group recalculation with full before/after validation.
 * Stops immediately if any validation fails.
 *
 * Run:
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' \
 *     scripts/recalculate-season.ts
 *
 * Flags:
 *   --dry-run    Print what would run without touching the DB
 *   --all        Also process remaining age groups after U17 (default: U17 only)
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import { recalculateSeasonSuspensions } from '../lib/suspension-calc';

const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes('--dry-run');
const RUN_ALL = ARGS.includes('--all');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) { console.error('Missing env vars'); process.exit(1); }

const supabase = createClient(url, key);

// ── Production context ──────────────────────────────────────────────────────
const SEASON_ID = 'e93c2eb6-e7a2-4b26-b946-5dbfc98d35c2';
const U17_ID = '00a4895f-39e7-4ac0-aacb-43765846a9c2';
const U14_ID = 'fe92820a-c489-47c4-9c1a-07a343ed6349';

// ── Result tracking ─────────────────────────────────────────────────────────
let anyFailed = false;

function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function warn(msg: string) { console.log(`  ⚠️  ${msg}`); }
function err(msg: string) { console.log(`  ❌ ${msg}`); anyFailed = true; }
function info(msg: string) { console.log(`  ℹ️  ${msg}`); }
function section(title: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

// ── DB helpers ──────────────────────────────────────────────────────────────
async function allSuspensions(seasonId: string, ageGroupId?: string) {
  let q = supabase
    .from('suspensions')
    .select('id, player_id, team_id, season_id, age_group_id, suspension_type, trigger_match_id, accumulated_threshold, source_card_ids, serving_match_ids, ban_matches, total_points, legacy_migrated, updated_at')
    .eq('season_id', seasonId);
  if (ageGroupId) q = q.eq('age_group_id', ageGroupId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function countsByType(seasonId: string, ageGroupId?: string) {
  const rows = await allSuspensions(seasonId, ageGroupId);
  const counts = {
    total: rows.length,
    legacy: rows.filter(r => r.suspension_type == null || r.suspension_type === 'legacy').length,
    manual: rows.filter(r => r.suspension_type === 'manual').length,
    accumulated_points: rows.filter(r => r.suspension_type === 'accumulated_points').length,
    direct_red: rows.filter(r => r.suspension_type === 'direct_red').length,
    second_yellow: rows.filter(r => r.suspension_type === 'second_yellow').length,
    yellow_red: rows.filter(r => r.suspension_type === 'yellow_red').length,
  };
  counts.legacy += counts.manual; // group legacy+manual for reporting
  return { counts, rows };
}

function printCounts(label: string, counts: ReturnType<typeof countsByType> extends Promise<infer T> ? T : never) {
  const c = counts.counts;
  console.log(`\n  ${label}:`);
  console.log(`    Total rows      : ${c.total}`);
  console.log(`    Legacy/null     : ${c.legacy}`);
  console.log(`    accumulated_pts : ${c.accumulated_points}`);
  console.log(`    direct_red      : ${c.direct_red}`);
  console.log(`    second_yellow   : ${c.second_yellow}`);
  console.log(`    yellow_red      : ${c.yellow_red}`);
}

// ── Validation suite ────────────────────────────────────────────────────────
async function validate(
  seasonId: string,
  ageGroupId: string,
  agCode: string,
  expectedLegacyCount: number
): Promise<boolean> {
  const { counts, rows } = await countsByType(seasonId, ageGroupId);
  const systemRows = rows.filter(r =>
    ['accumulated_points', 'second_yellow', 'direct_red', 'yellow_red'].includes(r.suspension_type ?? '')
  );
  const legacyRows = rows.filter(r => r.suspension_type == null || ['legacy', 'manual'].includes(r.suspension_type ?? ''));

  let allOk = true;
  const fail = (msg: string) => { err(msg); allOk = false; };

  // 1. Legacy preservation
  if (legacyRows.length < expectedLegacyCount) {
    fail(`${agCode}: Legacy rows dropped: expected ≥${expectedLegacyCount}, got ${legacyRows.length}`);
  } else {
    ok(`${agCode}: Legacy rows preserved: ${legacyRows.length}`);
  }

  // 2. Duplicate event keys
  const keyCount: Record<string, number> = {};
  for (const r of systemRows) {
    const key = `${r.player_id}::${r.team_id}::${r.trigger_match_id}::${r.suspension_type}::${r.accumulated_threshold ?? 0}`;
    keyCount[key] = (keyCount[key] || 0) + 1;
  }
  const dupes = Object.entries(keyCount).filter(([, v]) => v > 1);
  if (dupes.length > 0) {
    fail(`${agCode}: ${dupes.length} duplicate event keys found`);
    for (const [k, v] of dupes) console.log(`     [${v}×] ${k}`);
  } else {
    ok(`${agCode}: No duplicate event keys (${systemRows.length} system events)`);
  }

  // 3. source_card_ids — verify all IDs are real cards.id
  const allSourceIds = systemRows.flatMap(r => r.source_card_ids || []);
  if (allSourceIds.length === 0 && systemRows.length > 0) {
    warn(`${agCode}: ${systemRows.filter(r=>(r.source_card_ids||[]).length===0).length} system events have empty source_card_ids`);
  }
  if (allSourceIds.length > 0) {
    const uniqueSourceIds = [...new Set(allSourceIds)];
    const { data: cardCheck } = await supabase
      .from('cards')
      .select('id')
      .in('id', uniqueSourceIds);
    const foundIds = new Set((cardCheck || []).map((c: any) => c.id));
    const orphans = uniqueSourceIds.filter(id => !foundIds.has(id));
    if (orphans.length > 0) {
      fail(`${agCode}: ${orphans.length} orphan source_card_ids (not found in cards table)`);
    } else {
      ok(`${agCode}: All ${uniqueSourceIds.length} source_card_ids verified as real cards.id`);
    }
  } else if (systemRows.length === 0) {
    ok(`${agCode}: No system events — nothing to validate`);
  }

  // 4. serving_match_ids — must be scheduled (remaining) OR finished (served); never postponed/cancelled
  const allServingIds = systemRows.flatMap(r => r.serving_match_ids || []);
  if (allServingIds.length > 0) {
    const uniqueServingIds = [...new Set(allServingIds)];
    const { data: matchCheck } = await supabase
      .from('matches')
      .select('id, status')
      .in('id', uniqueServingIds);
    const matchMap = new Map((matchCheck || []).map((m: any) => [m.id, m.status]));
    const invalid = uniqueServingIds.filter(id => {
      const status = matchMap.get(id);
      return !status || (status !== 'scheduled' && status !== 'finished');
    });
    if (invalid.length > 0) {
      fail(`${agCode}: ${invalid.length} serving_match_ids are postponed/cancelled/missing`);
      for (const id of invalid.slice(0, 5)) {
        console.log(`     ${id} → status: ${matchMap.get(id) ?? 'NOT FOUND'}`);
      }
    } else {
      const scheduledCount = uniqueServingIds.filter(id => matchMap.get(id) === 'scheduled').length;
      const finishedCount = uniqueServingIds.filter(id => matchMap.get(id) === 'finished').length;
      ok(`${agCode}: serving_match_ids valid — ${scheduledCount} scheduled (remaining), ${finishedCount} finished (served)`);
    }
  } else {
    ok(`${agCode}: No serving_match_ids to validate (no active bans)`);
  }

  // 5. Stale system events — trigger_match_id has no cards for the player
  if (systemRows.length > 0) {
    // Fetch all cards in this season/age_group
    const { data: matchRows } = await supabase
      .from('matches')
      .select('id')
      .eq('season_id', seasonId)
      .eq('age_group_id', ageGroupId);
    const matchIds = (matchRows || []).map((m: any) => m.id);

    const { data: allCards } = matchIds.length > 0
      ? await supabase.from('cards').select('player_id, match_id').in('match_id', matchIds)
      : { data: [] };

    const playerMatchHasCard = new Set(
      (allCards || []).map((c: any) => `${c.player_id}::${c.match_id}`)
    );

    const staleEvents = systemRows.filter(r =>
      r.trigger_match_id &&
      !playerMatchHasCard.has(`${r.player_id}::${r.trigger_match_id}`)
    );

    if (staleEvents.length > 0) {
      fail(`${agCode}: ${staleEvents.length} stale system events (trigger match has no cards for player)`);
      for (const e of staleEvents.slice(0, 5)) {
        console.log(`     id=${e.id} type=${e.suspension_type} trigger=${e.trigger_match_id}`);
      }
    } else {
      ok(`${agCode}: No stale system events`);
    }
  }

  return allOk;
}

// ── Backup ──────────────────────────────────────────────────────────────────
async function backup(seasonId: string): Promise<string> {
  section('BACKUP — public.suspensions');
  const { rows } = await countsByType(seasonId);
  const backupFile = path.join(
    __dirname,
    `../backup-suspensions-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  fs.writeFileSync(backupFile, JSON.stringify(rows, null, 2));
  ok(`Backup written: ${path.basename(backupFile)} (${rows.length} rows)`);
  info(`Legacy/null rows: ${rows.filter(r => r.suspension_type == null || ['legacy','manual'].includes(r.suspension_type??'')).length}`);
  info(`Event-based rows: ${rows.filter(r => ['accumulated_points','second_yellow','direct_red','yellow_red'].includes(r.suspension_type??'')).length}`);
  return backupFile;
}

// ── Per-age-group recalculation ─────────────────────────────────────────────
async function runAgeGroup(
  seasonId: string,
  ageGroupId: string,
  agCode: string,
  expectedLegacy: number
): Promise<boolean> {
  section(`${agCode} — BEFORE`);
  const before = await countsByType(seasonId, ageGroupId);
  printCounts('Before', before);

  if (DRY_RUN) {
    warn(`DRY RUN — skipping recalculation for ${agCode}`);
    return true;
  }

  section(`${agCode} — RECALCULATE (Run 1)`);
  console.log(`  Running recalculateSeasonSuspensions(${seasonId}, ${ageGroupId})...`);
  const result1 = await recalculateSeasonSuspensions(seasonId, ageGroupId);
  info(`Processed ${result1.processed} players — ${result1.success} success, ${result1.failed} failed`);
  if (result1.failed > 0) {
    err(`${agCode}: ${result1.failed} player(s) failed during recalculation`);
    return false;
  }

  section(`${agCode} — AFTER Run 1`);
  const after1 = await countsByType(seasonId, ageGroupId);
  printCounts('After Run 1', after1);
  const valid1 = await validate(seasonId, ageGroupId, agCode, expectedLegacy);
  if (!valid1) {
    err(`${agCode}: Validation failed after Run 1. Stopping.`);
    return false;
  }
  ok(`${agCode}: Run 1 validation passed`);

  // ── Idempotency run ──────────────────────────────────────────────────────
  section(`${agCode} — RECALCULATE (Run 2 — Idempotency)`);
  console.log(`  Re-running recalculation to verify idempotency...`);
  const result2 = await recalculateSeasonSuspensions(seasonId, ageGroupId);
  info(`Processed ${result2.processed} players — ${result2.success} success, ${result2.failed} failed`);

  const after2 = await countsByType(seasonId, ageGroupId);
  printCounts('After Run 2', after2);

  // Compare counts
  if (after2.counts.total !== after1.counts.total) {
    err(`${agCode}: Total row count changed on Run 2: ${after1.counts.total} → ${after2.counts.total}`);
    return false;
  }
  ok(`${agCode}: Total row count stable across 2 runs: ${after2.counts.total}`);

  // Compare per-type counts
  const c1 = after1.counts;
  const c2 = after2.counts;
  const typeChanged =
    c1.accumulated_points !== c2.accumulated_points ||
    c1.direct_red !== c2.direct_red ||
    c1.second_yellow !== c2.second_yellow ||
    c1.yellow_red !== c2.yellow_red;

  if (typeChanged) {
    err(`${agCode}: Event type counts changed on Run 2`);
    return false;
  }
  ok(`${agCode}: All event type counts stable on Run 2`);

  // Verify IDs are identical (no re-creation)
  const ids1 = new Set(after1.rows.filter(r => ['accumulated_points','second_yellow','direct_red','yellow_red'].includes(r.suspension_type??'')).map(r => r.id));
  const ids2 = new Set(after2.rows.filter(r => ['accumulated_points','second_yellow','direct_red','yellow_red'].includes(r.suspension_type??'')).map(r => r.id));
  const newIds = [...ids2].filter(id => !ids1.has(id));
  const deletedIds = [...ids1].filter(id => !ids2.has(id));
  if (newIds.length > 0 || deletedIds.length > 0) {
    err(`${agCode}: Record IDs changed on Run 2 (new: ${newIds.length}, deleted: ${deletedIds.length})`);
    return false;
  }
  ok(`${agCode}: All record IDs stable (update path confirmed, no re-inserts)`);

  const valid2 = await validate(seasonId, ageGroupId, agCode, expectedLegacy);
  if (!valid2) {
    err(`${agCode}: Validation failed after Run 2`);
    return false;
  }
  ok(`${agCode}: ✅ ALL CHECKS PASSED`);
  return true;
}

// ── Final season audit ───────────────────────────────────────────────────────
async function finalAudit(seasonId: string) {
  section('FINAL SEASON AUDIT');
  const { counts, rows } = await countsByType(seasonId);
  printCounts('Full season', { counts, rows } as any);

  const systemRows = rows.filter(r =>
    ['accumulated_points', 'second_yellow', 'direct_red', 'yellow_red'].includes(r.suspension_type ?? '')
  );

  // Global duplicate check
  const keyCount: Record<string, number> = {};
  for (const r of systemRows) {
    const key = `${r.player_id}::${r.team_id}::${r.trigger_match_id}::${r.suspension_type}::${r.accumulated_threshold ?? 0}`;
    keyCount[key] = (keyCount[key] || 0) + 1;
  }
  const dupes = Object.entries(keyCount).filter(([, v]) => v > 1);
  if (dupes.length > 0) {
    err(`FINAL: ${dupes.length} duplicate event keys across full season`);
  } else {
    ok(`FINAL: No duplicate event keys (${systemRows.length} total system events)`);
  }

  // Global legacy check
  const legacyRows = rows.filter(r => r.suspension_type == null || ['legacy', 'manual'].includes(r.suspension_type ?? ''));
  ok(`FINAL: ${legacyRows.length} legacy/null/manual records preserved`);

  // Players with active bans
  const activeBans = systemRows.filter(r => r.ban_matches > 0 && (r.serving_match_ids || []).length > 0);
  info(`Players with active bans (serving_match_ids set): ${activeBans.length}`);

  // Summary per age group
  const byAg: Record<string, { legacy: number; system: number; types: string[] }> = {};
  for (const r of rows) {
    const agid = r.age_group_id;
    if (!byAg[agid]) byAg[agid] = { legacy: 0, system: 0, types: [] };
    if (r.suspension_type == null || ['legacy','manual'].includes(r.suspension_type??'')) {
      byAg[agid].legacy++;
    } else if (['accumulated_points','second_yellow','direct_red','yellow_red'].includes(r.suspension_type??'')) {
      byAg[agid].system++;
      byAg[agid].types.push(r.suspension_type!);
    }
  }
  console.log('\n  Per-age-group breakdown:');
  for (const [agid, stats] of Object.entries(byAg)) {
    const typeSummary = stats.types.reduce((acc: Record<string,number>, t) => { acc[t]=(acc[t]||0)+1; return acc; }, {});
    console.log(`    ${agid}: legacy=${stats.legacy} system=${stats.system} [${JSON.stringify(typeSummary)}]`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Phase 5.2D — Controlled Season-wide Recalculation');
  if (DRY_RUN) console.log('  MODE: DRY RUN (no DB writes)');
  console.log('══════════════════════════════════════════════════════════════');

  // Backup
  const backupFile = await backup(SEASON_ID);

  // U17 (63 expected legacy records)
  const u17ok = await runAgeGroup(SEASON_ID, U17_ID, 'U17', 63);
  if (!u17ok) {
    err('U17 failed — stopping. No other age groups will be processed.');
    printFinalReport(backupFile);
    process.exit(1);
  }

  // U14 (only if --all or default flow continues)
  let u14ok = true;
  if (RUN_ALL) {
    u14ok = await runAgeGroup(SEASON_ID, U14_ID, 'U14', 51);
    if (!u14ok) {
      err('U14 failed — stopping.');
      printFinalReport(backupFile);
      process.exit(1);
    }
  } else {
    section('U14 — SKIPPED');
    warn('Pass --all to also process U14. U17 passed — safe to proceed.');
  }

  // Final audit
  await finalAudit(SEASON_ID);
  printFinalReport(backupFile);

  if (anyFailed) process.exit(1);
}

function printFinalReport(backupFile: string) {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  PHASE 5.2D REPORT');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Backup file: ${path.basename(backupFile)}`);
  console.log(`  Overall: ${anyFailed ? '❌ FAILED' : '✅ ALL PASS'}`);
}

main().catch(e => { console.error('\n❌ Fatal:', e.message ?? e); process.exit(1); });

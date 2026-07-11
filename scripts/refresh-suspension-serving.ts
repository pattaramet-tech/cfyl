/**
 * Phase 5.3 — Serving Match Refresh Script
 *
 * Refreshes serving_match_ids for active suspension events when the
 * match schedule changes (postponed, cancelled, rescheduled).
 *
 * DEFAULT: --dry-run (prints what would change, writes nothing)
 * REQUIRED for writes: --apply
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' \
 *     scripts/refresh-suspension-serving.ts \
 *     --season-id e93c2eb6-e7a2-4b26-b946-5dbfc98d35c2 \
 *     [--age-group-id <id>] [--team-id <id>] [--changed-match-id <id>] \
 *     [--dry-run | --apply]
 *
 * Safety:
 *   - Dry-run by default — must explicitly pass --apply
 *   - Writes a timestamped backup of affected rows before any update
 *   - Never modifies legacy, manual, or null suspension_type records
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import { refreshSuspensionServingMatches } from '../lib/suspension-calc';

const ARGS = process.argv.slice(2);
const param = (name: string): string | undefined => {
  const i = ARGS.indexOf(`--${name}`);
  return i >= 0 ? ARGS[i + 1] : undefined;
};
const flag = (name: string) => ARGS.includes(`--${name}`);

const SEASON_ID = param('season-id');
const AGE_GROUP_ID = param('age-group-id');
const TEAM_ID = param('team-id');
const CHANGED_MATCH_ID = param('changed-match-id');
const DRY_RUN = !flag('apply');

if (!SEASON_ID) {
  console.error('Usage: --season-id <id> [--age-group-id <id>] [--team-id <id>] [--changed-match-id <id>] [--dry-run | --apply]');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) { console.error('Missing env vars'); process.exit(1); }

const supabase = createClient(url, key);

async function backup(seasonId: string, ageGroupId?: string, teamId?: string): Promise<string> {
  let q = supabase
    .from('suspensions')
    .select('*')
    .eq('season_id', seasonId)
    .in('suspension_type', ['accumulated_points', 'second_yellow', 'direct_red', 'yellow_red'])
    .gt('ban_matches', 0);
  if (ageGroupId) q = q.eq('age_group_id', ageGroupId);
  if (teamId) q = q.eq('team_id', teamId);

  const { data } = await q;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(__dirname, `../backup-serving-refresh-${ts}.json`);
  fs.writeFileSync(file, JSON.stringify(data || [], null, 2));
  return file;
}

async function previewChanges(seasonId: string, ageGroupId?: string, teamId?: string, changedMatchId?: string) {
  let q = supabase
    .from('suspensions')
    .select('id, player_id, team_id, suspension_type, trigger_match_id, serving_match_ids, ban_matches, suspended_from_match_id, served_completed_at')
    .eq('season_id', seasonId)
    .in('suspension_type', ['accumulated_points', 'second_yellow', 'direct_red', 'yellow_red'])
    .gt('ban_matches', 0);
  if (ageGroupId) q = q.eq('age_group_id', ageGroupId);
  if (teamId) q = q.eq('team_id', teamId);

  const { data: events } = await q;
  if (!events?.length) { console.log('  No active system events found.'); return; }

  let relevant = events as any[];
  if (changedMatchId) {
    relevant = events.filter((e: any) =>
      e.trigger_match_id === changedMatchId ||
      (e.serving_match_ids || []).includes(changedMatchId)
    );
  }

  console.log(`\n  Events that would be evaluated: ${relevant.length}`);
  console.log(`  (Full diff requires --apply — dry-run only shows count)\n`);
  for (const e of relevant.slice(0, 10)) {
    console.log(`    ${e.suspension_type} id=${e.id} serving=${JSON.stringify(e.serving_match_ids || [])}`);
  }
  if (relevant.length > 10) console.log(`    ... and ${relevant.length - 10} more`);
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  Serving Match Refresh ${DRY_RUN ? '[DRY RUN]' : '[APPLY]'}`);
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Season:     ${SEASON_ID}`);
  if (AGE_GROUP_ID) console.log(`  AgeGroup:   ${AGE_GROUP_ID}`);
  if (TEAM_ID) console.log(`  Team:       ${TEAM_ID}`);
  if (CHANGED_MATCH_ID) console.log(`  Changed:    ${CHANGED_MATCH_ID}`);

  if (DRY_RUN) {
    console.log('\n  DRY RUN — no changes will be written. Pass --apply to write.\n');
    await previewChanges(SEASON_ID!, AGE_GROUP_ID, TEAM_ID, CHANGED_MATCH_ID);
    return;
  }

  // Write path — backup first
  const backupFile = await backup(SEASON_ID!, AGE_GROUP_ID, TEAM_ID);
  console.log(`\n  Backup written: ${path.basename(backupFile)}`);

  const result = await refreshSuspensionServingMatches({
    seasonId: SEASON_ID!,
    ageGroupId: AGE_GROUP_ID ?? SEASON_ID!,
    teamId: TEAM_ID,
    changedMatchId: CHANGED_MATCH_ID,
  });

  console.log('\n  Results:');
  console.log(`    Refreshed: ${result.refreshed}`);
  console.log(`    Skipped:   ${result.skipped}`);
  console.log(`    Failed:    ${result.failed}`);

  if (result.failed > 0) {
    console.log('\n  ❌ Some events failed to refresh — check logs above');
    process.exit(1);
  } else {
    console.log('\n  ✅ Refresh complete');
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

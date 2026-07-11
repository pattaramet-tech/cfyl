/**
 * Phase 5.3 — Suspension Monitoring Script (READ-ONLY)
 *
 * Queries the monitoring endpoint and reports health status.
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' \
 *     scripts/monitor-suspensions.ts \
 *     --season-id e93c2eb6-e7a2-4b26-b946-5dbfc98d35c2 \
 *     [--age-group-id <id>] [--team-id <id>] [--verbose] [--json]
 *
 * Environment:
 *   NEXT_PUBLIC_SUPABASE_URL  — required
 *   SUPABASE_SERVICE_ROLE_KEY — required
 */

import { createClient } from '@supabase/supabase-js';

const ARGS = process.argv.slice(2);
const flag = (name: string) => ARGS.includes(`--${name}`);
const param = (name: string): string | undefined => {
  const i = ARGS.indexOf(`--${name}`);
  return i >= 0 ? ARGS[i + 1] : undefined;
};

const SEASON_ID = param('season-id');
const AGE_GROUP_ID = param('age-group-id');
const TEAM_ID = param('team-id');
const VERBOSE = flag('verbose');
const JSON_OUTPUT = flag('json');

if (!SEASON_ID) {
  console.error('Usage: --season-id <id> [--age-group-id <id>] [--team-id <id>] [--verbose] [--json]');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const supabase = createClient(url, key);

const SYSTEM_TYPES = ['accumulated_points', 'second_yellow', 'direct_red', 'yellow_red'] as const;

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Suspension Monitoring (READ-ONLY)');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Season:    ${SEASON_ID}`);
  if (AGE_GROUP_ID) console.log(`  AgeGroup:  ${AGE_GROUP_ID}`);
  if (TEAM_ID) console.log(`  Team:      ${TEAM_ID}`);

  let q = supabase
    .from('suspensions')
    .select(`
      id, player_id, team_id, season_id, age_group_id,
      suspension_type, trigger_match_id, accumulated_threshold,
      source_card_ids, serving_match_ids, ban_matches, total_points,
      suspended_from_match_id, served_completed_at, legacy_migrated, updated_at
    `)
    .eq('season_id', SEASON_ID!);

  if (AGE_GROUP_ID) q = q.eq('age_group_id', AGE_GROUP_ID);
  if (TEAM_ID) q = q.eq('team_id', TEAM_ID);

  const { data: records, error } = await q;
  if (error) { console.error('Query error:', error.message); process.exit(1); }

  const all = records || [];
  const system = all.filter(r => SYSTEM_TYPES.includes(r.suspension_type as any));
  const legacy = all.filter(r => r.suspension_type == null || r.suspension_type === 'legacy');
  const manual = all.filter(r => r.suspension_type === 'manual');

  // Collect all match IDs
  const allServingIds = [...new Set(system.flatMap((r: any) => r.serving_match_ids || []))];
  const allTriggerIds = [...new Set(system.map((r: any) => r.trigger_match_id).filter(Boolean) as string[])];
  const allSourceIds = [...new Set(system.flatMap((r: any) => r.source_card_ids || []))];
  const allMatchIds = [...new Set([...allServingIds, ...allTriggerIds])];

  const matchMap = new Map<string, any>();
  if (allMatchIds.length > 0) {
    const { data: mRows } = await supabase
      .from('matches')
      .select('id, status, season_id, age_group_id, home_team_id, away_team_id, match_date')
      .in('id', allMatchIds);
    for (const m of mRows || []) matchMap.set(m.id, m);
  }

  const cardMap = new Map<string, any>();
  if (allSourceIds.length > 0) {
    const { data: cRows } = await supabase.from('cards').select('id, player_id, match_id').in('id', allSourceIds);
    for (const c of cRows || []) cardMap.set(c.id, c);
  }

  // ── Issue collection ────────────────────────────────────────────────────
  const issues: Array<{ code: string; severity: string; id: string; detail: string }> = [];

  // Duplicate keys
  const keyCount = new Map<string, number>();
  system.forEach((r: any) => {
    const k = `${r.player_id}::${r.team_id}::${r.trigger_match_id}::${r.suspension_type}::${r.accumulated_threshold ?? 0}`;
    keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
  });
  system.forEach((r: any) => {
    const k = `${r.player_id}::${r.team_id}::${r.trigger_match_id}::${r.suspension_type}::${r.accumulated_threshold ?? 0}`;
    if ((keyCount.get(k) ?? 0) > 1) issues.push({ code: 'EVENT_DUPLICATE_KEY', severity: 'error', id: r.id, detail: k });
  });

  system.forEach((r: any) => {
    // source_card_ids
    (r.source_card_ids || []).forEach((cId: string) => {
      if (!cardMap.has(cId)) issues.push({ code: 'SOURCE_CARD_NOT_FOUND', severity: 'error', id: r.id, detail: cId });
    });

    // trigger
    if (!r.trigger_match_id) {
      issues.push({ code: 'TRIGGER_MATCH_NOT_FOUND', severity: 'error', id: r.id, detail: 'null trigger_match_id' });
    } else if (!matchMap.has(r.trigger_match_id)) {
      issues.push({ code: 'TRIGGER_MATCH_NOT_FOUND', severity: 'error', id: r.id, detail: r.trigger_match_id });
    }

    // serving
    const triggerDate = r.trigger_match_id ? (matchMap.get(r.trigger_match_id)?.match_date ?? null) : null;
    (r.serving_match_ids || []).forEach((sId: string) => {
      const sm = matchMap.get(sId);
      if (!sm) { issues.push({ code: 'SERVING_MATCH_NOT_FOUND', severity: 'error', id: r.id, detail: sId }); return; }
      if (sm.status === 'postponed') issues.push({ code: 'SERVING_MATCH_POSTPONED', severity: 'warning', id: r.id, detail: sId });
      if (sm.status === 'cancelled') issues.push({ code: 'SERVING_MATCH_CANCELLED', severity: 'warning', id: r.id, detail: sId });
      if (triggerDate && sm.match_date && sm.match_date <= triggerDate)
        issues.push({ code: 'SERVING_MATCH_BEFORE_TRIGGER', severity: 'error', id: r.id, detail: `${sId} (${sm.match_date} <= ${triggerDate})` });
      if (sm.home_team_id !== r.team_id && sm.away_team_id !== r.team_id)
        issues.push({ code: 'SERVING_MATCH_WRONG_TEAM', severity: 'error', id: r.id, detail: sId });
    });

    // active ban without scheduled serving match
    if (r.ban_matches > 0 && !r.served_completed_at) {
      const hasScheduled = (r.serving_match_ids || []).some((id: string) => matchMap.get(id)?.status === 'scheduled');
      if (!hasScheduled) issues.push({ code: 'ACTIVE_BAN_WITHOUT_REMAINING_SCHEDULED_MATCH', severity: 'warning', id: r.id, detail: `ban_matches=${r.ban_matches}` });
    }
  });

  // ── Report ────────────────────────────────────────────────────────────
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const healthy = errors.length === 0 && warnings.length === 0;

  const report = {
    checked_at: new Date().toISOString(),
    season_id: SEASON_ID,
    summary: {
      total: all.length,
      system: system.length,
      legacy: legacy.length,
      manual: manual.length,
      errors: errors.length,
      warnings: warnings.length,
      healthy,
    },
    issues,
  };

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n  Records: ${all.length} total | ${system.length} system | ${legacy.length} legacy | ${manual.length} manual`);
    console.log(`  Issues:  ${errors.length} errors | ${warnings.length} warnings`);
    console.log(`  Health:  ${healthy ? '✅ HEALTHY' : '❌ ISSUES FOUND'}`);

    if (!healthy || VERBOSE) {
      const byCode = new Map<string, number>();
      for (const i of issues) byCode.set(i.code, (byCode.get(i.code) ?? 0) + 1);
      for (const [code, count] of byCode) {
        const sev = errors.some(e => e.code === code) ? '❌' : '⚠️';
        console.log(`  ${sev} ${code}: ${count}`);
      }
      if (VERBOSE) {
        for (const i of issues) {
          console.log(`    [${i.severity.toUpperCase()}] ${i.code} id=${i.id} → ${i.detail}`);
        }
      }
    }
  }

  process.exit(healthy ? 0 : 1);
}

main().catch(e => { console.error(e.message); process.exit(1); });

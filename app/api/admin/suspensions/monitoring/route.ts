import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseServiceKey) throw new Error('Missing Supabase environment variables');

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const dynamic = 'force-dynamic';

type IssueSeverity = 'error' | 'warning' | 'info';

interface SuspensionIssue {
  suspension_id: string;
  player_id: string;
  team_id: string;
  suspension_type: string | null;
  trigger_match_id: string | null;
  issue_code: string;
  severity: IssueSeverity;
  details: string;
}

const SYSTEM_TYPES = ['accumulated_points', 'second_yellow', 'direct_red', 'yellow_red'] as const;

export async function GET(request: NextRequest) {
  const authResult = await verifyAdminAuth(request);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get('seasonId');
  const ageGroupId = searchParams.get('ageGroupId');
  const teamId = searchParams.get('teamId');

  if (!seasonId) {
    return NextResponse.json({ error: 'seasonId is required' }, { status: 400 });
  }

  try {
    // Fetch all suspension records
    let q = supabaseAdmin
      .from('suspensions')
      .select(`
        id, player_id, team_id, season_id, age_group_id,
        suspension_type, trigger_match_id, accumulated_threshold,
        source_card_ids, serving_match_ids, ban_matches, total_points,
        suspended_from_match_id, served_completed_at, legacy_migrated,
        suspension_details, updated_at
      `)
      .eq('season_id', seasonId);

    if (ageGroupId) q = q.eq('age_group_id', ageGroupId);
    if (teamId) q = q.eq('team_id', teamId);

    const { data: records, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const all = records || [];
    const systemEvents = all.filter((r) => SYSTEM_TYPES.includes(r.suspension_type as any));
    const legacyRecords = all.filter(
      (r) => r.suspension_type == null || r.suspension_type === 'legacy'
    );
    const manualRecords = all.filter((r) => r.suspension_type === 'manual');
    const activeBans = systemEvents.filter(
      (r) => r.ban_matches > 0 && (r.serving_match_ids || []).length > 0
    );
    const servedBans = systemEvents.filter(
      (r) => r.ban_matches > 0 && r.served_completed_at != null
    );

    // Collect all match IDs needed for validation
    const allServingIds = [
      ...new Set(systemEvents.flatMap((r) => r.serving_match_ids || [])),
    ];
    const allTriggerIds = [
      ...new Set(systemEvents.map((r) => r.trigger_match_id).filter(Boolean) as string[]),
    ];
    const allSourceCardIds = [
      ...new Set(systemEvents.flatMap((r) => r.source_card_ids || [])),
    ];

    // Batch-fetch match status data
    const matchMap = new Map<string, any>();
    if (allServingIds.length > 0 || allTriggerIds.length > 0) {
      const allMatchIds = [...new Set([...allServingIds, ...allTriggerIds])];
      const { data: matchRows } = await supabaseAdmin
        .from('matches')
        .select('id, status, season_id, age_group_id, home_team_id, away_team_id, match_date, matchday, trigger_match_id')
        .in('id', allMatchIds);
      for (const m of matchRows || []) matchMap.set(m.id, m);
    }

    // Batch-fetch source card data
    const cardMap = new Map<string, any>();
    if (allSourceCardIds.length > 0) {
      const { data: cardRows } = await supabaseAdmin
        .from('cards')
        .select('id, player_id, match_id, card_type')
        .in('id', allSourceCardIds);
      for (const c of cardRows || []) cardMap.set(c.id, c);
    }

    const issues: SuspensionIssue[] = [];

    // ── Per-event analysis ─────────────────────────────────────────────────
    // Duplicate event key detection
    const eventKeyCount = new Map<string, number>();
    for (const r of systemEvents) {
      const key = `${r.player_id}::${r.team_id}::${r.trigger_match_id}::${r.suspension_type}::${r.accumulated_threshold ?? 0}`;
      eventKeyCount.set(key, (eventKeyCount.get(key) ?? 0) + 1);
    }

    for (const r of systemEvents) {
      const key = `${r.player_id}::${r.team_id}::${r.trigger_match_id}::${r.suspension_type}::${r.accumulated_threshold ?? 0}`;
      if ((eventKeyCount.get(key) ?? 0) > 1) {
        issues.push({
          suspension_id: r.id,
          player_id: r.player_id,
          team_id: r.team_id,
          suspension_type: r.suspension_type,
          trigger_match_id: r.trigger_match_id,
          issue_code: 'EVENT_DUPLICATE_KEY',
          severity: 'error',
          details: `Duplicate event key: ${key}`,
        });
      }

      // source_card_ids checks
      for (const cardId of r.source_card_ids || []) {
        const card = cardMap.get(cardId);
        if (!card) {
          issues.push({
            suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
            suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
            issue_code: 'SOURCE_CARD_NOT_FOUND',
            severity: 'error',
            details: `Card ${cardId} not found in public.cards`,
          });
        } else {
          if (card.player_id !== r.player_id) {
            issues.push({
              suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
              suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
              issue_code: 'SOURCE_CARD_WRONG_PLAYER',
              severity: 'error',
              details: `Card ${cardId} belongs to player ${card.player_id}, not ${r.player_id}`,
            });
          }
          if (r.trigger_match_id && card.match_id !== r.trigger_match_id) {
            issues.push({
              suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
              suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
              issue_code: 'SOURCE_CARD_WRONG_MATCH',
              severity: 'warning',
              details: `Card ${cardId} is from match ${card.match_id}, trigger is ${r.trigger_match_id}`,
            });
          }
        }
      }

      // trigger_match_id checks
      if (!r.trigger_match_id) {
        issues.push({
          suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
          suspension_type: r.suspension_type, trigger_match_id: null,
          issue_code: 'TRIGGER_MATCH_NOT_FOUND',
          severity: 'error',
          details: 'trigger_match_id is null on a system event',
        });
      } else {
        const triggerMatch = matchMap.get(r.trigger_match_id);
        if (!triggerMatch) {
          issues.push({
            suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
            suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
            issue_code: 'TRIGGER_MATCH_NOT_FOUND',
            severity: 'error',
            details: `Trigger match ${r.trigger_match_id} not found in matches table`,
          });
        } else {
          // Check trigger match has at least one source card for this player
          const hasSourceCard = (r.source_card_ids || []).some(
            (id: string) => cardMap.get(id)?.match_id === r.trigger_match_id
          );
          if (!hasSourceCard) {
            issues.push({
              suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
              suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
              issue_code: 'TRIGGER_MATCH_HAS_NO_SOURCE_CARD',
              severity: 'error',
              details: `No source card links trigger match ${r.trigger_match_id} for this player`,
            });
          }
        }
      }

      // serving_match_ids checks
      const triggerMatch = r.trigger_match_id ? matchMap.get(r.trigger_match_id) : null;
      const triggerDate = triggerMatch?.match_date ?? null;

      for (const sId of r.serving_match_ids || []) {
        const sm = matchMap.get(sId);
        if (!sm) {
          issues.push({
            suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
            suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
            issue_code: 'SERVING_MATCH_NOT_FOUND',
            severity: 'error',
            details: `Serving match ${sId} not found in matches table`,
          });
          continue;
        }
        if (sm.status === 'postponed') {
          issues.push({
            suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
            suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
            issue_code: 'SERVING_MATCH_POSTPONED',
            severity: 'warning',
            details: `Serving match ${sId} is postponed — refresh needed`,
          });
        }
        if (sm.status === 'cancelled') {
          issues.push({
            suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
            suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
            issue_code: 'SERVING_MATCH_CANCELLED',
            severity: 'warning',
            details: `Serving match ${sId} is cancelled — refresh needed`,
          });
        }
        if (triggerDate && sm.match_date && sm.match_date <= triggerDate) {
          issues.push({
            suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
            suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
            issue_code: 'SERVING_MATCH_BEFORE_TRIGGER',
            severity: 'error',
            details: `Serving match ${sId} (${sm.match_date}) is on/before trigger date (${triggerDate})`,
          });
        }
        if (
          sm.home_team_id !== r.team_id &&
          sm.away_team_id !== r.team_id
        ) {
          issues.push({
            suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
            suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
            issue_code: 'SERVING_MATCH_WRONG_TEAM',
            severity: 'error',
            details: `Serving match ${sId} does not involve team ${r.team_id}`,
          });
        }
        if (ageGroupId && sm.age_group_id !== ageGroupId) {
          issues.push({
            suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
            suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
            issue_code: 'SERVING_MATCH_WRONG_SEASON',
            severity: 'error',
            details: `Serving match ${sId} is in a different age_group`,
          });
        }
      }

      // Ban slot count mismatch
      if (r.ban_matches > 0) {
        const totalServingSlots = (r.serving_match_ids || []).length;
        const servedSlots = (r.serving_match_ids || []).filter(
          (id: string) => matchMap.get(id)?.status === 'finished'
        ).length;
        const remainingSlots = totalServingSlots - servedSlots;
        const isComplete = r.served_completed_at != null;

        if (!isComplete && remainingSlots === 0 && servedSlots === 0) {
          // Active ban with no serving matches at all
          issues.push({
            suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
            suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
            issue_code: 'ACTIVE_BAN_WITHOUT_REMAINING_SCHEDULED_MATCH',
            severity: 'warning',
            details: `ban_matches=${r.ban_matches} but serving_match_ids is empty and ban is not served`,
          });
        }

        if (totalServingSlots > r.ban_matches) {
          issues.push({
            suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
            suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
            issue_code: 'BAN_SLOT_COUNT_MISMATCH',
            severity: 'error',
            details: `serving_match_ids has ${totalServingSlots} entries but ban_matches=${r.ban_matches}`,
          });
        }

        // served_completed_at consistency
        if (isComplete && servedSlots < r.ban_matches) {
          issues.push({
            suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
            suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
            issue_code: 'SERVED_COMPLETED_AT_INCONSISTENT',
            severity: 'warning',
            details: `served_completed_at is set but only ${servedSlots}/${r.ban_matches} slots are finished`,
          });
        }
        if (!isComplete && servedSlots >= r.ban_matches && r.ban_matches > 0) {
          issues.push({
            suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
            suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
            issue_code: 'SERVED_COMPLETED_AT_INCONSISTENT',
            severity: 'warning',
            details: `All ${r.ban_matches} ban slot(s) are finished but served_completed_at is null`,
          });
        }
      }
    }

    // Legacy/manual modification guards (should never change)
    for (const r of [...legacyRecords, ...manualRecords]) {
      if (r.suspension_type === 'manual') {
        const recentlyModified =
          r.updated_at && new Date(r.updated_at) > new Date(Date.now() - 86400000);
        if (recentlyModified) {
          issues.push({
            suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
            suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
            issue_code: 'MANUAL_RECORD_MODIFIED',
            severity: 'info',
            details: `Manual suspension record was updated in the last 24h at ${r.updated_at}`,
          });
        }
      }
    }

    // Aggregate summary
    const errorCount = issues.filter((i) => i.severity === 'error').length;
    const warningCount = issues.filter((i) => i.severity === 'warning').length;
    const infoCount = issues.filter((i) => i.severity === 'info').length;

    // Counts by issue code
    const issueCounts = issues.reduce((acc, i) => {
      acc[i.issue_code] = (acc[i.issue_code] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return NextResponse.json({
      checked_at: new Date().toISOString(),
      season_id: seasonId,
      age_group_id: ageGroupId ?? null,
      team_id: teamId ?? null,
      summary: {
        total_records: all.length,
        system_events: systemEvents.length,
        legacy_records: legacyRecords.length,
        manual_records: manualRecords.length,
        active_bans: activeBans.length,
        served_bans: servedBans.length,
        errors: errorCount,
        warnings: warningCount,
        infos: infoCount,
        total_issues: issues.length,
        healthy: issues.filter((i) => i.severity !== 'info').length === 0,
      },
      issue_counts: issueCounts,
      issues,
    });
  } catch (err: any) {
    console.error('[MONITORING] Error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal error' }, { status: 500 });
  }
}

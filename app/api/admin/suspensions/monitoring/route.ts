import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import {
  isSuspensionServingMatchAfterTrigger,
  selectNextSuspensionServingMatches,
} from '@/lib/suspension-shared';
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

interface MonitoringMatch {
  id: string;
  status: string;
  season_id: string;
  age_group_id: string;
  home_team_id: string;
  away_team_id: string;
  match_date: string | null;
  match_time: string | null;
  matchday: string | number | null;
  match_code: string;
}

interface MonitoringCard {
  id: string;
  player_id: string;
  match_id: string;
  card_type: string;
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
    const systemEvents = all.filter((r) =>
      SYSTEM_TYPES.some((type) => type === r.suspension_type)
    );
    const legacyRecords = all.filter(
      (r) => r.suspension_type == null || r.suspension_type === 'legacy'
    );
    const manualRecords = all.filter((r) => r.suspension_type === 'manual');
    const activeBans = systemEvents.filter(
      (r) => r.ban_matches > 0 && r.served_completed_at == null
    );
    const servedBans = systemEvents.filter(
      (r) => r.ban_matches > 0 && r.served_completed_at != null
    );

    // Collect all match IDs needed for reference validation.
    const allServingIds = [
      ...new Set(systemEvents.flatMap((r) => r.serving_match_ids || [])),
    ];
    const allTriggerIds = [
      ...new Set(systemEvents.map((r) => r.trigger_match_id).filter(Boolean) as string[]),
    ];
    const allSourceCardIds = [
      ...new Set(systemEvents.flatMap((r) => r.source_card_ids || [])),
    ];

    // Fetch referenced matches without season/age filters so wrong-scope references
    // remain visible and can be diagnosed instead of looking like missing rows.
    const matchMap = new Map<string, MonitoringMatch>();
    if (allServingIds.length > 0 || allTriggerIds.length > 0) {
      const allMatchIds = [...new Set([...allServingIds, ...allTriggerIds])];
      const { data: matchRows, error: matchRowsError } = await supabaseAdmin
        .from('matches')
        .select('id, status, season_id, age_group_id, home_team_id, away_team_id, match_date, match_time, matchday, match_code')
        .in('id', allMatchIds);
      if (matchRowsError) {
        return NextResponse.json({ error: matchRowsError.message }, { status: 500 });
      }
      for (const m of matchRows || []) matchMap.set(m.id, m);
    }

    // Separately load eligible-schedule candidates in the requested season scope.
    // This is what lets monitoring prove that an empty/no-next assignment is stale.
    let candidateQuery = supabaseAdmin
      .from('matches')
      .select('id, status, season_id, age_group_id, home_team_id, away_team_id, match_date, match_time, matchday, match_code')
      .eq('season_id', seasonId);
    if (ageGroupId) candidateQuery = candidateQuery.eq('age_group_id', ageGroupId);
    if (teamId) candidateQuery = candidateQuery.or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`);
    const { data: candidateRows, error: candidateError } = await candidateQuery;
    if (candidateError) {
      return NextResponse.json({ error: candidateError.message }, { status: 500 });
    }
    const candidateMatches = candidateRows || [];

    // Batch-fetch source card data
    const cardMap = new Map<string, MonitoringCard>();
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

      const isValidServingReference = (sm: MonitoringMatch | undefined) =>
        Boolean(
          sm &&
            (sm.status === 'scheduled' || sm.status === 'finished') &&
            sm.season_id === r.season_id &&
            sm.age_group_id === r.age_group_id &&
            (sm.home_team_id === r.team_id || sm.away_team_id === r.team_id) &&
            (!triggerMatch || isSuspensionServingMatchAfterTrigger(sm, triggerMatch))
        );

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
        } else if (sm.status === 'cancelled') {
          issues.push({
            suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
            suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
            issue_code: 'SERVING_MATCH_CANCELLED',
            severity: 'warning',
            details: `Serving match ${sId} is cancelled — refresh needed`,
          });
        } else if (sm.status !== 'scheduled' && sm.status !== 'finished') {
          issues.push({
            suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
            suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
            issue_code: 'SERVING_MATCH_INVALID_STATUS',
            severity: 'error',
            details: `Serving match ${sId} has invalid status ${sm.status}`,
          });
        }
        if (triggerMatch && !isSuspensionServingMatchAfterTrigger(sm, triggerMatch)) {
          issues.push({
            suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
            suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
            issue_code: 'SERVING_MATCH_BEFORE_TRIGGER',
            severity: 'error',
            details: `Serving match ${sId} is not chronologically after trigger ${r.trigger_match_id}`,
          });
        }
        if (sm.home_team_id !== r.team_id && sm.away_team_id !== r.team_id) {
          issues.push({
            suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
            suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
            issue_code: 'SERVING_MATCH_WRONG_TEAM',
            severity: 'error',
            details: `Serving match ${sId} does not involve team ${r.team_id}`,
          });
        }
        if (sm.season_id !== r.season_id) {
          issues.push({
            suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
            suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
            issue_code: 'SERVING_MATCH_WRONG_SEASON',
            severity: 'error',
            details: `Serving match ${sId} is in season ${sm.season_id}, expected ${r.season_id}`,
          });
        }
        if (sm.age_group_id !== r.age_group_id) {
          issues.push({
            suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
            suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
            issue_code: 'SERVING_MATCH_WRONG_AGE_GROUP',
            severity: 'error',
            details: `Serving match ${sId} is in age_group ${sm.age_group_id}, expected ${r.age_group_id}`,
          });
        }
      }

      // Ban slot count and readiness checks
      if (r.ban_matches > 0) {
        const servingIds: string[] = r.serving_match_ids || [];
        const totalServingSlots = servingIds.length;
        const validServingRows = servingIds
          .map((id) => matchMap.get(id))
          .filter((sm): sm is MonitoringMatch => isValidServingReference(sm));
        const servedIds = validServingRows
          .filter((sm) => sm.status === 'finished')
          .map((sm) => sm.id as string);
        const scheduledIds = validServingRows
          .filter((sm) => sm.status === 'scheduled')
          .map((sm) => sm.id as string);
        const servedSlots = servedIds.length;
        const remainingNeeded = Math.max(0, r.ban_matches - servedSlots);
        const isComplete = r.served_completed_at != null;

        if (!isComplete && remainingNeeded > 0) {
          if (scheduledIds.length === 0) {
            issues.push({
              suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
              suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
              issue_code: 'ACTIVE_BAN_WITHOUT_REMAINING_SCHEDULED_MATCH',
              severity: 'warning',
              details: `ban_matches=${r.ban_matches}, served=${servedSlots}, but no valid scheduled serving slot is assigned`,
            });
          }

          if (triggerMatch) {
            const eventCandidates = candidateMatches.filter(
              (m: MonitoringMatch) =>
                m.status === 'scheduled' &&
                m.season_id === r.season_id &&
                m.age_group_id === r.age_group_id &&
                (m.home_team_id === r.team_id || m.away_team_id === r.team_id)
            );
            const expectedFuture = selectNextSuspensionServingMatches(
              eventCandidates,
              triggerMatch,
              remainingNeeded,
              servedIds
            );
            const expectedIds = expectedFuture.map((m) => m.id);

            if (scheduledIds.length === 0 && expectedIds.length > 0) {
              issues.push({
                suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
                suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
                issue_code: 'ACTIVE_BAN_STALE_NO_NEXT_MATCH',
                severity: 'error',
                details: `No valid serving slot is assigned, but eligible future fixture(s) exist: ${expectedIds.join(', ')}`,
              });
            }

            const expectedAssignedPrefix = expectedIds.slice(0, scheduledIds.length);
            const assignmentIsStale =
              scheduledIds.length > 0 &&
              expectedAssignedPrefix.length === scheduledIds.length &&
              scheduledIds.some((id, index) => id !== expectedAssignedPrefix[index]);
            if (assignmentIsStale) {
              issues.push({
                suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
                suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
                issue_code: 'ACTIVE_BAN_STALE_ASSIGNMENT',
                severity: 'error',
                details: `Assigned remaining serving slot(s) ${scheduledIds.join(', ')} are not the earliest eligible fixture(s); expected ${expectedAssignedPrefix.join(', ')}`,
              });
            }

            if (expectedIds.length > scheduledIds.length) {
              issues.push({
                suspension_id: r.id, player_id: r.player_id, team_id: r.team_id,
                suspension_type: r.suspension_type, trigger_match_id: r.trigger_match_id,
                issue_code: 'ACTIVE_BAN_INCOMPLETE_ASSIGNMENT',
                severity: 'error',
                details: `Only ${scheduledIds.length}/${remainingNeeded} remaining serving slot(s) are assigned while eligible fixture(s) exist; expected ${expectedIds.join(', ')}`,
              });
            }
          }
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
            details: `served_completed_at is set but only ${servedSlots}/${r.ban_matches} valid slots are finished`,
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
  } catch (err: unknown) {
    console.error('[MONITORING] Error:', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

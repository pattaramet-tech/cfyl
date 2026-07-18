import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
import {
  previewStandingsOverride,
  saveStandingsOverride,
  StandingsOverrideError,
} from '@/lib/tournament/services/standingsOverride';
import { getBestThirdPlacedRanking, getCategoryStandings } from '@/lib/tournament/services/standings';
import type { BestThirdPlacedRankingResult, CrossGroupCandidate, StandingsRow } from '@/lib/tournament/standings/types';

export const dynamic = 'force-dynamic';

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

function serializeRow(row: StandingsRow) {
  return {
    team_id: row.teamId,
    team_name: row.teamName,
    team_code: row.teamCode,
    group_id: row.groupId,
    group_code: row.groupCode,
    position: row.position,
    played: row.played,
    won: row.won,
    lost: row.lost,
    goals_for: row.goalsFor,
    goals_against: row.goalsAgainst,
    goal_difference: row.goalDifference,
    points: row.points,
    fair_play_score: row.fairPlayScore,
    qualification_status: row.qualificationStatus,
    tiebreak_explanation: row.tiebreakExplanation,
    tie_state: row.tieState,
    override_applied: row.overrideApplied,
    override_reason: row.overrideReason,
    override_rejected_reason: row.overrideRejectedReason,
  };
}

function serializeCandidate(candidate: CrossGroupCandidate) {
  return {
    team_id: candidate.teamId,
    team_name: candidate.teamName,
    team_code: candidate.teamCode,
    group_id: candidate.groupId,
    group_code: candidate.groupCode,
    points: candidate.points,
    goal_difference: candidate.goalDifference,
    goals_for: candidate.goalsFor,
    fair_play_score: candidate.fairPlayScore,
    counted_matches: candidate.countedMatches,
  };
}

function serializeBestThirdPlacedRanking(ranking: BestThirdPlacedRankingResult) {
  return {
    state: ranking.state,
    fully_resolved: ranking.fullyResolved,
    explanation: ranking.explanation,
    ranked: ranking.ranked.map(serializeCandidate),
  };
}

async function resolveTournament(client: ReturnType<typeof getTournamentServiceClient>, tournamentSlug: string) {
  const { data, error } = await client
    .from('tournaments')
    .select('id, slug')
    .eq('slug', tournamentSlug)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; slug: string } | null;
}

/**
 * Admin standings view — official published results only, tiebreak
 * explanations, qualification status, and pending draw/override states.
 * Never reads or displays Quick Result payloads.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  const tournamentSlug = asText(request.nextUrl.searchParams.get('tournament_slug')).toLowerCase();
  const categoryCode = asText(request.nextUrl.searchParams.get('category_code')).toUpperCase();
  const groupCode = asText(request.nextUrl.searchParams.get('group_code')).toUpperCase();

  if (!tournamentSlug) return NextResponse.json({ error: 'tournament_slug is required' }, { status: 400 });
  if (!categoryCode) return NextResponse.json({ error: 'category_code is required' }, { status: 400 });

  try {
    const client = getTournamentServiceClient();
    const tournament = await resolveTournament(client, tournamentSlug);
    if (!tournament) {
      return NextResponse.json({ error: `Tournament ${tournamentSlug} not found` }, { status: 404 });
    }

    const categoryStandings = await getCategoryStandings({ client, tournamentId: tournament.id, categoryCode });
    const groups = groupCode
      ? categoryStandings.groups.filter((g) => g.groupCode.trim().toUpperCase() === groupCode)
      : categoryStandings.groups;

    // Cross-group best-third-place ranking only applies to 'ranked' method
    // categories — G-U16 (method='draw') is intentionally never ranked here;
    // it continues to use the separate identification-only candidate pool
    // surfaced via /api/tournament/admin/qualification-draws (PR #7).
    const bestThirdPlacedRanking =
      categoryStandings.bestThirdPlacedMethod === 'ranked' && categoryStandings.bestThirdPlacedCount > 0
        ? await getBestThirdPlacedRanking({ client, tournamentId: tournament.id, categoryCode })
        : null;

    return NextResponse.json({
      data: {
        category_id: categoryStandings.categoryId,
        category_code: categoryStandings.categoryCode,
        qualify_rank_per_group: categoryStandings.qualifyRankPerGroup,
        best_third_placed_count: categoryStandings.bestThirdPlacedCount,
        best_third_placed_method: categoryStandings.bestThirdPlacedMethod,
        best_third_placed_ranking: bestThirdPlacedRanking ? serializeBestThirdPlacedRanking(bestThirdPlacedRanking) : null,
        groups: groups.map((g) => ({
          group_id: g.groupId,
          group_code: g.groupCode,
          is_complete: g.isComplete,
          rows: g.rows.map(serializeRow),
        })),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface OverrideRequestBody {
  tournament_slug?: unknown;
  group_id?: unknown;
  team_id?: unknown;
  override_rank?: unknown;
  reason?: unknown;
  preview?: unknown;
  preview_token?: unknown;
}

/**
 * Manual standings override — Tournament Super Admin only. Two-step
 * Preview → Save flow, matching PR #9's Quick Result safety pattern
 * exactly: Save requires a server-signed preview_token proving a fresh
 * Preview actually happened (never trusts a client-side "I previewed this"
 * flag), and every scope constraint (tournament/group/team/rank/duplicate)
 * is re-validated on the server at both steps — see
 * lib/tournament/services/standingsOverride.ts. Writes exactly one active
 * row per (group_id, team_id) in tournament_standing_overrides (no
 * append-only table invented); change history lives in tournament_audit_logs.
 * Never rewrites raw Match results.
 */
export async function POST(request: NextRequest) {
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  let body: OverrideRequestBody;
  try {
    body = (await request.json()) as OverrideRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const tournamentSlug = asText(body.tournament_slug).toLowerCase();
  const groupId = asText(body.group_id);
  const teamId = asText(body.team_id);
  const reason = asText(body.reason);
  const overrideRank = Number(body.override_rank);
  const isPreview = body.preview === true;
  const previewToken = asText(body.preview_token);

  if (!tournamentSlug) return NextResponse.json({ error: 'tournament_slug is required' }, { status: 400 });
  if (!groupId) return NextResponse.json({ error: 'group_id is required' }, { status: 400 });
  if (!teamId) return NextResponse.json({ error: 'team_id is required' }, { status: 400 });

  try {
    const client = getTournamentServiceClient();
    const tournament = await resolveTournament(client, tournamentSlug);
    if (!tournament) {
      return NextResponse.json({ error: `Tournament ${tournamentSlug} not found` }, { status: 404 });
    }

    if (isPreview) {
      const preview = await previewStandingsOverride({
        client,
        tournamentId: tournament.id,
        groupId,
        teamId,
        overrideRank,
        reason,
        actorUserId: auth.userId || null,
      });
      return NextResponse.json({
        data: {
          preview: true,
          preview_token: preview.previewToken,
          preview_expires_at: preview.previewExpiresAt,
          before: preview.before ? { override_rank: preview.before.overrideRank, reason: preview.before.reason } : null,
          after: {
            group_id: preview.after.groupId,
            team_id: preview.after.teamId,
            override_rank: preview.after.overrideRank,
            reason: preview.after.reason,
          },
        },
      });
    }

    const result = await saveStandingsOverride({
      client,
      tournamentId: tournament.id,
      groupId,
      teamId,
      overrideRank,
      reason,
      actorUserId: auth.userId || null,
      actorEmail: auth.email || null,
      previewToken,
    });

    return NextResponse.json({
      data: {
        group_id: result.groupId,
        team_id: result.teamId,
        override_rank: result.overrideRank,
        reason: result.reason,
        audit_logged: result.auditLogged,
      },
    });
  } catch (error) {
    if (error instanceof StandingsOverrideError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

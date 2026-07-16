import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
import { logTournamentAdminAction } from '@/lib/tournament/services/audit';
import { getCategoryStandings } from '@/lib/tournament/services/standings';
import type { StandingsRow } from '@/lib/tournament/standings/types';

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

    return NextResponse.json({
      data: {
        category_id: categoryStandings.categoryId,
        category_code: categoryStandings.categoryCode,
        qualify_rank_per_group: categoryStandings.qualifyRankPerGroup,
        best_third_placed_count: categoryStandings.bestThirdPlacedCount,
        best_third_placed_method: categoryStandings.bestThirdPlacedMethod,
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
}

/**
 * Manual standings override — Tournament Super Admin only, requires a
 * reason, supports preview-before-save. Writes tournament_standing_overrides
 * (append-only history is provided by audit_logs, not a version column on
 * this table). Never rewrites raw Match results.
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

  if (!tournamentSlug) return NextResponse.json({ error: 'tournament_slug is required' }, { status: 400 });
  if (!groupId) return NextResponse.json({ error: 'group_id is required' }, { status: 400 });
  if (!teamId) return NextResponse.json({ error: 'team_id is required' }, { status: 400 });
  if (!reason) return NextResponse.json({ error: 'reason is required for a manual standings override' }, { status: 400 });
  if (!Number.isInteger(overrideRank) || overrideRank < 1) {
    return NextResponse.json({ error: 'override_rank must be a positive integer' }, { status: 400 });
  }

  try {
    const client = getTournamentServiceClient();
    const tournament = await resolveTournament(client, tournamentSlug);
    if (!tournament) {
      return NextResponse.json({ error: `Tournament ${tournamentSlug} not found` }, { status: 404 });
    }

    const { data: existing, error: existingError } = await client
      .from('tournament_standing_overrides')
      .select('group_id, team_id, override_rank, reason')
      .eq('group_id', groupId)
      .eq('team_id', teamId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    if (isPreview) {
      return NextResponse.json({
        data: {
          preview: true,
          before: existing || null,
          after: { group_id: groupId, team_id: teamId, override_rank: overrideRank, reason },
        },
      });
    }

    const { error: upsertError } = await client
      .from('tournament_standing_overrides')
      .upsert(
        { group_id: groupId, team_id: teamId, override_rank: overrideRank, reason, created_by: auth.userId || null },
        { onConflict: 'group_id,team_id' }
      );
    if (upsertError) throw new Error(upsertError.message);

    await logTournamentAdminAction({
      tournamentId: tournament.id,
      admin: { id: auth.userId, email: auth.email },
      action: 'standings.manual_override',
      entityType: 'standing-override',
      entityId: `${groupId}:${teamId}`,
      entityLabel: `group=${groupId} team=${teamId}`,
      oldData: existing || null,
      newData: { group_id: groupId, team_id: teamId, override_rank: overrideRank, reason },
    });

    return NextResponse.json({ data: { group_id: groupId, team_id: teamId, override_rank: overrideRank, reason } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { requireTournamentResultOperator } from '@/lib/tournament/services/auth';
import {
  loadFullMatchReportContext,
  previewFullMatchReport,
  publishFullMatchReport,
  FullMatchReportError,
  type FullMatchReportInput,
  type GoalEventInput,
  type CardEventInput,
} from '@/lib/tournament/services/fullMatchReport';

export const dynamic = 'force-dynamic';

interface GoalBodyItem {
  team_id?: unknown;
  player_id?: unknown;
  minute?: unknown;
  is_own_goal?: unknown;
  goals?: unknown;
  note?: unknown;
}

interface CardBodyItem {
  team_id?: unknown;
  player_id?: unknown;
  card_type?: unknown;
  minute?: unknown;
  note?: unknown;
}

interface FullReportRequestBody {
  tournament_slug?: unknown;
  venue_id?: unknown;
  regulation_home_score?: unknown;
  regulation_away_score?: unknown;
  penalty_home_score?: unknown;
  penalty_away_score?: unknown;
  decided_by?: unknown;
  winner_team_id?: unknown;
  goals?: unknown;
  cards?: unknown;
  report_text?: unknown;
  preview?: unknown;
  preview_token?: unknown;
  expected_version?: unknown;
  idempotency_key?: unknown;
}

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

function asGoals(value: unknown): GoalEventInput[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is GoalBodyItem => !!item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      teamId: asText(item.team_id),
      playerId: item.player_id ? asText(item.player_id) : null,
      minute: item.minute,
      isOwnGoal: item.is_own_goal === true,
      goals: item.goals,
      note: item.note ? asText(item.note) : null,
    }));
}

function asCards(value: unknown): CardEventInput[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is CardBodyItem => !!item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      teamId: asText(item.team_id),
      playerId: asText(item.player_id),
      cardType: item.card_type,
      minute: item.minute,
      note: item.note ? asText(item.note) : null,
    }));
}

function buildInput(body: FullReportRequestBody): FullMatchReportInput {
  return {
    regulationHomeScore: body.regulation_home_score,
    regulationAwayScore: body.regulation_away_score,
    penaltyHomeScore: body.penalty_home_score,
    penaltyAwayScore: body.penalty_away_score,
    decidedBy: body.decided_by,
    winnerTeamId: body.winner_team_id,
    reportText: body.report_text ? asText(body.report_text) : null,
    goals: asGoals(body.goals),
    cards: asCards(body.cards),
  };
}

async function resolveTournamentId(client: ReturnType<typeof getTournamentServiceClient>, tournamentSlug: string): Promise<string | null> {
  const { data, error } = await client.from('tournaments').select('id').eq('slug', tournamentSlug).is('deleted_at', null).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string } | null)?.id || null;
}

function errorStatus(code: string): number {
  if (code === 'FULL_REPORT_VERSION_CONFLICT') return 409;
  if (code === 'FULL_REPORT_MATCH_NOT_FOUND') return 404;
  if (code === 'FULL_REPORT_PUBLISH_RPC_UNAVAILABLE') return 503;
  // Every other FullMatchReportError — including the D-09 result-consistency
  // codes from validateResultConsistency.ts, which are not FULL_REPORT_
  // prefixed (e.g. PENALTY_SCORES_MUST_NOT_TIE) — represents a client-side
  // validation/business-rule problem, not a server fault.
  return 400;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;

  let body: FullReportRequestBody;
  try {
    body = (await request.json()) as FullReportRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const tournamentSlug = asText(body.tournament_slug).toLowerCase();
  if (!tournamentSlug) {
    return NextResponse.json({ error: 'tournament_slug is required' }, { status: 400 });
  }

  const client = getTournamentServiceClient();
  let tournamentId: string | null;
  try {
    tournamentId = await resolveTournamentId(client, tournamentSlug);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to resolve tournament' }, { status: 500 });
  }
  if (!tournamentId) {
    return NextResponse.json({ error: `Tournament ${tournamentSlug} not found` }, { status: 404 });
  }

  // Full Match Report / Official Publish requires Result-entry authorization
  // (result_operator or tournament_super_admin) — the same role check as
  // Quick Result. There is no public mutation route for this feature.
  const auth = await requireTournamentResultOperator(request, tournamentId);
  if (!auth.authenticated || !auth.authorized) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  const venueId = body.venue_id !== undefined && body.venue_id !== null ? asText(body.venue_id) : null;
  const isPreview = body.preview === true;
  const input = buildInput(body);

  try {
    if (isPreview) {
      const preview = await previewFullMatchReport({
        client,
        tournamentId,
        venueId,
        matchId,
        actorUserId: auth.userId || null,
        input,
      });

      return NextResponse.json({
        data: {
          preview: true,
          match_id: preview.matchId,
          match_code: preview.matchCode,
          current_version: preview.currentVersion,
          regulation_home_score: preview.scores.regulationHomeScore,
          regulation_away_score: preview.scores.regulationAwayScore,
          penalty_home_score: preview.scores.penaltyHomeScore,
          penalty_away_score: preview.scores.penaltyAwayScore,
          decided_by: preview.scores.decidedBy,
          winner_team_id: preview.scores.winnerTeamId,
          result_type: preview.scores.resultType,
          goals: preview.goals.map((g) => ({
            team_id: g.teamId,
            player_id: g.playerId,
            minute: g.minute,
            is_own_goal: g.isOwnGoal,
            goals: g.goals,
            note: g.note,
          })),
          cards: preview.cards.map((c) => ({
            team_id: c.teamId,
            player_id: c.playerId,
            card_type: c.cardType,
            minute: c.minute,
            note: c.note,
          })),
          report_text: preview.reportText,
          quick_result_comparison: {
            has_quick_result: preview.quickResultComparison.hasQuickResult,
            quick_result_home_score: preview.quickResultComparison.quickResultHomeScore,
            quick_result_away_score: preview.quickResultComparison.quickResultAwayScore,
            full_report_home_score: preview.quickResultComparison.fullReportHomeScore,
            full_report_away_score: preview.quickResultComparison.fullReportAwayScore,
            matches: preview.quickResultComparison.matches,
          },
          preview_token: preview.previewToken,
          preview_expires_at: preview.previewExpiresAt,
        },
      });
    }

    const expectedVersion = Number(body.expected_version);
    if (!Number.isInteger(expectedVersion)) {
      return NextResponse.json({ error: 'expected_version is required and must be an integer' }, { status: 400 });
    }
    const idempotencyKey = asText(body.idempotency_key);
    if (!idempotencyKey) {
      return NextResponse.json({ error: 'idempotency_key is required' }, { status: 400 });
    }
    const previewToken = asText(body.preview_token);

    // No app-layer logTournamentAdminAction call here on purpose: the
    // Official Publish RPC (tournament.publish_full_match_report, Migration
    // 014) already inserts exactly one tournament_audit_logs row INSIDE the
    // same atomic transaction as the publish itself (see the RPC's step 11).
    // Writing a second, independent audit entry from this route would be
    // both redundant and non-atomic with the publish — unlike PR #9's Quick
    // Result and PR #10's Standings Override, which never got a transaction
    // and so log from the app layer as a best-effort, separate step.
    const result = await publishFullMatchReport({
      client,
      tournamentId,
      venueId,
      matchId,
      expectedVersion,
      idempotencyKey,
      previewToken,
      actorUserId: auth.userId || null,
      actorEmail: auth.email || null,
      input,
    });

    return NextResponse.json({
      data: {
        submission_id: result.submissionId,
        match_id: result.matchId,
        new_match_version: result.newMatchVersion,
        published_at: result.publishedAt,
        idempotent: result.idempotent,
        status: 'published',
      },
    });
  } catch (error) {
    if (error instanceof FullMatchReportError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: errorStatus(error.code) });
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[FULL_MATCH_REPORT] unexpected error:', message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** Read-only context for the Full Match Report form: match identity, team
 * rosters, current publication status. Same auth gate as POST — this is not
 * a public route. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const tournamentSlug = asText(request.nextUrl.searchParams.get('tournament_slug')).toLowerCase();
  if (!tournamentSlug) {
    return NextResponse.json({ error: 'tournament_slug is required' }, { status: 400 });
  }

  const client = getTournamentServiceClient();
  let tournamentId: string | null;
  try {
    tournamentId = await resolveTournamentId(client, tournamentSlug);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to resolve tournament' }, { status: 500 });
  }
  if (!tournamentId) {
    return NextResponse.json({ error: `Tournament ${tournamentSlug} not found` }, { status: 404 });
  }

  const auth = await requireTournamentResultOperator(request, tournamentId);
  if (!auth.authenticated || !auth.authorized) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  try {
    const context = await loadFullMatchReportContext({ client, tournamentId, matchId });
    return NextResponse.json({
      data: {
        match_id: context.matchId,
        match_code: context.matchCode,
        match_no: context.matchNo,
        match_date: context.matchDate,
        match_time: context.matchTime,
        stage: context.stage,
        category_code: context.categoryCode,
        category_name: context.categoryName,
        group_code: context.groupCode,
        venue_name: context.venueName,
        court_name: context.courtName,
        home_team_id: context.homeTeamId,
        home_team_name: context.homeTeamName,
        away_team_id: context.awayTeamId,
        away_team_name: context.awayTeamName,
        home_team_players: context.homeTeamPlayers.map((p) => ({ id: p.id, full_name: p.fullName, shirt_no: p.shirtNo })),
        away_team_players: context.awayTeamPlayers.map((p) => ({ id: p.id, full_name: p.fullName, shirt_no: p.shirtNo })),
        current_version: context.currentVersion,
        result_workflow_status: context.resultWorkflowStatus,
        already_published: context.alreadyPublished,
      },
    });
  } catch (error) {
    if (error instanceof FullMatchReportError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: errorStatus(error.code) });
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

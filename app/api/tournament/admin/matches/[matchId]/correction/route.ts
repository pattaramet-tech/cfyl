import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
import {
  loadResultCorrectionContext,
  previewResultCorrection,
  publishResultCorrection,
  ResultCorrectionError,
  type CorrectedResultInput,
} from '@/lib/tournament/services/resultCorrection';

export const dynamic = 'force-dynamic';

interface CorrectionRequestBody {
  tournament_slug?: unknown;
  regulation_home_score?: unknown;
  regulation_away_score?: unknown;
  penalty_home_score?: unknown;
  penalty_away_score?: unknown;
  decided_by?: unknown;
  winner_team_id?: unknown;
  correction_reason?: unknown;
  preview?: unknown;
  preview_token?: unknown;
  expected_version?: unknown;
  idempotency_key?: unknown;
}

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

function buildInput(body: CorrectionRequestBody): CorrectedResultInput {
  return {
    regulationHomeScore: body.regulation_home_score,
    regulationAwayScore: body.regulation_away_score,
    penaltyHomeScore: body.penalty_home_score,
    penaltyAwayScore: body.penalty_away_score,
    decidedBy: body.decided_by,
    winnerTeamId: body.winner_team_id,
    correctionReason: asText(body.correction_reason),
  };
}

async function resolveTournamentId(client: ReturnType<typeof getTournamentServiceClient>, tournamentSlug: string): Promise<string | null> {
  const { data, error } = await client.from('tournaments').select('id').eq('slug', tournamentSlug).is('deleted_at', null).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string } | null)?.id || null;
}

function errorStatus(code: string): number {
  if (code === 'RESULT_CORRECTION_VERSION_CONFLICT') return 409;
  if (code === 'RESULT_CORRECTION_MATCH_NOT_FOUND') return 404;
  if (code === 'RESULT_CORRECTION_RPC_UNAVAILABLE') return 503;
  // Every other ResultCorrectionError — including the D-09 result-consistency
  // codes from validateResultConsistency.ts — represents a client-side
  // validation/business-rule problem, not a server fault.
  return 400;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;

  let body: CorrectionRequestBody;
  try {
    body = (await request.json()) as CorrectionRequestBody;
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

  // Result Correction requires tournament_super_admin — strictly stronger
  // than Full Match Report's result_operator-or-super_admin gate. The
  // Dedicated Shared Result-entry Account (role result_operator) must never
  // be able to correct a published result.
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  const isPreview = body.preview === true;
  const input = buildInput(body);

  try {
    if (isPreview) {
      const preview = await previewResultCorrection({
        client,
        tournamentId,
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
          before_result: {
            regulation_home_score: preview.beforeResult.regulationHomeScore,
            regulation_away_score: preview.beforeResult.regulationAwayScore,
            penalty_home_score: preview.beforeResult.penaltyHomeScore,
            penalty_away_score: preview.beforeResult.penaltyAwayScore,
            decided_by: preview.beforeResult.decidedBy,
            winner_team_id: preview.beforeResult.winnerTeamId,
            result_type: preview.beforeResult.resultType,
          },
          after_result: {
            regulation_home_score: preview.afterResult.regulationHomeScore,
            regulation_away_score: preview.afterResult.regulationAwayScore,
            penalty_home_score: preview.afterResult.penaltyHomeScore,
            penalty_away_score: preview.afterResult.penaltyAwayScore,
            decided_by: preview.afterResult.decidedBy,
            winner_team_id: preview.afterResult.winnerTeamId,
            result_type: preview.afterResult.resultType,
          },
          correction_reason: preview.correctionReason,
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
    // Correction RPC (tournament.correct_published_match_result, Migration
    // 018) already inserts exactly one tournament_audit_logs row INSIDE the
    // same atomic transaction as the correction itself.
    const result = await publishResultCorrection({
      client,
      tournamentId,
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
        corrected_at: result.correctedAt,
        idempotent: result.idempotent,
        status: 'corrected',
      },
    });
  } catch (error) {
    if (error instanceof ResultCorrectionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: errorStatus(error.code) });
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[RESULT_CORRECTION] unexpected error:', message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** Read-only context for the Result Correction form: match identity, team
 * names, current official result, and correction eligibility. Same strict
 * tournament_super_admin auth gate as POST — this is not a public route. */
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

  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  try {
    const context = await loadResultCorrectionContext({ client, tournamentId, matchId });
    return NextResponse.json({
      data: {
        match_id: context.matchId,
        match_code: context.matchCode,
        home_team_id: context.homeTeamId,
        home_team_name: context.homeTeamName,
        away_team_id: context.awayTeamId,
        away_team_name: context.awayTeamName,
        current_result: {
          regulation_home_score: context.currentResult.regulationHomeScore,
          regulation_away_score: context.currentResult.regulationAwayScore,
          penalty_home_score: context.currentResult.penaltyHomeScore,
          penalty_away_score: context.currentResult.penaltyAwayScore,
          decided_by: context.currentResult.decidedBy,
          winner_team_id: context.currentResult.winnerTeamId,
          result_type: context.currentResult.resultType,
        },
        current_version: context.currentVersion,
        result_workflow_status: context.resultWorkflowStatus,
        can_correct: context.canCorrect,
      },
    });
  } catch (error) {
    if (error instanceof ResultCorrectionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: errorStatus(error.code) });
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

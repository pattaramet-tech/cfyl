import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { requireTournamentResultOperator } from '@/lib/tournament/services/auth';
import {
  previewQuickResult,
  submitQuickResult,
  QuickResultError,
  type SubmitQuickResultResult,
} from '@/lib/tournament/services/quickResult';

export const dynamic = 'force-dynamic';

interface QuickResultRequestBody {
  tournament_slug?: unknown;
  venue_id?: unknown;
  home_score?: unknown;
  away_score?: unknown;
  expected_version?: unknown;
  idempotency_key?: unknown;
  preview?: unknown;
  preview_token?: unknown;
  session_id?: unknown;
  device_metadata?: unknown;
}

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

async function resolveTournamentId(
  client: ReturnType<typeof getTournamentServiceClient>,
  tournamentSlug: string
): Promise<string | null> {
  const { data, error } = await client
    .from('tournaments')
    .select('id')
    .eq('slug', tournamentSlug)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string } | null)?.id || null;
}

function errorStatus(code: string): number {
  if (code === 'QUICK_RESULT_VERSION_CONFLICT') return 409;
  if (code === 'QUICK_RESULT_PREVIEW_REQUIRED') return 409;
  if (code === 'MATCH_NOT_FOUND') return 404;
  if (
    [
      'MATCH_DELETED',
      'TOURNAMENT_MISMATCH',
      'VENUE_MATCH_MISMATCH',
      'MATCH_STATUS_INCOMPATIBLE',
      'RESULT_ALREADY_PUBLISHED',
      'HOME_TEAM_UNRESOLVED',
      'AWAY_TEAM_UNRESOLVED',
      'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
      'IDEMPOTENCY_KEY_REQUIRED',
      'QUICK_RESULT_PREVIEW_INVALID',
      'QUICK_RESULT_PREVIEW_EXPIRED',
      'QUICK_RESULT_PREVIEW_MISMATCH',
    ].includes(code) ||
    code.startsWith('HOME_SCORE_') ||
    code.startsWith('AWAY_SCORE_')
  ) {
    return 400;
  }
  return 500;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;

  let body: QuickResultRequestBody;
  try {
    body = (await request.json()) as QuickResultRequestBody;
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

  const auth = await requireTournamentResultOperator(request, tournamentId);
  if (!auth.authenticated || !auth.authorized) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  const venueId = body.venue_id !== undefined && body.venue_id !== null ? asText(body.venue_id) : null;
  const isPreview = body.preview === true;

  try {
    if (isPreview) {
      const preview = await previewQuickResult({
        client,
        tournamentId,
        venueId,
        matchId,
        homeScore: body.home_score,
        awayScore: body.away_score,
        actorUserId: auth.userId || null,
      });

      return NextResponse.json({
        data: {
          preview: true,
          match_id: preview.matchId,
          tournament_id: preview.tournamentId,
          category_code: preview.categoryCode,
          category_name: preview.categoryName,
          venue_id: preview.venueId,
          venue_name: preview.venueName,
          court_name: preview.courtName,
          match_code: preview.matchCode,
          match_no: preview.matchNo,
          match_date: preview.matchDate,
          match_time: preview.matchTime,
          home_team_name: preview.homeTeamName,
          away_team_name: preview.awayTeamName,
          home_score: preview.homeScore,
          away_score: preview.awayScore,
          current_version: preview.currentVersion,
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

    // Single-RPC write boundary (tournament.submit_quick_result, migration
    // 016): idempotency decision, version claim, submission insert,
    // result-version insert, and audit log all run inside one Postgres
    // transaction. There is deliberately no separate logTournamentAdminAction()
    // call here — a second, decoupled audit write after this returns would
    // reintroduce the exact non-atomicity this migration fixes.
    const result = (await submitQuickResult({
      client,
      tournamentId,
      venueId,
      matchId,
      homeScore: body.home_score,
      awayScore: body.away_score,
      expectedVersion,
      idempotencyKey,
      previewToken,
      actorUserId: auth.userId || null,
      actorEmail: auth.email || null,
      sessionId: body.session_id ? asText(body.session_id) : null,
      deviceMetadata: (body.device_metadata as Record<string, unknown> | undefined) || null,
    })) as SubmitQuickResultResult;

    return NextResponse.json({
      data: {
        submission_id: result.submissionId,
        match_id: result.matchId,
        home_score: result.homeScore,
        away_score: result.awayScore,
        previous_match_version: result.previousMatchVersion,
        new_match_version: result.newMatchVersion,
        status: result.status,
        idempotent: result.idempotent,
        provisional: true,
      },
    });
  } catch (error) {
    if (error instanceof QuickResultError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: errorStatus(error.code) });
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[QUICK_RESULT] unexpected error:', message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
import {
  loadQualificationCutoffDrawContext,
  previewQualificationCutoffDraw,
  saveQualificationCutoffDraw,
  QualificationCutoffDrawError,
} from '@/lib/tournament/services/qualification-cutoff-draws';

export const dynamic = 'force-dynamic';

interface QualificationCutoffDrawRequestBody {
  tournament_slug?: unknown;
  category_code?: unknown;
  group_code?: unknown;
  selected_team_ids?: unknown;
  note?: unknown;
  preview?: unknown;
  preview_token?: unknown;
  idempotency_key?: unknown;
}

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asText(item)).filter(Boolean);
}

async function resolveTournament(client: ReturnType<typeof getTournamentServiceClient>, tournamentSlug: string) {
  const { data, error } = await client.from('tournaments').select('id, slug').eq('slug', tournamentSlug).is('deleted_at', null).maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; slug: string } | null;
}

function errorStatus(code: string): number {
  if (code === 'QUALIFICATION_CUTOFF_DRAW_STALE_STATE' || code === 'QUALIFICATION_CUTOFF_DRAW_STALE_CANDIDATES') return 409;
  if (code === 'QUALIFICATION_CUTOFF_DRAW_GROUP_NOT_FOUND' || code === 'QUALIFICATION_CUTOFF_DRAW_CATEGORY_NOT_FOUND') return 404;
  if (code === 'QUALIFICATION_CUTOFF_DRAW_RPC_UNAVAILABLE') return 503;
  return 400;
}

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
  if (!groupCode) return NextResponse.json({ error: 'group_code is required' }, { status: 400 });

  try {
    const client = getTournamentServiceClient();
    const tournament = await resolveTournament(client, tournamentSlug);
    if (!tournament) return NextResponse.json({ error: `Tournament ${tournamentSlug} not found` }, { status: 404 });

    const context = await loadQualificationCutoffDrawContext({ client, tournamentId: tournament.id, categoryCode, groupCode });

    return NextResponse.json({
      data: {
        category_id: context.categoryId,
        group_id: context.groupId,
        group_code: context.groupCode,
        active_draw_id: context.activeDrawId,
        automatic_qualifiers: context.automaticQualifiers.map((t) => ({ team_id: t.teamId, team_name: t.teamName, team_code: t.teamCode })),
        automatic_eliminated: context.automaticEliminated.map((t) => ({ team_id: t.teamId, team_name: t.teamName, team_code: t.teamCode })),
        draw_candidates: context.drawCandidates.map((t) => ({ team_id: t.teamId, team_name: t.teamName, team_code: t.teamCode })),
        available_slots: context.availableSlots,
        selected_by_draw: context.selectedByDraw,
        eliminated_by_draw: context.eliminatedByDraw,
        qualification_state: context.qualificationState,
        explanation: context.explanation,
        cutoff_position: context.cutoffPosition,
        cutoff_points: context.cutoffPoints,
        candidate_snapshot: context.candidateSnapshot,
        versions: context.versions.map((v) => ({
          draw_id: v.drawId,
          version: v.version,
          is_active: v.isActive,
          drawn_by: v.drawnBy,
          drawn_at: v.drawnAt,
          note: v.note,
          available_slots: v.availableSlots,
          candidates: v.candidates.map((c) => ({
            team_id: c.teamId,
            team_code: c.teamCode,
            team_name: c.teamName,
            points_at_draw: c.pointsAtDraw,
            is_selected: c.isSelected,
          })),
        })),
      },
    });
  } catch (error) {
    if (error instanceof QualificationCutoffDrawError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: errorStatus(error.code) });
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  let body: QualificationCutoffDrawRequestBody;
  try {
    body = (await request.json()) as QualificationCutoffDrawRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const tournamentSlug = asText(body.tournament_slug).toLowerCase();
  const categoryCode = asText(body.category_code).toUpperCase();
  const groupCode = asText(body.group_code).toUpperCase();
  const selectedTeamIds = asStringArray(body.selected_team_ids);

  if (!tournamentSlug) return NextResponse.json({ error: 'tournament_slug is required' }, { status: 400 });
  if (!categoryCode) return NextResponse.json({ error: 'category_code is required' }, { status: 400 });
  if (!groupCode) return NextResponse.json({ error: 'group_code is required' }, { status: 400 });

  const isPreview = body.preview === true;

  try {
    const client = getTournamentServiceClient();
    const tournament = await resolveTournament(client, tournamentSlug);
    if (!tournament) return NextResponse.json({ error: `Tournament ${tournamentSlug} not found` }, { status: 404 });

    if (isPreview) {
      const preview = await previewQualificationCutoffDraw({
        client,
        tournamentId: tournament.id,
        categoryCode,
        groupCode,
        selectedTeamIds,
        actorUserId: auth.userId || null,
      });

      return NextResponse.json({
        data: {
          preview: true,
          category_id: preview.categoryId,
          group_id: preview.groupId,
          group_code: preview.groupCode,
          active_draw_id: preview.activeDrawId,
          draw_candidates: preview.drawCandidates.map((t) => ({ team_id: t.teamId, team_name: t.teamName, team_code: t.teamCode })),
          available_slots: preview.availableSlots,
          selected_team_ids: preview.selectedTeamIds,
          candidate_snapshot: preview.candidateSnapshot,
          preview_token: preview.previewToken,
          preview_expires_at: preview.previewExpiresAt,
        },
      });
    }

    const previewToken = asText(body.preview_token);
    const idempotencyKey = asText(body.idempotency_key);
    if (!idempotencyKey) {
      return NextResponse.json({ error: 'idempotency_key is required' }, { status: 400 });
    }

    // No app-layer logTournamentAdminAction call here on purpose: the
    // Migration 019 RPC already inserts exactly one tournament_audit_logs
    // row inside the same atomic transaction as the save itself.
    const result = await saveQualificationCutoffDraw({
      client,
      tournamentId: tournament.id,
      categoryCode,
      groupCode,
      selectedTeamIds,
      previewToken,
      idempotencyKey,
      note: body.note ? asText(body.note) : null,
      actorUserId: auth.userId || null,
      actorEmail: auth.email || null,
    });

    return NextResponse.json({
      data: {
        draw_id: result.drawId,
        version: result.version,
        available_slots: result.availableSlots,
        selected_team_ids: result.selectedTeamIds,
        idempotent: result.idempotent,
        status: 'recorded',
      },
    });
  } catch (error) {
    if (error instanceof QualificationCutoffDrawError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: errorStatus(error.code) });
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[QUALIFICATION_CUTOFF_DRAW] unexpected error:', message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

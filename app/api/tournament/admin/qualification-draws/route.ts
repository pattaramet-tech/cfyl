import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
import { logTournamentAdminAction } from '@/lib/tournament/services/audit';
import {
  getQualificationDrawState,
  previewQualificationDrawSelections,
  saveQualificationDrawSelections,
  type PreviewQualificationDrawSelectionsResult,
  type SaveQualificationDrawSelectionsResult,
} from '@/lib/tournament/services/qualification-draws';

export const dynamic = 'force-dynamic';

interface QualificationDrawRequestBody {
  tournament_slug?: unknown;
  category_code?: unknown;
  candidate_team_ids?: unknown;
  selections?: unknown;
  note?: unknown;
  preview?: unknown;
}

interface SelectionBodyItem {
  source_ref?: unknown;
  team_id?: unknown;
}

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((item) => asText(item)).filter(Boolean);
}

function asSelections(value: unknown): Array<{ sourceRef: string; teamId: string }> | null {
  if (!Array.isArray(value)) return null;

  return value
    .filter((item): item is SelectionBodyItem => !!item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      sourceRef: asText(item.source_ref).toUpperCase(),
      teamId: asText(item.team_id),
    }));
}

function isValidationErrorMessage(message: string): boolean {
  return [
    'not found',
    'Unknown draw_selected',
    'Invalid draw_selected source_ref format',
    'does not belong to category',
    'does not belong to this category',
    'no configuration support',
    'draw_selected configuration support',
    'requires a team_id',
    'cannot resolve to the same team',
    'not an eligible third-place team',
    'Missing draw selection',
    'Duplicate draw_selected source_ref',
    'Multiple active qualification draws',
    'candidate teams are required',
    'Duplicate candidate team',
  ].some((needle) => message.includes(needle));
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

export async function GET(request: NextRequest) {
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  const tournamentSlug = asText(request.nextUrl.searchParams.get('tournament_slug')).toLowerCase();
  const categoryCode = asText(request.nextUrl.searchParams.get('category_code')).toUpperCase();

  if (!tournamentSlug) {
    return NextResponse.json({ error: 'tournament_slug is required' }, { status: 400 });
  }
  if (!categoryCode) {
    return NextResponse.json({ error: 'category_code is required' }, { status: 400 });
  }

  try {
    const client = getTournamentServiceClient();
    const tournament = await resolveTournament(client, tournamentSlug);
    if (!tournament) {
      return NextResponse.json({ error: `Tournament ${tournamentSlug} not found` }, { status: 404 });
    }

    const state = await getQualificationDrawState({
      client,
      tournamentId: tournament.id,
      categoryCode,
    });

    return NextResponse.json({
      data: {
        category_id: state.categoryId,
        candidate_options: state.candidateOptions.map((option) => ({
          team_id: option.teamId,
          team_code: option.teamCode,
          team_name: option.teamName,
        })),
        placeholder_source_refs: state.placeholderSourceRefs,
        versions: state.versions.map((version) => ({
          draw_id: version.drawId,
          version: version.version,
          is_active: version.isActive,
          drawn_by: version.drawnBy,
          drawn_at: version.drawnAt,
          note: version.note,
          is_manual_candidate_confirmation: version.isManualCandidateConfirmation,
          candidates: version.candidates.map((candidate) => ({
            team_id: candidate.teamId,
            team_code: candidate.teamCode,
            team_name: candidate.teamName,
            is_selected: candidate.isSelected,
            draw_order: candidate.drawOrder,
          })),
        })),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = isValidationErrorMessage(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  let body: QualificationDrawRequestBody;
  try {
    body = (await request.json()) as QualificationDrawRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const tournamentSlug = asText(body.tournament_slug).toLowerCase();
  const categoryCode = asText(body.category_code).toUpperCase();
  const note = asText(body.note);
  const candidateTeamIds = asStringArray(body.candidate_team_ids);
  const selections = asSelections(body.selections);

  if (!tournamentSlug) {
    return NextResponse.json({ error: 'tournament_slug is required' }, { status: 400 });
  }
  if (!categoryCode) {
    return NextResponse.json({ error: 'category_code is required' }, { status: 400 });
  }
  if (!candidateTeamIds || candidateTeamIds.length === 0) {
    return NextResponse.json(
      { error: 'candidate_team_ids is required — the admin must manually confirm the eligible candidates first' },
      { status: 400 }
    );
  }
  if (!selections || selections.length === 0) {
    return NextResponse.json({ error: 'selections are required' }, { status: 400 });
  }

  const isPreview = body.preview === true;

  try {
    const client = getTournamentServiceClient();
    const tournament = await resolveTournament(client, tournamentSlug);
    if (!tournament) {
      return NextResponse.json({ error: `Tournament ${tournamentSlug} not found` }, { status: 404 });
    }

    if (isPreview) {
      // Read-only: validates the same way Save does, but never writes a draw
      // row, candidate rows, or match updates.
      const preview = (await previewQualificationDrawSelections({
        client,
        tournamentId: tournament.id,
        categoryCode,
        candidateTeamIds,
        assignments: selections,
      })) as PreviewQualificationDrawSelectionsResult;

      return NextResponse.json({
        data: {
          preview: true,
          affected_matches: preview.affectedMatches.map((match) => ({
            match_id: match.matchId,
            match_code: match.matchCode,
            side: match.side,
            source_ref: match.sourceRef,
            current_team_id: match.currentTeamId,
            resolved_team_id: match.resolvedTeamId,
            resolved_team_code: match.resolvedTeamCode,
            resolved_team_name: match.resolvedTeamName,
          })),
        },
      });
    }

    const result = (await saveQualificationDrawSelections({
      client,
      tournamentId: tournament.id,
      categoryCode,
      candidateTeamIds,
      assignments: selections,
      note: note || undefined,
      actorUserId: auth.userId || null,
    })) as SaveQualificationDrawSelectionsResult;

    await logTournamentAdminAction({
      tournamentId: tournament.id,
      admin: { id: auth.userId, email: auth.email },
      action: 'qualification-draws.confirm_manual_placeholder_assignment',
      entityType: 'qualification-draw',
      entityId: result.drawId,
      entityLabel: `${categoryCode} ${result.selectedSourceRefs.join(', ')}`,
      newData: {
        category_code: categoryCode,
        candidate_team_ids: candidateTeamIds,
        selections,
        updated_match_ids: result.updatedMatchIds,
        source: 'manual_candidate_confirmation',
      },
    });

    return NextResponse.json({
      data: {
        draw_id: result.drawId,
        version: result.version,
        updated_match_ids: result.updatedMatchIds,
        selected_source_refs: result.selectedSourceRefs,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = isValidationErrorMessage(message) ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

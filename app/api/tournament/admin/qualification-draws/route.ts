import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
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
  expected_active_draw_id?: unknown;
}

interface SelectionBodyItem {
  source_ref?: unknown;
  team_id?: unknown;
}

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

function asNullableUuid(value: unknown): string | null {
  const text = asText(value);
  return text.length > 0 ? text : null;
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

function isStaleStateErrorMessage(message: string): boolean {
  return message.includes('QUALIFICATION_DRAW_STALE_STATE');
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
    // Authoritative errors raised by tournament.save_qualification_draw_assignment
    // (migration 015) — the RPC re-validates everything the TS pre-validation
    // above already checks, plus tournament/category/config state it doesn't.
    'QUALIFICATION_DRAW_TOURNAMENT_NOT_FOUND',
    'QUALIFICATION_DRAW_TOURNAMENT_NOT_ACTIVE',
    'QUALIFICATION_DRAW_CATEGORY_NOT_FOUND',
    'QUALIFICATION_DRAW_CONFIG_NOT_FOUND',
    'QUALIFICATION_DRAW_INVALID_CANDIDATE_COUNT',
    'QUALIFICATION_DRAW_DUPLICATE_CANDIDATE',
    'QUALIFICATION_DRAW_CANDIDATE_NOT_IN_CATEGORY',
    'QUALIFICATION_DRAW_INVALID_ASSIGNMENT_COUNT',
    'QUALIFICATION_DRAW_DUPLICATE_ASSIGNMENT_REF',
    'QUALIFICATION_DRAW_UNKNOWN_ASSIGNMENT_REF',
    'QUALIFICATION_DRAW_ASSIGNMENT_NOT_CANDIDATE',
    'QUALIFICATION_DRAW_DUPLICATE_ASSIGNMENT_TEAM',
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
        active_draw_id: state.activeDrawId,
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
  const expectedActiveDrawId = asNullableUuid(body.expected_active_draw_id);

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
          active_draw_id: preview.activeDrawId,
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

    // Single-RPC write boundary (tournament.save_qualification_draw_assignment,
    // migration 015): supersede -> insert draw -> insert candidates -> resolve
    // Matches -> write audit log all run inside one Postgres transaction. There
    // is deliberately no separate logTournamentAdminAction() call here — a
    // second, decoupled audit write after this returns would reintroduce the
    // exact non-atomicity this migration fixes (a fully successful Save with a
    // silently-failed audit insert). expected_active_draw_id is the optimistic
    // concurrency token: null for an initial Save (must find no active draw),
    // or the exact currently-active draw id for a correction (must still be
    // active) — a mismatch fails closed with QUALIFICATION_DRAW_STALE_STATE and
    // zero writes, mapped to HTTP 409 below.
    const result = (await saveQualificationDrawSelections({
      client,
      tournamentId: tournament.id,
      categoryCode,
      candidateTeamIds,
      assignments: selections,
      expectedActiveDrawId,
      note: note || undefined,
      actorUserId: auth.userId || null,
      actorEmail: auth.email || null,
    })) as SaveQualificationDrawSelectionsResult;

    return NextResponse.json({
      data: {
        draw_id: result.drawId,
        version: result.version,
        updated_match_ids: result.updatedMatchIds,
        selected_source_refs: result.selectedSourceRefs,
        previous_draw_id: result.previousDrawId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';

    if (isStaleStateErrorMessage(message)) {
      return NextResponse.json(
        {
          error: 'ข้อมูลผลจับฉลากมีการเปลี่ยนแปลงตั้งแต่ครั้งล่าสุดที่โหลด กรุณาโหลดข้อมูลใหม่แล้วลองอีกครั้ง',
          code: 'QUALIFICATION_DRAW_STALE_STATE',
        },
        { status: 409 }
      );
    }

    const status = isValidationErrorMessage(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

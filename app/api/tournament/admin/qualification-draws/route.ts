import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
import { logTournamentAdminAction } from '@/lib/tournament/services/audit';
import {
  saveQualificationDrawSelections,
  type SaveQualificationDrawSelectionsResult,
} from '@/lib/tournament/services/qualification-draws';

export const dynamic = 'force-dynamic';

interface QualificationDrawRequestBody {
  tournament_slug?: unknown;
  category_code?: unknown;
  selections?: unknown;
  note?: unknown;
}

interface SelectionBodyItem {
  source_ref?: unknown;
  team_id?: unknown;
}

function asText(value: unknown): string {
  return String(value ?? '').trim();
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
    'no configuration support',
    'draw_selected configuration support',
    'requires a team_id',
    'cannot resolve to the same team',
    'not an eligible third-place team',
    'Missing draw selection',
    'Duplicate draw_selected source_ref',
    'Multiple active qualification draws',
  ].some((needle) => message.includes(needle));
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
  const selections = asSelections(body.selections);

  if (!tournamentSlug) {
    return NextResponse.json({ error: 'tournament_slug is required' }, { status: 400 });
  }
  if (!categoryCode) {
    return NextResponse.json({ error: 'category_code is required' }, { status: 400 });
  }
  if (!selections || selections.length === 0) {
    return NextResponse.json({ error: 'selections are required' }, { status: 400 });
  }

  try {
    const client = getTournamentServiceClient();
    const { data: tournamentData, error: tournamentError } = await client
      .from('tournaments')
      .select('id, slug')
      .eq('slug', tournamentSlug)
      .is('deleted_at', null)
      .maybeSingle();

    if (tournamentError) {
      return NextResponse.json({ error: tournamentError.message }, { status: 500 });
    }
    if (!tournamentData) {
      return NextResponse.json({ error: `Tournament ${tournamentSlug} not found` }, { status: 404 });
    }

    const result = (await saveQualificationDrawSelections({
      client,
      tournamentId: String(tournamentData.id),
      categoryCode,
      assignments: selections,
      note: note || undefined,
      actorUserId: auth.userId || null,
    })) as SaveQualificationDrawSelectionsResult;

    await logTournamentAdminAction({
      tournamentId: String(tournamentData.id),
      admin: { id: auth.userId, email: auth.email },
      action: 'qualification-draws.save',
      entityType: 'qualification-draw',
      entityId: result.drawId,
      entityLabel: `${categoryCode} ${result.selectedSourceRefs.join(', ')}`,
      newData: {
        category_code: categoryCode,
        selections,
        updated_match_ids: result.updatedMatchIds,
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

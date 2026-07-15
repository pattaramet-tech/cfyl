import { NextRequest, NextResponse } from 'next/server';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
import { logTournamentAdminAction } from '@/lib/tournament/services/audit';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  try {
    const rawTournamentSlug = request.nextUrl.searchParams.get('tournament_slug');
    const rawCategoryCode = request.nextUrl.searchParams.get('category_code');

    if (!rawTournamentSlug || !rawCategoryCode) {
      return NextResponse.json(
        { error: 'tournament_slug and category_code required' },
        { status: 400 }
      );
    }

    // Server-side normalization
    const tournamentSlug = rawTournamentSlug.trim().toLowerCase();
    const categoryCode = rawCategoryCode.trim().toUpperCase();

    const client = getTournamentServiceClient();

    // Resolve tournament by slug
    const { data: tournament, error: tourError } = await client
      .from('tournaments')
      .select('id')
      .eq('slug', tournamentSlug)
      .is('deleted_at', null)
      .single();

    if (tourError || !tournament) {
      console.error('[DRAW_ASSIGNMENTS_GET] tournament not found:', tourError);
      return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
    }

    // Resolve category by tournament_id + code
    const { data: category, error: catError } = await client
      .from('tournament_categories')
      .select('id')
      .eq('tournament_id', tournament.id)
      .eq('code', categoryCode)
      .is('deleted_at', null)
      .single();

    if (catError || !category) {
      console.error('[DRAW_ASSIGNMENTS_GET] category not found:', catError);
      return NextResponse.json({ error: `Category ${categoryCode} not found` }, { status: 404 });
    }

    const { data, error } = await client
      .from('tournament_draw_assignments')
      .select(
        `
        id,
        category_id,
        group_id,
        slot_code,
        team_id,
        version,
        assigned_at,
        tournament_teams!inner(id, name, team_code)
        `
      )
      .eq('category_id', category.id)
      .is('superseded_at', null);

    if (error) {
      console.error('[DRAW_ASSIGNMENTS_GET] db error:', error);
      return NextResponse.json({ error: 'Failed to fetch assignments' }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('[DRAW_ASSIGNMENTS_GET] error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    await logTournamentAdminAction({
      admin: auth.userId ? { id: auth.userId, email: auth.email } : undefined,
      action: 'draw-assignments.create',
      entityType: 'draw-assignment',
    });
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { tournament_slug, category_code, group_code, slot_code, team_name, team_code } = body;

    if (!tournament_slug || !category_code || !group_code || !slot_code || !team_name || !team_code) {
      await logTournamentAdminAction({
        admin: { id: auth.userId, email: auth.email },
        action: 'draw-assignments.create',
        entityType: 'draw-assignment',
        newData: body,
      });
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Server-side normalization
    const normalizedTournamentSlug = tournament_slug.trim().toLowerCase();
    const normalizedCategoryCode = category_code.trim().toUpperCase();
    const normalizedGroupCode = group_code.trim().toUpperCase();

    // Validate slot prefix matches group code (after normalization)
    const slotPrefix = slot_code.split('-')[0].toUpperCase();
    if (slotPrefix !== normalizedGroupCode) {
      return NextResponse.json(
        { error: `Slot code ${slot_code} must start with group ${normalizedGroupCode} (e.g., ${normalizedGroupCode}-S1)` },
        { status: 400 }
      );
    }

    const client = getTournamentServiceClient();

    // Resolve tournament by slug
    const { data: tournament, error: tourError } = await client
      .from('tournaments')
      .select('id')
      .eq('slug', normalizedTournamentSlug)
      .is('deleted_at', null)
      .single();

    if (tourError || !tournament) {
      console.error('[DRAW_ASSIGNMENTS_POST] tournament not found:', tourError);
      return NextResponse.json({ error: `Tournament ${tournament_slug} not found` }, { status: 404 });
    }

    // Resolve category by tournament_id + code
    const { data: category, error: catError } = await client
      .from('tournament_categories')
      .select('id')
      .eq('tournament_id', tournament.id)
      .eq('code', normalizedCategoryCode)
      .is('deleted_at', null)
      .single();

    if (catError || !category) {
      console.error('[DRAW_ASSIGNMENTS_POST] category not found:', catError);
      return NextResponse.json({ error: `Category ${normalizedCategoryCode} not found` }, { status: 404 });
    }

    // Resolve group by tournament_id + category_id + code
    const { data: group, error: groupError } = await client
      .from('tournament_groups')
      .select('id, tournament_id, category_id, code, name')
      .eq('tournament_id', tournament.id)
      .eq('category_id', category.id)
      .eq('code', normalizedGroupCode)
      .maybeSingle();

    if (groupError) {
      console.error('[DRAW_ASSIGNMENTS_POST] Group lookup failed', {
        tournamentSlug: normalizedTournamentSlug,
        categoryCode: normalizedCategoryCode,
        groupCode: normalizedGroupCode,
        message: groupError.message,
        code: groupError.code,
      });

      return NextResponse.json(
        {
          error: 'Failed to look up tournament group',
          detail:
            process.env.NODE_ENV === 'development'
              ? groupError.message
              : undefined,
        },
        { status: 500 }
      );
    }

    if (!group) {
      return NextResponse.json(
        {
          error: `Group ${normalizedGroupCode} not found in category ${normalizedCategoryCode}`,
        },
        { status: 404 }
      );
    }

    // Get or create tournament_teams row
    const { data: existingTeam } = await client
      .from('tournament_teams')
      .select('id')
      .eq('category_id', category.id)
      .eq('team_code', team_code)
      .is('deleted_at', null)
      .single();

    let teamId: string;

    if (existingTeam) {
      teamId = existingTeam.id;
    } else {
      const { data: newTeam, error: teamInsertError } = await client
        .from('tournament_teams')
        .insert({
          tournament_id: tournament.id,
          category_id: category.id,
          name: team_name,
          team_code,
          created_by: auth.userId,
        })
        .select('id')
        .single();

      if (teamInsertError || !newTeam) {
        console.error('[DRAW_ASSIGNMENTS_POST] team insert failed:', teamInsertError);
        return NextResponse.json({ error: 'Failed to create team' }, { status: 500 });
      }

      teamId = newTeam.id;
    }

    // Supersede any existing assignment for this slot
    await client
      .from('tournament_draw_assignments')
      .update({ superseded_at: new Date().toISOString() })
      .eq('group_id', group.id)
      .eq('slot_code', slot_code)
      .is('superseded_at', null);

    // Insert new assignment
    const { data: assignment, error: assignError } = await client
      .from('tournament_draw_assignments')
      .insert({
        category_id: category.id,
        group_id: group.id,
        slot_code,
        team_id: teamId,
        assigned_by: auth.userId,
      })
      .select()
      .single();

    if (assignError || !assignment) {
      console.error('[DRAW_ASSIGNMENTS_POST] insert failed:', assignError);
      return NextResponse.json({ error: 'Failed to save assignment' }, { status: 500 });
    }

    await logTournamentAdminAction({
      admin: { id: auth.userId, email: auth.email },
      action: 'draw-assignments.create',
      entityType: 'draw-assignment',
      entityId: assignment.id,
      entityLabel: `${group_code}-${slot_code}: ${team_name}`,
      newData: { tournament_slug, category_code, group_code, slot_code, team_name, team_code },
    });

    return NextResponse.json({ data: assignment }, { status: 201 });
  } catch (err) {
    console.error('[DRAW_ASSIGNMENTS_POST] error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

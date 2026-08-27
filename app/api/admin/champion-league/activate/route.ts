import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminAuth, badRequestResponse, internalErrorResponse } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
import { buildRegularLeagueStandings } from '@/lib/league-standings';
import {
  getRegularLeagueActivationReadiness,
  parseChampionLeagueQualifierSnapshot,
  type ChampionLeagueQualifier,
} from '@/lib/champion-league';
import type { Match } from '@/types/db';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated || !authResult.profile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!authResult.profile.can_edit_matches) {
      return NextResponse.json(
        { error: 'You do not have permission to edit matches' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const seasonId = typeof body.season_id === 'string' ? body.season_id : '';
    const ageGroupId = typeof body.age_group_id === 'string' ? body.age_group_id : '';
    const divisionId = typeof body.division_id === 'string' ? body.division_id : '';

    if (!seasonId || !ageGroupId || !divisionId) {
      return badRequestResponse('season_id, age_group_id and division_id are required');
    }

    const { data: existingSnapshot, error: existingError } = await supabaseAdmin
      .from('league_champion_league_snapshots')
      .select('*')
      .eq('season_id', seasonId)
      .eq('age_group_id', ageGroupId)
      .eq('division_id', divisionId)
      .maybeSingle();

    if (existingError) {
      console.error('[CHAMPION_LEAGUE_ACTIVATE] snapshot lookup error:', existingError);
      return internalErrorResponse('Failed to check Champion League activation');
    }

    if (existingSnapshot) {
      const existingQualifiers = parseChampionLeagueQualifierSnapshot(existingSnapshot.qualifiers);
      if (!existingQualifiers) {
        return internalErrorResponse('Champion League snapshot is invalid');
      }
      return NextResponse.json({
        active: true,
        already_active: true,
        activated_at: existingSnapshot.activated_at,
        qualifiers: existingQualifiers,
      });
    }

    const [matchesResult, teamsResult] = await Promise.all([
      supabaseAdmin
        .from('matches')
        .select('*')
        .eq('season_id', seasonId)
        .eq('age_group_id', ageGroupId)
        .eq('division_id', divisionId),
      supabaseAdmin
        .from('teams')
        .select('id, name, short_name, logo_url, active')
        .eq('season_id', seasonId)
        .eq('age_group_id', ageGroupId)
        .eq('division_id', divisionId)
        .eq('active', true),
    ]);

    if (matchesResult.error) {
      console.error('[CHAMPION_LEAGUE_ACTIVATE] match lookup error:', matchesResult.error);
      return internalErrorResponse('Failed to validate regular league matches');
    }
    if (teamsResult.error) {
      console.error('[CHAMPION_LEAGUE_ACTIVATE] team lookup error:', teamsResult.error);
      return internalErrorResponse('Failed to validate regular league teams');
    }

    const matches = (matchesResult.data || []) as Match[];
    const teams = teamsResult.data || [];
    const readiness = getRegularLeagueActivationReadiness(
      matches,
      teams.map((team) => team.id)
    );

    if (!readiness.ready) {
      return NextResponse.json(
        {
          error: 'Regular league is not complete; Champion League cannot be activated',
          readiness,
        },
        { status: 409 }
      );
    }

    const regularStandings = buildRegularLeagueStandings(matches, teams, {
      seasonId,
      ageGroupId,
      divisionId,
    });
    if (regularStandings.length < 4) {
      return NextResponse.json(
        { error: 'At least four ranked teams are required to activate Champion League' },
        { status: 409 }
      );
    }

    const qualifiers: ChampionLeagueQualifier[] = regularStandings.slice(0, 4).map((row, index) => ({
      team_id: row.team_id,
      league_rank: index + 1,
      team_name: row.team_name,
      team_short_name: row.team_short_name,
      team_logo_url: row.team_logo_url,
    }));

    const { data: insertedSnapshot, error: insertError } = await supabaseAdmin
      .from('league_champion_league_snapshots')
      .insert({
        season_id: seasonId,
        age_group_id: ageGroupId,
        division_id: divisionId,
        qualifiers,
        regular_match_count: readiness.regular_match_count,
        activated_by: authResult.profile.id,
      })
      .select('*')
      .single();

    if (insertError || !insertedSnapshot) {
      console.error('[CHAMPION_LEAGUE_ACTIVATE] snapshot insert error:', insertError);
      return internalErrorResponse('Failed to freeze Champion League qualifiers');
    }

    await logAdminAction({
      admin: { id: authResult.profile.id, email: authResult.profile.email },
      action: 'champion_league.activate',
      entityType: 'division',
      entityId: divisionId,
      entityLabel: `Champion League ${seasonId}/${ageGroupId}/${divisionId}`,
      oldData: null,
      newData: {
        season_id: seasonId,
        age_group_id: ageGroupId,
        division_id: divisionId,
        regular_match_count: readiness.regular_match_count,
        qualifiers,
      },
    });

    return NextResponse.json({
      active: true,
      already_active: false,
      activated_at: insertedSnapshot.activated_at,
      qualifiers,
    });
  } catch (error) {
    console.error('[CHAMPION_LEAGUE_ACTIVATE] API error:', error);
    return internalErrorResponse('Failed to activate Champion League');
  }
}

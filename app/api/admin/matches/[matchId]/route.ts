import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth, badRequestResponse, internalErrorResponse } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
import { refreshSuspensionServingMatches } from '@/lib/suspension-calc';
import {
  calculateChampionLeagueStandings,
  getChampionLeaguePlacementPairings,
  getChampionLeagueProgress,
  isSameTeamPair,
  parseChampionLeagueQualifierSnapshot,
} from '@/lib/champion-league';
import type { Match } from '@/types/db';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    const { matchId } = await params;

    // Verify admin is authenticated
    const authResult = await verifyAdminAuth(request);

    if (!authResult.authenticated || !authResult.profile) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check permission to edit matches
    if (!authResult.profile.can_edit_matches) {
      return NextResponse.json(
        { error: 'You do not have permission to edit matches' },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { home_score, away_score, status, winner_team_id, result_type, match_date, match_time, league_phase } = body;

    // Validate inputs
    const isByeResult = result_type && result_type !== 'normal';
    if (!isByeResult && (home_score == null || away_score == null)) {
      return badRequestResponse('home_score and away_score are required');
    }

    if (home_score != null && typeof home_score !== 'number') {
      return badRequestResponse('home_score must be a number');
    }
    if (away_score != null && typeof away_score !== 'number') {
      return badRequestResponse('away_score must be a number');
    }

    if (home_score != null && (home_score < 0 || home_score > 99)) {
      return badRequestResponse('home_score must be between 0 and 99');
    }
    if (away_score != null && (away_score < 0 || away_score > 99)) {
      return badRequestResponse('away_score must be between 0 and 99');
    }

    if (status && !['scheduled', 'finished', 'postponed', 'cancelled'].includes(status)) {
      return badRequestResponse('Invalid status');
    }

    const allowedLeaguePhases = ['regular', 'champion_league', 'final', 'third_place'];
    if (league_phase != null && !allowedLeaguePhases.includes(league_phase)) {
      return badRequestResponse('Invalid league_phase');
    }

    const rawResultType = result_type;
    const resultTypeMissing = rawResultType == null;

    if (resultTypeMissing) {
      console.warn('[MATCH_API] result_type missing from request body', {
        matchId,
        home_score,
        away_score,
        status,
        body_keys: Object.keys(body),
      });
    }

    const allowedResultTypes = ['normal', 'home_win_by_bye', 'away_win_by_bye'];
    if (rawResultType && !allowedResultTypes.includes(rawResultType)) {
      return badRequestResponse('Invalid result_type');
    }

    // Get current match
    const { data: currentMatch, error: getError } = await supabaseAdmin
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single();

    if (getError || !currentMatch) {
      return NextResponse.json(
        { error: 'Match not found' },
        { status: 404 }
      );
    }

    const effectiveLeaguePhase =
      typeof league_phase === 'undefined' ? currentMatch.league_phase : (league_phase || null);
    const isPostLeaguePhase = ['champion_league', 'final', 'third_place'].includes(effectiveLeaguePhase);

    if (isPostLeaguePhase) {
      if (!currentMatch.season_id || !currentMatch.age_group_id || !currentMatch.division_id) {
        return badRequestResponse('Post-league match must have season, age group and division');
      }

      const { data: snapshot, error: snapshotError } = await supabaseAdmin
        .from('league_champion_league_snapshots')
        .select('qualifiers')
        .eq('season_id', currentMatch.season_id)
        .eq('age_group_id', currentMatch.age_group_id)
        .eq('division_id', currentMatch.division_id)
        .maybeSingle();

      if (snapshotError) {
        console.error('[MATCH_API] Champion League snapshot lookup error:', snapshotError);
        return internalErrorResponse('Failed to validate Champion League activation');
      }

      const qualifiers = snapshot ? parseChampionLeagueQualifierSnapshot(snapshot.qualifiers) : null;
      if (!qualifiers) {
        return badRequestResponse('Champion League must be activated and Top 4 frozen before assigning this phase');
      }

      const qualifierIds = new Set(qualifiers.map((row) => row.team_id));
      if (!qualifierIds.has(currentMatch.home_team_id) || !qualifierIds.has(currentMatch.away_team_id)) {
        return badRequestResponse('Post-league match teams must be in the frozen Champion League Top 4');
      }

      const { data: scopeMatches, error: scopeMatchesError } = await supabaseAdmin
        .from('matches')
        .select('id, home_team_id, away_team_id, home_score, away_score, status, league_phase')
        .eq('season_id', currentMatch.season_id)
        .eq('age_group_id', currentMatch.age_group_id)
        .eq('division_id', currentMatch.division_id);

      if (scopeMatchesError) {
        console.error('[MATCH_API] Champion League scope lookup error:', scopeMatchesError);
        return internalErrorResponse('Failed to validate Champion League fixtures');
      }

      const typedScopeMatches = (scopeMatches || []) as Match[];

      if (effectiveLeaguePhase === 'champion_league') {
        const duplicatePairing = typedScopeMatches.some(
          (match) =>
            match.id !== matchId &&
            match.league_phase === 'champion_league' &&
            isSameTeamPair(
              match.home_team_id,
              match.away_team_id,
              currentMatch.home_team_id,
              currentMatch.away_team_id
            )
        );
        if (duplicatePairing) {
          return badRequestResponse('Champion League already has this team pairing');
        }
      }

      if (effectiveLeaguePhase === 'final' || effectiveLeaguePhase === 'third_place') {
        if (currentMatch.league_phase === 'champion_league') {
          return badRequestResponse('Placement match must be a separate fixture, not a reclassified Champion League round-robin match');
        }
        const progress = getChampionLeagueProgress(qualifiers, typedScopeMatches);
        const championStandings = calculateChampionLeagueStandings(qualifiers, typedScopeMatches);
        const placementPairings = getChampionLeaguePlacementPairings(championStandings, progress);
        if (!placementPairings) {
          return badRequestResponse('Champion League must finish all six valid pairings before placement matches');
        }

        const expectedPairing =
          effectiveLeaguePhase === 'final'
            ? placementPairings.final
            : placementPairings.third_place;
        if (
          !isSameTeamPair(
            currentMatch.home_team_id,
            currentMatch.away_team_id,
            expectedPairing.home_team_id,
            expectedPairing.away_team_id
          )
        ) {
          return badRequestResponse(
            effectiveLeaguePhase === 'final'
              ? 'Final teams must be Champion League ranks 1 and 2'
              : 'Third-place teams must be Champion League ranks 3 and 4'
          );
        }
      }
    }

    // winner_team_id (knockout draw / penalty decider) — must be one of the two teams or null
    let winnerUpdate: Record<string, unknown> = {};
    if (winner_team_id !== undefined) {
      if (winner_team_id && winner_team_id !== currentMatch.home_team_id && winner_team_id !== currentMatch.away_team_id) {
        return badRequestResponse('winner_team_id must be the home or away team');
      }
      winnerUpdate = { winner_team_id: winner_team_id || null };
    }

    // Normalize result_type
    const normalizedResultType = rawResultType || 'normal';

    // Update match
    // If bye result, force status to finished
    let finalStatus = status || currentMatch.status;
    let finalHomeScore = home_score;
    let finalAwayScore = away_score;

    if (normalizedResultType !== 'normal') {
      finalStatus = 'finished';
      if (normalizedResultType === 'home_win_by_bye') {
        finalHomeScore = home_score ?? 2;
        finalAwayScore = away_score ?? 0;
      } else if (normalizedResultType === 'away_win_by_bye') {
        finalHomeScore = home_score ?? 0;
        finalAwayScore = away_score ?? 2;
      }
    }

    // Build update payload
    const updatePayload: Record<string, unknown> = {
      home_score: finalHomeScore,
      away_score: finalAwayScore,
      status: finalStatus,
      result_type: normalizedResultType,
      ...winnerUpdate,
      updated_at: new Date().toISOString(),
    };

    if (typeof league_phase !== 'undefined') {
      updatePayload.league_phase = league_phase || null;
    }

    // Include date/time if provided
    if (typeof match_date !== 'undefined') {
      updatePayload.match_date = match_date || null;
    }
    if (typeof match_time !== 'undefined') {
      let normalizedTime = match_time;
      if (typeof match_time === 'string' && match_time.length === 5) {
        normalizedTime = `${match_time}:00`;
      }
      updatePayload.match_time = normalizedTime || null;
    }

    const { data: updatedMatch, error: updateError } = await supabaseAdmin
      .from('matches')
      .update(updatePayload)
      .eq('id', matchId)
      .select()
      .single();

    if (updateError) {
      console.error('Update match error:', updateError);
      return internalErrorResponse('Failed to update match');
    }

    await logAdminAction({
      admin: { id: authResult.profile.id, email: authResult.profile.email },
      action: 'match.update_score',
      entityType: 'match',
      entityId: matchId,
      entityLabel: currentMatch.match_code || matchId,
      oldData: {
        home_score: currentMatch.home_score,
        away_score: currentMatch.away_score,
        status: currentMatch.status,
        league_phase: currentMatch.league_phase || null,
      },
      newData: {
        home_score,
        away_score,
        status: status || currentMatch.status,
        league_phase: typeof league_phase === 'undefined' ? currentMatch.league_phase || null : league_phase || null,
      },
    });

    // Refresh suspension serving matches when status or schedule changes.
    // A status change (finished/postponed/cancelled/scheduled) or date/time shift
    // can invalidate existing serving_match_ids for players from either team.
    // Failure is non-fatal: match update already succeeded.
    let servingRefreshWarning: string | undefined;
    const statusChanged = status && status !== currentMatch.status;
    const dateChanged =
      typeof match_date !== 'undefined' || typeof match_time !== 'undefined';

    if ((statusChanged || dateChanged) && currentMatch.season_id && currentMatch.age_group_id) {
      try {
        // Refresh events for home team
        const homeResult = await refreshSuspensionServingMatches({
          seasonId: currentMatch.season_id,
          ageGroupId: currentMatch.age_group_id,
          teamId: currentMatch.home_team_id,
          changedMatchId: matchId,
        });
        // Refresh events for away team
        const awayResult = await refreshSuspensionServingMatches({
          seasonId: currentMatch.season_id,
          ageGroupId: currentMatch.age_group_id,
          teamId: currentMatch.away_team_id,
          changedMatchId: matchId,
        });
        const totalRefreshed = homeResult.refreshed + awayResult.refreshed;
        const totalFailed = homeResult.failed + awayResult.failed;
        if (totalFailed > 0) {
          servingRefreshWarning = `Serving refresh had ${totalFailed} failure(s)`;
          console.warn('[MATCH_PUT] Serving refresh partial failure:', { homeResult, awayResult });
        } else {
          console.log(`[MATCH_PUT] Serving refresh done: ${totalRefreshed} event(s) refreshed`);
        }
      } catch (refreshErr) {
        servingRefreshWarning = `Serving refresh failed: ${refreshErr instanceof Error ? refreshErr.message : String(refreshErr)}`;
        console.error('[MATCH_PUT] Serving refresh error:', refreshErr);
      }
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Match updated successfully',
        match: updatedMatch,
        ...(servingRefreshWarning ? { serving_refresh_warning: servingRefreshWarning } : {}),
        debug: {
          received_result_type: rawResultType ?? null,
          result_type_missing: resultTypeMissing,
          normalized_result_type: normalizedResultType,
          saved_result_type: updatedMatch.result_type,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Update match error:', error);
    return internalErrorResponse('Failed to update match');
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    const { matchId } = await params;

    // Verify admin is authenticated
    const authResult = await verifyAdminAuth(request);

    if (!authResult.authenticated) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get match with team details
    const { data: match, error } = await supabaseAdmin
      .from('matches')
      .select(
        `
        *,
        home_team:home_team_id(name, short_name, logo_url),
        away_team:away_team_id(name, short_name, logo_url),
        division:division_id(name),
        goals(id, player_id, player:player_id(full_name, shirt_no), team:team_id(name), goals),
        cards(id, player_id, player:player_id(full_name, shirt_no), team:team_id(name), card_type)
      `
      )
      .eq('id', matchId)
      .single();

    if (error || !match) {
      return NextResponse.json(
        { error: 'Match not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(match, { status: 200 });
  } catch (error) {
    console.error('Get match error:', error);
    return internalErrorResponse('Failed to fetch match');
  }
}

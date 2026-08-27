import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
  calculateChampionLeagueStandings,
  getChampionLeaguePlacementPairings,
  getChampionLeagueProgress,
  parseChampionLeagueQualifierSnapshot,
  validateChampionLeaguePlacementFixtures,
} from '@/lib/champion-league';
import type { Match } from '@/types/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const seasonId = request.nextUrl.searchParams.get('seasonId');
    const ageGroupId = request.nextUrl.searchParams.get('ageGroupId');
    const divisionId = request.nextUrl.searchParams.get('divisionId');

    if (!seasonId || !ageGroupId || !divisionId) {
      return NextResponse.json(
        { error: 'Missing required parameters: seasonId, ageGroupId, divisionId' },
        { status: 400 }
      );
    }

    const scope = { season_id: seasonId, age_group_id: ageGroupId, division_id: divisionId };
    const [matchesResult, snapshotResult] = await Promise.all([
      supabase
        .from('matches')
        .select(
          `
          *,
          home_team:home_team_id(name, short_name, logo_url),
          away_team:away_team_id(name, short_name, logo_url),
          division:division_id(name)
        `
        )
        .eq('season_id', seasonId)
        .eq('age_group_id', ageGroupId)
        .eq('division_id', divisionId)
        .order('match_date', { ascending: true })
        .order('match_time', { ascending: true }),
      supabase
        .from('league_champion_league_snapshots')
        .select('id, qualifiers, regular_match_count, activated_at')
        .eq('season_id', seasonId)
        .eq('age_group_id', ageGroupId)
        .eq('division_id', divisionId)
        .maybeSingle(),
    ]);

    if (matchesResult.error) throw matchesResult.error;
    if (snapshotResult.error) throw snapshotResult.error;

    const rawMatches = (matchesResult.data || []) as Array<Match & Record<string, unknown>>;
    const qualifiers = snapshotResult.data
      ? parseChampionLeagueQualifierSnapshot(snapshotResult.data.qualifiers)
      : null;

    if (!snapshotResult.data || !qualifiers) {
      return NextResponse.json({
        scope,
        active: false,
        qualifiers: [],
        standings: [],
        progress: getChampionLeagueProgress([], rawMatches),
        pairings: null,
        matches: {
          champion_league: rawMatches.filter((match) => match.league_phase === 'champion_league'),
          // Fail closed: without a valid frozen snapshot we cannot prove placement teams/ranks.
          final: [],
          third_place: [],
        },
        activation: null,
        rules: {
          win_points: 3,
          draw_points: 1,
          loss_points: 0,
          tied_points_tiebreak: 'frozen_regular_league_rank',
          required_matches_per_team: 3,
          required_unique_matches: 6,
        },
      });
    }

    const standings = calculateChampionLeagueStandings(qualifiers, rawMatches);
    const progress = getChampionLeagueProgress(qualifiers, rawMatches);
    const pairings = getChampionLeaguePlacementPairings(standings, progress);
    const placementIntegrity = validateChampionLeaguePlacementFixtures(qualifiers, rawMatches);

    return NextResponse.json({
      scope,
      active: true,
      qualifiers,
      standings,
      progress,
      pairings,
      matches: {
        champion_league: rawMatches.filter((match) => match.league_phase === 'champion_league'),
        final: placementIntegrity.valid
          ? rawMatches.filter((match) => match.league_phase === 'final')
          : [],
        third_place: placementIntegrity.valid
          ? rawMatches.filter((match) => match.league_phase === 'third_place')
          : [],
      },
      placement_integrity: placementIntegrity,
      activation: {
        id: snapshotResult.data.id,
        activated_at: snapshotResult.data.activated_at,
        regular_match_count: snapshotResult.data.regular_match_count,
      },
      rules: {
        win_points: 3,
        draw_points: 1,
        loss_points: 0,
        tied_points_tiebreak: 'frozen_regular_league_rank',
        required_matches_per_team: 3,
        required_unique_matches: 6,
      },
    });
  } catch (error) {
    console.error('[CHAMPION_LEAGUE_PUBLIC] API error:', error);
    return NextResponse.json({ error: 'Failed to fetch Champion League data' }, { status: 500 });
  }
}

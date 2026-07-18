import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { getBestThirdPlacedRanking, getCategoryStandings } from '@/lib/tournament/services/standings';
import type { BestThirdPlacedRankingResult, CrossGroupCandidate, StandingsRow } from '@/lib/tournament/standings/types';

export const dynamic = 'force-dynamic';

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

// Public rows never expose the override reason (an internal admin note) or
// any audit metadata (actor/timestamp) — only that a manual adjustment was
// applied, plus the same result fields the group table always shows.
//
// IMPORTANT: when an override is applied, calculateGroupStandings embeds the
// raw reason text directly into tiebreakExplanation ("จัดอันดับโดย Admin:
// <reason>") for the admin view — that field must NEVER be passed through
// verbatim here, or the "reason" leaks to the public despite being stripped
// everywhere else. Replace it with a reason-free placeholder instead.
function serializePublicRow(row: StandingsRow) {
  return {
    team_id: row.teamId,
    team_name: row.teamName,
    team_code: row.teamCode,
    position: row.position,
    played: row.played,
    won: row.won,
    lost: row.lost,
    goals_for: row.goalsFor,
    goals_against: row.goalsAgainst,
    goal_difference: row.goalDifference,
    points: row.points,
    fair_play_score: row.fairPlayScore,
    qualification_status: row.qualificationStatus,
    tiebreak_explanation: row.overrideApplied ? 'จัดอันดับโดย Admin' : row.tiebreakExplanation,
    tie_state: row.tieState,
    override_applied: row.overrideApplied,
  };
}

function serializePublicCandidate(candidate: CrossGroupCandidate) {
  return {
    team_id: candidate.teamId,
    team_name: candidate.teamName,
    team_code: candidate.teamCode,
    group_code: candidate.groupCode,
    points: candidate.points,
    goal_difference: candidate.goalDifference,
    goals_for: candidate.goalsFor,
    fair_play_score: candidate.fairPlayScore,
    counted_matches: candidate.countedMatches,
  };
}

// Surfaces the same pending-rule state the admin API sees (state/explanation)
// so the public page can clearly show "not yet comparable" rather than
// guessing or silently omitting the section — no audit/override metadata is
// part of this shape to begin with, so nothing further needs to be stripped.
function serializePublicBestThirdPlacedRanking(ranking: BestThirdPlacedRankingResult) {
  return {
    state: ranking.state,
    explanation: ranking.explanation,
    ranked: ranking.ranked.map(serializePublicCandidate),
  };
}

/**
 * Public standings — official published results only. Never reads or
 * exposes Quick Result payloads, override reasons, or audit metadata. Safe
 * when no results exist yet (returns an explicit not-published/incomplete
 * state per group rather than an empty crash).
 */
export async function GET(request: NextRequest) {
  const tournamentSlug = asText(request.nextUrl.searchParams.get('tournament_slug')).toLowerCase();
  const categoryCode = asText(request.nextUrl.searchParams.get('category_code')).toUpperCase();

  if (!tournamentSlug) return NextResponse.json({ error: 'tournament_slug is required' }, { status: 400 });
  if (!categoryCode) return NextResponse.json({ error: 'category_code is required' }, { status: 400 });

  try {
    const client = getTournamentServiceClient();
    const { data: tournamentData, error: tournamentError } = await client
      .from('tournaments')
      .select('id, slug')
      .eq('slug', tournamentSlug)
      .is('deleted_at', null)
      .maybeSingle();
    if (tournamentError) throw new Error(tournamentError.message);
    if (!tournamentData) {
      return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
    }
    const tournament = tournamentData as { id: string };

    const categoryStandings = await getCategoryStandings({ client, tournamentId: tournament.id, categoryCode });

    const bestThirdPlacedRanking =
      categoryStandings.bestThirdPlacedMethod === 'ranked' && categoryStandings.bestThirdPlacedCount > 0
        ? await getBestThirdPlacedRanking({ client, tournamentId: tournament.id, categoryCode })
        : null;

    return NextResponse.json({
      data: {
        category_code: categoryStandings.categoryCode,
        best_third_placed_ranking: bestThirdPlacedRanking
          ? serializePublicBestThirdPlacedRanking(bestThirdPlacedRanking)
          : null,
        groups: categoryStandings.groups.map((g) => ({
          group_code: g.groupCode,
          is_complete: g.isComplete,
          rows: g.rows.map(serializePublicRow),
        })),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

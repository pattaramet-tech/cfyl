import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { getCategoryStandings } from '@/lib/tournament/services/standings';
import type { StandingsRow } from '@/lib/tournament/standings/types';

export const dynamic = 'force-dynamic';

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

// Public rows never expose the override reason (an internal admin note) or
// any audit metadata (actor/timestamp) — only that a manual adjustment was
// applied, plus the same result fields the group table always shows.
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
    tiebreak_explanation: row.tiebreakExplanation,
    tie_state: row.tieState,
    override_applied: row.overrideApplied,
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

    return NextResponse.json({
      data: {
        category_code: categoryStandings.categoryCode,
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

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    console.log('[STATS] GET request received');

    // Verify admin is authenticated
    const authResult = await verifyAdminAuth(request);

    if (!authResult.authenticated) {
      console.error('[STATS] Auth failed:', authResult.error);
      return NextResponse.json(
        { error: authResult.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('[STATS] Authenticated user:', authResult.profile?.email);

    // Get total matches
    const { count: totalMatches, error: matchError } = await supabaseAdmin
      .from('matches')
      .select('*', { count: 'exact', head: true });

    if (matchError) throw matchError;

    // Get finished matches
    const { count: finishedMatches, error: finishedError } = await supabaseAdmin
      .from('matches')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'finished');

    if (finishedError) throw finishedError;

    // Get total goals
    const { count: totalGoals, error: goalsError } = await supabaseAdmin
      .from('goals')
      .select('*', { count: 'exact', head: true });

    if (goalsError) throw goalsError;

    // Get total cards
    const { count: totalCards, error: cardsError } = await supabaseAdmin
      .from('cards')
      .select('*', { count: 'exact', head: true });

    if (cardsError) throw cardsError;

    // Get total teams
    const { count: totalTeams, error: teamsError } = await supabaseAdmin
      .from('teams')
      .select('*', { count: 'exact', head: true });

    if (teamsError) throw teamsError;

    // Get total players
    const { count: totalPlayers, error: playersError } = await supabaseAdmin
      .from('players')
      .select('*', { count: 'exact', head: true });

    if (playersError) throw playersError;

    return NextResponse.json(
      {
        stats: {
          totalMatches: totalMatches || 0,
          finishedMatches: finishedMatches || 0,
          totalGoals: totalGoals || 0,
          totalCards: totalCards || 0,
          totalTeams: totalTeams || 0,
          totalPlayers: totalPlayers || 0,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[STATS] Error:', errorMsg, error);
    return NextResponse.json(
      { error: `Failed to fetch stats: ${errorMsg}` },
      { status: 500 }
    );
  }
}

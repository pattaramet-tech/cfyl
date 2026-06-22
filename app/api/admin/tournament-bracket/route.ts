import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = request.nextUrl;
  const seasonId = searchParams.get('seasonId');
  const ageGroupId = searchParams.get('ageGroupId');
  if (!seasonId || !ageGroupId) {
    return NextResponse.json({ error: 'seasonId and ageGroupId required' }, { status: 400 });
  }

  const { data: rounds } = await supabaseAdmin
    .from('knockout_rounds')
    .select('id, name, stage, sort_order')
    .eq('season_id', seasonId).eq('age_group_id', ageGroupId)
    .order('sort_order', { ascending: true });

  const { data: bracketMatches } = await supabaseAdmin
    .from('bracket_matches')
    .select(`id, round_id, match_id, bracket_position, status,
      home_source_type, home_source_ref, away_source_type, away_source_ref,
      home_team_id, away_team_id, winner_to_bracket_match_id, winner_to_slot,
      loser_to_bracket_match_id, loser_to_slot,
      round:round_id(stage, name, sort_order),
      home_team:home_team_id(name, short_name), away_team:away_team_id(name, short_name),
      match:match_id(match_code, home_score, away_score, status, winner_team_id, match_date, match_time, venue)`)
    .eq('season_id', seasonId).eq('age_group_id', ageGroupId)
    .order('bracket_position', { ascending: true });

  return NextResponse.json({ rounds: rounds || [], bracketMatches: bracketMatches || [] });
}

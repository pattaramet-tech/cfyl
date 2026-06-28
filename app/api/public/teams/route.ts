import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const seasonId = searchParams.get('seasonId');
    const ageGroupId = searchParams.get('ageGroupId');

    // If seasonId and ageGroupId provided, filter by them (original behavior)
    if (seasonId && ageGroupId) {
      const { data: teams, error } = await supabase
        .from('teams')
        .select('id, name, short_name, logo_url, division_id, active')
        .eq('season_id', seasonId)
        .eq('age_group_id', ageGroupId)
        .order('name', { ascending: true });

      if (error) {
        console.error('[PUBLIC_TEAMS_GET] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json(teams || []);
    }

    // If no filters, return all teams with metadata (for Teams Directory)
    const { data: teams, error } = await supabase
      .from('teams')
      .select(
        `
        id,
        name,
        short_name,
        logo_url,
        season_id,
        age_group_id,
        division_id,
        division:division_id(id, name),
        age_group:age_group_id(id, code, name),
        season:season_id(id, name, year)
      `
      )
      .order('age_group_id', { ascending: true })
      .order('division_id', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      console.error('[PUBLIC_TEAMS_LIST] Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(teams || []);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[PUBLIC_TEAMS_LIST] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

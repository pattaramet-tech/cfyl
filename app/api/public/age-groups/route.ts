import { supabase } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const seasonId = searchParams.get('seasonId');

    if (!seasonId) {
      return NextResponse.json({ error: 'Missing seasonId parameter' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('age_groups')
      .select('*')
      .eq('season_id', seasonId)
      .order('sort_order', { ascending: true });

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Failed to fetch age groups' }, { status: 500 });
  }
}

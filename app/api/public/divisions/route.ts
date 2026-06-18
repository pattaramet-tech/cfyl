import { supabase } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export const revalidate = 3600; // Cache for 1 hour

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const seasonId = searchParams.get('seasonId');
    const ageGroupId = searchParams.get('ageGroupId');

    if (!seasonId || !ageGroupId) {
      return NextResponse.json(
        { error: 'Missing required parameters: seasonId, ageGroupId' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('divisions')
      .select('*')
      .eq('season_id', seasonId)
      .eq('age_group_id', ageGroupId)
      .order('sort_order', { ascending: true });

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Failed to fetch divisions' }, { status: 500 });
  }
}

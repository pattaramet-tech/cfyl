import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { data: seasons } = await supabase
      .from('seasons')
      .select('id, name, year, season_slug, competition_type, status')
      .in('competition_type', ['tournament', 'mixed'])
      .order('year', { ascending: false });

    const ids = (seasons || []).map((s) => s.id);
    const agBySeason = new Map<string, { code: string; name: string; sort_order: number }[]>();
    if (ids.length) {
      const { data: ags } = await supabase
        .from('age_groups').select('season_id, code, name, sort_order')
        .in('season_id', ids).order('sort_order', { ascending: true });
      for (const a of ags || []) {
        if (!agBySeason.has(a.season_id)) agBySeason.set(a.season_id, []);
        agBySeason.get(a.season_id)!.push({ code: a.code, name: a.name, sort_order: a.sort_order });
      }
    }

    return NextResponse.json(
      (seasons || []).map((s) => ({
        id: s.id, name: s.name, year: s.year,
        slug: s.season_slug || String(s.year),
        competition_type: s.competition_type,
        ageGroups: agBySeason.get(s.id) || [],
      }))
    );
  } catch (e) {
    console.error('public tournaments error:', e);
    return NextResponse.json({ error: 'Failed to fetch tournaments' }, { status: 500 });
  }
}

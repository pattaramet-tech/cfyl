import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data: seasons } = await sb
    .from('seasons')
    .select('id,name,year')
    .order('created_at', { ascending: false });

  console.log('\nAll seasons:');
  for (const s of seasons || []) {
    console.log(' ', JSON.stringify({ id: s.id, name: s.name }));
  }

  const { data: ags } = await sb
    .from('age_groups')
    .select('id,code,season_id')
    .order('sort_order');

  console.log('\nSeason+AgeGroup combos with match/card counts:');
  for (const s of (seasons || []).slice(0, 5)) {
    for (const ag of (ags || []).filter((a: any) => a.season_id === s.id)) {
      const { data: matches } = await sb
        .from('matches')
        .select('id')
        .eq('season_id', s.id)
        .eq('age_group_id', ag.id);

      const matchIds = (matches || []).map((m: any) => m.id);
      if (!matchIds.length) continue;

      const { data: cards } = await sb
        .from('cards')
        .select('id')
        .in('match_id', matchIds);

      const cardCount = (cards || []).length;
      if (cardCount > 0) {
        console.log(JSON.stringify({
          season: s.name,
          season_id: s.id,
          age_group: ag.code,
          age_group_id: ag.id,
          matches: matchIds.length,
          cards: cardCount,
        }));
      }
    }
  }

  // Also show suspension counts
  const { data: suspensions } = await sb
    .from('suspensions')
    .select('id, suspension_type, season_id, age_group_id')
    .limit(200);

  const suspGrouped: Record<string, number> = {};
  for (const s of suspensions || []) {
    const key = `${s.season_id}::${s.age_group_id}::${s.suspension_type ?? 'null'}`;
    suspGrouped[key] = (suspGrouped[key] || 0) + 1;
  }
  console.log('\nSuspension records by season/agegroup/type (first 200):');
  for (const [k, v] of Object.entries(suspGrouped)) {
    console.log(` ${k} → ${v}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });

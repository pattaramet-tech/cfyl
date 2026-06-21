import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { getSuspensionStatus, getBangkokToday, type SuspensionStatusKey } from '@/lib/suspension-status';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const dynamic = 'force-dynamic';

const SENDABLE: SuspensionStatusKey[] = ['pending', 'active', 'no_next_match'];

function mdNum(val: unknown): number {
  if (val == null) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const m = String(val).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

const rel = (obj: unknown, key: string): string => {
  const v = obj as Record<string, unknown> | null | undefined;
  return v && typeof v === 'object' ? String((v as Record<string, unknown>)[key] ?? '') : '';
};

async function count(table: string, filter?: (q: any) => any): Promise<number> {
  let q = supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
  if (filter) q = filter(q);
  const { count: c } = await q;
  return c || 0;
}

function mapMatch(m: any) {
  return {
    id: m.id,
    matchday: m.matchday,
    matchdayNum: mdNum(m.matchday),
    ageGroup: rel(m.age_group, 'code'),
    division: rel(m.division, 'name'),
    homeTeam: rel(m.home_team, 'name') || rel(m.home_team, 'short_name'),
    awayTeam: rel(m.away_team, 'name') || rel(m.away_team, 'short_name'),
    homeScore: m.home_score, // keeps 0
    awayScore: m.away_score,
    date: m.match_date,
    time: m.match_time ? String(m.match_time).substring(0, 5) : null,
    status: m.status,
  };
}

export async function GET(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  // ── Global stats ──────────────────────────────────────────────────────────
  const [teams, players, matchesTotal, finishedMatches, goalsTotal, cardsTotal] = await Promise.all([
    count('teams'),
    count('players'),
    count('matches'),
    count('matches', (q) => q.eq('status', 'finished')),
    count('goals'),
    count('cards'),
  ]);

  // ── Active season (warn if >1) ────────────────────────────────────────────
  const { data: activeSeasons } = await supabaseAdmin
    .from('seasons')
    .select('id, name, year, status')
    .eq('status', 'active');
  let season: { id: string; name: string; year: number; status: string } | null =
    (activeSeasons || [])[0] || null;
  if (!season) {
    const { data: newest } = await supabaseAdmin
      .from('seasons')
      .select('id, name, year, status')
      .order('year', { ascending: false })
      .limit(1)
      .maybeSingle();
    season = newest || null;
  }
  const activeSeasonCount = (activeSeasons || []).length;

  let seasonBlock: any = null;
  let recentMatches: any[] = [];
  let upcomingMatches: any[] = [];
  let matchdays: any[] = [];
  const topScorers: { U14: any[]; U17: any[] } = { U14: [], U17: [] };
  let activeSuspensions: any[] = [];

  if (season) {
    const seasonId = season.id;

    // Age groups + divisions for the season card
    const { data: ageGroups } = await supabaseAdmin
      .from('age_groups')
      .select('id, code, sort_order')
      .eq('season_id', seasonId)
      .order('sort_order', { ascending: true });
    const { data: divisions } = await supabaseAdmin
      .from('divisions')
      .select('name')
      .eq('season_id', seasonId)
      .order('sort_order', { ascending: true });
    const ageCodeById = new Map((ageGroups || []).map((a) => [a.id, a.code]));

    seasonBlock = {
      id: season.id,
      name: season.name,
      year: season.year,
      status: season.status,
      ageGroups: Array.from(new Set((ageGroups || []).map((a) => a.code))),
      divisions: Array.from(new Set((divisions || []).map((d) => d.name))),
    };

    // All season matches (with relations) — reused for recent/upcoming/matchdays
    const { data: matchesRaw } = await supabaseAdmin
      .from('matches')
      .select(
        `id, matchday, status, home_score, away_score, match_date, match_time,
         division:division_id(name), age_group:age_group_id(code),
         home_team:home_team_id(name, short_name), away_team:away_team_id(name, short_name)`
      )
      .eq('season_id', seasonId);
    const matches = matchesRaw || [];

    const byDateDesc = (a: any, b: any) =>
      String(b.match_date || '').localeCompare(String(a.match_date || '')) ||
      String(b.match_time || '').localeCompare(String(a.match_time || ''));
    const byDateAsc = (a: any, b: any) =>
      String(a.match_date || '9999').localeCompare(String(b.match_date || '9999')) ||
      String(a.match_time || '99').localeCompare(String(b.match_time || '99'));

    recentMatches = matches
      .filter((m) => m.status === 'finished' && m.home_score !== null && m.away_score !== null)
      .sort(byDateDesc)
      .slice(0, 8)
      .map(mapMatch);

    upcomingMatches = matches
      .filter((m) => m.status !== 'finished')
      .sort(byDateAsc)
      .slice(0, 8)
      .map(mapMatch);

    // Match ids → goals & cards for matchday tally + top scorers
    const matchIds = matches.map((m) => m.id);
    const matchMdMap = new Map(matches.map((m) => [m.id, mdNum(m.matchday)]));

    const goalsRes = matchIds.length
      ? await supabaseAdmin
          .from('goals')
          .select('match_id, goals, player:player_id(id, full_name, shirt_no, age_group_id, team:team_id(name))')
          .in('match_id', matchIds)
      : { data: [] as any[] };
    const cardsRes = matchIds.length
      ? await supabaseAdmin.from('cards').select('match_id, card_type').in('match_id', matchIds)
      : { data: [] as any[] };
    const goalsRows = goalsRes.data || [];
    const cardsRows = cardsRes.data || [];

    // Matchday tally
    const mdMap = new Map<number, { matchday: number; total: number; finished: number; pending: number; goals: number; cards: number }>();
    const getMd = (n: number) => {
      if (!mdMap.has(n)) mdMap.set(n, { matchday: n, total: 0, finished: 0, pending: 0, goals: 0, cards: 0 });
      return mdMap.get(n)!;
    };
    for (const m of matches) {
      const e = getMd(mdNum(m.matchday));
      e.total += 1;
      if (m.status === 'finished') e.finished += 1; else e.pending += 1;
    }
    for (const g of goalsRows) {
      const n = matchMdMap.get((g as any).match_id) ?? 0;
      getMd(n).goals += Number((g as any).goals) || 0;
    }
    for (const c of cardsRows) {
      const n = matchMdMap.get((c as any).match_id) ?? 0;
      getMd(n).cards += 1;
    }
    matchdays = Array.from(mdMap.values())
      .filter((e) => e.matchday > 0)
      .sort((a, b) => a.matchday - b.matchday);

    // Top scorers by player.id, split by age group
    const scorerMap = new Map<string, { player_id: string; full_name: string; shirt_no: number | null; team_name: string; age_group_id: string; total_goals: number }>();
    for (const g of goalsRows) {
      const p = (g as any).player;
      if (!p?.id) continue;
      const cur = scorerMap.get(p.id) || {
        player_id: p.id,
        full_name: p.full_name,
        shirt_no: p.shirt_no,
        team_name: rel(p.team, 'name'),
        age_group_id: p.age_group_id,
        total_goals: 0,
      };
      cur.total_goals += Number((g as any).goals) || 0;
      scorerMap.set(p.id, cur);
    }
    const allScorers = Array.from(scorerMap.values());
    for (const ag of ageGroups || []) {
      const code = ag.code as 'U14' | 'U17';
      const list = allScorers
        .filter((s) => s.age_group_id === ag.id)
        .sort((a, b) => b.total_goals - a.total_goals || a.full_name.localeCompare(b.full_name, 'th'))
        .slice(0, 5)
        .map((s, i) => ({ rank: i + 1, player_id: s.player_id, full_name: s.full_name, shirt_no: s.shirt_no, team_name: s.team_name, total_goals: s.total_goals }));
      if (code === 'U14' || code === 'U17') topScorers[code] = list;
    }

    // Active suspensions (lifecycle pending/active/no_next_match)
    const { data: suspensions } = await supabaseAdmin
      .from('suspensions')
      .select('player_id, age_group_id, total_points, ban_matches, suspension_details, player:player_id(full_name, shirt_no), team:team_id(name)')
      .eq('season_id', seasonId)
      .order('total_points', { ascending: false });
    const today = getBangkokToday();
    activeSuspensions = (suspensions || [])
      .map((s: any) => ({ s, st: getSuspensionStatus(s, today) }))
      .filter(({ st }) => SENDABLE.includes(st.key))
      .slice(0, 12)
      .map(({ s, st }) => {
        const next = s.suspension_details?.suspended_matches?.[0];
        return {
          player_id: s.player_id,
          full_name: rel(s.player, 'full_name'),
          shirt_no: (s.player as any)?.shirt_no ?? null,
          team_name: rel(s.team, 'name'),
          ageGroup: ageCodeById.get(s.age_group_id) || '',
          total_points: s.total_points,
          ban_matches: s.ban_matches,
          statusKey: st.key,
          statusLabel: st.label,
          statusColor: st.color,
          suspendedMatch: next ? `MD${next.matchday} vs ${next.opponent_name} (${next.is_home ? 'เหย้า' : 'เยือน'})` : null,
        };
      });
  }

  return NextResponse.json({
    season: seasonBlock,
    activeSeasonCount,
    stats: {
      teams,
      players,
      matches: matchesTotal,
      finishedMatches,
      pendingMatches: matchesTotal - finishedMatches,
      goals: goalsTotal,
      cards: cardsTotal,
      activeSuspensions: activeSuspensions.length,
    },
    recentMatches,
    upcomingMatches,
    matchdays,
    topScorers,
    activeSuspensions,
  });
}

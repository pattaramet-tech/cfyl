// Server-side helpers for public tournament pages (Phase 5B.2). Anon read-only.
import { supabase } from '@/lib/supabase';
import { calculateStandings } from '@/lib/calculations';
import type { Match } from '@/types/db';

export interface TournamentContext {
  season: { id: string; name: string; year: number; season_slug: string | null; competition_type: string | null };
  ageGroup: { id: string; code: string; name: string };
}

/** Resolve seasonSlug (slug or year) + ageGroupCode → ids. Null if not found. */
export async function resolveTournamentContext(seasonSlug: string, ageCode: string): Promise<TournamentContext | null> {
  const { data: seasons } = await supabase
    .from('seasons').select('id, name, year, season_slug, competition_type, status');
  const list = seasons || [];
  const seg = seasonSlug.toLowerCase();
  let season = list.find((s) => (s.season_slug || '').toLowerCase() === seg);
  if (!season) {
    const byYear = list.filter((s) => String(s.year) === seasonSlug);
    season = byYear.find((s) => s.status === 'active') || byYear[0];
  }
  if (!season) return null;

  const { data: ags } = await supabase
    .from('age_groups').select('id, code, name, sort_order').eq('season_id', season.id);
  const ageGroup = (ags || []).find((a) => a.code.toLowerCase() === ageCode.toLowerCase());
  if (!ageGroup) return null;

  return {
    season: { id: season.id, name: season.name, year: season.year, season_slug: season.season_slug, competition_type: season.competition_type },
    ageGroup: { id: ageGroup.id, code: ageGroup.code, name: ageGroup.name },
  };
}

export interface GroupStanding {
  id: string; name: string;
  teams: { rank: number; teamId: string; name: string; shortName: string | null;
    played: number; wins: number; draws: number; losses: number;
    goalsFor: number; goalsAgainst: number; goalDiff: number; points: number }[];
}

export async function computeGroupStandings(seasonId: string, ageGroupId: string): Promise<GroupStanding[]> {
  const { data: groups } = await supabase
    .from('tournament_groups').select('id, name, sort_order')
    .eq('season_id', seasonId).eq('age_group_id', ageGroupId)
    .order('sort_order', { ascending: true });
  const ids = (groups || []).map((g) => g.id);
  const { data: gt } = ids.length
    ? await supabase.from('tournament_group_teams').select('group_id, team_id, team:team_id(name, short_name)').in('group_id', ids)
    : { data: [] as any[] };
  const { data: matchesRaw } = await supabase
    .from('matches').select('*').eq('season_id', seasonId).eq('age_group_id', ageGroupId);
  const matches = (matchesRaw as Match[] | null) || [];

  return (groups || []).map((g) => {
    const members = (gt || []).filter((r: any) => r.group_id === g.id);
    const setIds = new Set(members.map((m: any) => m.team_id));
    const gm = matches.filter(
      (m) => m.status === 'finished' && m.home_score !== null && m.away_score !== null &&
        setIds.has(m.home_team_id) && setIds.has(m.away_team_id)
    );
    const teams = members
      .map((m: any) => {
        const s = calculateStandings(gm, m.team_id);
        return { teamId: m.team_id, name: (m.team as any)?.name || '', shortName: (m.team as any)?.short_name || null, ...s };
      })
      .sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor || a.name.localeCompare(b.name, 'th'))
      .map((r, i) => ({ rank: i + 1, ...r }));
    return { id: g.id, name: g.name, teams };
  });
}

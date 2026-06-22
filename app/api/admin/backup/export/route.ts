import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { calculateStandings } from '@/lib/calculations';
import { buildCsv, csvFilename, type CsvRow } from '@/lib/csv';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const dynamic = 'force-dynamic';

interface Column {
  key: string;
  header: string;
}
interface Sheet {
  name: string;
  columns: Column[];
  rows: CsvRow[];
}

const rel = (obj: unknown, key: string): string => {
  const v = obj as Record<string, unknown> | null | undefined;
  return v && typeof v === 'object' ? String((v as Record<string, unknown>)[key] ?? '') : '';
};

async function fetchMatches(seasonId: string, ageGroupId?: string | null, divisionId?: string | null) {
  let q = supabaseAdmin
    .from('matches')
    .select(
      `id, match_code, matchday, match_date, match_time, home_score, away_score, status,
       stage, venue, division_id, tournament_group_id, home_team_id, away_team_id, winner_team_id,
       division:division_id(name), group:tournament_group_id(name),
       home_team:home_team_id(name), away_team:away_team_id(name), winner:winner_team_id(name)`
    )
    .eq('season_id', seasonId);
  if (ageGroupId) q = q.eq('age_group_id', ageGroupId);
  if (divisionId) q = q.eq('division_id', divisionId);
  const { data } = await q;
  return data || [];
}

// ─── Per-type dataset builders ──────────────────────────────────────────────

async function buildTeams(seasonId: string, ageGroupId?: string | null, divisionId?: string | null): Promise<Sheet> {
  let q = supabaseAdmin
    .from('teams')
    .select('id, name, short_name, team_color, active, age_group:age_group_id(code), division:division_id(name)')
    .eq('season_id', seasonId);
  if (ageGroupId) q = q.eq('age_group_id', ageGroupId);
  if (divisionId) q = q.eq('division_id', divisionId);
  const { data } = await q;
  return {
    name: 'teams',
    columns: [
      { key: 'id', header: 'id' },
      { key: 'name', header: 'name' },
      { key: 'short_name', header: 'short_name' },
      { key: 'age_group', header: 'age_group' },
      { key: 'division', header: 'division' },
      { key: 'team_color', header: 'team_color' },
      { key: 'active', header: 'active' },
    ],
    rows: (data || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      short_name: t.short_name,
      age_group: rel(t.age_group, 'code'),
      division: rel(t.division, 'name'),
      team_color: t.team_color,
      active: t.active === false ? 'false' : 'true',
    })),
  };
}

async function buildPlayers(seasonId: string, ageGroupId?: string | null, divisionId?: string | null): Promise<Sheet> {
  let q = supabaseAdmin
    .from('players')
    .select('id, player_code, full_name, shirt_no, active, team:team_id(name), age_group:age_group_id(code), division:division_id(name)')
    .eq('season_id', seasonId);
  if (ageGroupId) q = q.eq('age_group_id', ageGroupId);
  if (divisionId) q = q.eq('division_id', divisionId);
  const { data } = await q;
  return {
    name: 'players',
    columns: [
      { key: 'id', header: 'id' },
      { key: 'player_code', header: 'player_code' },
      { key: 'full_name', header: 'full_name' },
      { key: 'shirt_no', header: 'shirt_no' },
      { key: 'team', header: 'team' },
      { key: 'age_group', header: 'age_group' },
      { key: 'division', header: 'division' },
      { key: 'active', header: 'active' },
    ],
    rows: (data || []).map((p: any) => ({
      id: p.id,
      player_code: p.player_code,
      full_name: p.full_name,
      shirt_no: p.shirt_no,
      team: rel(p.team, 'name'),
      age_group: rel(p.age_group, 'code'),
      division: rel(p.division, 'name'),
      active: p.active === false ? 'false' : 'true',
    })),
  };
}

function matchesSheet(matches: any[]): Sheet {
  return {
    name: 'matches',
    columns: [
      { key: 'match_code', header: 'match_code' },
      { key: 'matchday', header: 'matchday' },
      { key: 'stage', header: 'stage' },
      { key: 'group', header: 'group' },
      { key: 'date', header: 'date' },
      { key: 'time', header: 'time' },
      { key: 'venue', header: 'venue' },
      { key: 'division', header: 'division' },
      { key: 'home_team', header: 'home_team' },
      { key: 'away_team', header: 'away_team' },
      { key: 'home_score', header: 'home_score' },
      { key: 'away_score', header: 'away_score' },
      { key: 'winner', header: 'winner' },
      { key: 'status', header: 'status' },
    ],
    rows: matches.map((m: any) => ({
      match_code: m.match_code,
      matchday: m.matchday,
      stage: m.stage,
      group: rel(m.group, 'name'),
      date: m.match_date,
      time: m.match_time,
      venue: m.venue,
      division: rel(m.division, 'name'),
      home_team: rel(m.home_team, 'name'),
      away_team: rel(m.away_team, 'name'),
      home_score: m.home_score, // keeps 0
      away_score: m.away_score,
      winner: rel(m.winner, 'name'),
      status: m.status,
    })),
  };
}

async function buildGoals(matches: any[]): Promise<Sheet> {
  const ids = matches.map((m) => m.id);
  const codeMap = new Map(matches.map((m) => [m.id, { code: m.match_code, md: m.matchday }]));
  const rows: CsvRow[] = [];
  if (ids.length) {
    const { data } = await supabaseAdmin
      .from('goals')
      .select('id, match_id, goals, player:player_id(full_name), team:team_id(name)')
      .in('match_id', ids);
    for (const g of data || []) {
      const meta = codeMap.get((g as any).match_id);
      rows.push({
        id: (g as any).id,
        match_code: meta?.code ?? '',
        matchday: meta?.md ?? '',
        player: rel((g as any).player, 'full_name'),
        team: rel((g as any).team, 'name'),
        goals: (g as any).goals,
      });
    }
  }
  return {
    name: 'goals',
    columns: [
      { key: 'id', header: 'id' },
      { key: 'match_code', header: 'match_code' },
      { key: 'matchday', header: 'matchday' },
      { key: 'player', header: 'player' },
      { key: 'team', header: 'team' },
      { key: 'goals', header: 'goals' },
    ],
    rows,
  };
}

async function buildCards(matches: any[]): Promise<Sheet> {
  const ids = matches.map((m) => m.id);
  const codeMap = new Map(matches.map((m) => [m.id, { code: m.match_code, md: m.matchday }]));
  const rows: CsvRow[] = [];
  if (ids.length) {
    const { data } = await supabaseAdmin
      .from('cards')
      .select('id, match_id, card_type, minute, note, player:player_id(full_name), team:team_id(name)')
      .in('match_id', ids);
    for (const c of data || []) {
      const meta = codeMap.get((c as any).match_id);
      rows.push({
        id: (c as any).id,
        match_code: meta?.code ?? '',
        matchday: meta?.md ?? '',
        player: rel((c as any).player, 'full_name'),
        team: rel((c as any).team, 'name'),
        card_type: (c as any).card_type,
        minute: (c as any).minute,
        note: (c as any).note,
      });
    }
  }
  return {
    name: 'cards',
    columns: [
      { key: 'id', header: 'id' },
      { key: 'match_code', header: 'match_code' },
      { key: 'matchday', header: 'matchday' },
      { key: 'player', header: 'player' },
      { key: 'team', header: 'team' },
      { key: 'card_type', header: 'card_type' },
      { key: 'minute', header: 'minute' },
      { key: 'note', header: 'note' },
    ],
    rows,
  };
}

async function buildSuspensions(seasonId: string, ageGroupId?: string | null): Promise<Sheet> {
  let q = supabaseAdmin
    .from('suspensions')
    .select('total_points, ban_matches, suspension_reason, player:player_id(full_name), team:team_id(name)')
    .eq('season_id', seasonId)
    .order('total_points', { ascending: false });
  if (ageGroupId) q = q.eq('age_group_id', ageGroupId);
  const { data } = await q;
  return {
    name: 'suspensions',
    columns: [
      { key: 'player', header: 'player' },
      { key: 'team', header: 'team' },
      { key: 'total_points', header: 'total_points' },
      { key: 'ban_matches', header: 'ban_matches' },
      { key: 'suspension_reason', header: 'suspension_reason' },
    ],
    rows: (data || []).map((s: any) => ({
      player: rel(s.player, 'full_name'),
      team: rel(s.team, 'name'),
      total_points: s.total_points,
      ban_matches: s.ban_matches,
      suspension_reason: s.suspension_reason,
    })),
  };
}

async function buildStandings(seasonId: string, ageGroupId?: string | null, divisionId?: string | null): Promise<Sheet> {
  const matches = await fetchMatches(seasonId, ageGroupId, divisionId);
  // Teams in scope
  let tq = supabaseAdmin
    .from('teams')
    .select('id, name, division_id, division:division_id(name)')
    .eq('season_id', seasonId);
  if (ageGroupId) tq = tq.eq('age_group_id', ageGroupId);
  if (divisionId) tq = tq.eq('division_id', divisionId);
  const { data: teams } = await tq;

  const scored = (matches as any[]).filter(
    (m) => m.status === 'finished' && m.home_score !== null && m.away_score !== null
  );

  const rows: CsvRow[] = [];
  // group teams by division
  const byDiv = new Map<string, { name: string; teams: any[] }>();
  for (const t of teams || []) {
    const dId = (t as any).division_id || '';
    if (!byDiv.has(dId)) byDiv.set(dId, { name: rel((t as any).division, 'name') || '—', teams: [] });
    byDiv.get(dId)!.teams.push(t);
  }

  for (const { name: divName, teams: divTeams } of byDiv.values()) {
    const divMatches = scored.filter((m) => divTeams.some((t) => t.id === m.home_team_id || t.id === m.away_team_id));
    const table = divTeams
      .map((t: any) => {
        const s = calculateStandings(divMatches, t.id);
        return {
          team: t.name,
          P: s.played, W: s.wins, D: s.draws, L: s.losses,
          GF: s.goalsFor, GA: s.goalsAgainst, GD: s.goalDiff, Pts: s.points,
        };
      })
      .sort((a, b) => b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF || a.team.localeCompare(b.team, 'th'));
    table.forEach((r, i) => rows.push({ division: divName, rank: i + 1, ...r }));
  }

  return {
    name: 'standings',
    columns: [
      { key: 'division', header: 'division' },
      { key: 'rank', header: 'rank' },
      { key: 'team', header: 'team' },
      { key: 'P', header: 'P' },
      { key: 'W', header: 'W' },
      { key: 'D', header: 'D' },
      { key: 'L', header: 'L' },
      { key: 'GF', header: 'GF' },
      { key: 'GA', header: 'GA' },
      { key: 'GD', header: 'GD' },
      { key: 'Pts', header: 'Pts' },
    ],
    rows,
  };
}

async function buildTournamentGroups(seasonId: string, ageGroupId?: string | null): Promise<Sheet> {
  let gq = supabaseAdmin
    .from('tournament_groups')
    .select('id, name, code, sort_order, age_group:age_group_id(code)')
    .eq('season_id', seasonId)
    .order('sort_order', { ascending: true });
  if (ageGroupId) gq = gq.eq('age_group_id', ageGroupId);
  const { data: groups } = await gq;

  const ids = (groups || []).map((g: any) => g.id);
  const teamsByGroup = new Map<string, string[]>();
  if (ids.length) {
    const { data: gt } = await supabaseAdmin
      .from('tournament_group_teams')
      .select('group_id, sort_order, team:team_id(name)')
      .in('group_id', ids)
      .order('sort_order', { ascending: true });
    for (const row of gt || []) {
      const arr = teamsByGroup.get((row as any).group_id) || [];
      arr.push(rel((row as any).team, 'name'));
      teamsByGroup.set((row as any).group_id, arr);
    }
  }

  const rows: CsvRow[] = [];
  for (const g of groups || []) {
    const teams = teamsByGroup.get((g as any).id) || [];
    const base = { group: (g as any).name, code: (g as any).code, age_group: rel((g as any).age_group, 'code') };
    if (teams.length === 0) rows.push({ ...base, team: '' });
    else for (const t of teams) rows.push({ ...base, team: t });
  }

  return {
    name: 'tournament_groups',
    columns: [
      { key: 'group', header: 'group' },
      { key: 'code', header: 'code' },
      { key: 'age_group', header: 'age_group' },
      { key: 'team', header: 'team' },
    ],
    rows,
  };
}

async function buildBracket(seasonId: string, ageGroupId?: string | null): Promise<Sheet> {
  let q = supabaseAdmin
    .from('bracket_matches')
    .select(`bracket_position, status, round:round_id(name, stage, sort_order),
      home_team:home_team_id(name), away_team:away_team_id(name),
      match:match_id(match_code, home_score, away_score, status)`)
    .eq('season_id', seasonId);
  if (ageGroupId) q = q.eq('age_group_id', ageGroupId);
  const { data } = await q.order('bracket_position', { ascending: true });
  return {
    name: 'bracket',
    columns: [
      { key: 'round', header: 'round' },
      { key: 'stage', header: 'stage' },
      { key: 'position', header: 'position' },
      { key: 'match_code', header: 'match_code' },
      { key: 'home_team', header: 'home_team' },
      { key: 'away_team', header: 'away_team' },
      { key: 'home_score', header: 'home_score' },
      { key: 'away_score', header: 'away_score' },
      { key: 'status', header: 'status' },
    ],
    rows: (data || []).map((b: any) => ({
      round: rel(b.round, 'name'),
      stage: rel(b.round, 'stage'),
      position: b.bracket_position,
      match_code: b.match ? (b.match as any).match_code : '',
      home_team: rel(b.home_team, 'name'),
      away_team: rel(b.away_team, 'name'),
      home_score: b.match ? (b.match as any).home_score : '',
      away_score: b.match ? (b.match as any).away_score : '',
      status: b.status,
    })),
  };
}

async function buildSheets(type: string, seasonId: string, ageGroupId?: string | null, divisionId?: string | null): Promise<Sheet[]> {
  const needMatches = ['matches', 'goals', 'cards', 'all'].includes(type);
  const matches = needMatches ? await fetchMatches(seasonId, ageGroupId, divisionId) : [];

  switch (type) {
    case 'teams': return [await buildTeams(seasonId, ageGroupId, divisionId)];
    case 'players': return [await buildPlayers(seasonId, ageGroupId, divisionId)];
    case 'matches': return [matchesSheet(matches)];
    case 'goals': return [await buildGoals(matches)];
    case 'cards': return [await buildCards(matches)];
    case 'suspensions': return [await buildSuspensions(seasonId, ageGroupId)];
    case 'standings': return [await buildStandings(seasonId, ageGroupId, divisionId)];
    case 'tournament-groups': return [await buildTournamentGroups(seasonId, ageGroupId)];
    case 'bracket': return [await buildBracket(seasonId, ageGroupId)];
    case 'all':
      return [
        await buildTeams(seasonId, ageGroupId, divisionId),
        await buildPlayers(seasonId, ageGroupId, divisionId),
        matchesSheet(matches),
        await buildGoals(matches),
        await buildCards(matches),
        await buildSuspensions(seasonId, ageGroupId),
        await buildStandings(seasonId, ageGroupId, divisionId),
        await buildTournamentGroups(seasonId, ageGroupId),
        await buildBracket(seasonId, ageGroupId),
      ];
    default:
      return [];
  }
}

export async function GET(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const seasonId = searchParams.get('seasonId');
  const ageGroupId = searchParams.get('ageGroupId');
  const divisionId = searchParams.get('divisionId');
  const type = searchParams.get('type') || '';
  const format = searchParams.get('format') || 'csv';

  if (!seasonId) {
    return NextResponse.json({ error: 'seasonId is required' }, { status: 400 });
  }

  const sheets = await buildSheets(type, seasonId, ageGroupId, divisionId);
  if (sheets.length === 0) {
    return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
  }

  // Excel: type=all always xlsx; or any type when format=xlsx
  if (type === 'all' || format === 'xlsx') {
    const wb = XLSX.utils.book_new();
    for (const sheet of sheets) {
      const aoa = [
        sheet.columns.map((c) => c.header),
        ...sheet.rows.map((r) => sheet.columns.map((c) => r[c.key] ?? '')),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
    }
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="cfyl_${type}_${stamp}.xlsx"`,
      },
    });
  }

  // CSV (single sheet)
  const sheet = sheets[0];
  const csv = buildCsv(sheet.columns, sheet.rows);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFilename(['cfyl', sheet.name])}"`,
    },
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import scheduleData from '@/data/tournament-schedule-fallback.json';

export const dynamic = 'force-dynamic';

interface ScheduleMatch {
  id: string;
  category_code: string;
  venue_code: string;
  date: string;
  time: string;
  home_slot: string;
  away_slot: string;
  home_team?: string;
  away_team?: string;
  court: string | number;
  round: string;
  match_number: string | number;
}

interface TournamentRow {
  id: string;
  start_date: string | null;
  end_date: string | null;
}

interface DbMatchRow {
  id: string;
  match_code: string;
  match_no: number | null;
  match_date: string | null;
  match_time: string | null;
  category_id: string;
  venue_id: string | null;
  court_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_source_ref: string | null;
  away_source_ref: string | null;
  stage: string;
  schedule_status: string;
}

interface CodeRow {
  id: string;
  code: string;
}

interface TeamRow {
  id: string;
  name: string;
}

type SupabaseClient = ReturnType<typeof getTournamentServiceClient>;

async function resolveTeamForSlot(
  client: SupabaseClient,
  tournamentId: string,
  categoryCode: string,
  slotCode: string
): Promise<string | undefined> {
  if (slotCode.startsWith('Winner ') || slotCode === 'TBD' || !slotCode.includes('-')) {
    return undefined;
  }

  try {
    const groupCode = slotCode.split('-')[0];
    const { data: category } = await client
      .from('tournament_categories')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('code', categoryCode)
      .is('deleted_at', null)
      .single();

    if (!category) return undefined;

    const { data: group } = await client
      .from('tournament_groups')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('category_id', category.id)
      .eq('code', groupCode)
      .maybeSingle();

    if (!group) return undefined;

    const { data: assignment } = await client
      .from('tournament_draw_assignments')
      .select('team_id, tournament_teams!inner(name)')
      .eq('group_id', group.id)
      .eq('slot_code', slotCode)
      .is('superseded_at', null)
      .single();

    if (assignment) {
      const teams = assignment.tournament_teams as Array<{ name: string }>;
      if (Array.isArray(teams) && teams.length > 0 && teams[0].name) {
        return teams[0].name;
      }
    }

    return undefined;
  } catch (error) {
    console.error('[SCHEDULE_RESOLVE] Error resolving team:', error);
    return undefined;
  }
}

interface ImportedScheduleResult {
  publishedMatches: ScheduleMatch[];
  hasAnyImportedMatches: boolean;
}

async function loadImportedSchedule(params: {
  client: SupabaseClient;
  tournament: TournamentRow;
  categoryCode: string | null;
  venueCode: string | null;
  date: string | null;
}): Promise<ImportedScheduleResult | null> {
  const { client, tournament, categoryCode, venueCode, date } = params;

  const [categoriesResult, venuesResult, courtsResult, teamsResult] = await Promise.all([
    client
      .from('tournament_categories')
      .select('id, code')
      .eq('tournament_id', tournament.id)
      .is('deleted_at', null),
    client.from('tournament_venues').select('id, code').eq('tournament_id', tournament.id),
    client.from('tournament_courts').select('id, code'),
    client.from('tournament_teams').select('id, name').eq('tournament_id', tournament.id),
  ]);

  const referenceError = [
    categoriesResult.error,
    venuesResult.error,
    courtsResult.error,
    teamsResult.error,
  ].find(Boolean);
  if (referenceError) {
    console.error('[SCHEDULE_GET] reference query failed:', referenceError.message);
    return null;
  }

  const categories = (categoriesResult.data || []) as CodeRow[];
  const venues = (venuesResult.data || []) as CodeRow[];
  const categoriesById = new Map(categories.map((item) => [item.id, item.code]));
  const categoryIdsByCode = new Map(categories.map((item) => [item.code.trim().toUpperCase(), item.id]));
  const venuesById = new Map(venues.map((item) => [item.id, item.code]));
  const venueIdsByCode = new Map(venues.map((item) => [item.code.trim().toUpperCase(), item.id]));
  const courtsById = new Map(((courtsResult.data || []) as CodeRow[]).map((item) => [item.id, item.code]));
  const teamsById = new Map(((teamsResult.data || []) as TeamRow[]).map((item) => [item.id, item.name]));

  function baseQuery() {
    let query = client
      .from('tournament_matches')
      .select(
        'id, match_code, match_no, match_date, match_time, category_id, venue_id, court_id, home_team_id, away_team_id, home_source_ref, away_source_ref, stage, schedule_status'
      )
      .eq('tournament_id', tournament.id)
      .is('deleted_at', null);

    if (categoryCode) {
      const categoryId = categoryIdsByCode.get(categoryCode.trim().toUpperCase());
      if (!categoryId) return null;
      query = query.eq('category_id', categoryId);
    }
    if (venueCode) {
      const venueId = venueIdsByCode.get(venueCode.trim().toUpperCase());
      if (!venueId) return null;
      query = query.eq('venue_id', venueId);
    }
    if (date) query = query.eq('match_date', date);

    return query;
  }

  // First, cheaply check whether ANY imported match exists in scope (any
  // schedule_status) — this distinguishes "nothing imported yet" (sample
  // fallback may apply) from "imported but not published" (must return
  // NOT_PUBLISHED, never expose draft/validated rows).
  const existsQuery = baseQuery();
  if (!existsQuery) return { publishedMatches: [], hasAnyImportedMatches: false };
  const { data: existsData, error: existsError } = await existsQuery.limit(1);
  if (existsError) {
    console.error('[SCHEDULE_GET] imported schedule existence check failed:', existsError.message);
    return null;
  }
  const hasAnyImportedMatches = (existsData || []).length > 0;

  if (!hasAnyImportedMatches) {
    return { publishedMatches: [], hasAnyImportedMatches: false };
  }

  // Public API must only ever return matches whose schedule publication
  // status is 'published' — draft/validated/revision_required rows are
  // never exposed here, even labeled as draft.
  const publishedQuery = baseQuery();
  if (!publishedQuery) return { publishedMatches: [], hasAnyImportedMatches };
  const { data: matchData, error: matchError } = await publishedQuery
    .eq('schedule_status', 'published')
    .order('match_date', { ascending: true })
    .order('match_time', { ascending: true })
    .order('match_no', { ascending: true });

  if (matchError) {
    console.error('[SCHEDULE_GET] imported schedule query failed:', matchError.message);
    return null;
  }

  const matches = (matchData || []) as DbMatchRow[];

  const publishedMatches = matches.map((match) => ({
    id: match.id,
    category_code: categoriesById.get(match.category_id) || 'UNKNOWN',
    venue_code: match.venue_id ? venuesById.get(match.venue_id) || 'TBD' : 'TBD',
    date: match.match_date || '',
    time: match.match_time || '',
    home_slot: match.home_source_ref || 'TBD',
    away_slot: match.away_source_ref || 'TBD',
    home_team: match.home_team_id ? teamsById.get(match.home_team_id) : undefined,
    away_team: match.away_team_id ? teamsById.get(match.away_team_id) : undefined,
    court: match.court_id ? courtsById.get(match.court_id) || '' : '',
    round: match.stage,
    match_number: match.match_no || match.match_code,
  }));

  return { publishedMatches, hasAnyImportedMatches };
}

export async function GET(request: NextRequest) {
  try {
    const tournamentSlug = request.nextUrl.searchParams.get('tournament_slug');
    const categoryCode = request.nextUrl.searchParams.get('category_code');
    const venueCode = request.nextUrl.searchParams.get('venue_code');
    const date = request.nextUrl.searchParams.get('date');

    if (!tournamentSlug) {
      return NextResponse.json({ error: 'tournament_slug required' }, { status: 400 });
    }

    const client = getTournamentServiceClient();
    const { data: tournamentData, error: tournamentError } = await client
      .from('tournaments')
      .select('id, start_date, end_date')
      .eq('slug', tournamentSlug.trim().toLowerCase())
      .is('deleted_at', null)
      .single();

    if (tournamentError || !tournamentData) {
      return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
    }

    const tournament = tournamentData as TournamentRow;
    const imported = await loadImportedSchedule({
      client,
      tournament,
      categoryCode,
      venueCode,
      date,
    });

    if (imported === null) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    if (imported.publishedMatches.length > 0) {
      return NextResponse.json({
        tournament_slug: tournamentSlug,
        status: 'OFFICIAL',
        is_official: true,
        source: {
          type: 'tournament_database',
          fallback: false,
          note: 'Published Tournament V2 schedule',
        },
        competition_dates: {
          start: tournament.start_date,
          end: tournament.end_date,
        },
        total_matches: imported.publishedMatches.length,
        data: imported.publishedMatches,
      });
    }

    if (imported.hasAnyImportedMatches) {
      // Imports exist for this tournament but nothing is published yet.
      // Never expose draft/validated/revision_required rows here.
      return NextResponse.json({
        tournament_slug: tournamentSlug,
        status: 'NOT_PUBLISHED',
        is_official: false,
        source: {
          type: 'tournament_database',
          fallback: false,
          note: 'Schedule imported but not yet published',
        },
        competition_dates: {
          start: tournament.start_date,
          end: tournament.end_date,
        },
        total_matches: 0,
        data: [],
      });
    }

    // No imports exist at all for this tournament. Sample fallback is only
    // safe to serve for the tournament it was explicitly authored for —
    // never mix unrelated sample rows with a real tournament's public page.
    if (tournamentSlug.trim().toLowerCase() !== scheduleData.tournament_slug.trim().toLowerCase()) {
      return NextResponse.json({
        tournament_slug: tournamentSlug,
        status: 'NOT_PUBLISHED',
        is_official: false,
        source: {
          type: 'tournament_database',
          fallback: false,
          note: 'No schedule imported yet',
        },
        competition_dates: {
          start: tournament.start_date,
          end: tournament.end_date,
        },
        total_matches: 0,
        data: [],
      });
    }

    let matches: ScheduleMatch[] = scheduleData.matches.map((match) => ({ ...match }));
    if (categoryCode) {
      matches = matches.filter((match) => match.category_code === categoryCode.trim().toUpperCase());
    }
    if (venueCode) {
      matches = matches.filter((match) => match.venue_code === venueCode.trim().toUpperCase());
    }
    if (date) {
      matches = matches.filter((match) => match.date === date);
    }

    const resolvedMatches: ScheduleMatch[] = [];
    for (const match of matches) {
      const homeTeam = await resolveTeamForSlot(
        client,
        tournament.id,
        match.category_code,
        match.home_slot
      );
      const awayTeam = await resolveTeamForSlot(
        client,
        tournament.id,
        match.category_code,
        match.away_slot
      );
      resolvedMatches.push({ ...match, home_team: homeTeam, away_team: awayTeam });
    }

    return NextResponse.json({
      tournament_slug: tournamentSlug,
      status: scheduleData.status,
      is_official: scheduleData.is_official,
      source: scheduleData.source,
      competition_dates: scheduleData.competition_dates,
      total_matches: resolvedMatches.length,
      data: resolvedMatches,
    });
  } catch (error) {
    console.error('[SCHEDULE_GET] error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

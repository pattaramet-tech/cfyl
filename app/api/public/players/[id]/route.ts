import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { markSupersededLegacyRecords } from '@/lib/suspension-calc';
import {
  getSuspensionServingState,
  parseMatchdayNumber,
} from '@/lib/suspension-shared';
import {
  buildPublicPlayerSummary,
  getPublicSuspensionHistoryStatus,
} from '@/lib/public-player-detail';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const dynamic = 'force-dynamic';

type TeamMini = {
  id: string;
  name: string;
  short_name?: string | null;
  logo_url?: string | null;
};

type MatchRow = {
  id: string;
  match_code: string;
  matchday: string | number | null;
  match_date: string;
  match_time?: string | null;
  status: string;
  league_phase?: string | null;
  home_team_id: string;
  away_team_id: string;
  home_team?: TeamMini | TeamMini[] | null;
  away_team?: TeamMini | TeamMini[] | null;
};

type GoalRow = {
  id: string;
  match_id: string;
  goals?: number | null;
  minute?: number | null;
  is_own_goal?: boolean | null;
  note?: string | null;
  created_at?: string | null;
};

type CardRow = {
  id: string;
  match_id: string;
  card_type: string;
  minute?: number | null;
  note?: string | null;
  created_at?: string | null;
};

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function publicMatch(match: MatchRow | null | undefined, teamId: string) {
  if (!match) return null;
  const home = relationOne(match.home_team);
  const away = relationOne(match.away_team);
  const isHome = match.home_team_id === teamId;
  const opponent = isHome ? away : home;
  return {
    id: match.id,
    match_code: match.match_code,
    matchday: match.matchday,
    matchday_number: parseMatchdayNumber(match.matchday),
    match_date: match.match_date,
    match_time: match.match_time ?? null,
    status: match.status,
    league_phase: match.league_phase ?? 'regular',
    home_team_id: match.home_team_id,
    away_team_id: match.away_team_id,
    is_home: isHome,
    opponent: opponent
      ? { id: opponent.id, name: opponent.name, short_name: opponent.short_name ?? null }
      : null,
  };
}

function eventSortKey(match: ReturnType<typeof publicMatch>, minute?: number | null): string {
  if (!match) return `0000-00-00T00:00:00-${String(minute ?? -1).padStart(3, '0')}`;
  return `${match.match_date || '0000-00-00'}T${match.match_time || '00:00:00'}-${String(minute ?? -1).padStart(3, '0')}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Player ID required' }, { status: 400 });
    }

    const { data: player, error: playerError } = await supabaseAdmin
      .from('players')
      .select(
        'id, player_code, season_id, age_group_id, division_id, team_id, shirt_no, full_name, birth_date, remarks, active'
      )
      .eq('id', id)
      .maybeSingle();

    if (playerError) {
      console.error('[PUBLIC_PLAYER_DETAIL] Player query error:', playerError);
      return NextResponse.json({ error: 'ไม่สามารถโหลดข้อมูลนักกีฬาได้' }, { status: 500 });
    }
    if (!player) {
      return NextResponse.json({ error: 'ไม่พบนักกีฬานี้' }, { status: 404 });
    }

    const [teamResult, seasonResult, ageGroupResult, divisionResult, goalsResult, cardsResult, suspensionsResult, matchesResult] =
      await Promise.all([
        supabaseAdmin
          .from('teams')
          .select('id, name, short_name, logo_url')
          .eq('id', player.team_id)
          .maybeSingle(),
        supabaseAdmin
          .from('seasons')
          .select('id, name, year')
          .eq('id', player.season_id)
          .maybeSingle(),
        supabaseAdmin
          .from('age_groups')
          .select('id, code, name')
          .eq('id', player.age_group_id)
          .maybeSingle(),
        player.division_id
          ? supabaseAdmin
              .from('divisions')
              .select('id, name')
              .eq('id', player.division_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabaseAdmin
          .from('goals')
          .select('id, match_id, goals, minute, is_own_goal, note, created_at')
          .eq('player_id', id),
        supabaseAdmin
          .from('cards')
          .select('id, match_id, card_type, minute, note, created_at')
          .eq('player_id', id),
        supabaseAdmin
          .from('suspensions')
          .select(
            `id, season_id, age_group_id, player_id, team_id, total_points, point_sources,
             ban_matches, suspension_type, trigger_match_id, accumulated_threshold,
             source_card_ids, serving_match_ids, served_completed_at, legacy_migrated,
             suspended_from_match_id, suspension_reason, suspension_details, created_at, updated_at`
          )
          .eq('player_id', id)
          .eq('team_id', player.team_id)
          .eq('season_id', player.season_id)
          .eq('age_group_id', player.age_group_id),
        supabaseAdmin
          .from('matches')
          .select(
            `id, match_code, matchday, match_date, match_time, status, league_phase,
             home_team_id, away_team_id,
             home_team:home_team_id(id, name, short_name, logo_url),
             away_team:away_team_id(id, name, short_name, logo_url)`
          )
          .eq('season_id', player.season_id)
          .eq('age_group_id', player.age_group_id)
          .or(`home_team_id.eq.${player.team_id},away_team_id.eq.${player.team_id}`),
      ]);

    const relatedErrors = [
      teamResult.error,
      seasonResult.error,
      ageGroupResult.error,
      divisionResult.error,
      goalsResult.error,
      cardsResult.error,
      suspensionsResult.error,
      matchesResult.error,
    ].filter(Boolean);
    if (relatedErrors.length > 0) {
      console.error('[PUBLIC_PLAYER_DETAIL] Related query error:', relatedErrors[0]);
      return NextResponse.json({ error: 'ไม่สามารถโหลดรายละเอียดนักกีฬาได้' }, { status: 500 });
    }

    const goals = (goalsResult.data || []) as GoalRow[];
    const cards = (cardsResult.data || []) as CardRow[];
    const matches = (matchesResult.data || []) as MatchRow[];
    const matchMap = new Map(matches.map((match) => [match.id, match]));
    const statusMap = new Map(
      matches.map((match) => [match.id, { status: match.status }])
    );

    const summary = buildPublicPlayerSummary(cards, goals);
    const authoritativeSuspensions = markSupersededLegacyRecords(suspensionsResult.data || [])
      .filter((record) => !record._superseded && Number(record.ban_matches || 0) > 0)
      .map((record) => {
        const servingState = getSuspensionServingState(record, statusMap);
        const servingIds = Array.isArray(record.serving_match_ids)
          ? record.serving_match_ids.filter((matchId): matchId is string => typeof matchId === 'string')
          : [];
        return {
          id: record.id,
          suspension_type: record.suspension_type ?? 'legacy',
          accumulated_threshold: record.accumulated_threshold ?? null,
          total_points: Number(record.total_points || 0),
          point_sources: record.point_sources || [],
          ban_matches: Number(record.ban_matches || 0),
          suspension_reason: record.suspension_reason || null,
          suspension_details: record.suspension_details || null,
          trigger_match_id: record.trigger_match_id || null,
          suspended_from_match_id: record.suspended_from_match_id || null,
          serving_match_ids: servingIds,
          served_completed_at: record.served_completed_at || null,
          created_at: record.created_at || null,
          updated_at: record.updated_at || null,
          status: getPublicSuspensionHistoryStatus(record, statusMap),
          served_count: servingState.servedCount,
          remaining_count: servingState.remainingCount,
          trigger_match: record.trigger_match_id
            ? publicMatch(matchMap.get(record.trigger_match_id), player.team_id)
            : null,
          serving_matches: servingIds
            .map((matchId) => publicMatch(matchMap.get(matchId), player.team_id))
            .filter((match): match is NonNullable<typeof match> => match !== null),
        };
      })
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

    const goalEvents = goals
      .map((goal) => ({
        ...goal,
        goals: Number(goal.goals || 0),
        match: publicMatch(matchMap.get(goal.match_id), player.team_id),
      }))
      .sort((a, b) => eventSortKey(b.match, b.minute).localeCompare(eventSortKey(a.match, a.minute)));

    const cardEvents = cards
      .map((card) => ({
        ...card,
        match: publicMatch(matchMap.get(card.match_id), player.team_id),
      }))
      .sort((a, b) => eventSortKey(b.match, b.minute).localeCompare(eventSortKey(a.match, a.minute)));

    return NextResponse.json({
      player: {
        ...player,
        team: teamResult.data || null,
        season: seasonResult.data || null,
        age_group: ageGroupResult.data || null,
        division: divisionResult.data || null,
      },
      summary,
      goals: goalEvents,
      cards: cardEvents,
      suspensions: authoritativeSuspensions,
    });
  } catch (error) {
    console.error('[PUBLIC_PLAYER_DETAIL] API error:', error);
    return NextResponse.json({ error: 'ไม่สามารถโหลดรายละเอียดนักกีฬาได้' }, { status: 500 });
  }
}

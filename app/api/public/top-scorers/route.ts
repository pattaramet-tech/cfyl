import { supabase } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface PlayerRelation {
  player_code?: string | null;
  full_name?: string | null;
  shirt_no?: number | null;
  team_id?: string | null;
}

interface TeamRelation {
  name?: string | null;
  short_name?: string | null;
}

interface MatchRelation {
  season_id?: string | null;
  age_group_id?: string | null;
  division_id?: string | null;
}

interface GoalRecord {
  player_id?: string | null;
  is_own_goal?: boolean | null;
  player?: PlayerRelation | PlayerRelation[] | null;
  team?: TeamRelation | TeamRelation[] | null;
  match?: MatchRelation | MatchRelation[] | null;
  goals?: number | null;
}

interface ScopedGoalRecord extends Omit<GoalRecord, 'player_id' | 'player' | 'team' | 'match'> {
  player_id: string;
  player: PlayerRelation;
  team: TeamRelation | null;
  match: MatchRelation;
}

interface TopScorer {
  player_id: string;
  player_code: string;
  full_name: string;
  shirt_no: number | null;
  team_id: string | null;
  team_name: string;
  total_goals: number;
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const seasonId = searchParams.get('seasonId');
    const ageGroupId = searchParams.get('ageGroupId');
    const divisionId = searchParams.get('divisionId');
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const query = supabase
      .from('goals')
      .select(
        `
        player_id,
        is_own_goal,
        player:player_id(player_code, full_name, shirt_no, team_id),
        team:team_id(name, short_name),
        match:match_id(season_id, age_group_id, division_id),
        goals
      `
      )
      .eq('is_own_goal', false)
      .not('player_id', 'is', null);

    const { data: rawData, error } = await query;

    if (error) throw error;

    // Scope scoring events by the match that owns each goal, not mutable player metadata.
    // This keeps historical totals correct even when players.division_id is null/stale.
    const filteredRecords: ScopedGoalRecord[] = [];
    for (const record of (rawData || []) as unknown as GoalRecord[]) {
      const player = relationOne(record.player);
      const team = relationOne(record.team);
      const match = relationOne(record.match);

      if (!record.player_id || record.is_own_goal || !player || !match) {
        continue;
      }

      if (seasonId && match.season_id !== seasonId) {
        continue;
      }

      if (ageGroupId && match.age_group_id !== ageGroupId) {
        continue;
      }

      if (divisionId && match.division_id !== divisionId) {
        continue;
      }

      filteredRecords.push({
        ...record,
        player_id: record.player_id,
        player,
        team,
        match,
      });
    }

    const scorerMap = new Map<string, TopScorer>();

    filteredRecords.forEach((record) => {
      const key = record.player_id;
      if (!scorerMap.has(key)) {
        scorerMap.set(key, {
          player_id: record.player_id,
          player_code: record.player.player_code || '',
          full_name: record.player.full_name || 'ไม่ระบุชื่อ',
          shirt_no: record.player.shirt_no ?? null,
          team_id: record.player.team_id ?? null,
          team_name: record.team?.name || record.team?.short_name || 'ไม่ระบุทีม',
          total_goals: 0,
        });
      }
      const scorer = scorerMap.get(key);
      if (scorer) {
        scorer.total_goals += Number(record.goals || 1);
      }
    });

    let scorers = Array.from(scorerMap.values());

    // Sort by goals (desc), name (asc)
    scorers.sort((a, b) => {
      if (b.total_goals !== a.total_goals) return b.total_goals - a.total_goals;
      return a.full_name.localeCompare(b.full_name);
    });

    // Apply limit
    scorers = scorers.slice(0, limit);

    return NextResponse.json(scorers);
  } catch (error) {
    console.error('[PUBLIC_TOP_SCORERS] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch top scorers' },
      { status: 500 }
    );
  }
}

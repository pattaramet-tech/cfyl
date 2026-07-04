import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

type QualitySeverity = 'error' | 'warning' | 'info';

interface QualityIssue {
  id: string;
  severity: QualitySeverity;
  category: string;
  title: string;
  description: string;
  entity_type: 'match' | 'team' | 'player' | 'card' | 'suspension' | 'staff' | 'staff_discipline';
  entity_id?: string | null;
  match_id?: string | null;
  team_id?: string | null;
  action_url?: string | null;
  meta?: Record<string, any>;
}

interface QualitySummary {
  errors: number;
  warnings: number;
  infos: number;
  total: number;
}

interface DataQualityResponse {
  summary: QualitySummary;
  issues: QualityIssue[];
  checked_at: string;
}

export const dynamic = 'force-dynamic';

function getGoalTeamId(goal: any): string | null {
  // team_id หมายถึงทีมที่ได้รับประตูเสมอ รวมถึง Own Goal
  if (goal.team_id) return goal.team_id;

  // fallback สำหรับข้อมูลเก่าที่ goal ไม่มี team_id
  return goal.player?.team_id || null;
}

function getGoalValue(goal: any): number {
  const value = Number(goal.goals ?? goal.goal_count ?? 1);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return value;
}

function isByeResult(match: any): boolean {
  return match.result_type === 'home_win_by_bye' || match.result_type === 'away_win_by_bye';
}

function isOwnGoal(goal: any): boolean {
  return goal.is_own_goal === true;
}

function sumGoalsForTeam(matchGoals: any[], teamId: string): number {
  return matchGoals
    .filter((g: any) => getGoalTeamId(g) === teamId)
    .reduce((sum: number, g: any) => sum + getGoalValue(g), 0);
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const seasonId = searchParams.get('seasonId');
    const ageGroupId = searchParams.get('ageGroupId');
    const divisionId = searchParams.get('divisionId');

    if (!seasonId || !ageGroupId) {
      return NextResponse.json(
        { error: 'seasonId and ageGroupId are required' },
        { status: 400 }
      );
    }

    const issues: QualityIssue[] = [];
    let issueCounter = 0;

    // Fetch matches
    let matchQuery = supabaseAdmin
      .from('matches')
      .select(`
        id, matchday, status, home_score, away_score, result_type,
        home_team_id, away_team_id, match_date, match_time,
        home_team:home_team_id(name),
        away_team:away_team_id(name)
      `)
      .eq('season_id', seasonId)
      .eq('age_group_id', ageGroupId);

    if (divisionId) {
      matchQuery = matchQuery.eq('division_id', divisionId);
    }

    const { data: matches, error: matchError } = await matchQuery;
    if (matchError) {
      console.error('Error fetching matches:', matchError);
      return NextResponse.json({ error: 'Failed to fetch matches' }, { status: 500 });
    }

    const matchIds = (matches || []).map((m: any) => m.id);

    // Fetch related data in batch
    const [{ data: goals }, { data: cards }, { data: staffDiscipline }, { data: suspensions }, { data: teams }, { data: players }, { data: staffs }] = await Promise.all([
      supabaseAdmin
        .from('goals')
        .select(`
          id,
          match_id,
          team_id,
          player_id,
          goals,
          is_own_goal,
          note,
          player:player_id(id, full_name, shirt_no, team_id)
        `)
        .in('match_id', matchIds),
      supabaseAdmin
        .from('cards')
        .select('match_id, player_id, card_type, team_id, player:player_id(team_id)')
        .in('match_id', matchIds),
      supabaseAdmin
        .from('staff_discipline_events')
        .select('id, match_id, discipline_type, reason, suspended_matches, status')
        .in('match_id', matchIds),
      supabaseAdmin
        .from('suspensions')
        .select('player_id, team_id, ban_matches, suspended_from_match_id')
        .eq('season_id', seasonId)
        .eq('age_group_id', ageGroupId),
      supabaseAdmin
        .from('teams')
        .select('id, name, logo_url, division_id')
        .eq('season_id', seasonId)
        .eq('age_group_id', ageGroupId),
      supabaseAdmin
        .from('players')
        .select('id, full_name, shirt_no, team_id')
        .eq('season_id', seasonId)
        .eq('age_group_id', ageGroupId),
      supabaseAdmin
        .from('team_staffs')
        .select('id, full_name, position, team_id')
        .eq('season_id', seasonId)
        .eq('age_group_id', ageGroupId),
    ]);

    // Check 1: Match finished but no score
    (matches || []).forEach((match: any) => {
      if (match.status === 'finished' && (match.home_score === null || match.away_score === null)) {
        issues.push({
          id: `check1_${issueCounter++}`,
          severity: 'error',
          category: 'Match Result',
          title: 'แมตช์จบแล้วแต่ยังไม่มีสกอร์',
          description: `MD${match.matchday} ${match.home_team?.name} vs ${match.away_team?.name}`,
          entity_type: 'match',
          entity_id: match.id,
          match_id: match.id,
          action_url: `/admin/matches/manage?matchId=${match.id}`,
        });
      }
    });

    // Check 2: Score mismatch with goals (including Own Goals)
    (matches || []).forEach((match: any) => {
      if (match.status === 'finished' && !isByeResult(match)) {
        const matchGoals = (goals || []).filter((g: any) => g.match_id === match.id);
        const homeGoals = sumGoalsForTeam(matchGoals, match.home_team_id);
        const awayGoals = sumGoalsForTeam(matchGoals, match.away_team_id);
        const ownGoalRecords = matchGoals.filter((g: any) => isOwnGoal(g));
        const normalGoalRecords = matchGoals.filter((g: any) => !isOwnGoal(g));

        if (homeGoals !== (match.home_score || 0) || awayGoals !== (match.away_score || 0)) {
          issues.push({
            id: `check2_${issueCounter++}`,
            severity: 'error',
            category: 'Score Consistency',
            title: 'สกอร์ไม่ตรงกับจำนวนประตูที่บันทึก',
            description: `MD${match.matchday} ${match.home_team?.name} ${match.home_score}-${match.away_score} ${match.away_team?.name} แต่จำนวนประตูที่บันทึก ${homeGoals}-${awayGoals}${ownGoalRecords.length ? ` (รวม Own Goal ${ownGoalRecords.length} รายการ)` : ''}`,
            entity_type: 'match',
            entity_id: match.id,
            match_id: match.id,
            action_url: `/admin/goals?matchId=${match.id}`,
            meta: {
              home_score: match.home_score,
              away_score: match.away_score,
              home_goals: homeGoals,
              away_goals: awayGoals,
              match_goal_records: matchGoals.length,
              own_goal_records: ownGoalRecords.length,
              normal_goal_records: normalGoalRecords.length,
            },
          });
        }
      }
    });

    // Check 3: Scheduled match but has score/goals/cards/staff_discipline
    (matches || []).forEach((match: any) => {
      if (match.status === 'scheduled') {
        const hasScore = match.home_score !== null || match.away_score !== null;
        const hasGoals = (goals || []).some((g: any) => g.match_id === match.id);
        const hasCards = (cards || []).some((c: any) => c.match_id === match.id);
        const hasStaffDiscipline = (staffDiscipline || []).some((sd: any) => sd.match_id === match.id);

        if (hasScore || hasGoals || hasCards || hasStaffDiscipline) {
          issues.push({
            id: `check3_${issueCounter++}`,
            severity: 'warning',
            category: 'Match Status',
            title: 'แมตช์ยังไม่จบแต่มีข้อมูลการแข่งขันแล้ว',
            description: `MD${match.matchday} ${match.home_team?.name} vs ${match.away_team?.name}`,
            entity_type: 'match',
            entity_id: match.id,
            match_id: match.id,
            action_url: `/admin/matches/manage?matchId=${match.id}`,
          });
        }
      }
    });

    // Check 4: Match finished with score > 0 but no goals/own goals
    (matches || []).forEach((match: any) => {
      if (match.status === 'finished' && !isByeResult(match)) {
        const totalScore = (match.home_score || 0) + (match.away_score || 0);
        const matchGoals = (goals || []).filter((g: any) => g.match_id === match.id);

        if (totalScore > 0 && matchGoals.length === 0) {
          issues.push({
            id: `check4_${issueCounter++}`,
            severity: 'warning',
            category: 'Goal Data',
            title: 'มีสกอร์แต่ยังไม่มีข้อมูลประตู',
            description: `MD${match.matchday} ${match.home_team?.name} ${match.home_score}-${match.away_score} ${match.away_team?.name} แต่ยังไม่มีรายการประตูหรือ Own Goal`,
            entity_type: 'match',
            entity_id: match.id,
            match_id: match.id,
            action_url: `/admin/goals?matchId=${match.id}`,
          });
        }
      }
    });

    // Check 5A: Own Goal must have team_id
    (goals || []).forEach((goal: any) => {
      if (isOwnGoal(goal) && !goal.team_id) {
        issues.push({
          id: `check5a_${issueCounter++}`,
          severity: 'error',
          category: 'Goal Data',
          title: 'Own Goal ไม่มีทีมที่ได้รับประตู',
          description: `Goal ${goal.id || ''} เป็น Own Goal แต่ไม่มี team_id จึงไม่สามารถนับสกอร์ได้`,
          entity_type: 'match',
          entity_id: goal.match_id,
          match_id: goal.match_id,
          team_id: null,
          action_url: `/admin/goals?matchId=${goal.match_id}`,
          meta: {
            goal_id: goal.id,
            is_own_goal: goal.is_own_goal,
            team_id: goal.team_id,
            player_id: goal.player_id,
          },
        });
      }
    });

    // Check 5B: Normal goal (not own goal) must have player_id
    (goals || []).forEach((goal: any) => {
      if (!isOwnGoal(goal) && !goal.player_id) {
        issues.push({
          id: `check5b_${issueCounter++}`,
          severity: 'error',
          category: 'Goal Data',
          title: 'รายการประตูไม่มีผู้ทำประตู',
          description: `Goal ${goal.id || ''} ไม่ใช่ Own Goal แต่ไม่มี player_id`,
          entity_type: 'match',
          entity_id: goal.match_id,
          match_id: goal.match_id,
          team_id: goal.team_id || null,
          action_url: `/admin/goals?matchId=${goal.match_id}`,
          meta: {
            goal_id: goal.id,
            is_own_goal: goal.is_own_goal,
            team_id: goal.team_id,
            player_id: goal.player_id,
          },
        });
      }
    });

    // Check 6: Red/second_yellow card but no suspension
    (cards || []).forEach((card: any) => {
      if (card.card_type === 'red' || card.card_type === 'second_yellow') {
        const suspension = (suspensions || []).find(
          (s: any) => s.player_id === card.player_id && s.team_id === card.team_id
        );

        if (!suspension || suspension.ban_matches === 0) {
          issues.push({
            id: `check6_${issueCounter++}`,
            severity: 'error',
            category: 'Suspension',
            title: 'มีใบแดง/ใบเหลืองที่ 2 แต่ยังไม่เกิดโทษแบน',
            description: `ผู้เล่น ${card.player_id} ได้${card.card_type === 'red' ? 'ใบแดง' : 'ใบเหลืองที่ 2'} แต่ไม่มีรายการแบน`,
            entity_type: 'card',
            entity_id: card.id,
            match_id: card.match_id,
            action_url: '/admin/suspensions',
          });
        }
      }
    });

    // Check 7: Suspension with ban but no suspended_from_match_id
    (suspensions || []).forEach((susp: any) => {
      if (susp.ban_matches > 0 && !susp.suspended_from_match_id) {
        issues.push({
          id: `check7_${issueCounter++}`,
          severity: 'warning',
          category: 'Suspension',
          title: 'มีโทษแบนแต่ไม่พบแมตช์ถัดไป',
          description: 'อาจเป็นเพราะทีมไม่มีโปรแกรมถัดไปแล้ว หรือข้อมูลโปรแกรมยังไม่ครบ',
          entity_type: 'suspension',
          entity_id: susp.player_id,
          team_id: susp.team_id,
          action_url: '/admin/suspensions',
        });
      }
    });

    // Check 8: Staff discipline without reason
    (staffDiscipline || []).forEach((sd: any) => {
      if (sd.status === 'active' && (!sd.reason || sd.reason.trim() === '')) {
        issues.push({
          id: `check8_${issueCounter++}`,
          severity: 'warning',
          category: 'Staff Discipline',
          title: 'บันทึกโทษเจ้าหน้าที่ทีมไม่มีเหตุผล',
          description: `Event ${sd.id}`,
          entity_type: 'staff_discipline',
          entity_id: sd.id,
          match_id: sd.match_id,
          action_url: `/admin/staff-discipline`,
        });
      }
    });

    // Check 9: Staff discipline ejection/ban without suspended_matches
    (staffDiscipline || []).forEach((sd: any) => {
      if ((sd.discipline_type === 'ejection' || sd.discipline_type === 'ban') && (sd.suspended_matches === 0 || !sd.suspended_matches)) {
        issues.push({
          id: `check9_${issueCounter++}`,
          severity: 'warning',
          category: 'Staff Discipline',
          title: 'เจ้าหน้าที่ทีมถูกไล่ออก/แบน แต่ยังไม่ได้ระบุจำนวนแมตช์ที่แบน',
          description: `Event ${sd.id}`,
          entity_type: 'staff_discipline',
          entity_id: sd.id,
          match_id: sd.match_id,
        });
      }
    });

    // Check 9: Team without logo
    (teams || []).forEach((team: any) => {
      if (!team.logo_url || team.logo_url.trim() === '') {
        issues.push({
          id: `check9_${issueCounter++}`,
          severity: 'info',
          category: 'Team Profile',
          title: 'ทีมยังไม่มีโลโก้',
          description: team.name,
          entity_type: 'team',
          entity_id: team.id,
          team_id: team.id,
          action_url: '/admin/teams/logos',
        });
      }
    });

    // Check 10: Player without shirt_no
    (players || []).forEach((player: any) => {
      if (!player.shirt_no) {
        issues.push({
          id: `check10_${issueCounter++}`,
          severity: 'warning',
          category: 'Player Profile',
          title: 'นักเตะยังไม่มีเบอร์เสื้อ',
          description: `${player.full_name}`,
          entity_type: 'player',
          entity_id: player.id,
          team_id: player.team_id,
        });
      }
    });

    // Check 11: Duplicate player names in same team
    const playersByTeam = new Map<string, any[]>();
    (players || []).forEach((player: any) => {
      if (!playersByTeam.has(player.team_id)) {
        playersByTeam.set(player.team_id, []);
      }
      playersByTeam.get(player.team_id)!.push(player);
    });

    playersByTeam.forEach((teamPlayers, teamId) => {
      const nameMap = new Map<string, any[]>();
      teamPlayers.forEach((p: any) => {
        const normalized = (p.full_name || '').trim().toLowerCase();
        if (!nameMap.has(normalized)) {
          nameMap.set(normalized, []);
        }
        nameMap.get(normalized)!.push(p);
      });

      nameMap.forEach((dupes, normalized) => {
        if (dupes.length > 1) {
          issues.push({
            id: `check11_${issueCounter++}`,
            severity: 'warning',
            category: 'Player Profile',
            title: 'พบนักเตะชื่อซ้ำในทีมเดียวกัน',
            description: `${dupes[0].full_name}`,
            entity_type: 'player',
            entity_id: dupes[0].id,
            team_id: teamId,
            meta: { duplicates: dupes.map((p: any) => p.id) },
          });
        }
      });
    });

    // Check 12: Duplicate staff names in same team
    const staffByTeam = new Map<string, any[]>();
    (staffs || []).forEach((staff: any) => {
      if (!staffByTeam.has(staff.team_id)) {
        staffByTeam.set(staff.team_id, []);
      }
      staffByTeam.get(staff.team_id)!.push(staff);
    });

    staffByTeam.forEach((teamStaffs, teamId) => {
      const nameMap = new Map<string, any[]>();
      teamStaffs.forEach((s: any) => {
        const normalized = (s.full_name || '').trim().toLowerCase();
        if (!nameMap.has(normalized)) {
          nameMap.set(normalized, []);
        }
        nameMap.get(normalized)!.push(s);
      });

      nameMap.forEach((dupes, normalized) => {
        if (dupes.length > 1) {
          issues.push({
            id: `check12_${issueCounter++}`,
            severity: 'info',
            category: 'Staff Profile',
            title: 'พบเจ้าหน้าที่ทีมชื่อซ้ำในทีมเดียวกัน',
            description: `${dupes[0].full_name}`,
            entity_type: 'staff',
            entity_id: dupes[0].id,
            team_id: teamId,
            meta: { duplicates: dupes.map((s: any) => s.id) },
          });
        }
      });
    });

    // Check 5C: Bye result validation
    (matches || []).forEach((match: any) => {
      if (match.result_type === 'home_win_by_bye') {
        if (match.status !== 'finished') {
          issues.push({
            id: `check5c_${issueCounter++}`,
            severity: 'error',
            category: 'Bye Result',
            title: 'ผลชนะบายไม่สอดคล้องกับสถานะ',
            description: `MD${match.matchday} ${match.home_team?.name} vs ${match.away_team?.name} marked as home_win_by_bye but status is ${match.status}, should be finished`,
            entity_type: 'match',
            entity_id: match.id,
            match_id: match.id,
            action_url: `/admin/matches/manage?matchId=${match.id}`,
          });
        }
        if ((match.home_score || 0) <= (match.away_score || 0)) {
          issues.push({
            id: `check5c_${issueCounter++}`,
            severity: 'error',
            category: 'Bye Result',
            title: 'ผลชนะบายไม่สอดคล้องกับสกอร์',
            description: `MD${match.matchday} ${match.home_team?.name} vs ${match.away_team?.name} marked as home_win_by_bye but score is ${match.home_score}-${match.away_score}, home should win`,
            entity_type: 'match',
            entity_id: match.id,
            match_id: match.id,
            action_url: `/admin/matches/manage?matchId=${match.id}`,
          });
        }
      } else if (match.result_type === 'away_win_by_bye') {
        if (match.status !== 'finished') {
          issues.push({
            id: `check5c_${issueCounter++}`,
            severity: 'error',
            category: 'Bye Result',
            title: 'ผลชนะบายไม่สอดคล้องกับสถานะ',
            description: `MD${match.matchday} ${match.home_team?.name} vs ${match.away_team?.name} marked as away_win_by_bye but status is ${match.status}, should be finished`,
            entity_type: 'match',
            entity_id: match.id,
            match_id: match.id,
            action_url: `/admin/matches/manage?matchId=${match.id}`,
          });
        }
        if ((match.away_score || 0) <= (match.home_score || 0)) {
          issues.push({
            id: `check5c_${issueCounter++}`,
            severity: 'error',
            category: 'Bye Result',
            title: 'ผลชนะบายไม่สอดคล้องกับสกอร์',
            description: `MD${match.matchday} ${match.home_team?.name} vs ${match.away_team?.name} marked as away_win_by_bye but score is ${match.home_score}-${match.away_score}, away should win`,
            entity_type: 'match',
            entity_id: match.id,
            match_id: match.id,
            action_url: `/admin/matches/manage?matchId=${match.id}`,
          });
        }
      }
    });

    // Calculate summary
    const summary: QualitySummary = {
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      infos: issues.filter((i) => i.severity === 'info').length,
      total: issues.length,
    };

    const response: DataQualityResponse = {
      summary,
      issues,
      checked_at: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[DATA_QUALITY] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

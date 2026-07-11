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
        // Check if ANY suspension exists for this player with ban_matches > 0
        // (event-based system can have multiple records per player)
        const hasBan = (suspensions || []).some(
          (s: any) => s.player_id === card.player_id && s.team_id === card.team_id && s.ban_matches > 0
        );

        if (!hasBan) {
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

    // ── Event-based Suspension Quality (17 rules) ──────────────────────────
    // Fetch full event records for event-based checks
    const SYSTEM_TYPES_DQ = ['accumulated_points', 'second_yellow', 'direct_red', 'yellow_red'];
    const { data: eventSuspensions } = await supabaseAdmin
      .from('suspensions')
      .select(`
        id, player_id, team_id, suspension_type, trigger_match_id,
        accumulated_threshold, source_card_ids, serving_match_ids,
        ban_matches, served_completed_at
      `)
      .eq('season_id', seasonId)
      .eq('age_group_id', ageGroupId)
      .in('suspension_type', SYSTEM_TYPES_DQ);

    const systemEvents = eventSuspensions || [];

    // Batch-fetch all referenced matches and cards
    const dqServingIds = [...new Set(systemEvents.flatMap((r: any) => r.serving_match_ids || []))];
    const dqTriggerIds = [...new Set(systemEvents.map((r: any) => r.trigger_match_id).filter(Boolean) as string[])];
    const dqSourceCardIds = [...new Set(systemEvents.flatMap((r: any) => r.source_card_ids || []))];
    const dqAllMatchIds = [...new Set([...dqServingIds, ...dqTriggerIds])];

    const dqMatchMap = new Map<string, any>();
    if (dqAllMatchIds.length > 0) {
      const { data: dqMatchRows } = await supabaseAdmin
        .from('matches')
        .select('id, status, season_id, age_group_id, home_team_id, away_team_id, match_date')
        .in('id', dqAllMatchIds);
      for (const m of dqMatchRows || []) dqMatchMap.set(m.id, m);
    }

    const dqCardMap = new Map<string, any>();
    if (dqSourceCardIds.length > 0) {
      const { data: dqCardRows } = await supabaseAdmin
        .from('cards')
        .select('id, player_id, match_id, card_type')
        .in('id', dqSourceCardIds);
      for (const c of dqCardRows || []) dqCardMap.set(c.id, c);
    }

    // EVENT_DUPLICATE_KEY
    const dqKeyCount = new Map<string, number>();
    systemEvents.forEach((r: any) => {
      const k = `${r.player_id}::${r.team_id}::${r.trigger_match_id}::${r.suspension_type}::${r.accumulated_threshold ?? 0}`;
      dqKeyCount.set(k, (dqKeyCount.get(k) ?? 0) + 1);
    });
    systemEvents.forEach((r: any) => {
      const k = `${r.player_id}::${r.team_id}::${r.trigger_match_id}::${r.suspension_type}::${r.accumulated_threshold ?? 0}`;
      if ((dqKeyCount.get(k) ?? 0) > 1) {
        issues.push({
          id: `dq_dup_${issueCounter++}`, severity: 'error', category: 'Suspension Event',
          title: 'EVENT_DUPLICATE_KEY: พบ Event ซ้ำกัน',
          description: `Duplicate key for suspension id=${r.id} (${r.suspension_type})`,
          entity_type: 'suspension', entity_id: r.id, team_id: r.team_id,
          action_url: '/admin/suspensions',
        });
      }
    });

    // Per-event source_card and trigger checks
    systemEvents.forEach((r: any) => {
      const triggerMatch = r.trigger_match_id ? dqMatchMap.get(r.trigger_match_id) : null;
      const triggerDate: string | null = triggerMatch?.match_date ?? null;

      // SOURCE_CARD_NOT_FOUND / WRONG_PLAYER / WRONG_MATCH
      (r.source_card_ids || []).forEach((cId: string) => {
        const card = dqCardMap.get(cId);
        if (!card) {
          issues.push({
            id: `dq_scnf_${issueCounter++}`, severity: 'error', category: 'Suspension Event',
            title: 'SOURCE_CARD_NOT_FOUND: ไม่พบใบที่อ้างอิงใน source_card_ids',
            description: `suspension id=${r.id}: card ${cId} not in public.cards`,
            entity_type: 'suspension', entity_id: r.id, team_id: r.team_id,
            action_url: '/admin/suspensions',
          });
        } else {
          if (card.player_id !== r.player_id) {
            issues.push({
              id: `dq_scwp_${issueCounter++}`, severity: 'error', category: 'Suspension Event',
              title: 'SOURCE_CARD_WRONG_PLAYER: Card ของผู้เล่นผิดคน',
              description: `suspension id=${r.id}: card ${cId} belongs to ${card.player_id}`,
              entity_type: 'suspension', entity_id: r.id, team_id: r.team_id, action_url: '/admin/suspensions',
            });
          }
          if (r.trigger_match_id && card.match_id !== r.trigger_match_id) {
            issues.push({
              id: `dq_scwm_${issueCounter++}`, severity: 'warning', category: 'Suspension Event',
              title: 'SOURCE_CARD_WRONG_MATCH: Card ไม่ได้อยู่ใน trigger match',
              description: `suspension id=${r.id}: card ${cId} is from match ${card.match_id}`,
              entity_type: 'suspension', entity_id: r.id, team_id: r.team_id, action_url: '/admin/suspensions',
            });
          }
        }
      });

      // TRIGGER_MATCH_NOT_FOUND
      if (!r.trigger_match_id) {
        issues.push({
          id: `dq_tmnf_${issueCounter++}`, severity: 'error', category: 'Suspension Event',
          title: 'TRIGGER_MATCH_NOT_FOUND: ไม่มี trigger_match_id',
          description: `suspension id=${r.id} (${r.suspension_type}) has no trigger_match_id`,
          entity_type: 'suspension', entity_id: r.id, team_id: r.team_id, action_url: '/admin/suspensions',
        });
      } else if (!triggerMatch) {
        issues.push({
          id: `dq_tmnf2_${issueCounter++}`, severity: 'error', category: 'Suspension Event',
          title: 'TRIGGER_MATCH_NOT_FOUND: trigger_match_id ไม่พบในตาราง matches',
          description: `suspension id=${r.id}: trigger_match_id=${r.trigger_match_id} not found`,
          entity_type: 'suspension', entity_id: r.id, team_id: r.team_id, action_url: '/admin/suspensions',
        });
      } else {
        // TRIGGER_MATCH_HAS_NO_SOURCE_CARD
        const hasCard = (r.source_card_ids || []).some(
          (cId: string) => dqCardMap.get(cId)?.match_id === r.trigger_match_id
        );
        if (!hasCard) {
          issues.push({
            id: `dq_tmnsc_${issueCounter++}`, severity: 'error', category: 'Suspension Event',
            title: 'TRIGGER_MATCH_HAS_NO_SOURCE_CARD: ไม่มี Card จาก trigger match',
            description: `suspension id=${r.id}: no source_card links trigger match ${r.trigger_match_id}`,
            entity_type: 'suspension', entity_id: r.id, team_id: r.team_id, action_url: '/admin/suspensions',
          });
        }
      }

      // serving_match_ids checks
      (r.serving_match_ids || []).forEach((sId: string) => {
        const sm = dqMatchMap.get(sId);
        if (!sm) {
          issues.push({
            id: `dq_smnf_${issueCounter++}`, severity: 'error', category: 'Suspension Event',
            title: 'SERVING_MATCH_NOT_FOUND: ไม่พบ serving match',
            description: `suspension id=${r.id}: serving match ${sId} not in matches table`,
            entity_type: 'suspension', entity_id: r.id, team_id: r.team_id, action_url: '/admin/suspensions',
          });
        } else {
          if (sm.status === 'postponed') {
            issues.push({
              id: `dq_smp_${issueCounter++}`, severity: 'warning', category: 'Suspension Event',
              title: 'SERVING_MATCH_POSTPONED: Serving match ถูกเลื่อน',
              description: `suspension id=${r.id}: serving match ${sId} is postponed`,
              entity_type: 'suspension', entity_id: r.id, team_id: r.team_id,
              match_id: sId, action_url: '/admin/suspensions',
            });
          }
          if (sm.status === 'cancelled') {
            issues.push({
              id: `dq_smc_${issueCounter++}`, severity: 'warning', category: 'Suspension Event',
              title: 'SERVING_MATCH_CANCELLED: Serving match ถูกยกเลิก',
              description: `suspension id=${r.id}: serving match ${sId} is cancelled`,
              entity_type: 'suspension', entity_id: r.id, team_id: r.team_id,
              match_id: sId, action_url: '/admin/suspensions',
            });
          }
          if (triggerDate && sm.match_date && sm.match_date <= triggerDate) {
            issues.push({
              id: `dq_smbt_${issueCounter++}`, severity: 'error', category: 'Suspension Event',
              title: 'SERVING_MATCH_BEFORE_TRIGGER: Serving match ก่อน trigger',
              description: `suspension id=${r.id}: serving ${sId} (${sm.match_date}) ≤ trigger (${triggerDate})`,
              entity_type: 'suspension', entity_id: r.id, team_id: r.team_id,
              match_id: sId, action_url: '/admin/suspensions',
            });
          }
          if (sm.home_team_id !== r.team_id && sm.away_team_id !== r.team_id) {
            issues.push({
              id: `dq_smwt_${issueCounter++}`, severity: 'error', category: 'Suspension Event',
              title: 'SERVING_MATCH_WRONG_TEAM: ทีมไม่ได้แข่งใน serving match นี้',
              description: `suspension id=${r.id}: team ${r.team_id} not in serving match ${sId}`,
              entity_type: 'suspension', entity_id: r.id, team_id: r.team_id,
              match_id: sId, action_url: '/admin/suspensions',
            });
          }
          if (sm.season_id !== seasonId || sm.age_group_id !== ageGroupId) {
            issues.push({
              id: `dq_smws_${issueCounter++}`, severity: 'error', category: 'Suspension Event',
              title: 'SERVING_MATCH_WRONG_SEASON: Serving match ต่าง Season/AgeGroup',
              description: `suspension id=${r.id}: serving match ${sId} has season/ag mismatch`,
              entity_type: 'suspension', entity_id: r.id, team_id: r.team_id,
              match_id: sId, action_url: '/admin/suspensions',
            });
          }
        }
      });

      // BAN_SLOT_COUNT_MISMATCH
      if ((r.serving_match_ids || []).length > r.ban_matches) {
        issues.push({
          id: `dq_bsc_${issueCounter++}`, severity: 'error', category: 'Suspension Event',
          title: 'BAN_SLOT_COUNT_MISMATCH: จำนวน serving slots เกิน ban_matches',
          description: `suspension id=${r.id}: ${r.serving_match_ids?.length} serving slots but ban_matches=${r.ban_matches}`,
          entity_type: 'suspension', entity_id: r.id, team_id: r.team_id, action_url: '/admin/suspensions',
        });
      }

      // SERVED_COMPLETED_AT_INCONSISTENT
      if (r.ban_matches > 0) {
        const finishedCount = (r.serving_match_ids || []).filter(
          (id: string) => dqMatchMap.get(id)?.status === 'finished'
        ).length;
        const isComplete = !!r.served_completed_at;
        if (isComplete && finishedCount < r.ban_matches) {
          issues.push({
            id: `dq_sca1_${issueCounter++}`, severity: 'warning', category: 'Suspension Event',
            title: 'SERVED_COMPLETED_AT_INCONSISTENT: แบนยังไม่ครบแต่ served_completed_at ถูกตั้งไว้',
            description: `suspension id=${r.id}: ${finishedCount}/${r.ban_matches} slots finished but completed_at is set`,
            entity_type: 'suspension', entity_id: r.id, team_id: r.team_id, action_url: '/admin/suspensions',
          });
        }
        if (!isComplete && finishedCount >= r.ban_matches && r.ban_matches > 0) {
          issues.push({
            id: `dq_sca2_${issueCounter++}`, severity: 'warning', category: 'Suspension Event',
            title: 'SERVED_COMPLETED_AT_INCONSISTENT: แบนครบแล้วแต่ served_completed_at ยังเป็น null',
            description: `suspension id=${r.id}: all ${r.ban_matches} slot(s) finished but completed_at is null`,
            entity_type: 'suspension', entity_id: r.id, team_id: r.team_id, action_url: '/admin/suspensions',
          });
        }
      }

      // ACTIVE_BAN_WITHOUT_REMAINING_SCHEDULED_MATCH
      if (r.ban_matches > 0 && !r.served_completed_at) {
        const scheduledCount = (r.serving_match_ids || []).filter(
          (id: string) => dqMatchMap.get(id)?.status === 'scheduled'
        ).length;
        if (scheduledCount === 0) {
          issues.push({
            id: `dq_abwrs_${issueCounter++}`, severity: 'warning', category: 'Suspension Event',
            title: 'ACTIVE_BAN_WITHOUT_REMAINING_SCHEDULED_MATCH: แบนค้างอยู่ ไม่พบนัดถัดไป',
            description: `suspension id=${r.id}: ban_matches=${r.ban_matches} active but no scheduled serving match`,
            entity_type: 'suspension', entity_id: r.id, team_id: r.team_id, action_url: '/admin/suspensions',
          });
        }
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

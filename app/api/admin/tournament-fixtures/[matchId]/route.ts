import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
import { FIXTURE_STAGES, isLegacyTournamentV1Fixture } from '@/lib/tournament-fixtures';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const dynamic = 'force-dynamic';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated || !auth.profile) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  if (!auth.profile.can_edit_matches) {
    return NextResponse.json({ error: 'You do not have permission to edit matches' }, { status: 403 });
  }

  const { data: existing } = await supabaseAdmin
    .from('matches')
    .select('id, season_id, age_group_id, division_id, match_code, stage, league_phase, status, tournament_group_id, home_team_id, away_team_id')
    .eq('id', matchId)
    .single();
  if (!existing) return NextResponse.json({ error: 'ไม่พบแมตช์' }, { status: 404 });
  if (!isLegacyTournamentV1Fixture(existing)) {
    return NextResponse.json(
      { error: 'Route นี้แก้ไขได้เฉพาะ Tournament V1 fixture เท่านั้น' },
      { status: 409 }
    );
  }
  if (existing.status === 'finished') {
    return NextResponse.json(
      { error: 'แมตช์ที่แข่งจบแล้วเป็น read-only ใน Tournament fixture editor' },
      { status: 409 }
    );
  }

  const body = await request.json();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.matchday !== undefined) updates.matchday = String(body.matchday).trim();
  if (body.date !== undefined) updates.match_date = String(body.date).trim() || null;
  if (body.time !== undefined) updates.match_time = String(body.time).trim() || null;
  if (body.venue !== undefined) updates.venue = String(body.venue).trim() || null;
  if (body.status !== undefined) {
    if (!['scheduled', 'finished', 'postponed', 'cancelled'].includes(body.status)) {
      return NextResponse.json({ error: 'status ไม่ถูกต้อง' }, { status: 400 });
    }
    updates.status = body.status;
  }
  if (body.stage !== undefined) {
    const stage = String(body.stage).trim() || 'group';
    if (!FIXTURE_STAGES.includes(stage as (typeof FIXTURE_STAGES)[number])) {
      return NextResponse.json({ error: `stage ไม่ถูกต้อง (${FIXTURE_STAGES.join('/')})` }, { status: 400 });
    }
    updates.stage = stage;
  }
  if (body.groupId !== undefined) updates.tournament_group_id = body.groupId || null;

  const homeId = body.home_team_id ?? existing.home_team_id;
  const awayId = body.away_team_id ?? existing.away_team_id;
  if (homeId === awayId) {
    return NextResponse.json({ error: 'home_team กับ away_team ต้องไม่ใช่ทีมเดียวกัน' }, { status: 400 });
  }

  const { data: scopedTeams, error: scopedTeamsError } = await supabaseAdmin
    .from('teams')
    .select('id, season_id, age_group_id, division_id')
    .in('id', [homeId, awayId]);
  if (scopedTeamsError) {
    return NextResponse.json({ error: 'ตรวจสอบขอบเขตทีมไม่สำเร็จ' }, { status: 500 });
  }
  const scopedTeamMap = new Map((scopedTeams || []).map((team) => [team.id, team]));
  for (const teamId of [homeId, awayId]) {
    const team = scopedTeamMap.get(teamId);
    if (
      !team ||
      team.season_id !== existing.season_id ||
      team.age_group_id !== existing.age_group_id ||
      team.division_id != null
    ) {
      return NextResponse.json(
        { error: 'Tournament V1 fixture ใช้ได้เฉพาะทีม Tournament ใน season/age group เดียวกัน' },
        { status: 400 }
      );
    }
  }

  if (body.home_team_id !== undefined) updates.home_team_id = homeId;
  if (body.away_team_id !== undefined) updates.away_team_id = awayId;

  // match_code uniqueness within season (if changed)
  if (body.match_code !== undefined) {
    const code = String(body.match_code).trim();
    if (!code) return NextResponse.json({ error: 'ต้องระบุ match_code' }, { status: 400 });
    if (code !== existing.match_code) {
      const { data: dup } = await supabaseAdmin
        .from('matches').select('id').eq('season_id', existing.season_id).eq('match_code', code).neq('id', matchId).maybeSingle();
      if (dup) return NextResponse.json({ error: `match_code "${code}" ซ้ำในฤดูกาล` }, { status: 409 });
    }
    updates.match_code = code;
  }

  // group membership (if both team + group resolvable)
  const finalGroup = body.groupId !== undefined ? (body.groupId || null) : existing.tournament_group_id;
  if (finalGroup) {
    const { data: gm } = await supabaseAdmin
      .from('tournament_group_teams').select('team_id').eq('group_id', finalGroup).in('team_id', [homeId, awayId]);
    const inGroup = new Set((gm || []).map((r) => r.team_id));
    if (!inGroup.has(homeId) || !inGroup.has(awayId)) {
      return NextResponse.json({ error: 'ทั้งสองทีมต้องอยู่ในกลุ่มที่เลือก' }, { status: 400 });
    }
  }

  const { data: updated, error } = await supabaseAdmin
    .from('matches').update(updates).eq('id', matchId)
    .select('id, match_code, stage, status').single();
  if (error) {
    return NextResponse.json({ error: 'แก้ไขแมตช์ไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 });
  }

  await logAdminAction({
    admin: { id: auth.profile.id, email: auth.profile.email },
    action: 'tournament_fixture.update',
    entityType: 'match',
    entityId: matchId,
    entityLabel: updated.match_code,
    newData: updates,
  });

  return NextResponse.json({ success: true, match: updated });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated || !auth.profile) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  if (!auth.profile.can_edit_matches) {
    return NextResponse.json({ error: 'You do not have permission to edit matches' }, { status: 403 });
  }

  const { data: match } = await supabaseAdmin
    .from('matches')
    .select('id, match_code, division_id, stage, league_phase, status')
    .eq('id', matchId)
    .single();
  if (!match) return NextResponse.json({ error: 'ไม่พบแมตช์' }, { status: 404 });
  if (!isLegacyTournamentV1Fixture(match)) {
    return NextResponse.json(
      { error: 'Route นี้ลบได้เฉพาะ Tournament V1 fixture เท่านั้น' },
      { status: 409 }
    );
  }
  if (match.status === 'finished') {
    return NextResponse.json(
      { error: 'แมตช์ที่แข่งจบแล้วเป็น read-only ใน Tournament fixture editor' },
      { status: 409 }
    );
  }

  // Block delete if results recorded (goals/cards)
  const [{ count: goals }, { count: cards }] = await Promise.all([
    supabaseAdmin.from('goals').select('id', { count: 'exact', head: true }).eq('match_id', matchId),
    supabaseAdmin.from('cards').select('id', { count: 'exact', head: true }).eq('match_id', matchId),
  ]);
  if ((goals || 0) > 0 || (cards || 0) > 0) {
    return NextResponse.json(
      { error: `ลบไม่ได้ — แมตช์นี้มีประตู ${goals} / ใบ ${cards} บันทึกไว้แล้ว` },
      { status: 409 }
    );
  }

  const { error } = await supabaseAdmin.from('matches').delete().eq('id', matchId);
  if (error) {
    return NextResponse.json({ error: 'ลบแมตช์ไม่สำเร็จ' }, { status: 500 });
  }

  await logAdminAction({
    admin: { id: auth.profile.id, email: auth.profile.email },
    action: 'tournament_fixture.delete',
    entityType: 'match',
    entityId: matchId,
    entityLabel: match.match_code,
  });

  return NextResponse.json({ success: true });
}

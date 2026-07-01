import { supabase } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import * as ExcelJS from 'exceljs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const seasonId = searchParams.get('seasonId');
    const ageGroupId = searchParams.get('ageGroupId');
    const divisionId = searchParams.get('divisionId');

    if (!seasonId || !ageGroupId) {
      return NextResponse.json(
        { error: 'seasonId และ ageGroupId จำเป็น' },
        { status: 400 }
      );
    }

    // Fetch teams first
    const teamsResult = await supabase
      .from('teams')
      .select('id, name, short_name, age_group_id, division_id, division:division_id(name)')
      .eq('season_id', seasonId)
      .eq('age_group_id', ageGroupId);

    const teamsData: any[] = (teamsResult.data || []).map((t: any) => ({
      team_id: t.id,
      team_name: t.name,
      short_name: t.short_name,
      age_group: ageGroupId,
      division: t.division?.name,
    }));

    const teamIds = teamsData.map((t: any) => t.team_id);

    // Fetch all other data
    const [playersData, staffData, matchesData, goalsData, cardsData, staffDisciplineData] =
      await Promise.all([
        supabase
          .from('players')
          .select('id, team_id, shirt_no, full_name, active, team:team_id(age_group_id)')
          .then(({ data }) =>
            (data || [])
              .filter((p: any) => p.team?.age_group_id === ageGroupId)
              .map((p: any) => ({
                player_id: p.id,
                team_id: p.team_id,
                team_name: p.team_id,
                short_name: p.team_id,
                shirt_no: p.shirt_no,
                full_name: p.full_name,
                active: p.active,
              }))
          ),

        supabase
          .from('team_staffs')
          .select('id, team_id, full_name, position, active, team:team_id(age_group_id)')
          .then(({ data }) =>
            (data || [])
              .filter((s: any) => s.team?.age_group_id === ageGroupId)
              .map((s: any) => ({
                staff_id: s.id,
                team_id: s.team_id,
                team_name: s.team_id,
                short_name: s.team_id,
                staff_name: s.full_name,
                position: s.position,
                active: s.active,
              }))
          ),

        supabase
          .from('matches')
          .select(
            `id, matchday, match_date, match_time, status, home_score, away_score,
             division:division_id(name),
             home_team:home_team_id(name, short_name),
             away_team:away_team_id(name, short_name)`
          )
          .eq('season_id', seasonId)
          .eq('age_group_id', ageGroupId)
          .then(({ data }) => data || []),

        supabase
          .from('goals')
          .select('id, match_id, player_id, team_id, goals, minute, player:player_id(full_name, shirt_no), team:team_id(name, short_name)')
          .in('team_id', teamIds)
          .then(({ data }) => data || []),

        supabase
          .from('cards')
          .select(
            'id, match_id, player_id, team_id, card_type, minute, note, player:player_id(full_name, shirt_no), team:team_id(name, short_name)'
          )
          .in('team_id', teamIds)
          .then(({ data }) => data || []),

        supabase
          .from('staff_discipline_events')
          .select(
            'id, match_id, staff_id, team_id, discipline_type, minute, reason, suspended_matches, staff:staff_id(full_name, position), team:team_id(name, short_name)'
          )
          .in('team_id', teamIds)
          .then(({ data }) => data || []),
      ]);

    // Get team name mapping
    const teamMap = new Map(teamsData.map((t: any) => [t.team_id, t.team_name]));

    // Fetch players with full team info
    const playersWithTeams = await supabase
      .from('players')
      .select('id, team_id, shirt_no, full_name, active, team:team_id(name)')
      .then(({ data }) =>
        (data || [])
          .filter((p: any) => teamsData.some((t: any) => t.team_id === p.team_id))
          .map((p: any) => ({
            player_id: p.id,
            team_id: p.team_id,
            team_name: p.team?.name,
            shirt_no: p.shirt_no,
            full_name: p.full_name,
            active: p.active,
          }))
      );

    // Create workbook
    const workbook = new ExcelJS.Workbook();

    // Sheet 1: README
    const readmeSheet = workbook.addWorksheet('README');
    readmeSheet.columns = [{ header: '', key: 'content', width: 80 }];
    readmeSheet.addRows([
      { content: 'CFYL Current Data Export' },
      { content: '' },
      { content: 'ไฟล์นี้เป็น Current Data Export' },
      { content: 'ใช้สำหรับแก้ข้อมูลเดิมและนำกลับเข้า Bulk Import ได้' },
      { content: '' },
      { content: 'ข้อควรระวัง (สำคัญ):' },
      { content: '1. Matches และ PlayerUpdates สามารถใช้แก้ข้อมูลเดิมได้' },
      { content: '2. Goals / Cards / StaffDiscipline ใน Phase 1 เป็น Append Only' },
      { content: '3. ถ้านำ Current Data ที่มี event เดิมกลับเข้าไป จะเกิดข้อมูลซ้ำ' },
      { content: '4. หากต้องการแก้ event เดิม ให้แก้ใน Match Management หรือรอ Replace Mode (Phase 2)' },
      { content: '' },
      { content: 'วิธีใช้:' },
      { content: '1. แก้ข้อมูลใน Matches / Goals / Cards / StaffDiscipline / PlayerUpdates' },
      { content: '2. เก็บชื่อ Ref sheets ไว้ (ห้ามแก้ชื่อ sheets)' },
      { content: '3. Upload ไปที่ Preview & Apply' },
      { content: '' },
      { content: 'ID Columns (สำหรับอ้างอิง):' },
      { content: 'goal_id / card_id / event_id ใช้เพื่ออ้างอิงข้อมูลเดิมเท่านั้น' },
      { content: 'ใน Phase 1 ยังไม่สามารถ update event เดิมได้ เฉพาะ append ใหม่' },
    ]);

    // Function to create ref sheet
    const createRefSheet = (name: string, columns: any[], data: any[]) => {
      const sheet = workbook.addWorksheet(name);
      sheet.columns = columns;
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } };
      sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
      sheet.addRows(data);
      columns.forEach((col, i) => {
        sheet.getColumn(i + 1).width = 18;
      });
    };

    // Ref sheets
    createRefSheet(
      'TeamsRef',
      [
        { header: 'team_id', key: 'team_id', width: 20 },
        { header: 'team_name', key: 'team_name', width: 30 },
        { header: 'short_name', key: 'short_name', width: 15 },
        { header: 'age_group', key: 'age_group', width: 15 },
        { header: 'division', key: 'division', width: 15 },
      ],
      teamsData
    );

    createRefSheet(
      'PlayersRef',
      [
        { header: 'player_id', key: 'player_id', width: 20 },
        { header: 'team_id', key: 'team_id', width: 20 },
        { header: 'team_name', key: 'team_name', width: 25 },
        { header: 'short_name', key: 'short_name', width: 15 },
        { header: 'shirt_no', key: 'shirt_no', width: 10 },
        { header: 'full_name', key: 'full_name', width: 25 },
        { header: 'active', key: 'active', width: 10 },
      ],
      playersData
    );

    createRefSheet(
      'StaffRef',
      [
        { header: 'staff_id', key: 'staff_id', width: 20 },
        { header: 'team_id', key: 'team_id', width: 20 },
        { header: 'team_name', key: 'team_name', width: 25 },
        { header: 'short_name', key: 'short_name', width: 15 },
        { header: 'staff_name', key: 'staff_name', width: 25 },
        { header: 'position', key: 'position', width: 20 },
        { header: 'active', key: 'active', width: 10 },
      ],
      staffData
    );

    const matchesRefData = matchesData.map((m: any) => ({
      match_id: m.id,
      matchday: m.matchday,
      match_date: m.match_date,
      match_time: m.match_time,
      division: m.division?.name,
      home_team: m.home_team?.name,
      away_team: m.away_team?.name,
      status: m.status,
      home_score: m.home_score,
      away_score: m.away_score,
    }));

    createRefSheet(
      'MatchesRef',
      [
        { header: 'match_id', key: 'match_id', width: 20 },
        { header: 'matchday', key: 'matchday', width: 12 },
        { header: 'match_date', key: 'match_date', width: 15 },
        { header: 'match_time', key: 'match_time', width: 12 },
        { header: 'division', key: 'division', width: 15 },
        { header: 'home_team', key: 'home_team', width: 25 },
        { header: 'away_team', key: 'away_team', width: 25 },
        { header: 'status', key: 'status', width: 15 },
        { header: 'home_score', key: 'home_score', width: 12 },
        { header: 'away_score', key: 'away_score', width: 12 },
      ],
      matchesRefData
    );

    // Input sheets with current data
    const matchesDataRows = matchesData.map((m: any) => ({
      match_id: m.id,
      matchday: m.matchday,
      match_date: m.match_date,
      match_time: m.match_time,
      home_team: m.home_team?.name,
      away_team: m.away_team?.name,
      home_score: m.home_score,
      away_score: m.away_score,
      status: m.status,
      note: null,
    }));

    const matchesSheet = workbook.addWorksheet('Matches');
    matchesSheet.columns = [
      { header: 'match_id *', key: 'match_id', width: 20 },
      { header: 'matchday', key: 'matchday', width: 12 },
      { header: 'match_date', key: 'match_date', width: 15 },
      { header: 'match_time', key: 'match_time', width: 12 },
      { header: 'home_team', key: 'home_team', width: 25 },
      { header: 'away_team', key: 'away_team', width: 25 },
      { header: 'home_score', key: 'home_score', width: 12 },
      { header: 'away_score', key: 'away_score', width: 12 },
      { header: 'status', key: 'status', width: 15 },
      { header: 'note', key: 'note', width: 20 },
    ];
    matchesSheet.getRow(1).font = { bold: true };
    matchesSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
    matchesSheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
    matchesSheet.addRows(matchesDataRows);

    // Goals sheet
    const goalsDataRows = goalsData.map((g: any) => ({
      goal_id: g.id,
      match_id: g.match_id,
      matchday: matchesData.find((m: any) => m.id === g.match_id)?.matchday,
      team: g.team?.name,
      shirt_no: g.player?.shirt_no,
      player_name: g.player?.full_name,
      goals: g.goals,
      minute: g.minute,
      note: null,
    }));

    const goalsSheet = workbook.addWorksheet('Goals');
    goalsSheet.columns = [
      { header: 'goal_id', key: 'goal_id', width: 20 },
      { header: 'match_id *', key: 'match_id', width: 20 },
      { header: 'matchday', key: 'matchday', width: 12 },
      { header: 'team *', key: 'team', width: 25 },
      { header: 'shirt_no *', key: 'shirt_no', width: 10 },
      { header: 'player_name', key: 'player_name', width: 25 },
      { header: 'goals', key: 'goals', width: 10 },
      { header: 'minute', key: 'minute', width: 10 },
      { header: 'note', key: 'note', width: 20 },
    ];
    goalsSheet.getRow(1).font = { bold: true };
    goalsSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
    goalsSheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
    goalsSheet.addRows(goalsDataRows);

    // Cards sheet
    const cardsDataRows = cardsData.map((c: any) => ({
      card_id: c.id,
      match_id: c.match_id,
      matchday: matchesData.find((m: any) => m.id === c.match_id)?.matchday,
      team: c.team?.name,
      shirt_no: c.player?.shirt_no,
      player_name: c.player?.full_name,
      card_type: c.card_type,
      minute: c.minute,
      count: 1,
      reason: null,
      note: c.note,
    }));

    const cardsSheet = workbook.addWorksheet('Cards');
    cardsSheet.columns = [
      { header: 'card_id', key: 'card_id', width: 20 },
      { header: 'match_id *', key: 'match_id', width: 20 },
      { header: 'matchday', key: 'matchday', width: 12 },
      { header: 'team *', key: 'team', width: 25 },
      { header: 'shirt_no *', key: 'shirt_no', width: 10 },
      { header: 'player_name', key: 'player_name', width: 25 },
      { header: 'card_type *', key: 'card_type', width: 15 },
      { header: 'minute', key: 'minute', width: 10 },
      { header: 'count', key: 'count', width: 8 },
      { header: 'reason', key: 'reason', width: 20 },
      { header: 'note', key: 'note', width: 20 },
    ];
    cardsSheet.getRow(1).font = { bold: true };
    cardsSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
    cardsSheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
    cardsSheet.addRows(cardsDataRows);

    // StaffDiscipline sheet
    const staffDisciplineDataRows = staffDisciplineData.map((s: any) => ({
      event_id: s.id,
      match_id: s.match_id,
      matchday: matchesData.find((m: any) => m.id === s.match_id)?.matchday,
      team: s.team?.name,
      staff_name: s.staff?.full_name,
      position: s.staff?.position,
      discipline_type: s.discipline_type,
      minute: s.minute,
      reason: s.reason,
      suspended_matches: s.suspended_matches,
      note: null,
    }));

    const staffDisciplineSheet = workbook.addWorksheet('StaffDiscipline');
    staffDisciplineSheet.columns = [
      { header: 'event_id', key: 'event_id', width: 20 },
      { header: 'match_id *', key: 'match_id', width: 20 },
      { header: 'matchday', key: 'matchday', width: 12 },
      { header: 'team *', key: 'team', width: 25 },
      { header: 'staff_name *', key: 'staff_name', width: 25 },
      { header: 'position', key: 'position', width: 20 },
      { header: 'discipline_type *', key: 'discipline_type', width: 15 },
      { header: 'minute', key: 'minute', width: 10 },
      { header: 'reason', key: 'reason', width: 20 },
      { header: 'suspended_matches', key: 'suspended_matches', width: 12 },
      { header: 'note', key: 'note', width: 20 },
    ];
    staffDisciplineSheet.getRow(1).font = { bold: true };
    staffDisciplineSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
    staffDisciplineSheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
    staffDisciplineSheet.addRows(staffDisciplineDataRows);

    // PlayerUpdates sheet
    const playerUpdatesDataRows = playersWithTeams.map((p: any) => ({
      player_id: p.player_id,
      team: p.team_name,
      shirt_no: p.shirt_no,
      old_full_name: p.full_name,
      new_prefix: null,
      new_full_name: p.full_name,
      new_shirt_no: p.shirt_no,
      active: p.active,
      note: null,
    }));

    const playerUpdatesSheet = workbook.addWorksheet('PlayerUpdates');
    playerUpdatesSheet.columns = [
      { header: 'player_id', key: 'player_id', width: 20 },
      { header: 'team', key: 'team', width: 25 },
      { header: 'shirt_no', key: 'shirt_no', width: 10 },
      { header: 'old_full_name', key: 'old_full_name', width: 25 },
      { header: 'new_prefix', key: 'new_prefix', width: 15 },
      { header: 'new_full_name', key: 'new_full_name', width: 25 },
      { header: 'new_shirt_no', key: 'new_shirt_no', width: 12 },
      { header: 'active', key: 'active', width: 10 },
      { header: 'note', key: 'note', width: 20 },
    ];
    playerUpdatesSheet.getRow(1).font = { bold: true };
    playerUpdatesSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
    playerUpdatesSheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
    playerUpdatesSheet.addRows(playerUpdatesDataRows);

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Generate filename
    const ageGroupName = (await supabase
      .from('age_groups')
      .select('code')
      .eq('id', ageGroupId)
      .maybeSingle()
      .then(({ data }) => data?.code)) || 'all';

    const filename = divisionId
      ? `cfyl-current-data-${ageGroupName}-${divisionId}.xlsx`
      : `cfyl-current-data-${ageGroupName}-all.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('[MATCH_BULK_EXPORT_CURRENT] Error:', error);
    return NextResponse.json(
      { error: 'ไม่สามารถ export ข้อมูลได้' },
      { status: 500 }
    );
  }
}

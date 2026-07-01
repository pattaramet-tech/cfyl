import { supabase } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import * as ExcelJS from 'exceljs';
import {
  TeamRef,
  PlayerRef,
  StaffRef,
  MatchRef,
} from '@/types/bulk-import';

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

    // Fetch reference data
    const [teamsRes, playersRes, staffRes, matchesRes] = await Promise.all([
      supabase
        .from('teams')
        .select('id, name, short_name, age_group_id, division_id, division:division_id(name), age_group:age_group_id(code, name)')
        .eq('season_id', seasonId)
        .eq('age_group_id', ageGroupId)
        .then(({ data }) =>
          (data || []).map((t: any) => ({
            team_id: t.id,
            team_name: t.name,
            short_name: t.short_name,
            age_group: t.age_group?.name,
            division: t.division?.name,
          }))
        ),

      supabase
        .from('players')
        .select('id, team_id, shirt_no, full_name, active, team:team_id(name, short_name, age_group_id)')
        .then(({ data }) =>
          (data || [])
            .filter((p: any) => p.team?.age_group_id === ageGroupId)
            .map((p: any) => ({
              player_id: p.id,
              team_id: p.team_id,
              team_name: p.team?.name,
              short_name: p.team?.short_name,
              shirt_no: p.shirt_no,
              full_name: p.full_name,
              active: p.active,
            }))
        ),

      supabase
        .from('team_staffs')
        .select('id, team_id, full_name, position, active, team:team_id(name, short_name, age_group_id)')
        .then(({ data }) =>
          (data || [])
            .filter((s: any) => s.team?.age_group_id === ageGroupId)
            .map((s: any) => ({
              staff_id: s.id,
              team_id: s.team_id,
              team_name: s.team?.name,
              short_name: s.team?.short_name,
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
        .then(({ data }) =>
          (data || []).map((m: any) => ({
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
          }))
        ),
    ]);

    // Create workbook
    const workbook = new ExcelJS.Workbook();

    // Sheet 1: README
    const readmeSheet = workbook.addWorksheet('README');
    readmeSheet.columns = [{ header: '', key: 'content', width: 80 }];
    readmeSheet.addRows([
      { content: 'CFYL Match Bulk Import Template' },
      { content: '' },
      { content: 'วิธีใช้:' },
      { content: '1. ห้ามแก้ไข id ใน sheets Ref (TeamsRef, PlayersRef, StaffRef, MatchesRef)' },
      { content: '2. กรอกข้อมูลใน sheets: Matches / Goals / Cards / StaffDiscipline / PlayerUpdates' },
      { content: '3. ใช้ชื่อทีม + เบอร์เสื้อ หรือ ID ได้โดยตรง' },
      { content: '4. ก่อน Apply จะ Preview & Validate ก่อน' },
      { content: '5. ถ้ามี Error ต้องแก้ไฟล์ก่อน' },
      { content: '' },
      { content: 'สำคัญ:' },
      { content: '- Goals / Cards / StaffDiscipline เป็น append only' },
      { content: '- ถ้า import ซ้ำ อาจเกิดข้อมูลซ้ำ' },
      { content: '- Matches & PlayerUpdates จะ update/replace' },
      { content: '' },
      { content: 'Column ที่ต้องกรอก เครื่องหมาย * = บังคับ' },
      { content: '- Matches: match_id* home_score away_score status' },
      { content: '- Goals: match_id* team* shirt_no* goals minute' },
      { content: '- Cards: match_id* team* shirt_no* card_type* minute' },
      { content: '- StaffDiscipline: match_id* team* staff_name* discipline_type*' },
      { content: '- PlayerUpdates: player_id* new_full_name หรือ new_prefix' },
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
    createRefSheet('TeamsRef', [
      { header: 'team_id', key: 'team_id', width: 20 },
      { header: 'team_name', key: 'team_name', width: 30 },
      { header: 'short_name', key: 'short_name', width: 15 },
      { header: 'age_group', key: 'age_group', width: 15 },
      { header: 'division', key: 'division', width: 15 },
    ], teamsRes as any[]);

    createRefSheet('PlayersRef', [
      { header: 'player_id', key: 'player_id', width: 20 },
      { header: 'team_id', key: 'team_id', width: 20 },
      { header: 'team_name', key: 'team_name', width: 25 },
      { header: 'short_name', key: 'short_name', width: 15 },
      { header: 'shirt_no', key: 'shirt_no', width: 10 },
      { header: 'full_name', key: 'full_name', width: 25 },
      { header: 'active', key: 'active', width: 10 },
    ], playersRes as any[]);

    createRefSheet('StaffRef', [
      { header: 'staff_id', key: 'staff_id', width: 20 },
      { header: 'team_id', key: 'team_id', width: 20 },
      { header: 'team_name', key: 'team_name', width: 25 },
      { header: 'short_name', key: 'short_name', width: 15 },
      { header: 'staff_name', key: 'staff_name', width: 25 },
      { header: 'position', key: 'position', width: 20 },
      { header: 'active', key: 'active', width: 10 },
    ], staffRes as any[]);

    createRefSheet('MatchesRef', [
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
    ], matchesRes as any[]);

    // Function to create input sheet
    const createInputSheet = (name: string, columns: any[], sampleData: any[] = []) => {
      const sheet = workbook.addWorksheet(name);
      sheet.columns = columns;
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
      sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
      if (sampleData.length > 0) {
        sheet.addRows(sampleData);
      }
      columns.forEach((col, i) => {
        sheet.getColumn(i + 1).width = 16;
      });
    };

    // Input sheets
    createInputSheet('Matches', [
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
    ]);

    createInputSheet('Goals', [
      { header: 'match_id *', key: 'match_id', width: 20 },
      { header: 'matchday', key: 'matchday', width: 12 },
      { header: 'team *', key: 'team', width: 25 },
      { header: 'shirt_no *', key: 'shirt_no', width: 10 },
      { header: 'player_name', key: 'player_name', width: 25 },
      { header: 'goals', key: 'goals', width: 10 },
      { header: 'minute', key: 'minute', width: 10 },
      { header: 'note', key: 'note', width: 20 },
    ]);

    createInputSheet('Cards', [
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
    ]);

    createInputSheet('StaffDiscipline', [
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
    ]);

    createInputSheet('PlayerUpdates', [
      { header: 'player_id', key: 'player_id', width: 20 },
      { header: 'team', key: 'team', width: 25 },
      { header: 'shirt_no', key: 'shirt_no', width: 10 },
      { header: 'old_full_name', key: 'old_full_name', width: 25 },
      { header: 'new_prefix', key: 'new_prefix', width: 15 },
      { header: 'new_full_name', key: 'new_full_name', width: 25 },
      { header: 'new_shirt_no', key: 'new_shirt_no', width: 12 },
      { header: 'active', key: 'active', width: 10 },
      { header: 'note', key: 'note', width: 20 },
    ]);

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="cfyl-match-bulk-template.xlsx"',
      },
    });
  } catch (error) {
    console.error('[MATCH_BULK_TEMPLATE] Error:', error);
    return NextResponse.json(
      { error: 'ไม่สามารถสร้าง template ได้' },
      { status: 500 }
    );
  }
}

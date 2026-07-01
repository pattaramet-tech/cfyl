import { supabase } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import * as ExcelJS from 'exceljs';
import {
  BulkImportPreviewResponse,
  BulkImportRowResult,
  MatchesRow,
  GoalsRow,
  CardsRow,
  StaffDisciplineRow,
  PlayerUpdatesRow,
} from '@/types/bulk-import';
import {
  validateScore,
  validateMinute,
  validateCardType,
  validateDisciplineType,
  validateMatchStatus,
  validateGoalsCount,
  validateCardCount,
  validateShirtNo,
  getCellValue,
  trimString,
  createValidResult,
  createWarningResult,
  createErrorResult,
} from '@/lib/bulk-import-utils';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const seasonId = formData.get('seasonId') as string;
    const ageGroupId = formData.get('ageGroupId') as string;
    const divisionId = formData.get('divisionId') as string | null;

    if (!file || !seasonId || !ageGroupId) {
      return NextResponse.json(
        { error: 'file, seasonId, ageGroupId จำเป็น' },
        { status: 400 }
      );
    }

    // Parse Excel
    const buffer = await file.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    // Fetch reference data
    const [teamsData, playersData, staffData, matchesData] = await Promise.all([
      supabase
        .from('teams')
        .select('id, name, short_name')
        .eq('season_id', seasonId)
        .eq('age_group_id', ageGroupId)
        .then(({ data }) => data || []),

      supabase
        .from('players')
        .select('id, team_id, shirt_no, full_name, team:team_id(age_group_id)')
        .then(({ data }) =>
          (data || []).filter((p: any) => p.team?.age_group_id === ageGroupId)
        ),

      supabase
        .from('team_staffs')
        .select('id, team_id, full_name, position, team:team_id(age_group_id)')
        .then(({ data }) =>
          (data || []).filter((s: any) => s.team?.age_group_id === ageGroupId)
        ),

      supabase
        .from('matches')
        .select('id, matchday, match_date, match_time, home_team_id, away_team_id, status')
        .eq('season_id', seasonId)
        .eq('age_group_id', ageGroupId)
        .then(({ data }) => data || []),
    ]);

    const results: BulkImportRowResult[] = [];
    let summary = {
      matches: 0,
      goals: 0,
      cards: 0,
      staffDiscipline: 0,
      playerUpdates: 0,
      errors: 0,
      warnings: 0,
    };

    // Helper functions
    const findTeam = (nameOrId: string) =>
      teamsData.find(
        (t: any) => t.id === nameOrId || t.name === nameOrId || t.short_name === nameOrId
      );

    const findPlayer = (teamId: string, shirtNo: number, name?: string) =>
      playersData.find(
        (p: any) =>
          p.team_id === teamId &&
          (p.shirt_no === shirtNo || (name && p.full_name.includes(name)))
      );

    const findStaff = (teamId: string, name: string, position?: string) =>
      staffData.filter(
        (s: any) =>
          s.team_id === teamId &&
          (s.full_name === name || s.full_name.includes(name))
      );

    const findMatch = (id: string) => matchesData.find((m: any) => m.id === id);

    // Process each sheet
    const processMatches = () => {
      const sheet = workbook.getWorksheet('Matches');
      if (!sheet) return;

      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;

        const matchId = trimString(getCellValue(row.getCell(1)));
        const homeScore = getCellValue(row.getCell(7));
        const awayScore = getCellValue(row.getCell(8));
        const status = trimString(getCellValue(row.getCell(9)));

        if (!matchId) {
          results.push(createErrorResult('Matches', rowNumber, 'update_match', 'match_id จำเป็น'));
          summary.errors++;
          return;
        }

        const match = findMatch(matchId);
        if (!match) {
          results.push(createErrorResult('Matches', rowNumber, 'update_match', `ไม่พบ match_id: ${matchId}`));
          summary.errors++;
          return;
        }

        const homeScoreResult = validateScore(homeScore);
        if (!homeScoreResult.valid) {
          results.push(
            createErrorResult('Matches', rowNumber, 'update_match', homeScoreResult.error!)
          );
          summary.errors++;
          return;
        }

        const awayScoreResult = validateScore(awayScore);
        if (!awayScoreResult.valid) {
          results.push(
            createErrorResult('Matches', rowNumber, 'update_match', awayScoreResult.error!)
          );
          summary.errors++;
          return;
        }

        let statusNorm: string | null = status || null;
        if (status) {
          const statusResult = validateMatchStatus(status);
          if (!statusResult.valid) {
            results.push(
              createErrorResult('Matches', rowNumber, 'update_match', statusResult.error!)
            );
            summary.errors++;
            return;
          }
          statusNorm = statusResult.normalized || null;
        }

        results.push(
          createValidResult('Matches', rowNumber, 'update_match', {
            match_id: matchId,
            home_score: homeScoreResult.value,
            away_score: awayScoreResult.value,
            status: statusNorm,
          })
        );
        summary.matches++;
      });
    };

    const processGoals = () => {
      const sheet = workbook.getWorksheet('Goals');
      if (!sheet) return;

      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;

        const matchId = trimString(getCellValue(row.getCell(1)));
        const teamName = trimString(getCellValue(row.getCell(3)));
        const shirtNo = getCellValue(row.getCell(4));
        const playerName = trimString(getCellValue(row.getCell(5)));
        const goals = getCellValue(row.getCell(6));
        const minute = getCellValue(row.getCell(7));

        if (!matchId) {
          results.push(createErrorResult('Goals', rowNumber, 'insert_goal', 'match_id จำเป็น'));
          summary.errors++;
          return;
        }

        if (!teamName) {
          results.push(createErrorResult('Goals', rowNumber, 'insert_goal', 'team จำเป็น'));
          summary.errors++;
          return;
        }

        if (shirtNo === null || shirtNo === undefined || shirtNo === '') {
          results.push(
            createErrorResult('Goals', rowNumber, 'insert_goal', 'shirt_no จำเป็น')
          );
          summary.errors++;
          return;
        }

        const match = findMatch(matchId);
        if (!match) {
          results.push(
            createErrorResult('Goals', rowNumber, 'insert_goal', `ไม่พบ match_id: ${matchId}`)
          );
          summary.errors++;
          return;
        }

        const team = findTeam(teamName);
        if (!team) {
          results.push(
            createErrorResult('Goals', rowNumber, 'insert_goal', `ไม่พบทีม: ${teamName}`)
          );
          summary.errors++;
          return;
        }

        const shirtNoResult = validateShirtNo(shirtNo);
        if (!shirtNoResult.valid) {
          results.push(
            createErrorResult('Goals', rowNumber, 'insert_goal', shirtNoResult.error!)
          );
          summary.errors++;
          return;
        }

        const player = findPlayer(team.id, shirtNoResult.value!, playerName || undefined);
        if (!player) {
          results.push(
            createErrorResult(
              'Goals',
              rowNumber,
              'insert_goal',
              `ไม่พบนักเตะ ${team.name} #${shirtNoResult.value}`
            )
          );
          summary.errors++;
          return;
        }

        const goalsResult = validateGoalsCount(goals);
        if (!goalsResult.valid) {
          results.push(
            createErrorResult('Goals', rowNumber, 'insert_goal', goalsResult.error!)
          );
          summary.errors++;
          return;
        }

        const minuteResult = validateMinute(minute);
        if (!minuteResult.valid) {
          results.push(
            createErrorResult('Goals', rowNumber, 'insert_goal', minuteResult.error!)
          );
          summary.errors++;
          return;
        }

        results.push(
          createValidResult('Goals', rowNumber, 'insert_goal', {
            match_id: matchId,
            player_id: player.id,
            team_id: team.id,
            goals: goalsResult.value,
            minute: minuteResult.value,
          })
        );
        summary.goals++;
      });
    };

    const processCards = () => {
      const sheet = workbook.getWorksheet('Cards');
      if (!sheet) return;

      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;

        const matchId = trimString(getCellValue(row.getCell(1)));
        const teamName = trimString(getCellValue(row.getCell(3)));
        const shirtNo = getCellValue(row.getCell(4));
        const playerName = trimString(getCellValue(row.getCell(5)));
        const cardType = trimString(getCellValue(row.getCell(6)));
        const minute = getCellValue(row.getCell(7));
        const count = getCellValue(row.getCell(8));

        if (!matchId || !teamName || !cardType) {
          results.push(
            createErrorResult(
              'Cards',
              rowNumber,
              'insert_card',
              'match_id, team, card_type จำเป็น'
            )
          );
          summary.errors++;
          return;
        }

        if (shirtNo === null || shirtNo === undefined || shirtNo === '') {
          results.push(
            createErrorResult('Cards', rowNumber, 'insert_card', 'shirt_no จำเป็น')
          );
          summary.errors++;
          return;
        }

        const cardTypeResult = validateCardType(cardType);
        if (!cardTypeResult.valid) {
          results.push(
            createErrorResult('Cards', rowNumber, 'insert_card', cardTypeResult.error!)
          );
          summary.errors++;
          return;
        }

        const match = findMatch(matchId);
        if (!match) {
          results.push(
            createErrorResult('Cards', rowNumber, 'insert_card', `ไม่พบ match_id: ${matchId}`)
          );
          summary.errors++;
          return;
        }

        const team = findTeam(teamName);
        if (!team) {
          results.push(
            createErrorResult('Cards', rowNumber, 'insert_card', `ไม่พบทีม: ${teamName}`)
          );
          summary.errors++;
          return;
        }

        const shirtNoResult = validateShirtNo(shirtNo);
        if (!shirtNoResult.valid) {
          results.push(
            createErrorResult('Cards', rowNumber, 'insert_card', shirtNoResult.error!)
          );
          summary.errors++;
          return;
        }

        const player = findPlayer(team.id, shirtNoResult.value!, playerName || undefined);
        if (!player) {
          results.push(
            createErrorResult(
              'Cards',
              rowNumber,
              'insert_card',
              `ไม่พบนักเตะ ${team.name} #${shirtNoResult.value}`
            )
          );
          summary.errors++;
          return;
        }

        const minuteResult = validateMinute(minute);
        if (!minuteResult.valid) {
          results.push(
            createErrorResult('Cards', rowNumber, 'insert_card', minuteResult.error!)
          );
          summary.errors++;
          return;
        }

        const countResult = validateCardCount(count);
        if (!countResult.valid) {
          results.push(
            createErrorResult('Cards', rowNumber, 'insert_card', countResult.error!)
          );
          summary.errors++;
          return;
        }

        results.push(
          createWarningResult(
            'Cards',
            rowNumber,
            'insert_card',
            `จะเพิ่ม ${countResult.value} บัตรของนักเตะ`,
            {
              match_id: matchId,
              player_id: player.id,
              team_id: team.id,
              card_type: cardTypeResult.normalized,
              minute: minuteResult.value,
              count: countResult.value,
            }
          )
        );
        summary.cards += countResult.value!;
        summary.warnings++;
      });
    };

    const processStaffDiscipline = () => {
      const sheet = workbook.getWorksheet('StaffDiscipline');
      if (!sheet) return;

      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;

        const matchId = trimString(getCellValue(row.getCell(1)));
        const teamName = trimString(getCellValue(row.getCell(3)));
        const staffName = trimString(getCellValue(row.getCell(4)));
        const disciplineType = trimString(getCellValue(row.getCell(6)));
        const minute = getCellValue(row.getCell(7));

        if (!matchId || !teamName || !staffName || !disciplineType) {
          results.push(
            createErrorResult(
              'StaffDiscipline',
              rowNumber,
              'insert_staff_discipline',
              'match_id, team, staff_name, discipline_type จำเป็น'
            )
          );
          summary.errors++;
          return;
        }

        const disciplineTypeResult = validateDisciplineType(disciplineType);
        if (!disciplineTypeResult.valid) {
          results.push(
            createErrorResult(
              'StaffDiscipline',
              rowNumber,
              'insert_staff_discipline',
              disciplineTypeResult.error!
            )
          );
          summary.errors++;
          return;
        }

        const match = findMatch(matchId);
        if (!match) {
          results.push(
            createErrorResult(
              'StaffDiscipline',
              rowNumber,
              'insert_staff_discipline',
              `ไม่พบ match_id: ${matchId}`
            )
          );
          summary.errors++;
          return;
        }

        const team = findTeam(teamName);
        if (!team) {
          results.push(
            createErrorResult(
              'StaffDiscipline',
              rowNumber,
              'insert_staff_discipline',
              `ไม่พบทีม: ${teamName}`
            )
          );
          summary.errors++;
          return;
        }

        const staffMembers = findStaff(team.id, staffName);
        if (staffMembers.length === 0) {
          results.push(
            createErrorResult(
              'StaffDiscipline',
              rowNumber,
              'insert_staff_discipline',
              `ไม่พบเจ้าหน้าที่ ${staffName}`
            )
          );
          summary.errors++;
          return;
        }

        if (staffMembers.length > 1) {
          results.push(
            createErrorResult(
              'StaffDiscipline',
              rowNumber,
              'insert_staff_discipline',
              `พบเจ้าหน้าที่ ${staffName} หลายคน`
            )
          );
          summary.errors++;
          return;
        }

        const minuteResult = validateMinute(minute);
        if (!minuteResult.valid) {
          results.push(
            createErrorResult(
              'StaffDiscipline',
              rowNumber,
              'insert_staff_discipline',
              minuteResult.error!
            )
          );
          summary.errors++;
          return;
        }

        const staff = staffMembers[0];
        results.push(
          createValidResult('StaffDiscipline', rowNumber, 'insert_staff_discipline', {
            match_id: matchId,
            staff_id: staff.id,
            team_id: team.id,
            discipline_type: disciplineTypeResult.normalized,
            minute: minuteResult.value,
          })
        );
        summary.staffDiscipline++;
      });
    };

    const processPlayerUpdates = () => {
      const sheet = workbook.getWorksheet('PlayerUpdates');
      if (!sheet) return;

      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;

        const playerId = trimString(getCellValue(row.getCell(1)));
        const team = trimString(getCellValue(row.getCell(2)));
        const shirtNo = getCellValue(row.getCell(3));
        const newFullName = trimString(getCellValue(row.getCell(6)));

        if (!playerId && !team) {
          results.push(
            createErrorResult(
              'PlayerUpdates',
              rowNumber,
              'update_player',
              'player_id หรือ team จำเป็น'
            )
          );
          summary.errors++;
          return;
        }

        if (!newFullName) {
          results.push(
            createErrorResult(
              'PlayerUpdates',
              rowNumber,
              'update_player',
              'new_full_name จำเป็น'
            )
          );
          summary.errors++;
          return;
        }

        let player: any;

        if (playerId) {
          player = playersData.find((p: any) => p.id === playerId);
        } else if (team && shirtNo) {
          const t = findTeam(team);
          if (!t) {
            results.push(
              createErrorResult(
                'PlayerUpdates',
                rowNumber,
                'update_player',
                `ไม่พบทีม: ${team}`
              )
            );
            summary.errors++;
            return;
          }

          const shirtNoResult = validateShirtNo(shirtNo);
          if (!shirtNoResult.valid) {
            results.push(
              createErrorResult('PlayerUpdates', rowNumber, 'update_player', shirtNoResult.error!)
            );
            summary.errors++;
            return;
          }

          player = findPlayer(t.id, shirtNoResult.value!);
        }

        if (!player) {
          results.push(
            createErrorResult('PlayerUpdates', rowNumber, 'update_player', 'ไม่พบนักเตะ')
          );
          summary.errors++;
          return;
        }

        results.push(
          createValidResult('PlayerUpdates', rowNumber, 'update_player', {
            player_id: player.id,
            full_name: newFullName,
          })
        );
        summary.playerUpdates++;
      });
    };

    processMatches();
    processGoals();
    processCards();
    processStaffDiscipline();
    processPlayerUpdates();

    summary.errors = results.filter((r) => r.status === 'error').length;
    summary.warnings = results.filter((r) => r.status === 'warning').length;

    const response: BulkImportPreviewResponse = {
      success: true,
      summary,
      rows: results,
      canApply: summary.errors === 0,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[MATCH_BULK_PREVIEW] Error:', error);
    return NextResponse.json(
      { error: 'ไม่สามารถ preview ได้', details: error instanceof Error ? error.message : '' },
      { status: 500 }
    );
  }
}

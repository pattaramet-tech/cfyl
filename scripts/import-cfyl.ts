/**
 * Import script: Read CFYL2026.xlsx and populate Supabase
 * Run with: npx ts-node scripts/import-cfyl.ts
 */

import XLSX from 'xlsx';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { excelDateToISO, parseTaiTime, extractDivisionNumber } from '../lib/calculations';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface RawMatch {
  MatchID: number;
  AgeGroup: string;
  MatchDay: string;
  MatchNo: number;
  Division: string;
  Date: number;
  Time: string;
  TeamA: string;
  ScoreA: number;
  ScoreB: number;
  TeamB: string;
}

interface RawPlayer {
  PlayerID: string;
  'Age Group': number;
  Division: number;
  Team: string;
  PlayerNo: number;
  PlayerName: string;
  BirthDate: number;
  Remarks: string;
}

interface RawScorer {
  MatchID: number;
  PlayerID: string;
  Goals: number;
  Team: string;
  Division: number;
}

interface RawCard {
  MatchID: number;
  PlayerID: string;
  Team: string;
  Division: number;
  CardType: string;
  Unit: number;
}

async function importData() {
  try {
    console.log('🚀 Starting CFYL data import...\n');

    // 1. Read Excel file
    const excelPath = path.join(__dirname, '..', '..', 'CFYL2026.xlsx');
    const workbook = XLSX.readFile(excelPath);

    const allMatches = XLSX.utils.sheet_to_json<RawMatch>(workbook.Sheets['AllMatches']);
    const players = XLSX.utils.sheet_to_json<RawPlayer>(workbook.Sheets['Players']);
    const scorers = XLSX.utils.sheet_to_json<RawScorer>(workbook.Sheets['Scorers']);
    const cards = XLSX.utils.sheet_to_json<RawCard>(workbook.Sheets['Cards']);

    console.log(`✓ Read ${allMatches.length} matches`);
    console.log(`✓ Read ${players.length} players`);
    console.log(`✓ Read ${scorers.length} goal records`);
    console.log(`✓ Read ${cards.length} card records\n`);

    // 2. Create or get Season
    console.log('📅 Importing Season...');
    const { data: seasonData, error: seasonError } = await supabase
      .from('seasons')
      .upsert(
        {
          name: 'CFYL 2026',
          year: 2026,
          status: 'active',
        },
        { onConflict: 'year' }
      )
      .select()
      .single();

    if (seasonError) throw seasonError;
    const seasonId = seasonData.id;
    console.log(`✓ Season: ${seasonId}\n`);

    // 3. Create Age Groups
    console.log('🎯 Importing Age Groups...');
    const ageGroupMap: { [key: string]: string } = {};

    const ageGroups = [
      { code: 'U14', name: 'รุ่นอายุไม่เกิน 14 ปี', sort_order: 1 },
      { code: 'U17', name: 'รุ่นอายุไม่เกิน 17 ปี', sort_order: 2 },
    ];

    for (const ag of ageGroups) {
      const { data, error } = await supabase
        .from('age_groups')
        .upsert(
          {
            season_id: seasonId,
            ...ag,
          },
          { onConflict: 'season_id,code' }
        )
        .select()
        .single();

      if (error) throw error;
      ageGroupMap[ag.code] = data.id;
      console.log(`  ✓ ${ag.code}`);
    }
    console.log('');

    // 4. Create Divisions
    console.log('📊 Importing Divisions...');
    const divisionMap: { [key: string]: string } = {};

    const uniqueDivisions = [...new Set(allMatches.map(m => m.Division))];

    for (const ageCode of ['U14', 'U17']) {
      const ageGroupId = ageGroupMap[ageCode];
      const ageDivisions = uniqueDivisions.filter(d => d.includes(ageCode === 'U14' ? '' : 'U17') || allMatches.some(m => m.AgeGroup === ageCode && m.Division === d));

      for (const divName of ageDivisions) {
        const divNum = extractDivisionNumber(divName);
        const { data, error } = await supabase
          .from('divisions')
          .upsert(
            {
              season_id: seasonId,
              age_group_id: ageGroupId,
              name: divName,
              sort_order: divNum,
            },
            { onConflict: 'season_id,age_group_id,name' }
          )
          .select()
          .single();

        if (error) throw error;
        divisionMap[`${ageCode}-${divName}`] = data.id;
      }
    }
    console.log(`✓ Created divisions\n`);

    // 5. Create Teams
    console.log('⚽ Importing Teams...');
    const teamMap: { [key: string]: string } = {};

    const uniqueTeams = [...new Set(allMatches.flatMap(m => [m.TeamA, m.TeamB]))];

    for (const teamName of uniqueTeams) {
      const match = allMatches.find(m => m.TeamA === teamName || m.TeamB === teamName);
      if (!match) continue;

      const ageCode = match.AgeGroup;
      const ageGroupId = ageGroupMap[ageCode];
      const divisionKey = `${ageCode}-${match.Division}`;
      const divisionId = divisionMap[divisionKey];

      const { data, error } = await supabase
        .from('teams')
        .upsert(
          {
            season_id: seasonId,
            age_group_id: ageGroupId,
            division_id: divisionId,
            name: teamName,
          },
          { onConflict: 'season_id,age_group_id,name' }
        )
        .select()
        .single();

      if (error) throw error;
      teamMap[teamName] = data.id;
    }
    console.log(`✓ Created ${Object.keys(teamMap).length} teams\n`);

    // 6. Create Players
    console.log('👥 Importing Players...');
    const playerMap: { [key: string]: string } = {};
    const seenPlayerKeys = new Set<string>(); // Track unique (season_id, player_code) combinations
    let duplicateCount = 0;

    const playerChunks = chunkArray(players, 100);
    let playerCount = 0;

    for (const chunk of playerChunks) {
      const playersToInsert = chunk
        .filter(p => {
          // 1. Check if team exists
          if (!teamMap[p.Team]) {
            return false;
          }

          // 2. Deduplicate by (season_id, player_code)
          const playerKey = `${seasonId}|${String(p.PlayerID)}`;
          if (seenPlayerKeys.has(playerKey)) {
            console.log(
              `  ⚠️  Duplicate player skipped: ${p.PlayerID} (${p.PlayerName}) - ${p.Team}`
            );
            duplicateCount++;
            return false;
          }

          seenPlayerKeys.add(playerKey);
          return true;
        })
        .map(p => {
          const ageCode = p['Age Group'] === 14 ? 'U14' : 'U17';
          const ageGroupId = ageGroupMap[ageCode];
          const divName = `ดิวิชั่น ${p.Division}`;
          const divisionKey = `${ageCode}-${divName}`;
          const divisionId = divisionMap[divisionKey];

          return {
            player_code: String(p.PlayerID),
            season_id: seasonId,
            age_group_id: ageGroupId,
            division_id: divisionId,
            team_id: teamMap[p.Team],
            shirt_no: p.PlayerNo,
            full_name: p.PlayerName,
            birth_date: p.BirthDate ? excelDateToISO(p.BirthDate) : null,
            remarks: p.Remarks || null,
          };
        });

      if (playersToInsert.length > 0) {
        const { data, error } = await supabase.from('players').upsert(playersToInsert, {
          onConflict: 'season_id,player_code',
        });

        if (error) throw error;
        playerCount += playersToInsert.length;
      }
    }

    // Build playerMap for goals and cards
    const { data: allPlayers } = await supabase.from('players').select('id, player_code').eq('season_id', seasonId);
    if (allPlayers) {
      allPlayers.forEach(p => {
        playerMap[p.player_code] = p.id;
      });
    }

    if (duplicateCount > 0) {
      console.log(`⚠️  Skipped ${duplicateCount} duplicate players\n`);
    }
    console.log(`✓ Created ${playerCount} players\n`);

    // 7. Create Matches
    console.log('🎮 Importing Matches...');
    const matchMap: { [key: number]: string } = {};

    const matchChunks = chunkArray(allMatches, 50);
    let matchCount = 0;

    for (const chunk of matchChunks) {
      const matchesToInsert = chunk.map(m => {
        const ageCode = m.AgeGroup;
        const ageGroupId = ageGroupMap[ageCode];
        const divisionKey = `${ageCode}-${m.Division}`;
        const divisionId = divisionMap[divisionKey];

        return {
          match_code: String(m.MatchID),
          season_id: seasonId,
          age_group_id: ageGroupId,
          division_id: divisionId,
          matchday: m.MatchDay,
          match_no: m.MatchNo,
          match_date: excelDateToISO(m.Date),
          match_time: parseTaiTime(m.Time),
          home_team_id: teamMap[m.TeamA],
          away_team_id: teamMap[m.TeamB],
          home_score: m.ScoreA != null ? m.ScoreA : null,
          away_score: m.ScoreB != null ? m.ScoreB : null,
          status: m.ScoreA !== undefined && m.ScoreB !== undefined ? 'finished' : 'scheduled',
        };
      });

      const { data, error } = await supabase.from('matches').upsert(matchesToInsert, {
        onConflict: 'season_id,match_code',
      });

      if (error) throw error;
      matchCount += matchesToInsert.length;
    }

    // Build matchMap
    const { data: allMatches2 } = await supabase.from('matches').select('id, match_code').eq('season_id', seasonId);
    if (allMatches2) {
      allMatches2.forEach(m => {
        matchMap[parseInt(m.match_code, 10)] = m.id;
      });
    }

    console.log(`✓ Created ${matchCount} matches\n`);

    // 8. Import Goals
    console.log('⚡ Importing Goals...');
    const seenGoalKeys = new Set<string>();
    let goalDuplicates = 0;

    const goalsToInsert = scorers
      .filter(s => {
        if (!matchMap[s.MatchID] || !playerMap[s.PlayerID]) {
          return false;
        }

        const goalKey = `${matchMap[s.MatchID]}|${playerMap[s.PlayerID]}`;
        if (seenGoalKeys.has(goalKey)) {
          console.log(`  ⚠️  Duplicate goal skipped: Match ${s.MatchID} - Player ${s.PlayerID}`);
          goalDuplicates++;
          return false;
        }

        seenGoalKeys.add(goalKey);
        return true;
      })
      .map(s => ({
        match_id: matchMap[s.MatchID],
        player_id: playerMap[s.PlayerID],
        team_id: teamMap[s.Team],
        goals: s.Goals || 1,
      }));

    if (goalsToInsert.length > 0) {
      const { error } = await supabase.from('goals').upsert(goalsToInsert, {
        onConflict: 'match_id,player_id',
      });

      if (error) throw error;
    }

    if (goalDuplicates > 0) {
      console.log(`  ⚠️  Skipped ${goalDuplicates} duplicate goal records`);
    }
    console.log(`✓ Created ${goalsToInsert.length} goal records\n`);

    // 9. Import Cards
    console.log('🟨 Importing Cards...');
    const seenCardKeys = new Set<string>();
    let cardDuplicates = 0;

    const cardsToInsert = cards
      .filter(c => {
        if (!matchMap[c.MatchID] || !playerMap[c.PlayerID]) {
          return false;
        }

        const cardKey = `${matchMap[c.MatchID]}|${playerMap[c.PlayerID]}`;
        if (seenCardKeys.has(cardKey)) {
          console.log(
            `  ⚠️  Duplicate card skipped: Match ${c.MatchID} - Player ${c.PlayerID} - ${c.CardType}`
          );
          cardDuplicates++;
          return false;
        }

        seenCardKeys.add(cardKey);
        return true;
      })
      .map(c => ({
        match_id: matchMap[c.MatchID],
        player_id: playerMap[c.PlayerID],
        team_id: teamMap[c.Team],
        card_type: c.CardType === 'Yellow' ? 'Yellow' : 'Red',
        unit: c.Unit || 1,
      }));

    if (cardsToInsert.length > 0) {
      const { error } = await supabase.from('cards').upsert(cardsToInsert, {
        onConflict: 'match_id,player_id',
      });

      if (error) throw error;
    }

    if (cardDuplicates > 0) {
      console.log(`  ⚠️  Skipped ${cardDuplicates} duplicate card records`);
    }
    console.log(`✓ Created ${cardsToInsert.length} card records\n`);

    console.log('✅ Import completed successfully!');
  } catch (error) {
    console.error('❌ Import failed:', error);
    process.exit(1);
  }
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

importData();

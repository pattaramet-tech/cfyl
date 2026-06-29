import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface StaffRow {
  'Age Group': string;
  Division: string;
  Team: string;
  Position: string;
  StaffName: string;
  StaffPhone: string;
}

interface ParsedStaff {
  ageGroupCode: string;
  divisionName: string;
  teamName: string;
  position: string;
  fullName: string;
  phone: string;
  rowIndex: number;
}

interface ImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  unmatchedTeams: ParsedStaff[];
}

function normalizeText(text: string): string {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeTeamName(name: string): string {
  return normalizeText(name)
    .replace(/\bU\d{2}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function importStaffs(filePath: string, seasonName: string, dryRun: boolean = false) {
  console.log(`\n📖 Importing staffs from: ${filePath}`);
  console.log(`🔍 Season: ${seasonName}`);
  console.log(`🧪 Dry-run: ${dryRun}\n`);

  // Read XLSX file
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  const workbook = XLSX.readFile(filePath);
  const worksheet = workbook.Sheets['Staffs'];

  if (!worksheet) {
    console.error('❌ Sheet "Staffs" not found in workbook');
    process.exit(1);
  }

  const rows: StaffRow[] = XLSX.utils.sheet_to_json(worksheet);
  console.log(`📋 Read ${rows.length} rows from sheet`);

  // Fetch season
  const { data: seasonData, error: seasonError } = await supabase
    .from('seasons')
    .select('id, name')
    .ilike('name', `%${seasonName}%`)
    .limit(1)
    .single();

  if (seasonError || !seasonData) {
    console.error(`❌ Season not found: ${seasonName}`);
    process.exit(1);
  }

  console.log(`✓ Found season: ${seasonData.name}`);

  // Fetch all age groups, divisions, teams
  const { data: ageGroups } = await supabase
    .from('age_groups')
    .select('id, code, name')
    .eq('season_id', seasonData.id);

  const { data: divisions } = await supabase
    .from('divisions')
    .select('id, name, age_group_id')
    .eq('season_id', seasonData.id);

  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, short_name, age_group_id, division_id')
    .eq('season_id', seasonData.id);

  console.log(`✓ Loaded ${ageGroups?.length || 0} age groups`);
  console.log(`✓ Loaded ${divisions?.length || 0} divisions`);
  console.log(`✓ Loaded ${teams?.length || 0} teams\n`);

  // Parse and match rows
  const parsedStaffs: ParsedStaff[] = [];
  const unmatchedTeams: ParsedStaff[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowIndex = i + 2; // +2 for header + 1-based indexing

    // Parse age group
    const ageGroupCode = String(row['Age Group'] || '').trim();
    const matchedAgeGroup = ageGroups?.find(
      (ag) => normalizeText(ag.code) === normalizeText(`U${ageGroupCode}`)
    );

    if (!matchedAgeGroup) {
      console.warn(`⚠️ Row ${rowIndex}: Age group not found: ${ageGroupCode}`);
      continue;
    }

    // Parse division
    const divisionName = String(row.Division || '').trim();
    const matchedDivision = divisions?.find(
      (d) =>
        normalizeText(d.name) === normalizeText(divisionName) &&
        d.age_group_id === matchedAgeGroup.id
    );

    if (!matchedDivision) {
      console.warn(`⚠️ Row ${rowIndex}: Division not found: ${divisionName}`);
      continue;
    }

    // Parse and match team
    const teamName = normalizeTeamName(row.Team || '');
    const matchedTeam = teams?.find(
      (t) =>
        (normalizeTeamName(t.name) === teamName ||
          normalizeText(t.short_name || '') === normalizeText(row.Team || '')) &&
        t.division_id === matchedDivision.id
    );

    if (!matchedTeam) {
      unmatchedTeams.push({
        ageGroupCode,
        divisionName,
        teamName: row.Team,
        position: row.Position,
        fullName: row.StaffName,
        phone: row.StaffPhone,
        rowIndex,
      });
      continue;
    }

    parsedStaffs.push({
      ageGroupCode,
      divisionName,
      teamName: row.Team,
      position: row.Position,
      fullName: row.StaffName,
      phone: row.StaffPhone,
      rowIndex,
    });
  }

  console.log(`✓ Matched ${parsedStaffs.length} staffs`);
  if (unmatchedTeams.length > 0) {
    console.log(`⚠️ Unmatched teams: ${unmatchedTeams.length}`);
    unmatchedTeams.forEach((u) => {
      console.log(`   Row ${u.rowIndex}: ${u.teamName} (${u.ageGroupCode}/${u.divisionName})`);
    });
  }
  console.log();

  if (dryRun) {
    console.log('🧪 DRY-RUN MODE: No changes made\n');
    console.log('Sample staffs to be imported:');
    parsedStaffs.slice(0, 5).forEach((s) => {
      console.log(`  - ${s.fullName} (${s.position}) @ ${s.teamName}`);
    });
    console.log();
    return;
  }

  // Import to database
  const result: ImportResult = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    unmatchedTeams,
  };

  for (const staff of parsedStaffs) {
    const ageGroup = ageGroups?.find((ag) => normalizeText(ag.code) === normalizeText(`U${staff.ageGroupCode}`));
    const division = divisions?.find((d) => normalizeText(d.name) === normalizeText(staff.divisionName));
    const team = teams?.find(
      (t) =>
        (normalizeTeamName(t.name) === normalizeTeamName(staff.teamName) ||
          normalizeText(t.short_name || '') === normalizeText(staff.teamName)) &&
        t.division_id === division?.id
    );

    if (!ageGroup || !division || !team) {
      result.skipped++;
      continue;
    }

    // Check if staff exists (by unique: team_id, full_name, position)
    const { data: existingStaff } = await supabase
      .from('team_staffs')
      .select('id')
      .eq('team_id', team.id)
      .eq('full_name', staff.fullName)
      .eq('position', staff.position)
      .limit(1)
      .single();

    if (existingStaff) {
      // Update existing
      const { error: updateError } = await supabase
        .from('team_staffs')
        .update({
          phone: staff.phone || null,
          active: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingStaff.id);

      if (!updateError) {
        result.updated++;
      }
    } else {
      // Insert new
      const { error: insertError } = await supabase
        .from('team_staffs')
        .insert({
          season_id: seasonData.id,
          age_group_id: ageGroup.id,
          division_id: division.id,
          team_id: team.id,
          full_name: staff.fullName,
          position: staff.position,
          phone: staff.phone || null,
          active: true,
        });

      if (!insertError) {
        result.inserted++;
      }
    }
  }

  console.log('📊 Import Results:');
  console.log(`  ✓ Inserted: ${result.inserted}`);
  console.log(`  ↻ Updated: ${result.updated}`);
  console.log(`  ⊘ Skipped: ${result.skipped}`);
  console.log(`  ❌ Unmatched: ${result.unmatchedTeams.length}\n`);
}

// Main
const args = process.argv.slice(2);
let filePath = 'staffs.xlsx';
let seasonName = 'cfyl';
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file' && args[i + 1]) {
    filePath = args[i + 1];
    i++;
  } else if (args[i] === '--season' && args[i + 1]) {
    seasonName = args[i + 1];
    i++;
  } else if (args[i] === '--dry-run') {
    dryRun = true;
  }
}

importStaffs(filePath, seasonName, dryRun).catch((error) => {
  console.error('❌ Import error:', error);
  process.exit(1);
});

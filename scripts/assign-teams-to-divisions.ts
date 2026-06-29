import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface StaffRow {
  'Age Group': string;
  Division: string;
  Team: string;
  Position: string;
  StaffName: string;
  StaffPhone: string;
}

function normalizeText(text: string): string {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeTeamName(name: string): string {
  return normalizeText(name)
    .replace(/\s*u\d{2}\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function assignTeamsToDivisions(filePath: string, seasonName: string) {
  console.log(`\n📖 Assigning teams to divisions from: ${filePath}`);
  console.log(`🔍 Season: ${seasonName}\n`);

  // Fetch season
  const { data: seasonData } = await supabase
    .from('seasons')
    .select('id')
    .ilike('name', `%${seasonName}%`)
    .single();

  if (!seasonData) {
    console.error('❌ Season not found');
    process.exit(1);
  }

  // Fetch all entities
  const { data: ageGroups } = await supabase
    .from('age_groups')
    .select('id, code')
    .eq('season_id', seasonData.id);

  const { data: divisions } = await supabase
    .from('divisions')
    .select('id, name, age_group_id')
    .eq('season_id', seasonData.id);

  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, short_name, age_group_id, division_id')
    .eq('season_id', seasonData.id);

  // Read XLSX
  const workbook = XLSX.readFile(filePath);
  const worksheet = workbook.Sheets['Staffs'];
  const rows: StaffRow[] = XLSX.utils.sheet_to_json(worksheet);

  // Extract unique team-division combinations from XLSX
  const teamDivisions = new Map<string, { ageGroupCode: string; divisionNum: string }>();

  for (const row of rows) {
    const teamName = normalizeTeamName(row.Team || '');
    const ageGroupCode = String(row['Age Group'] || '').trim();
    const divisionNum = String(row.Division || '').trim();

    const key = `${teamName}|${ageGroupCode}`;
    teamDivisions.set(key, { ageGroupCode, divisionNum });
  }

  console.log(`📋 Found ${teamDivisions.size} unique team-agegroup combinations\n`);

  // Update teams
  let updated = 0;
  let skipped = 0;

  for (const [key, info] of teamDivisions) {
    const [teamName] = key.split('|');

    // Find matching age group
    const matchedAg = ageGroups?.find(
      (ag) => normalizeText(ag.code) === normalizeText(`U${info.ageGroupCode}`)
    );

    if (!matchedAg) {
      console.log(`⚠️  Age group not found: U${info.ageGroupCode}`);
      skipped++;
      continue;
    }

    // Find matching division
    const divNumMatch = info.divisionNum.match(/\d+/);
    const matchedDiv = divisions?.find((d) => {
      const dbNumMatch = d.name.match(/\d+/);
      return (
        divNumMatch &&
        dbNumMatch &&
        divNumMatch[0] === dbNumMatch[0] &&
        d.age_group_id === matchedAg.id
      );
    });

    if (!matchedDiv) {
      console.log(
        `⚠️  Division not found: U${info.ageGroupCode}/${info.divisionNum}`
      );
      skipped++;
      continue;
    }

    // Find matching team
    const matchedTeam = teams?.find(
      (t) =>
        normalizeTeamName(t.name) === teamName && t.age_group_id === matchedAg.id
    );

    if (!matchedTeam) {
      console.log(`⚠️  Team not found: "${teamName}" (U${info.ageGroupCode})`);
      skipped++;
      continue;
    }

    if (matchedTeam.division_id === matchedDiv.id) {
      // Already correct
      continue;
    }

    // Update team
    const { error } = await supabase
      .from('teams')
      .update({ division_id: matchedDiv.id })
      .eq('id', matchedTeam.id);

    if (error) {
      console.log(
        `❌ Error updating ${matchedTeam.name}: ${error.message}`
      );
      skipped++;
    } else {
      console.log(`✓ Assigned "${matchedTeam.name}" to ${matchedDiv.name}`);
      updated++;
    }
  }

  console.log(`\n📊 Results:`);
  console.log(`  ✓ Updated: ${updated}`);
  console.log(`  ⚠️  Skipped: ${skipped}\n`);
}

const args = process.argv.slice(2);
let filePath = 'staffs.xlsx';
let seasonName = 'cfyl';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file' && args[i + 1]) {
    filePath = args[i + 1];
    i++;
  } else if (args[i] === '--season' && args[i + 1]) {
    seasonName = args[i + 1];
    i++;
  }
}

assignTeamsToDivisions(filePath, seasonName).catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});

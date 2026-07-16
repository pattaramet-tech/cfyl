import { loadEnvConfig } from '@next/env';
import { getTournamentServiceClient } from '../../lib/tournament/db/supabase-tournament';

const args = process.argv.slice(2);

// Handle --help before loading env
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Tournament Phase 2 Core Domain Seeder

Usage: npm run seed:tournament-phase2 -- --tournament-slug=<slug> --tournament-name="<name>"

Arguments (required):
  --tournament-slug=<slug>      Tournament slug (lowercase, alphanumeric, hyphens; e.g. 'cfyl-2026-meeting')
  --tournament-name="<name>"    Tournament display name (e.g. 'CFYL 2026 Draw Meeting')

Example:
  npm run seed:tournament-phase2 -- --tournament-slug=cfyl-2026-meeting --tournament-name="CFYL 2026 Draw Meeting"

This script:
1. Creates or finds a tournament by slug
2. Upserts 4 venues (V1–V4, field-1 to field-4)
3. Upserts 7 categories (B-U12, G-U14, B-U14, G-U16, B-U16, G-U18, B-U18)
4. Upserts 7 category-venue mappings
5. Creates 39 tournament groups (A–H per category, with correct sort order)

Idempotent: Safe to re-run without side effects.

Required environment variables (set in .env.local):
  TOURNAMENT_SUPABASE_URL
  TOURNAMENT_SUPABASE_SERVICE_ROLE_KEY
`);
  process.exit(0);
}

loadEnvConfig(process.cwd());

let tournamentSlug = '';
let tournamentName = '';

for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--tournament-slug=')) {
    tournamentSlug = args[i].split('=')[1];
  }
  if (args[i].startsWith('--tournament-name=')) {
    tournamentName = args[i].split('=')[1].replace(/^"|"$/g, '');
  }
}

if (!tournamentSlug || !tournamentName) {
  console.error('[SEED] Error: --tournament-slug and --tournament-name are required');
  console.error('[SEED] Usage: npm run seed:tournament-phase2 -- --tournament-slug=<slug> --tournament-name="<name>"');
  console.error('[SEED] Run: npm run seed:tournament-phase2 -- --help');
  process.exit(1);
}

const VENUES = [
  { name: 'V1', code: 'V1', slug: 'field-1' },
  { name: 'V2', code: 'V2', slug: 'field-2' },
  { name: 'V3', code: 'V3', slug: 'field-3' },
  { name: 'V4', code: 'V4', slug: 'field-4' },
];

const CATEGORIES = [
  { code: 'B-U12', name: 'Boys U12', gender: 'male' },
  { code: 'G-U14', name: 'Girls U14', gender: 'female' },
  { code: 'B-U14', name: 'Boys U14', gender: 'male' },
  { code: 'G-U16', name: 'Girls U16', gender: 'female' },
  { code: 'B-U16', name: 'Boys U16', gender: 'male' },
  { code: 'G-U18', name: 'Girls U18', gender: 'female' },
  { code: 'B-U18', name: 'Boys U18', gender: 'male' },
];

const MAPPINGS = [
  { categoryCode: 'B-U12', venueSlug: 'field-1' },
  { categoryCode: 'G-U14', venueSlug: 'field-1' },
  { categoryCode: 'B-U14', venueSlug: 'field-2' },
  { categoryCode: 'G-U16', venueSlug: 'field-2' },
  { categoryCode: 'B-U16', venueSlug: 'field-3' },
  { categoryCode: 'G-U18', venueSlug: 'field-3' },
  { categoryCode: 'B-U18', venueSlug: 'field-4' },
];

const GROUPS_PER_CATEGORY: Record<string, string[]> = {
  'B-U12': ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  'G-U14': ['A', 'B'],
  'B-U14': ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  'G-U16': ['A', 'B', 'C'],
  'B-U16': ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  'G-U18': ['A', 'B'],
  'B-U18': ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
};

async function seed() {
  try {
    const client = getTournamentServiceClient();

    console.log('[SEED] Looking up or creating tournament...');
    const { data: existingTournament } = await client
      .from('tournaments')
      .select('id')
      .eq('slug', tournamentSlug)
      .maybeSingle();

    let tournamentId = existingTournament?.id;

    if (!tournamentId) {
      const { data: newTournament, error: createError } = await client
        .from('tournaments')
        .insert({ name: tournamentName, slug: tournamentSlug, status: 'upcoming' })
        .select('id')
        .single();

      if (createError) {
        throw new Error(`Failed to create tournament: ${createError.message}`);
      }

      tournamentId = newTournament.id;
      console.log('[SEED] ✓ Tournament created');
    } else {
      console.log('[SEED] ✓ Tournament exists');
    }

    console.log('[SEED] Upserting 4 venues...');
    for (const venue of VENUES) {
      const { error } = await client
        .from('tournament_venues')
        .upsert(
          {
            tournament_id: tournamentId,
            name: venue.name,
            code: venue.code,
            slug: venue.slug,
            active: true,
          },
          { onConflict: 'tournament_id,slug' }
        );

      if (error) {
        throw new Error(`Failed to upsert venue ${venue.code}: ${error.message}`);
      }
    }
    console.log('[SEED] ✓ Venues upserted');

    console.log('[SEED] Upserting 7 categories...');
    for (const category of CATEGORIES) {
      const { error } = await client
        .from('tournament_categories')
        .upsert(
          {
            tournament_id: tournamentId,
            code: category.code,
            name: category.name,
            gender: category.gender,
          },
          { onConflict: 'tournament_id,code' }
        );

      if (error) {
        throw new Error(`Failed to upsert category ${category.code}: ${error.message}`);
      }
    }
    console.log('[SEED] ✓ Categories upserted');

    console.log('[SEED] Upserting 7 category-venue mappings...');
    for (const mapping of MAPPINGS) {
      const { data: category } = await client
        .from('tournament_categories')
        .select('id')
        .eq('tournament_id', tournamentId)
        .eq('code', mapping.categoryCode)
        .maybeSingle();

      const { data: venue } = await client
        .from('tournament_venues')
        .select('id')
        .eq('tournament_id', tournamentId)
        .eq('slug', mapping.venueSlug)
        .maybeSingle();

      if (!category || !venue) {
        throw new Error(`Failed to find category ${mapping.categoryCode} or venue ${mapping.venueSlug}`);
      }

      const { error } = await client
        .from('tournament_category_venues')
        .upsert(
          {
            category_id: category.id,
            venue_id: venue.id,
            is_primary: true,
          },
          { onConflict: 'category_id,venue_id' }
        );

      if (error) {
        throw new Error(
          `Failed to upsert mapping ${mapping.categoryCode}->${mapping.venueSlug}: ${error.message}`
        );
      }
    }
    console.log('[SEED] ✓ Mappings upserted');

    console.log('[SEED] Ensuring G-U16 qualification draw rule...');
    const { data: gU16Category, error: gU16CategoryError } = await client
      .from('tournament_categories')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('code', 'G-U16')
      .maybeSingle();

    if (gU16CategoryError) {
      throw new Error(`Failed to look up G-U16 category: ${gU16CategoryError.message}`);
    }
    if (!gU16Category) {
      throw new Error('Failed to find G-U16 category after category upsert');
    }

    const { data: existingQualificationRules, error: existingQualificationRulesError } = await client
      .from('tournament_qualification_rules')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('category_id', gU16Category.id);

    if (existingQualificationRulesError) {
      throw new Error(
        `Failed to look up G-U16 qualification rules: ${existingQualificationRulesError.message}`
      );
    }

    const qualificationRulePayload = {
      tournament_id: tournamentId,
      category_id: gU16Category.id,
      qualify_rank_per_group: 2,
      best_third_placed_count: 2,
      best_third_placed_method: 'draw',
      cross_group_comparison: false,
    };

    if ((existingQualificationRules || []).length === 0) {
      const { error: qualificationRuleInsertError } = await client
        .from('tournament_qualification_rules')
        .insert(qualificationRulePayload);

      if (qualificationRuleInsertError) {
        throw new Error(
          `Failed to insert G-U16 qualification rule: ${qualificationRuleInsertError.message}`
        );
      }
    } else {
      const { error: qualificationRuleUpdateError } = await client
        .from('tournament_qualification_rules')
        .update(qualificationRulePayload)
        .eq('tournament_id', tournamentId)
        .eq('category_id', gU16Category.id);

      if (qualificationRuleUpdateError) {
        throw new Error(
          `Failed to update G-U16 qualification rule: ${qualificationRuleUpdateError.message}`
        );
      }
    }
    console.log('[SEED] ✓ G-U16 qualification draw rule ready');

    console.log('[SEED] Creating tournament groups...');
    let groupsCreated = 0;
    for (const category of CATEGORIES) {
      const { data: categoryData } = await client
        .from('tournament_categories')
        .select('id')
        .eq('tournament_id', tournamentId)
        .eq('code', category.code)
        .maybeSingle();

      if (!categoryData) {
        throw new Error(`Failed to find category ${category.code}`);
      }

      const groupCodes = GROUPS_PER_CATEGORY[category.code] || [];
      for (let i = 0; i < groupCodes.length; i++) {
        const code = groupCodes[i];
        const { error } = await client
          .from('tournament_groups')
          .upsert(
            {
              tournament_id: tournamentId,
              category_id: categoryData.id,
              name: `Group ${code}`,
              code: code,
              sort_order: i,
            },
            { onConflict: 'category_id,code' }
          );

        if (error) {
          throw new Error(`Failed to upsert group ${code} for ${category.code}: ${error.message}`);
        }

        groupsCreated++;
      }
    }
    console.log(`[SEED] ✓ Groups created (${groupsCreated} total)`);

    console.log('[SEED] ✓ Seed complete');
    console.log(`[SEED] Tournament: ${tournamentName} (${tournamentSlug})`);
    console.log('[SEED] Venues: 4 (V1-V4)');
    console.log('[SEED] Categories: 7 (B-U12, G-U14, B-U14, G-U16, B-U16, G-U18, B-U18)');
    console.log('[SEED] Category-Venue Mappings: 7');
    console.log(`[SEED] Groups: ${groupsCreated} (A-H for most categories)`);
    process.exit(0);
  } catch (err) {
    console.error('[SEED] Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

seed();

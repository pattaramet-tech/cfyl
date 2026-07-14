import { loadEnvConfig } from '@next/env';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';

loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
let tournamentSlug = '';
let tournamentName = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--tournament-slug' && i + 1 < args.length) {
    tournamentSlug = args[i + 1];
  }
  if (args[i] === '--tournament-name' && i + 1 < args.length) {
    tournamentName = args[i + 1];
  }
}

if (!tournamentSlug || !tournamentName) {
  console.error('[SEED] Error: --tournament-slug and --tournament-name are required');
  console.error('[SEED] Usage: npm run seed:tournament-phase2 -- --tournament-slug=<slug> --tournament-name="<name>"');
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

    console.log('[SEED] ✓ Seed complete');
    console.log(`[SEED] Tournament: ${tournamentName} (${tournamentSlug})`);
    console.log('[SEED] Venues: 4 (V1-V4)');
    console.log('[SEED] Categories: 7 (B-U12, G-U14, B-U14, G-U16, B-U16, G-U18, B-U18)');
    console.log('[SEED] Category-Venue Mappings: 7');
    process.exit(0);
  } catch (err) {
    console.error('[SEED] Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

seed();

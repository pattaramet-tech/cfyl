import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'scripts/migration-card-note-presets.sql'),
  'utf8'
);

describe('card note presets migration safety', () => {
  it('creates only the dedicated preset table with normalized uniqueness and RLS', () => {
    expect(migration).toMatch(/create table if not exists public\.card_note_presets/i);
    expect(migration).toMatch(/note text not null/i);
    expect(migration).toMatch(/lower\(btrim\(note\)\)/i);
    expect(migration).toMatch(/alter table public\.card_note_presets enable row level security/i);
  });

  it('does not alter cards or Tournament V2 tables', () => {
    expect(migration).not.toMatch(/alter table public\.cards/i);
    expect(migration).not.toMatch(/tournament\./i);
  });
});

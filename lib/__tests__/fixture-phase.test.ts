import { describe, expect, it } from 'vitest';
import {
  filterMatchesByFixturePhase,
  getAvailableFixturePhaseOptions,
  normalizeFixturePhaseFilter,
  withFixturePhase,
} from '@/lib/fixture-phase';

const matches = [
  { league_phase: null },
  { league_phase: 'regular' as const },
  { league_phase: 'champion_league' as const },
  { league_phase: 'final' as const },
];

describe('fixture phase filter', () => {
  it('treats legacy NULL phase as regular league', () => {
    expect(filterMatchesByFixturePhase(matches, 'regular')).toHaveLength(2);
    expect(filterMatchesByFixturePhase(matches, 'champion_league')).toEqual([
      { league_phase: 'champion_league' },
    ]);
  });

  it('only exposes phase buttons that have fixtures plus the all button', () => {
    expect(getAvailableFixturePhaseOptions(matches).map((option) => option.value)).toEqual([
      'all',
      'regular',
      'champion_league',
      'final',
    ]);
  });

  it('normalizes invalid URL phase values and builds phase-aware fixture URLs', () => {
    expect(normalizeFixturePhaseFilter('champion_league')).toBe('champion_league');
    expect(normalizeFixturePhaseFilter('bogus')).toBe('all');
    expect(withFixturePhase('/fixtures/cfyl-2026/u14', 'all')).toBe('/fixtures/cfyl-2026/u14');
    expect(withFixturePhase('/fixtures/cfyl-2026/u14/md2', 'champion_league')).toBe(
      '/fixtures/cfyl-2026/u14/md2?phase=champion_league'
    );
  });
});

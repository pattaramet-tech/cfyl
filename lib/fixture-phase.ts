import type { LeaguePhase, Match } from '@/types/db';

export type FixturePhaseFilter = 'all' | LeaguePhase;

export const FIXTURE_PHASE_OPTIONS: Array<{ value: FixturePhaseFilter; label: string }> = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'regular', label: 'รอบลีก' },
  { value: 'champion_league', label: 'แชมเปียนส์ลีก' },
  { value: 'final', label: 'รอบชิงชนะเลิศ' },
  { value: 'third_place', label: 'ชิงอันดับ 3' },
];

const FILTER_VALUES = new Set<FixturePhaseFilter>(FIXTURE_PHASE_OPTIONS.map((option) => option.value));

export function normalizeFixturePhaseFilter(value: string | null | undefined): FixturePhaseFilter {
  return value && FILTER_VALUES.has(value as FixturePhaseFilter)
    ? (value as FixturePhaseFilter)
    : 'all';
}

export function getMatchLeaguePhase(match: Pick<Match, 'league_phase'>): LeaguePhase {
  return match.league_phase || 'regular';
}

export function filterMatchesByFixturePhase<T extends Pick<Match, 'league_phase'>>(
  matches: T[],
  phase: FixturePhaseFilter
): T[] {
  if (phase === 'all') return matches;
  return matches.filter((match) => getMatchLeaguePhase(match) === phase);
}

export function getAvailableFixturePhaseOptions<T extends Pick<Match, 'league_phase'>>(matches: T[]) {
  const available = new Set(matches.map((match) => getMatchLeaguePhase(match)));
  return FIXTURE_PHASE_OPTIONS.filter(
    (option) => option.value === 'all' || available.has(option.value as LeaguePhase)
  );
}

export function resolveAvailableFixturePhase<T extends Pick<Match, 'league_phase'>>(
  matches: T[],
  phase: FixturePhaseFilter
): FixturePhaseFilter {
  if (phase === 'all') return 'all';
  return matches.some((match) => getMatchLeaguePhase(match) === phase) ? phase : 'all';
}

export function withFixturePhase(path: string, phase: FixturePhaseFilter): string {
  return phase === 'all' ? path : `${path}?phase=${encodeURIComponent(phase)}`;
}

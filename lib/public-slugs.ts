import type { Season, AgeGroup, Division } from '@/types/db';

/**
 * Clean public URL <-> id mapping for Standings (and future pages).
 * Slugs are DERIVED from existing data — no DB slug column.
 *
 *   /standings/{year}/{ageCode}/{divCode}
 *   e.g. /standings/2026/u14/d1
 */

export interface ResolvedStandings {
  seasonId: string;
  ageGroupId: string;
  divisionId: string | null; // null = all divisions of the age group
  seasonYear: number;
  seasonSeg: string; // slug or year — for building clean URLs
  ageGroupCode: string;
  divisions: Division[]; // sorted
}

function sortDivisions(divisions: Division[]): Division[] {
  return [...divisions].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)
  );
}

/** "d1" / "d2" → division (1-based index after sort_order), with name fallback. */
export function divisionFromCode(divisions: Division[], divCode: string): Division | null {
  const sorted = sortDivisions(divisions);
  const m = divCode.toLowerCase().match(/^d(\d+)$/);
  if (m) {
    const idx = parseInt(m[1], 10) - 1;
    if (idx >= 0 && idx < sorted.length) return sorted[idx];
  }
  // Fallback: match a division whose name contains the same number
  const num = divCode.replace(/\D/g, '');
  if (num) {
    const byName = sorted.find((d) => d.name.replace(/\D/g, '') === num);
    if (byName) return byName;
  }
  return null;
}

/** division id → "d1"/"d2" based on sort order. */
export function divisionToCode(divisions: Division[], divisionId: string): string | null {
  const sorted = sortDivisions(divisions);
  const idx = sorted.findIndex((d) => d.id === divisionId);
  return idx >= 0 ? `d${idx + 1}` : null;
}

export type PublicPage = 'standings' | 'fixtures' | 'top-scorers' | 'discipline';

/** Generic clean-URL builder: /{page}/{year}/{ageCode}[/{sub}] */
export function buildPath(
  page: PublicPage,
  year: number | string,
  ageCode: string,
  sub?: string | null
): string {
  const base = `/${page}/${year}/${ageCode.toLowerCase()}`;
  return sub ? `${base}/${sub.toLowerCase()}` : base;
}

export function buildStandingsPath(year: number | string, ageCode: string, divCode?: string | null) {
  return buildPath('standings', year, ageCode, divCode ?? undefined);
}
export function buildFixturesPath(year: number | string, ageCode: string, mdCode?: string | null) {
  return buildPath('fixtures', year, ageCode, mdCode ?? undefined);
}
export function buildTopScorersPath(year: number | string, ageCode: string) {
  return buildPath('top-scorers', year, ageCode);
}
export function buildDisciplinePath(year: number | string, ageCode: string) {
  return buildPath('discipline', year, ageCode);
}

// ─── Matchday slug (client-safe; does NOT import suspension-calc) ────────────
export function matchdayNumber(val: string | number | null | undefined): number {
  if (val == null) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const m = String(val).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}
export function matchdayToCode(val: string | number): string {
  return `md${matchdayNumber(val)}`;
}
export function matchdayFromCode(code: string): number {
  const m = String(code).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// ─── Season slug helpers ────────────────────────────────────────────────────
type SeasonLike = { season_slug?: string | null; year: number; status?: string };

/** URL segment for a season: prefer slug, fall back to year. */
export function seasonSeg(s: SeasonLike): string {
  return s.season_slug && s.season_slug.trim() ? s.season_slug.trim() : String(s.year);
}

/** Match a season by slug first; else by year (prefer active, else first). */
function pickSeasonBySeg<T extends SeasonLike>(seasons: T[], seg: string): T | null {
  const bySlug = seasons.find((s) => (s.season_slug || '').toLowerCase() === seg.toLowerCase());
  if (bySlug) return bySlug;
  const byYear = seasons.filter((s) => String(s.year) === seg);
  if (!byYear.length) return null;
  return byYear.find((s) => s.status === 'active') || byYear[0];
}

/** Build a season slug from name (+ year appended if not already present). */
export function slugify(name: string, year?: number): string {
  let base = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (year != null && !new RegExp(`(^|-)${year}(-|$)`).test(base)) {
    base = base ? `${base}-${year}` : String(year);
  }
  return base;
}

export interface CurrentSeasonSlug {
  seasonId: string;
  ageGroupId: string;
  seasonYear: number;
  seasonSlug: string | null;
  seasonSeg: string;
  ageGroupCode: string;
}

/**
 * Resolve the "current" season (active, else newest year) + its first age group.
 * Used to point the navbar / bare /standings at a clean URL.
 */
export async function resolveCurrentSeasonSlug(): Promise<CurrentSeasonSlug | null> {
  const seasons = await getJson<Season[]>('/api/public/seasons');
  if (!seasons?.length) return null;
  const season =
    seasons.find((s) => s.status === 'active') ||
    [...seasons].sort((a, b) => b.year - a.year)[0];

  const ageGroups = await getJson<AgeGroup[]>(`/api/public/age-groups?seasonId=${season.id}`);
  if (!ageGroups?.length) return null;
  const ageGroup = [...ageGroups].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0];

  return {
    seasonId: season.id,
    ageGroupId: ageGroup.id,
    seasonYear: season.year,
    seasonSlug: season.season_slug ?? null,
    seasonSeg: seasonSeg(season),
    ageGroupCode: ageGroup.code,
  };
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Resolve clean-URL slugs into ids using the existing public APIs.
 * Returns null when the season or age group cannot be found.
 */
export async function resolveStandingsSlug(
  year: string,
  ageCode: string,
  divCode?: string
): Promise<ResolvedStandings | null> {
  const seasons = await getJson<Season[]>('/api/public/seasons');
  const season = pickSeasonBySeg(seasons || [], year);
  if (!season) return null;

  const ageGroups = await getJson<AgeGroup[]>(`/api/public/age-groups?seasonId=${season.id}`);
  const ageGroup = ageGroups?.find(
    (ag) => ag.code.toLowerCase() === ageCode.toLowerCase()
  );
  if (!ageGroup) return null;

  const divisionsRaw =
    (await getJson<Division[]>(
      `/api/public/divisions?seasonId=${season.id}&ageGroupId=${ageGroup.id}`
    )) || [];
  const divisions = sortDivisions(divisionsRaw);

  let divisionId: string | null = null;
  if (divCode) {
    const div = divisionFromCode(divisions, divCode);
    if (!div) return null; // explicit division requested but not found
    divisionId = div.id;
  }

  return {
    seasonId: season.id,
    ageGroupId: ageGroup.id,
    divisionId,
    seasonYear: season.year,
    seasonSeg: seasonSeg(season),
    ageGroupCode: ageGroup.code,
    divisions,
  };
}

/**
 * Generic resolver for age-level pages (fixtures / top-scorers / discipline).
 * Returns null when season or age group can't be found (route → not found).
 */
export async function resolvePublicSlug(
  year: string,
  ageCode: string
): Promise<CurrentSeasonSlug | null> {
  const seasons = await getJson<Season[]>('/api/public/seasons');
  const season = pickSeasonBySeg(seasons || [], year);
  if (!season) return null;

  const ageGroups = await getJson<AgeGroup[]>(`/api/public/age-groups?seasonId=${season.id}`);
  const ageGroup = ageGroups?.find((ag) => ag.code.toLowerCase() === ageCode.toLowerCase());
  if (!ageGroup) return null;

  return {
    seasonId: season.id,
    ageGroupId: ageGroup.id,
    seasonYear: season.year,
    seasonSlug: season.season_slug ?? null,
    seasonSeg: seasonSeg(season),
    ageGroupCode: ageGroup.code,
  };
}

export type SubFilter =
  | { kind: 'div'; code: string }
  | { kind: 'md'; code: string }
  | null
  | undefined;

/**
 * Build the clean URL when switching season — best effort: keep the desired age
 * group if it exists (else first), and keep the sub-filter (division/matchday)
 * only if it also exists in the new season.
 */
export async function resolveSeasonSwitchPath(
  page: PublicPage,
  newSeason: Season,
  desiredAgeCode: string,
  sub?: SubFilter
): Promise<string> {
  const agsRaw = await getJson<AgeGroup[]>(`/api/public/age-groups?seasonId=${newSeason.id}`);
  const ags = [...(agsRaw || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  if (ags.length === 0) return `/${page}`;
  const ag =
    ags.find((a) => a.code.toLowerCase() === desiredAgeCode.toLowerCase()) || ags[0];
  const ageCode = ag.code;
  const seg = seasonSeg(newSeason);

  if (!sub) return buildPath(page, seg, ageCode);

  if (sub.kind === 'div') {
    const divs = sortDivisions(
      (await getJson<Division[]>(
        `/api/public/divisions?seasonId=${newSeason.id}&ageGroupId=${ag.id}`
      )) || []
    );
    const div = divisionFromCode(divs, sub.code);
    return buildPath(page, seg, ageCode, div ? divisionToCode(divs, div.id)! : undefined);
  }

  // matchday
  const matches =
    (await getJson<Array<{ matchday: string | number }>>(
      `/api/public/matches?seasonId=${newSeason.id}&ageGroupId=${ag.id}`
    )) || [];
  const want = matchdayFromCode(sub.code);
  const exists = matches.some((m) => matchdayNumber(m.matchday) === want);
  return buildPath(page, seg, ageCode, exists ? `md${want}` : undefined);
}

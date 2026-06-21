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

export function buildStandingsPath(
  year: number | string,
  ageCode: string,
  divCode?: string | null
): string {
  const base = `/standings/${year}/${ageCode.toLowerCase()}`;
  return divCode ? `${base}/${divCode.toLowerCase()}` : base;
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
  const season = seasons?.find((s) => String(s.year) === String(year));
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
    ageGroupCode: ageGroup.code,
    divisions,
  };
}

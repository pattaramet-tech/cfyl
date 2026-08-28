export interface LeagueFixtureDateValidation {
  valid: boolean;
  reason?: 'invalid_date' | 'season_year_mismatch';
  expectedYear?: number;
  actualYear?: number;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Generated League fixtures use Gregorian ISO dates. The season year is the guardrail
 * against accidentally entering a Buddhist year (for example 2569 for season 2026),
 * which would later render as 3112 in Thai locale formatting.
 */
export function validateLeagueFixtureDateForSeason(
  value: string,
  seasonYear: number
): LeagueFixtureDateValidation {
  if (!isValidIsoDate(value)) {
    return { valid: false, reason: 'invalid_date' };
  }

  const actualYear = Number(value.slice(0, 4));
  if (!Number.isInteger(seasonYear) || actualYear !== seasonYear) {
    return {
      valid: false,
      reason: 'season_year_mismatch',
      expectedYear: seasonYear,
      actualYear,
    };
  }

  return { valid: true, expectedYear: seasonYear, actualYear };
}

export function getLeagueFixtureDateErrorMessage(
  value: string,
  seasonYear: number
): string | null {
  const validation = validateLeagueFixtureDateForSeason(value, seasonYear);
  if (validation.valid) return null;
  if (validation.reason === 'season_year_mismatch') {
    return `match_date ต้องใช้ปี ค.ศ. ${seasonYear} ตามฤดูกาล ห้ามกรอกปี พ.ศ. (${value})`;
  }
  return 'match_date ต้องเป็นวันที่รูปแบบ YYYY-MM-DD ที่ถูกต้อง';
}

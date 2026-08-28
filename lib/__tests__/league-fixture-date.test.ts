import { describe, expect, it } from 'vitest';
import {
  getLeagueFixtureDateErrorMessage,
  validateLeagueFixtureDateForSeason,
} from '../league-fixture-date';

describe('League generated fixture season date guard', () => {
  it('accepts a Gregorian date in the season year', () => {
    expect(validateLeagueFixtureDateForSeason('2026-08-22', 2026)).toEqual({
      valid: true,
      expectedYear: 2026,
      actualYear: 2026,
    });
    expect(getLeagueFixtureDateErrorMessage('2026-08-22', 2026)).toBeNull();
  });

  it('rejects a Buddhist year accidentally stored as Gregorian', () => {
    expect(validateLeagueFixtureDateForSeason('2569-08-22', 2026)).toEqual({
      valid: false,
      reason: 'season_year_mismatch',
      expectedYear: 2026,
      actualYear: 2569,
    });
    expect(getLeagueFixtureDateErrorMessage('2569-08-22', 2026)).toContain('ค.ศ. 2026');
  });

  it('rejects invalid ISO calendar dates', () => {
    expect(validateLeagueFixtureDateForSeason('2026-02-31', 2026)).toEqual({
      valid: false,
      reason: 'invalid_date',
    });
  });
});

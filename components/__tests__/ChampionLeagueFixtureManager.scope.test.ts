import { describe, expect, it } from 'vitest';
import {
  ChampionLeagueFixtureManager,
  getChampionLeagueFixtureScopeKey,
  isChampionLeagueFixturePayloadForScope,
} from '../ChampionLeagueFixtureManager';

describe('ChampionLeagueFixtureManager scope isolation', () => {
  it('changes the keyed inner component when the selected scope changes so old drafts are remounted away', () => {
    const first = ChampionLeagueFixtureManager({
      seasonId: 'season-1',
      ageGroupId: 'age-1',
      divisionId: 'division-1',
    });
    const second = ChampionLeagueFixtureManager({
      seasonId: 'season-1',
      ageGroupId: 'age-1',
      divisionId: 'division-2',
    });

    expect(first.key).toBe('season-1::age-1::division-1');
    expect(second.key).toBe('season-1::age-1::division-2');
    expect(second.key).not.toBe(first.key);
  });

  it('rejects a delayed response whose payload belongs to the previous scope', () => {
    const currentScopeKey = getChampionLeagueFixtureScopeKey('season-1', 'age-1', 'division-2');
    const delayedOldPayload = {
      scope: {
        season_id: 'season-1',
        age_group_id: 'age-1',
        division_id: 'division-1',
      },
    };
    const currentPayload = {
      scope: {
        season_id: 'season-1',
        age_group_id: 'age-1',
        division_id: 'division-2',
      },
    };

    expect(isChampionLeagueFixturePayloadForScope(delayedOldPayload, currentScopeKey)).toBe(false);
    expect(isChampionLeagueFixturePayloadForScope(currentPayload, currentScopeKey)).toBe(true);
  });
});

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  ChampionLeagueFixtureManager,
  getChampionLeagueFixtureScopeKey,
  isChampionLeagueFixturePayloadForScope,
} from '../ChampionLeagueFixtureManager';

function inactiveFixtureState(divisionId: string) {
  return {
    scope: {
      season_id: 'season-1',
      age_group_id: 'age-1',
      division_id: divisionId,
    },
    active: false,
    reason: 'not active',
    qualifiers: [],
    round_robin: {
      preview: [],
      structure: null,
      can_generate: false,
      already_generated: false,
    },
    placement: {
      can_generate: false,
      pairings: null,
      final_match: null,
      third_place_match: null,
    },
  };
}

function response(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: vi.fn(async () => payload),
  } as unknown as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
});

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

  it('does not run old-scope follow-up refresh when an action resolves after a scope rerender', async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('window', {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
    });
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => 'admin-token'),
    });

    const delayedActivate = deferred<Response>();
    const fetchCalls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      fetchCalls.push(`${method} ${url}`);

      if (url === '/api/admin/champion-league/activate') {
        return delayedActivate.promise;
      }
      if (url.startsWith('/api/admin/champion-league/fixtures?')) {
        const divisionId = url.includes('divisionId=division-2') ? 'division-2' : 'division-1';
        return response(inactiveFixtureState(divisionId));
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const oldScopeChanged = vi.fn(async () => undefined);
    const newScopeChanged = vi.fn(async () => undefined);
    let renderer!: ReactTestRenderer;

    const flushMicrotasks = async () => {
      for (let index = 0; index < 4; index += 1) await Promise.resolve();
    };

    await act(async () => {
      renderer = create(
        React.createElement(ChampionLeagueFixtureManager, {
          seasonId: 'season-1',
          ageGroupId: 'age-1',
          divisionId: 'division-1',
          onChanged: oldScopeChanged,
        })
      );
    });

    const oldRefreshButton = renderer.root
      .findAllByType('button')
      .find((node) => node.children.join('') === 'รีเฟรช');
    expect(oldRefreshButton).toBeDefined();
    await act(async () => {
      oldRefreshButton!.props.onClick();
      await flushMicrotasks();
    });

    expect(
      fetchCalls.filter(
        (entry) =>
          entry.startsWith('GET /api/admin/champion-league/fixtures?') &&
          entry.includes('divisionId=division-1')
      )
    ).toHaveLength(1);
    const activateButton = renderer.root
      .findAllByType('button')
      .find((node) => node.children.join('') === 'ล็อก Top 4 / เปิด Champion League');
    expect(activateButton).toBeDefined();

    act(() => {
      activateButton!.props.onClick();
    });
    expect(fetchCalls.some((entry) => entry === 'POST /api/admin/champion-league/activate')).toBe(true);

    await act(async () => {
      renderer.update(
        React.createElement(ChampionLeagueFixtureManager, {
          seasonId: 'season-1',
          ageGroupId: 'age-1',
          divisionId: 'division-2',
          onChanged: newScopeChanged,
        })
      );
    });

    const newRefreshButton = renderer.root
      .findAllByType('button')
      .find((node) => node.children.join('') === 'รีเฟรช');
    expect(newRefreshButton).toBeDefined();
    await act(async () => {
      newRefreshButton!.props.onClick();
      await flushMicrotasks();
    });

    expect(
      fetchCalls.filter(
        (entry) =>
          entry.startsWith('GET /api/admin/champion-league/fixtures?') &&
          entry.includes('divisionId=division-2')
      )
    ).toHaveLength(1);

    await act(async () => {
      delayedActivate.resolve(response({ already_active: false }));
      await flushMicrotasks();
    });

    expect(oldScopeChanged).not.toHaveBeenCalled();
    expect(newScopeChanged).not.toHaveBeenCalled();
    expect(
      fetchCalls.filter(
        (entry) =>
          entry.startsWith('GET /api/admin/champion-league/fixtures?') &&
          entry.includes('divisionId=division-1')
      )
    ).toHaveLength(1);

    act(() => {
      renderer.unmount();
    });
  });
});

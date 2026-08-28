import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const state = vi.hoisted(() => ({
  navProps: null as null | Record<string, unknown>,
  routerPush: vi.fn(),
  resolveSeasonSwitchPath: vi.fn(async () => '/fixtures/cfyl-2027/u14/md2'),
  matchCardIds: [] as string[],
}));

vi.mock('@/components/PublicSeasonNav', () => ({
  PublicSeasonNav: (props: Record<string, unknown>) => {
    state.navProps = props;
    return props.children ?? null;
  },
}));

vi.mock('@/components/MatchCard', () => ({
  MatchCard: ({ match }: { match: { id: string } }) => {
    state.matchCardIds.push(match.id);
    return null;
  },
}));

vi.mock('@/lib/use-public-nav', () => ({
  usePublicNav: () => ({
    router: { push: state.routerPush },
    seasons: [
      { id: 'season-1', name: 'CFYL 2026', year: 2026, season_slug: 'cfyl-2026', status: 'active' },
      { id: 'season-2', name: 'CFYL 2027', year: 2027, season_slug: 'cfyl-2027', status: 'draft' },
    ],
    ageGroups: [
      { id: 'age-1', code: 'U14', name: 'U14', sort_order: 1 },
      { id: 'age-2', code: 'U17', name: 'U17', sort_order: 2 },
    ],
    seg: 'cfyl-2026',
    code: 'U14',
  }),
}));

vi.mock('@/lib/public-slugs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/public-slugs')>();
  return {
    ...actual,
    resolveSeasonSwitchPath: state.resolveSeasonSwitchPath,
  };
});

import { FixturesView } from '../FixturesView';

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function response(payload: unknown): Response {
  return {
    ok: true,
    json: vi.fn(async () => payload),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  state.navProps = null;
  state.matchCardIds = [];
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
});

describe('FixturesView phase-aware navigation', () => {
  it('preserves the selected Champion League phase when switching age group and season', async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('window', {
      location: { search: '?phase=champion_league' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response([
          {
            id: 'match-1',
            league_phase: 'champion_league',
            matchday: 'CL2',
            match_date: '2026-09-01',
            status: 'scheduled',
          },
        ])
      )
    );

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(FixturesView, {
          seasonId: 'season-1',
          ageGroupId: 'age-1',
          matchdayCode: 'md2',
        })
      );
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
    });

    const navProps = state.navProps as {
      onAgeChange: (ageGroup: Record<string, unknown>) => void;
      onSeasonChange: (season: Record<string, unknown>) => Promise<void>;
    };

    act(() => {
      navProps.onAgeChange({ id: 'age-2', code: 'U17', name: 'U17', sort_order: 2 });
    });
    expect(state.routerPush).toHaveBeenCalledWith(
      '/fixtures/cfyl-2026/u17?phase=champion_league'
    );

    await act(async () => {
      await navProps.onSeasonChange({
        id: 'season-2',
        name: 'CFYL 2027',
        year: 2027,
        season_slug: 'cfyl-2027',
        status: 'draft',
      });
    });
    expect(state.resolveSeasonSwitchPath).toHaveBeenCalledWith(
      'fixtures',
      expect.objectContaining({ id: 'season-2' }),
      'U14',
      { kind: 'md', code: 'md2' }
    );
    expect(state.routerPush).toHaveBeenLastCalledWith(
      '/fixtures/cfyl-2027/u14/md2?phase=champion_league'
    );

    act(() => renderer.unmount());
  });

  it('falls back to all when a preserved Champion League phase is unavailable in the new scope', async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('window', {
      location: { search: '?phase=champion_league' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response([
          {
            id: 'regular-match',
            league_phase: null,
            matchday: 'MD1',
            match_date: '2026-09-01',
            status: 'scheduled',
          },
        ])
      )
    );

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(FixturesView, {
          seasonId: 'season-2',
          ageGroupId: 'age-2',
        })
      );
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
    });

    expect(state.matchCardIds).toContain('regular-match');
    expect((state.navProps as { copyPath?: string }).copyPath).toBe('/fixtures/cfyl-2026/u14');

    const navProps = state.navProps as {
      onAgeChange: (ageGroup: Record<string, unknown>) => void;
    };
    act(() => {
      navProps.onAgeChange({ id: 'age-2', code: 'U17', name: 'U17', sort_order: 2 });
    });
    expect(state.routerPush).toHaveBeenLastCalledWith('/fixtures/cfyl-2026/u17');

    act(() => renderer.unmount());
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
type MockError = { message: string } | null;
type QueryResult = { data: Row[] | null; error: MockError };

const state = vi.hoisted(() => ({
  db: {
    matches: [] as Row[],
    suspensions: [] as Row[],
  },
  updates: [] as Array<{ table: string; id: unknown; values: Row }>,
  triggerLookupError: false,
  candidateLookupError: false,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from(table: 'matches' | 'suspensions') {
      const eqFilters: Array<{ column: string; value: unknown }> = [];
      const neqFilters: Array<{ column: string; value: unknown }> = [];
      const inFilters: Array<{ column: string; values: unknown[] }> = [];
      const gtFilters: Array<{ column: string; value: number }> = [];
      let orFilter: string | null = null;
      let operation: 'select' | 'update' = 'select';
      let updateValues: Row = {};

      const selectedRows = () => {
        let rows = [...state.db[table]];
        rows = rows.filter((row) =>
          eqFilters.every(({ column, value }) => row[column] === value)
        );
        rows = rows.filter((row) =>
          neqFilters.every(({ column, value }) => row[column] !== value)
        );
        rows = rows.filter((row) =>
          inFilters.every(({ column, values }) => values.includes(row[column]))
        );
        rows = rows.filter((row) =>
          gtFilters.every(({ column, value }) => Number(row[column]) > value)
        );

        if (orFilter) {
          const teamMatch = orFilter.match(/home_team_id\.eq\.([^,]+),away_team_id\.eq\.(.+)$/);
          if (teamMatch) {
            const teamId = teamMatch[1];
            rows = rows.filter(
              (row) => row.home_team_id === teamId || row.away_team_id === teamId
            );
          }
        }
        return rows;
      };

      const execute = (single = false): QueryResult | { data: Row | null; error: MockError } => {
        if (operation === 'update') {
          const rows = selectedRows();
          for (const row of rows) {
            Object.assign(row, updateValues);
            state.updates.push({ table, id: row.id, values: { ...updateValues } });
          }
          return single
            ? { data: rows[0] ?? null, error: null }
            : { data: rows, error: null };
        }

        if (table === 'matches' && single && state.triggerLookupError) {
          return { data: null, error: { message: 'trigger lookup failed' } };
        }
        if (table === 'matches' && orFilter && state.candidateLookupError) {
          return { data: null, error: { message: 'candidate lookup failed' } };
        }

        const rows = selectedRows();
        return single
          ? { data: rows[0] ?? null, error: null }
          : { data: rows, error: null };
      };

      // Supabase builders are thenable. Keep the mock deliberately minimal.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api: any = {
        select() {
          return api;
        },
        eq(column: string, value: unknown) {
          eqFilters.push({ column, value });
          return api;
        },
        neq(column: string, value: unknown) {
          neqFilters.push({ column, value });
          return api;
        },
        in(column: string, values: unknown[]) {
          inFilters.push({ column, values });
          return api;
        },
        gt(column: string, value: number) {
          gtFilters.push({ column, value });
          return api;
        },
        or(value: string) {
          orFilter = value;
          return api;
        },
        update(values: Row) {
          operation = 'update';
          updateValues = values;
          return api;
        },
        single() {
          return Promise.resolve(execute(true));
        },
        then(resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(execute(false) as QueryResult).then(resolve, reject);
        },
      };
      return api;
    },
  })),
}));

import { refreshSuspensionServingMatches } from '../suspension-calc';

const scope = {
  seasonId: 'season-1',
  ageGroupId: 'age-1',
  teamId: 'A',
};

function match(overrides: Row): Row {
  return {
    id: 'match',
    season_id: scope.seasonId,
    age_group_id: scope.ageGroupId,
    matchday: 'MD1',
    match_date: '2026-08-30',
    match_time: '10:00:00',
    match_code: 'M-1',
    home_team_id: 'A',
    away_team_id: 'X',
    status: 'finished',
    home_team: { name: 'A' },
    away_team: { name: 'X' },
    ...overrides,
  };
}

function suspension(overrides: Row = {}): Row {
  return {
    id: 'susp-1',
    season_id: scope.seasonId,
    age_group_id: scope.ageGroupId,
    player_id: 'player-1',
    team_id: 'A',
    trigger_match_id: 'regular-last',
    suspension_type: 'accumulated_points',
    accumulated_threshold: 6,
    source_card_ids: ['card-1'],
    serving_match_ids: [],
    ban_matches: 1,
    suspended_from_match_id: null,
    suspension_details: { suspended_matches: [], ban_matches_count: 1 },
    suspension_reason: 'pending',
    served_completed_at: null,
    ...overrides,
  };
}

describe('refreshSuspensionServingMatches integration safety', () => {
  beforeEach(() => {
    state.db.matches = [];
    state.db.suspensions = [];
    state.updates = [];
    state.triggerLookupError = false;
    state.candidateLookupError = false;
  });

  it('backfills an empty MD14 suspension to the team Champion League CL1 after fixtures exist', async () => {
    state.db.matches = [
      match({
        id: 'md14-trigger',
        matchday: 'MatchDay 14',
        match_date: '2026-08-16',
        match_time: '13:00:00',
        away_team_id: 'B',
        away_team: { name: 'B' },
        status: 'finished',
      }),
      match({
        id: 'cl1-generated',
        matchday: 'CL1',
        match_date: '2026-08-22',
        match_time: '13:00:00',
        away_team_id: 'C',
        away_team: { name: 'C' },
        status: 'scheduled',
        match_code: 'CL-D1-R1',
      }),
    ];
    state.db.suspensions = [
      suspension({
        trigger_match_id: 'md14-trigger',
        serving_match_ids: [],
        suspended_from_match_id: null,
        suspension_details: {
          trigger_match_id: 'md14-trigger',
          suspended_matches: [],
          ban_matches_count: 1,
        },
        suspension_reason: 'accumulated_points - แบน 1 นัด (ไม่พบโปรแกรมนัดถัดไป)',
      }),
    ];

    const result = await refreshSuspensionServingMatches(scope);

    expect(result).toEqual({ refreshed: 1, skipped: 0, failed: 0 });
    expect(state.db.suspensions[0].serving_match_ids).toEqual(['cl1-generated']);
    expect(state.db.suspensions[0].suspended_from_match_id).toBe('cl1-generated');
    expect(state.db.suspensions[0].served_completed_at).toBeNull();
    expect(state.db.suspensions[0].suspension_reason).toContain('MD1');
    expect(
      (state.db.suspensions[0].suspension_details as { suspended_matches: Row[] }).suspended_matches[0]
    ).toEqual(
      expect.objectContaining({
        match_id: 'cl1-generated',
        matchday: 1,
        status: 'scheduled',
      })
    );
  });

  it('keeps a completed suspension completed when generated Champion League fixtures trigger refresh', async () => {
    const completedAt = '2026-09-01T12:00:00Z';
    state.db.matches = [
      match({ id: 'regular-last', matchday: 'MD9', match_date: '2026-08-30' }),
      match({
        id: 'served-match',
        matchday: 'MD10',
        match_date: '2026-09-01',
        away_team_id: 'B',
        away_team: { name: 'B' },
        status: 'finished',
      }),
      match({
        id: 'cl1-generated',
        matchday: 'CL1',
        match_date: '2026-09-05',
        away_team_id: 'C',
        away_team: { name: 'C' },
        status: 'scheduled',
      }),
    ];
    state.db.suspensions = [
      suspension({
        serving_match_ids: ['served-match'],
        served_completed_at: completedAt,
        suspension_details: {
          suspended_matches: [{ match_id: 'served-match', status: 'finished' }],
          ban_matches_count: 1,
        },
        suspension_reason: 'served',
      }),
    ];

    const result = await refreshSuspensionServingMatches(scope);

    expect(result).toEqual({ refreshed: 0, skipped: 1, failed: 0 });
    expect(state.updates).toHaveLength(0);
    expect(state.db.suspensions[0].serving_match_ids).toEqual(['served-match']);
    expect(state.db.suspensions[0].served_completed_at).toBe(completedAt);
  });

  it('does not write a suspension when the trigger match lookup fails', async () => {
    state.db.suspensions = [suspension()];
    state.triggerLookupError = true;

    const result = await refreshSuspensionServingMatches(scope);

    expect(result).toEqual({ refreshed: 0, skipped: 0, failed: 1 });
    expect(state.updates).toHaveLength(0);
    expect(state.db.suspensions[0].serving_match_ids).toEqual([]);
  });

  it('does not write a suspension when the candidate match lookup fails', async () => {
    state.db.matches = [
      match({ id: 'regular-last', matchday: 'MD9', match_date: '2026-08-30' }),
      match({
        id: 'cl1-generated',
        matchday: 'CL1',
        match_date: '2026-09-05',
        away_team_id: 'C',
        away_team: { name: 'C' },
        status: 'scheduled',
      }),
    ];
    state.db.suspensions = [suspension()];
    state.candidateLookupError = true;

    const result = await refreshSuspensionServingMatches(scope);

    expect(result).toEqual({ refreshed: 0, skipped: 0, failed: 1 });
    expect(state.updates).toHaveLength(0);
    expect(state.db.suspensions[0].serving_match_ids).toEqual([]);
  });

  it('reassigns to a newly-earlier fixture even when changedMatchId was never referenced', async () => {
    state.db.matches = [
      match({ id: 'regular-last', matchday: 'MD9', match_date: '2026-08-30' }),
      match({
        id: 'new-earlier',
        matchday: 'CL1',
        match_date: '2026-09-05',
        status: 'scheduled',
      }),
      match({
        id: 'old-later',
        matchday: 'CL2',
        match_date: '2026-09-10',
        status: 'scheduled',
      }),
    ];
    state.db.suspensions = [
      suspension({
        serving_match_ids: ['old-later'],
        suspended_from_match_id: 'old-later',
        suspension_details: {
          suspended_matches: [{ match_id: 'old-later', status: 'scheduled' }],
          ban_matches_count: 1,
        },
      }),
    ];

    const result = await refreshSuspensionServingMatches({
      ...scope,
      changedMatchId: 'new-earlier',
    });

    expect(result).toEqual({ refreshed: 1, skipped: 0, failed: 0 });
    expect(state.db.suspensions[0].serving_match_ids).toEqual(['new-earlier']);
    expect(state.db.suspensions[0].suspended_from_match_id).toBe('new-earlier');
  });

  it('never reactivates a suspension that already has served_completed_at', async () => {
    const completedAt = '2026-09-02T12:00:00Z';
    state.db.matches = [
      match({ id: 'regular-last', matchday: 'MD9', match_date: '2026-08-30' }),
      match({ id: 'served-match', matchday: 'CL1', match_date: '2026-09-01', status: 'scheduled' }),
      match({ id: 'replacement', matchday: 'CL2', match_date: '2026-09-05', status: 'scheduled' }),
    ];
    state.db.suspensions = [
      suspension({
        serving_match_ids: ['served-match'],
        served_completed_at: completedAt,
        suspended_from_match_id: null,
      }),
    ];

    const result = await refreshSuspensionServingMatches({
      ...scope,
      changedMatchId: 'replacement',
    });

    expect(result).toEqual({ refreshed: 0, skipped: 1, failed: 0 });
    expect(state.updates).toHaveLength(0);
    expect(state.db.suspensions[0].serving_match_ids).toEqual(['served-match']);
    expect(state.db.suspensions[0].served_completed_at).toBe(completedAt);
  });
});

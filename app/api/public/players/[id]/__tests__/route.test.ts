import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

const state = vi.hoisted(() => ({ db: {} as Db }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const filters: Array<{ column: string; value: unknown }> = [];
      let orFilter: string | null = null;

      const rows = () => {
        let result = [...(state.db[table] || [])];
        result = result.filter((row) =>
          filters.every(({ column, value }) => row[column] === value)
        );
        if (orFilter) {
          const match = orFilter.match(/home_team_id\.eq\.([^,]+),away_team_id\.eq\.(.+)$/);
          if (match) {
            const teamId = match[1];
            result = result.filter(
              (row) => row.home_team_id === teamId || row.away_team_id === teamId
            );
          }
        }
        return result;
      };

      // Supabase builders are thenable; keep this mock intentionally small.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api: any = {
        select() {
          return api;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return api;
        },
        or(value: string) {
          orFilter = value;
          return api;
        },
        maybeSingle() {
          return Promise.resolve({ data: rows()[0] ?? null, error: null });
        },
        then(
          resolve: (value: { data: Row[]; error: null }) => unknown,
          reject?: (reason: unknown) => unknown
        ) {
          return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  }),
}));

import { GET } from '../route';

function requestParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function initializeDb() {
  state.db = {
    players: [
      {
        id: 'player-1',
        player_code: 'P001',
        season_id: 'season-1',
        age_group_id: 'age-1',
        division_id: 'division-1',
        team_id: 'A',
        shirt_no: 9,
        full_name: 'ผู้เล่นทดสอบ',
        birth_date: '2012-03-04',
        remarks: 'ข้อมูลภายในสำหรับเจ้าหน้าที่',
        active: true,
      },
    ],
    teams: [{ id: 'A', name: 'ทีม A', short_name: 'A', logo_url: null }],
    seasons: [{ id: 'season-1', name: 'CFYL 2026', year: 2026 }],
    age_groups: [{ id: 'age-1', code: 'U14', name: 'รุ่นอายุไม่เกิน 14 ปี' }],
    divisions: [{ id: 'division-1', name: 'ดิวิชั่น 1' }],
    goals: [
      {
        id: 'goal-1',
        player_id: 'player-1',
        match_id: 'md14',
        goals: 2,
        minute: 10,
        is_own_goal: false,
        note: null,
        created_at: '2026-08-16T06:00:00Z',
      },
    ],
    cards: [
      {
        id: 'card-y',
        player_id: 'player-1',
        match_id: 'md14',
        card_type: 'yellow',
        minute: 20,
        note: null,
        created_at: '2026-08-16T06:20:00Z',
      },
      {
        id: 'card-r',
        player_id: 'player-1',
        match_id: 'md14',
        card_type: 'red',
        minute: 30,
        note: null,
        created_at: '2026-08-16T06:30:00Z',
      },
    ],
    suspensions: [
      {
        id: 'susp-1',
        season_id: 'season-1',
        age_group_id: 'age-1',
        player_id: 'player-1',
        team_id: 'A',
        total_points: 8,
        point_sources: [{ match_id: 'md14', matchday: 14, points: 8, points_before: 0, points_after: 8, reason: '1Y + 1R' }],
        ban_matches: 1,
        suspension_type: 'yellow_red',
        trigger_match_id: 'md14',
        accumulated_threshold: null,
        source_card_ids: ['card-y', 'card-r'],
        serving_match_ids: ['cl1'],
        served_completed_at: null,
        legacy_migrated: false,
        suspended_from_match_id: 'cl1',
        suspension_reason: 'yellow_red - แบน 1 นัด (MD1)',
        suspension_details: { trigger_event: 'ใบเหลือง + ใบแดง', suspended_matches: [] },
        created_at: '2026-08-16T07:00:00Z',
        updated_at: '2026-08-16T07:00:00Z',
      },
    ],
    matches: [
      {
        id: 'md14',
        season_id: 'season-1',
        age_group_id: 'age-1',
        match_code: 'M14',
        matchday: 'MatchDay 14',
        match_date: '2026-08-16',
        match_time: '13:00:00',
        status: 'finished',
        league_phase: 'regular',
        home_team_id: 'A',
        away_team_id: 'B',
        home_team: { id: 'A', name: 'ทีม A', short_name: 'A' },
        away_team: { id: 'B', name: 'ทีม B', short_name: 'B' },
      },
      {
        id: 'cl1',
        season_id: 'season-1',
        age_group_id: 'age-1',
        match_code: 'CL-D1-R1',
        matchday: 'CL1',
        match_date: '2026-08-22',
        match_time: '13:00:00',
        status: 'scheduled',
        league_phase: 'champion_league',
        home_team_id: 'A',
        away_team_id: 'C',
        home_team: { id: 'A', name: 'ทีม A', short_name: 'A' },
        away_team: { id: 'C', name: 'ทีม C', short_name: 'C' },
      },
    ],
  };
}

describe('GET /api/public/players/[id]', () => {
  beforeEach(() => initializeDb());

  it('returns 404 for an unknown player', async () => {
    const response = await GET(new Request('http://localhost/api/public/players/missing'), requestParams('missing'));
    expect(response.status).toBe(404);
  });

  it('returns player identity, event totals and suspension trigger/serving history', async () => {
    const response = await GET(new Request('http://localhost/api/public/players/player-1'), requestParams('player-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.player).toEqual(
      expect.objectContaining({
        id: 'player-1',
        full_name: 'ผู้เล่นทดสอบ',
        shirt_no: 9,
        team: expect.objectContaining({ id: 'A', name: 'ทีม A' }),
        season: expect.objectContaining({ year: 2026 }),
        age_group: expect.objectContaining({ code: 'U14' }),
        division: expect.objectContaining({ name: 'ดิวิชั่น 1' }),
      })
    );
    expect(body.player).not.toHaveProperty('birth_date');
    expect(body.player).not.toHaveProperty('remarks');
    expect(body.player).not.toHaveProperty('player_code');
    expect(body.summary).toEqual({
      goals: 2,
      yellow: 1,
      red: 1,
      second_yellow: 0,
      discipline_points: 8,
    });
    expect(body.suspensions).toHaveLength(1);
    expect(body.suspensions[0]).toEqual(
      expect.objectContaining({
        id: 'susp-1',
        status: 'active',
        remaining_count: 1,
        trigger_match: expect.objectContaining({ id: 'md14', matchday_number: 14 }),
        serving_matches: [expect.objectContaining({ id: 'cl1', status: 'scheduled' })],
      })
    );
    expect(body.goals[0].match.id).toBe('md14');
    expect(body.cards).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';
import { buildDrawSelectedMatchUpdates } from '../qualification-draws';

describe('buildDrawSelectedMatchUpdates', () => {
  it('updates draw_selected matches once the selected teams are known', () => {
    const updates = buildDrawSelectedMatchUpdates({
      matches: [
        {
          id: 'match-1',
          home_source_type: 'group_rank',
          home_source_ref: 'A:1',
          away_source_type: 'draw_selected',
          away_source_ref: 'G-U16-THIRD-DRAW-1',
          home_team_id: 'team-a1',
          away_team_id: null,
          sources_resolved_at: null,
        },
      ],
      teamIdsBySourceRef: new Map([['G-U16-THIRD-DRAW-1', 'team-c3']]),
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(updates).toEqual([
      {
        id: 'match-1',
        home_team_id: 'team-a1',
        away_team_id: 'team-c3',
        sources_resolved_at: '2026-07-15T12:00:00.000Z',
      },
    ]);
  });

  it('leaves matches unchanged while draw_selected is still unconfigured', () => {
    const updates = buildDrawSelectedMatchUpdates({
      matches: [
        {
          id: 'match-1',
          home_source_type: 'draw_selected',
          home_source_ref: 'G-U16-THIRD-DRAW-2',
          away_source_type: 'group_rank',
          away_source_ref: 'B:1',
          home_team_id: null,
          away_team_id: 'team-b1',
          sources_resolved_at: null,
        },
      ],
      teamIdsBySourceRef: new Map(),
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(updates).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildDrawSelectedConfigs,
  buildDrawSelectedSelectionMaps,
  validateDrawSelectedAssignments,
} from '../drawSelected';

describe('drawSelected helpers', () => {
  it('builds the two supported G-U16 third-place draw references', () => {
    const { configsByRef, configsByCategoryCode } = buildDrawSelectedConfigs([
      {
        categoryId: 'category-g-u16',
        categoryCode: 'G-U16',
        bestThirdPlacedCount: 2,
        bestThirdPlacedMethod: 'draw',
      },
    ]);

    expect(Array.from(configsByRef.keys())).toEqual([
      'G-U16-THIRD-DRAW-1',
      'G-U16-THIRD-DRAW-2',
    ]);
    expect(configsByCategoryCode.get('G-U16')?.map((entry) => entry.sourceRef)).toEqual([
      'G-U16-THIRD-DRAW-1',
      'G-U16-THIRD-DRAW-2',
    ]);
  });

  it('accepts distinct eligible teams for DRAW-1 and DRAW-2', () => {
    const { configsByRef, configsByCategoryCode } = buildDrawSelectedConfigs([
      {
        categoryId: 'category-g-u16',
        categoryCode: 'G-U16',
        bestThirdPlacedCount: 2,
        bestThirdPlacedMethod: 'draw',
      },
    ]);

    const errors = validateDrawSelectedAssignments({
      categoryCode: 'G-U16',
      configsByRef,
      configsByCategoryCode,
      assignments: [
        { sourceRef: 'G-U16-THIRD-DRAW-1', teamId: 'team-a3' },
        { sourceRef: 'G-U16-THIRD-DRAW-2', teamId: 'team-b3' },
      ],
      eligibleTeamIds: new Set(['team-a3', 'team-b3', 'team-c3']),
    });

    expect(errors).toEqual([]);
  });

  it('rejects the same team being assigned to DRAW-1 and DRAW-2', () => {
    const { configsByRef, configsByCategoryCode } = buildDrawSelectedConfigs([
      {
        categoryId: 'category-g-u16',
        categoryCode: 'G-U16',
        bestThirdPlacedCount: 2,
        bestThirdPlacedMethod: 'draw',
      },
    ]);

    const errors = validateDrawSelectedAssignments({
      categoryCode: 'G-U16',
      configsByRef,
      configsByCategoryCode,
      assignments: [
        { sourceRef: 'G-U16-THIRD-DRAW-1', teamId: 'team-a3' },
        { sourceRef: 'G-U16-THIRD-DRAW-2', teamId: 'team-a3' },
      ],
      eligibleTeamIds: new Set(['team-a3', 'team-b3', 'team-c3']),
    });

    expect(errors).toContain(
      'Draw references G-U16-THIRD-DRAW-1 and G-U16-THIRD-DRAW-2 cannot resolve to the same team'
    );
  });

  it('rejects teams outside the eligible third-place pool', () => {
    const { configsByRef, configsByCategoryCode } = buildDrawSelectedConfigs([
      {
        categoryId: 'category-g-u16',
        categoryCode: 'G-U16',
        bestThirdPlacedCount: 2,
        bestThirdPlacedMethod: 'draw',
      },
    ]);

    const errors = validateDrawSelectedAssignments({
      categoryCode: 'G-U16',
      configsByRef,
      configsByCategoryCode,
      assignments: [
        { sourceRef: 'G-U16-THIRD-DRAW-1', teamId: 'team-a3' },
        { sourceRef: 'G-U16-THIRD-DRAW-2', teamId: 'team-outsider' },
      ],
      eligibleTeamIds: new Set(['team-a3', 'team-b3', 'team-c3']),
    });

    expect(errors).toContain(
      'Draw reference G-U16-THIRD-DRAW-2 selected a team that is not an eligible third-place team'
    );
  });

  it('maps selected candidates back to draw_selected references and blocks duplicate teams', () => {
    const { configsByRef } = buildDrawSelectedConfigs([
      {
        categoryId: 'category-g-u16',
        categoryCode: 'G-U16',
        bestThirdPlacedCount: 2,
        bestThirdPlacedMethod: 'draw',
      },
    ]);

    const mapped = buildDrawSelectedSelectionMaps({
      configsByRef,
      activeDraws: [
        {
          id: 'draw-1',
          category_id: 'category-g-u16',
          qualification_slot: 'group_third_place',
        },
      ],
      candidates: [
        { draw_id: 'draw-1', team_id: 'team-a3', is_selected: true, draw_order: 1 },
        { draw_id: 'draw-1', team_id: 'team-a3', is_selected: true, draw_order: 2 },
      ],
    });

    expect(mapped.teamIdsBySourceRef.get('G-U16-THIRD-DRAW-1')).toBe('team-a3');
    expect(mapped.teamIdsBySourceRef.get('G-U16-THIRD-DRAW-2')).toBe('team-a3');
    expect(mapped.errors).toContain(
      'Draw references G-U16-THIRD-DRAW-1 and G-U16-THIRD-DRAW-2 cannot resolve to the same team'
    );
  });
});

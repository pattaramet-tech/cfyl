import { describe, expect, it } from 'vitest';
import { resolveScheduleSourceTeamId } from '../resolveScheduleSource';

describe('resolveScheduleSourceTeamId', () => {
  it('keeps draw_selected matches unresolved until a draw result exists', () => {
    const teamId = resolveScheduleSourceTeamId({
      sourceType: 'draw_selected',
      sourceRef: 'G-U16-THIRD-DRAW-1',
      categoryId: 'category-g-u16',
      groupId: null,
      teamsByCategoryAndCode: new Map(),
      groupMembersBySlot: new Map(),
      drawSelectedTeamIdsByRef: new Map(),
      existingSourceType: null,
      existingSourceRef: null,
      existingTeamId: null,
    });

    expect(teamId).toBeNull();
  });

  it('resolves draw_selected references after draw results are saved', () => {
    const teamId = resolveScheduleSourceTeamId({
      sourceType: 'draw_selected',
      sourceRef: 'G-U16-THIRD-DRAW-2',
      categoryId: 'category-g-u16',
      groupId: null,
      teamsByCategoryAndCode: new Map(),
      groupMembersBySlot: new Map(),
      drawSelectedTeamIdsByRef: new Map([['G-U16-THIRD-DRAW-2', 'team-b3']]),
      existingSourceType: null,
      existingSourceRef: null,
      existingTeamId: null,
    });

    expect(teamId).toBe('team-b3');
  });
});

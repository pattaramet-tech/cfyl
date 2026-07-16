import { DRAW_SELECTED_SOURCE_TYPE } from './drawSelected';
import { groupSlotKey, teamKey } from './validateScheduleImportRow';

interface TeamRowLike {
  id: string;
}

interface GroupMemberRowLike {
  team_id: string | null;
}

export interface ResolveScheduleSourceParams {
  sourceType: string;
  sourceRef: string;
  categoryId: string;
  groupId: string | null;
  teamsByCategoryAndCode: Map<string, TeamRowLike>;
  groupMembersBySlot: Map<string, GroupMemberRowLike>;
  drawSelectedTeamIdsByRef?: Map<string, string>;
  existingSourceType: string | null;
  existingSourceRef: string | null;
  existingTeamId: string | null;
}

function upper(value: string): string {
  return value.trim().toUpperCase();
}

export function resolveScheduleSourceTeamId(params: ResolveScheduleSourceParams): string | null {
  const {
    sourceType,
    sourceRef,
    categoryId,
    groupId,
    teamsByCategoryAndCode,
    groupMembersBySlot,
    drawSelectedTeamIdsByRef,
    existingSourceType,
    existingSourceRef,
    existingTeamId,
  } = params;

  if (sourceType === 'team') {
    return teamsByCategoryAndCode.get(teamKey(categoryId, sourceRef))?.id || null;
  }

  if (sourceType === 'group_slot' && groupId) {
    const member = groupMembersBySlot.get(groupSlotKey(groupId, sourceRef));
    if (member?.team_id) return member.team_id;
  }

  if (sourceType === DRAW_SELECTED_SOURCE_TYPE) {
    return drawSelectedTeamIdsByRef?.get(upper(sourceRef)) || null;
  }

  if (
    existingSourceType === sourceType &&
    upper(existingSourceRef || '') === upper(sourceRef) &&
    existingTeamId
  ) {
    return existingTeamId;
  }

  return null;
}

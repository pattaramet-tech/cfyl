export const DRAW_SELECTED_SOURCE_TYPE = 'draw_selected';
export const GROUP_THIRD_PLACE_QUALIFICATION_SLOT = 'group_third_place';

const DRAW_SELECTED_SOURCE_REF_PATTERN = /^([A-Z0-9-]+)-THIRD-DRAW-(\d+)$/;

export interface DrawSelectedRuleRecord {
  categoryId: string;
  categoryCode: string;
  bestThirdPlacedCount: number;
  bestThirdPlacedMethod: string;
}

export interface DrawSelectedSourceRefParts {
  sourceRef: string;
  categoryCode: string;
  drawPosition: number;
  qualificationSlot: typeof GROUP_THIRD_PLACE_QUALIFICATION_SLOT;
}

export interface DrawSelectedConfig {
  sourceRef: string;
  categoryId: string;
  categoryCode: string;
  drawPosition: number;
  qualificationSlot: typeof GROUP_THIRD_PLACE_QUALIFICATION_SLOT;
  slotsAvailable: number;
}

export interface TournamentQualificationDrawRow {
  id: string;
  category_id: string;
  qualification_slot: string;
}

export interface TournamentQualificationDrawCandidateRow {
  draw_id: string;
  team_id: string;
  is_selected: boolean;
  draw_order: number | null;
}

export interface DrawSelectedValidationResult {
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface DrawSelectedSelectionMaps {
  teamIdsBySourceRef: Map<string, string>;
  errors: string[];
}

export interface DrawSelectedAssignmentInput {
  sourceRef: string;
  teamId: string;
}

export interface ValidateDrawSelectedAssignmentsParams {
  categoryCode: string;
  configsByRef: Map<string, DrawSelectedConfig>;
  configsByCategoryCode: Map<string, DrawSelectedConfig[]>;
  assignments: DrawSelectedAssignmentInput[];
  eligibleTeamIds: Set<string>;
}

export function parseDrawSelectedSourceRef(sourceRef: string): DrawSelectedSourceRefParts | null {
  const normalizedSourceRef = String(sourceRef || '').trim().toUpperCase();
  const match = normalizedSourceRef.match(DRAW_SELECTED_SOURCE_REF_PATTERN);
  if (!match) return null;

  const drawPosition = Number(match[2]);
  if (!Number.isInteger(drawPosition) || drawPosition <= 0) return null;

  return {
    sourceRef: normalizedSourceRef,
    categoryCode: match[1],
    drawPosition,
    qualificationSlot: GROUP_THIRD_PLACE_QUALIFICATION_SLOT,
  };
}

export function buildDrawSelectedConfigs(rules: DrawSelectedRuleRecord[]): {
  configsByRef: Map<string, DrawSelectedConfig>;
  configsByCategoryCode: Map<string, DrawSelectedConfig[]>;
} {
  const configsByRef = new Map<string, DrawSelectedConfig>();
  const configsByCategoryCode = new Map<string, DrawSelectedConfig[]>();

  for (const rule of rules) {
    if (rule.bestThirdPlacedMethod !== 'draw' || rule.bestThirdPlacedCount <= 0) continue;

    const categoryCode = rule.categoryCode.trim().toUpperCase();
    const categoryConfigs: DrawSelectedConfig[] = [];

    for (let drawPosition = 1; drawPosition <= rule.bestThirdPlacedCount; drawPosition += 1) {
      const sourceRef = `${categoryCode}-THIRD-DRAW-${drawPosition}`;
      const config: DrawSelectedConfig = {
        sourceRef,
        categoryId: rule.categoryId,
        categoryCode,
        drawPosition,
        qualificationSlot: GROUP_THIRD_PLACE_QUALIFICATION_SLOT,
        slotsAvailable: rule.bestThirdPlacedCount,
      };

      configsByRef.set(sourceRef, config);
      categoryConfigs.push(config);
    }

    configsByCategoryCode.set(categoryCode, categoryConfigs);
  }

  return { configsByRef, configsByCategoryCode };
}

export function validateDrawSelectedSourceRef(params: {
  sourceRef: string;
  rowCategoryCode: string;
  configsByRef: Map<string, DrawSelectedConfig>;
  configsByCategoryCode: Map<string, DrawSelectedConfig[]>;
}): DrawSelectedValidationResult {
  const normalizedSourceRef = String(params.sourceRef || '').trim().toUpperCase();
  const normalizedCategoryCode = String(params.rowCategoryCode || '').trim().toUpperCase();
  const parsed = parseDrawSelectedSourceRef(normalizedSourceRef);

  if (!parsed) {
    return {
      ok: false,
      errorCode: 'E_DRAW_SELECTED_FORMAT',
      errorMessage: `Invalid draw_selected source_ref format: ${normalizedSourceRef}`,
    };
  }

  if (parsed.categoryCode !== normalizedCategoryCode) {
    return {
      ok: false,
      errorCode: 'E_DRAW_SELECTED_CATEGORY',
      errorMessage: `Draw reference ${normalizedSourceRef} does not belong to category ${normalizedCategoryCode}`,
    };
  }

  const supportedConfigs = params.configsByCategoryCode.get(normalizedCategoryCode) || [];
  if (supportedConfigs.length === 0) {
    return {
      ok: false,
      errorCode: 'E_DRAW_SELECTED_CONFIG',
      errorMessage: `Match references draw reference ${normalizedSourceRef} that has no configuration support`,
    };
  }

  if (!params.configsByRef.has(normalizedSourceRef)) {
    return {
      ok: false,
      errorCode: 'E_DRAW_SELECTED_UNKNOWN',
      errorMessage: `Unknown draw_selected source_ref: ${normalizedSourceRef}`,
    };
  }

  return { ok: true };
}

export function buildDrawSelectedSelectionMaps(params: {
  configsByRef: Map<string, DrawSelectedConfig>;
  activeDraws: TournamentQualificationDrawRow[];
  candidates: TournamentQualificationDrawCandidateRow[];
}): DrawSelectedSelectionMaps {
  const teamIdsBySourceRef = new Map<string, string>();
  const errors: string[] = [];
  const configsByCategorySlot = new Map<string, DrawSelectedConfig[]>();
  const selectedTeamsByCategorySlot = new Map<string, Map<string, string>>();

  for (const config of params.configsByRef.values()) {
    const key = `${config.categoryId}|${config.qualificationSlot}`;
    const list = configsByCategorySlot.get(key) || [];
    list.push(config);
    configsByCategorySlot.set(key, list);
  }

  for (const list of configsByCategorySlot.values()) {
    list.sort((left, right) => left.drawPosition - right.drawPosition);
  }

  const candidatesByDrawId = new Map<string, TournamentQualificationDrawCandidateRow[]>();
  for (const candidate of params.candidates) {
    const list = candidatesByDrawId.get(candidate.draw_id) || [];
    list.push(candidate);
    candidatesByDrawId.set(candidate.draw_id, list);
  }

  for (const draw of params.activeDraws) {
    const key = `${draw.category_id}|${draw.qualification_slot}`;
    const configs = configsByCategorySlot.get(key) || [];
    if (configs.length === 0) continue;

    const selectedCandidates = (candidatesByDrawId.get(draw.id) || []).filter(
      (candidate) => candidate.is_selected && candidate.draw_order !== null
    );

    for (const candidate of selectedCandidates) {
      const config = configs.find((entry) => entry.drawPosition === candidate.draw_order);
      if (!config) continue;

      const selectedTeams = selectedTeamsByCategorySlot.get(key) || new Map<string, string>();
      const existingSourceRef = selectedTeams.get(candidate.team_id);
      if (existingSourceRef) {
        errors.push(
          `Draw references ${existingSourceRef} and ${config.sourceRef} cannot resolve to the same team`
        );
      } else {
        selectedTeams.set(candidate.team_id, config.sourceRef);
        selectedTeamsByCategorySlot.set(key, selectedTeams);
      }

      teamIdsBySourceRef.set(config.sourceRef, candidate.team_id);
    }
  }

  return { teamIdsBySourceRef, errors };
}

export function validateDrawSelectedAssignments(
  params: ValidateDrawSelectedAssignmentsParams
): string[] {
  const errors: string[] = [];
  const categoryCode = params.categoryCode.trim().toUpperCase();
  const expectedConfigs = params.configsByCategoryCode.get(categoryCode) || [];
  const seenSourceRefs = new Set<string>();
  const seenTeamIds = new Map<string, string>();

  if (expectedConfigs.length === 0) {
    errors.push(`Category ${categoryCode} has no draw_selected configuration support`);
    return errors;
  }

  const expectedSourceRefs = new Set(expectedConfigs.map((config) => config.sourceRef));

  for (const assignment of params.assignments) {
    const sourceRef = assignment.sourceRef.trim().toUpperCase();
    const validation = validateDrawSelectedSourceRef({
      sourceRef,
      rowCategoryCode: categoryCode,
      configsByRef: params.configsByRef,
      configsByCategoryCode: params.configsByCategoryCode,
    });

    if (!validation.ok) {
      errors.push(validation.errorMessage || `Invalid draw_selected source_ref: ${sourceRef}`);
      continue;
    }

    if (seenSourceRefs.has(sourceRef)) {
      errors.push(`Duplicate draw_selected source_ref: ${sourceRef}`);
      continue;
    }
    seenSourceRefs.add(sourceRef);

    const teamId = assignment.teamId.trim();
    if (!teamId) {
      errors.push(`Draw reference ${sourceRef} requires a team_id`);
      continue;
    }

    const existingSourceRef = seenTeamIds.get(teamId);
    if (existingSourceRef) {
      errors.push(
        `Draw references ${existingSourceRef} and ${sourceRef} cannot resolve to the same team`
      );
      continue;
    }
    seenTeamIds.set(teamId, sourceRef);

    if (!params.eligibleTeamIds.has(teamId)) {
      errors.push(`Draw reference ${sourceRef} selected a team that is not an eligible third-place team`);
    }
  }

  for (const sourceRef of expectedSourceRefs) {
    if (!seenSourceRefs.has(sourceRef)) {
      errors.push(`Missing draw selection for ${sourceRef}`);
    }
  }

  return errors;
}

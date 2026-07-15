import {
  GROUP_THIRD_PLACE_QUALIFICATION_SLOT,
  buildDrawSelectedConfigs,
  buildDrawSelectedSelectionMaps,
  validateDrawSelectedAssignments,
  type DrawSelectedAssignmentInput,
  type TournamentQualificationDrawCandidateRow,
  type TournamentQualificationDrawRow,
} from '@/lib/tournament/scheduling/drawSelected';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';

// NOTE: The Tournament V2 Standings Engine is not implemented yet. This
// service therefore does NOT calculate group standings or infer third-place
// rank from match results. The physical draw for G-U16 third-place
// qualification is conducted on paper at the venue; this service only
// records what an authorized tournament_super_admin manually confirms
// afterward — both the three eligible candidate teams and the two selected
// results. See TOURNAMENT_V2_SCHEDULING_AND_IMPORT.md §D-29 and the
// "Manual Qualification Placeholder Assignment" feature notes in PR #7.

type TournamentClient = ReturnType<typeof getTournamentServiceClient>;

const MANUAL_CANDIDATE_CONFIRMATION_MARKER = '[MANUAL_CANDIDATE_CONFIRMATION]';

interface CategoryRow {
  id: string;
  code: string;
}

interface QualificationRuleRow {
  category_id: string;
  best_third_placed_count: number;
  best_third_placed_method: string;
}

interface TeamRow {
  id: string;
  category_id: string;
  team_code: string;
  name: string;
}

interface GroupMemberRow {
  group_id: string;
  team_id: string | null;
}

interface TournamentMatchSourceRow {
  id: string;
  home_source_type: string | null;
  home_source_ref: string | null;
  away_source_type: string | null;
  away_source_ref: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  sources_resolved_at: string | null;
}

interface TournamentMatchRow extends TournamentMatchSourceRow {
  category_id: string;
}

interface ActiveDrawRow {
  id: string;
  version: number;
}

interface DrawRow {
  id: string;
  category_id: string;
  qualification_slot: string;
  slots_available: number;
  version: number;
  drawn_by: string | null;
  drawn_at: string;
  note: string | null;
  superseded_at: string | null;
}

interface CandidateRow {
  id: string;
  draw_id: string;
  team_id: string;
  group_id: string | null;
  is_selected: boolean;
  draw_order: number | null;
}

export interface CandidateOption {
  teamId: string;
  teamCode: string;
  teamName: string;
}

export interface DrawVersionSummary {
  drawId: string;
  version: number;
  isActive: boolean;
  drawnBy: string | null;
  drawnAt: string;
  note: string | null;
  isManualCandidateConfirmation: boolean;
  candidates: Array<{ teamId: string; teamCode: string; teamName: string; isSelected: boolean; drawOrder: number | null }>;
}

export interface QualificationDrawStateResult {
  categoryId: string;
  candidateOptions: CandidateOption[];
  placeholderSourceRefs: string[];
  versions: DrawVersionSummary[];
}

interface SaveQualificationDrawSelectionsParams {
  client: TournamentClient;
  tournamentId: string;
  categoryCode: string;
  candidateTeamIds: string[];
  assignments: DrawSelectedAssignmentInput[];
  note?: string;
  actorUserId?: string | null;
}

export interface SaveQualificationDrawSelectionsResult {
  drawId: string;
  version: number;
  updatedMatchIds: string[];
  selectedSourceRefs: string[];
}

export function buildDrawSelectedMatchUpdates(params: {
  matches: TournamentMatchSourceRow[];
  teamIdsBySourceRef: Map<string, string>;
  now: string;
}): Array<{
  id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  sources_resolved_at: string | null;
}> {
  const updates: Array<{
    id: string;
    home_team_id: string | null;
    away_team_id: string | null;
    sources_resolved_at: string | null;
  }> = [];

  for (const match of params.matches) {
    const homeSourceRef = String(match.home_source_ref || '').trim().toUpperCase();
    const awaySourceRef = String(match.away_source_ref || '').trim().toUpperCase();

    const nextHomeTeamId =
      match.home_source_type === 'draw_selected'
        ? params.teamIdsBySourceRef.get(homeSourceRef) || null
        : match.home_team_id;
    const nextAwayTeamId =
      match.away_source_type === 'draw_selected'
        ? params.teamIdsBySourceRef.get(awaySourceRef) || null
        : match.away_team_id;

    // Preserve the original source_type/source_ref always — resolution only
    // ever populates home_team_id/away_team_id, never converts the source
    // definition itself (e.g. never rewrites source_type to 'team').
    if (nextHomeTeamId === match.home_team_id && nextAwayTeamId === match.away_team_id) {
      continue;
    }

    updates.push({
      id: match.id,
      home_team_id: nextHomeTeamId,
      away_team_id: nextAwayTeamId,
      sources_resolved_at: nextHomeTeamId || nextAwayTeamId ? params.now : match.sources_resolved_at,
    });
  }

  return updates;
}

function validateCandidateTeamIds(params: {
  candidateTeamIds: string[];
  expectedCount: number;
  teamsInCategory: Set<string>;
}): string[] {
  const errors: string[] = [];
  const trimmed = params.candidateTeamIds.map((id) => id.trim()).filter(Boolean);

  if (trimmed.length !== params.expectedCount) {
    errors.push(`Exactly ${params.expectedCount} candidate teams are required (received ${trimmed.length})`);
    return errors;
  }

  const uniqueIds = new Set(trimmed);
  if (uniqueIds.size !== trimmed.length) {
    errors.push('Duplicate candidate team in candidate list');
  }

  for (const teamId of trimmed) {
    if (!params.teamsInCategory.has(teamId)) {
      errors.push(`Candidate team ${teamId} does not belong to this category`);
    }
  }

  return errors;
}

export async function getQualificationDrawState(params: {
  client: TournamentClient;
  tournamentId: string;
  categoryCode: string;
}): Promise<QualificationDrawStateResult> {
  const categoryCode = params.categoryCode.trim().toUpperCase();

  const [categoriesResult, qualificationRulesResult, teamsResult, drawsResult] = await Promise.all([
    params.client
      .from('tournament_categories')
      .select('id, code')
      .eq('tournament_id', params.tournamentId)
      .is('deleted_at', null),
    params.client
      .from('tournament_qualification_rules')
      .select('category_id, best_third_placed_count, best_third_placed_method')
      .eq('tournament_id', params.tournamentId),
    params.client
      .from('tournament_teams')
      .select('id, category_id, team_code, name')
      .eq('tournament_id', params.tournamentId),
    params.client
      .from('tournament_qualification_draws')
      .select('id, category_id, qualification_slot, slots_available, version, drawn_by, drawn_at, note, superseded_at')
      .eq('qualification_slot', GROUP_THIRD_PLACE_QUALIFICATION_SLOT)
      .order('version', { ascending: false }),
  ]);

  const queryError = [
    categoriesResult.error,
    qualificationRulesResult.error,
    teamsResult.error,
    drawsResult.error,
  ].find(Boolean);
  if (queryError) throw new Error(queryError.message);

  const categories = (categoriesResult.data || []) as CategoryRow[];
  const category = categories.find((entry) => entry.code.trim().toUpperCase() === categoryCode);
  if (!category) {
    throw new Error(`Category ${categoryCode} not found`);
  }

  const qualificationRules = ((qualificationRulesResult.data || []) as QualificationRuleRow[])
    .filter((rule) => rule.category_id === category.id)
    .map((rule) => ({
      categoryId: rule.category_id,
      categoryCode: category.code,
      bestThirdPlacedCount: rule.best_third_placed_count,
      bestThirdPlacedMethod: rule.best_third_placed_method,
    }));
  const { configsByCategoryCode } = buildDrawSelectedConfigs(qualificationRules);
  const placeholderConfigs = configsByCategoryCode.get(categoryCode) || [];

  const teamsInCategory = ((teamsResult.data || []) as TeamRow[]).filter(
    (team) => team.category_id === category.id
  );
  const teamsById = new Map(teamsInCategory.map((team) => [team.id, team]));
  const candidateOptions: CandidateOption[] = teamsInCategory.map((team) => ({
    teamId: team.id,
    teamCode: team.team_code,
    teamName: team.name,
  }));

  const draws = ((drawsResult.data || []) as DrawRow[]).filter((draw) => draw.category_id === category.id);
  const drawIds = draws.map((draw) => draw.id);

  let candidatesByDrawId = new Map<string, CandidateRow[]>();
  if (drawIds.length > 0) {
    const { data: candidateData, error: candidateError } = await params.client
      .from('tournament_qualification_draw_candidates')
      .select('id, draw_id, team_id, group_id, is_selected, draw_order')
      .in('draw_id', drawIds);
    if (candidateError) throw new Error(candidateError.message);
    candidatesByDrawId = new Map();
    for (const candidate of (candidateData || []) as CandidateRow[]) {
      const list = candidatesByDrawId.get(candidate.draw_id) || [];
      list.push(candidate);
      candidatesByDrawId.set(candidate.draw_id, list);
    }
  }

  const versions: DrawVersionSummary[] = draws
    .sort((left, right) => right.version - left.version)
    .map((draw) => ({
      drawId: draw.id,
      version: draw.version,
      isActive: draw.superseded_at === null,
      drawnBy: draw.drawn_by,
      drawnAt: draw.drawn_at,
      note: draw.note,
      isManualCandidateConfirmation: (draw.note || '').includes(MANUAL_CANDIDATE_CONFIRMATION_MARKER),
      candidates: (candidatesByDrawId.get(draw.id) || [])
        .map((candidate) => ({
          teamId: candidate.team_id,
          teamCode: teamsById.get(candidate.team_id)?.team_code || '',
          teamName: teamsById.get(candidate.team_id)?.name || '',
          isSelected: candidate.is_selected,
          drawOrder: candidate.draw_order,
        }))
        .sort((a, b) => (a.drawOrder || 99) - (b.drawOrder || 99)),
    }));

  return {
    categoryId: category.id,
    candidateOptions,
    placeholderSourceRefs: placeholderConfigs.map((config) => config.sourceRef),
    versions,
  };
}

interface PreviewMatchQueryRow {
  id: string;
  category_id: string;
  match_code: string;
  home_source_type: string | null;
  home_source_ref: string | null;
  away_source_type: string | null;
  away_source_ref: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
}

export interface PreviewMatchSummary {
  matchId: string;
  matchCode: string;
  side: 'home' | 'away';
  sourceRef: string;
  currentTeamId: string | null;
  resolvedTeamId: string;
  resolvedTeamCode: string;
  resolvedTeamName: string;
}

export interface PreviewQualificationDrawSelectionsResult {
  affectedMatches: PreviewMatchSummary[];
}

/**
 * Read-only preview: validates candidates/selections exactly like Save, and
 * reports which matches would be resolved and to which teams — without
 * writing anything (no draw row, no candidate rows, no match updates).
 */
export async function previewQualificationDrawSelections(params: {
  client: TournamentClient;
  tournamentId: string;
  categoryCode: string;
  candidateTeamIds: string[];
  assignments: DrawSelectedAssignmentInput[];
}): Promise<PreviewQualificationDrawSelectionsResult> {
  const categoryCode = params.categoryCode.trim().toUpperCase();

  const [categoriesResult, qualificationRulesResult, teamsResult, matchesResult] = await Promise.all([
    params.client
      .from('tournament_categories')
      .select('id, code')
      .eq('tournament_id', params.tournamentId)
      .is('deleted_at', null),
    params.client
      .from('tournament_qualification_rules')
      .select('category_id, best_third_placed_count, best_third_placed_method')
      .eq('tournament_id', params.tournamentId),
    params.client
      .from('tournament_teams')
      .select('id, category_id, team_code, name')
      .eq('tournament_id', params.tournamentId),
    params.client
      .from('tournament_matches')
      .select('id, category_id, match_code, home_source_type, home_source_ref, away_source_type, away_source_ref, home_team_id, away_team_id')
      .eq('tournament_id', params.tournamentId)
      .is('deleted_at', null),
  ]);

  const queryError = [
    categoriesResult.error,
    qualificationRulesResult.error,
    teamsResult.error,
    matchesResult.error,
  ].find(Boolean);
  if (queryError) throw new Error(queryError.message);

  const categories = (categoriesResult.data || []) as CategoryRow[];
  const category = categories.find((entry) => entry.code.trim().toUpperCase() === categoryCode);
  if (!category) throw new Error(`Category ${categoryCode} not found`);

  const qualificationRules = ((qualificationRulesResult.data || []) as QualificationRuleRow[])
    .filter((rule) => rule.category_id === category.id)
    .map((rule) => ({
      categoryId: rule.category_id,
      categoryCode: category.code,
      bestThirdPlacedCount: rule.best_third_placed_count,
      bestThirdPlacedMethod: rule.best_third_placed_method,
    }));
  const { configsByRef, configsByCategoryCode } = buildDrawSelectedConfigs(qualificationRules);
  const categoryConfigs = configsByCategoryCode.get(categoryCode) || [];
  if (categoryConfigs.length === 0) {
    throw new Error(`Match references draw reference ${categoryCode}-THIRD-DRAW-1 that has no configuration support`);
  }

  const teamsInCategory = ((teamsResult.data || []) as TeamRow[]).filter(
    (team) => team.category_id === category.id
  );
  const teamsById = new Map(teamsInCategory.map((team) => [team.id, team]));
  const teamsInCategoryIds = new Set(teamsInCategory.map((team) => team.id));

  const candidateErrors = validateCandidateTeamIds({
    candidateTeamIds: params.candidateTeamIds,
    expectedCount: 3,
    teamsInCategory: teamsInCategoryIds,
  });
  if (candidateErrors.length > 0) throw new Error(candidateErrors[0]);
  const eligibleTeamIds = new Set(params.candidateTeamIds.map((id) => id.trim()));

  const assignmentErrors = validateDrawSelectedAssignments({
    categoryCode,
    configsByRef,
    configsByCategoryCode,
    assignments: params.assignments,
    eligibleTeamIds,
  });
  if (assignmentErrors.length > 0) throw new Error(assignmentErrors[0]);

  const teamIdsBySourceRef = new Map(
    params.assignments.map((assignment) => [assignment.sourceRef.trim().toUpperCase(), assignment.teamId.trim()])
  );

  const drawSourceRefs = new Set(categoryConfigs.map((config) => config.sourceRef));
  const matches = ((matchesResult.data || []) as PreviewMatchQueryRow[]).filter(
    (match) => match.category_id === category.id
  );

  const affectedMatches: PreviewMatchSummary[] = [];
  for (const match of matches) {
    const homeRef = String(match.home_source_ref || '').trim().toUpperCase();
    const awayRef = String(match.away_source_ref || '').trim().toUpperCase();
    if (match.home_source_type === 'draw_selected' && drawSourceRefs.has(homeRef)) {
      const resolvedTeamId = teamIdsBySourceRef.get(homeRef);
      if (resolvedTeamId) {
        const team = teamsById.get(resolvedTeamId);
        affectedMatches.push({
          matchId: match.id,
          matchCode: match.match_code,
          side: 'home',
          sourceRef: homeRef,
          currentTeamId: match.home_team_id,
          resolvedTeamId,
          resolvedTeamCode: team?.team_code || '',
          resolvedTeamName: team?.name || '',
        });
      }
    }
    if (match.away_source_type === 'draw_selected' && drawSourceRefs.has(awayRef)) {
      const resolvedTeamId = teamIdsBySourceRef.get(awayRef);
      if (resolvedTeamId) {
        const team = teamsById.get(resolvedTeamId);
        affectedMatches.push({
          matchId: match.id,
          matchCode: match.match_code,
          side: 'away',
          sourceRef: awayRef,
          currentTeamId: match.away_team_id,
          resolvedTeamId,
          resolvedTeamCode: team?.team_code || '',
          resolvedTeamName: team?.name || '',
        });
      }
    }
  }

  return { affectedMatches };
}

export async function saveQualificationDrawSelections(
  params: SaveQualificationDrawSelectionsParams
): Promise<SaveQualificationDrawSelectionsResult> {
  const categoryCode = params.categoryCode.trim().toUpperCase();
  const now = new Date().toISOString();

  const [categoriesResult, qualificationRulesResult, teamsResult, groupMembersResult, matchesResult] =
    await Promise.all([
      params.client
        .from('tournament_categories')
        .select('id, code')
        .eq('tournament_id', params.tournamentId)
        .is('deleted_at', null),
      params.client
        .from('tournament_qualification_rules')
        .select('category_id, best_third_placed_count, best_third_placed_method')
        .eq('tournament_id', params.tournamentId),
      params.client
        .from('tournament_teams')
        .select('id, category_id, team_code, name')
        .eq('tournament_id', params.tournamentId),
      params.client.from('tournament_group_members').select('group_id, team_id'),
      params.client
        .from('tournament_matches')
        .select(
          'id, category_id, home_source_type, home_source_ref, away_source_type, away_source_ref, home_team_id, away_team_id, sources_resolved_at'
        )
        .eq('tournament_id', params.tournamentId)
        .is('deleted_at', null),
    ]);

  const queryError = [
    categoriesResult.error,
    qualificationRulesResult.error,
    teamsResult.error,
    groupMembersResult.error,
    matchesResult.error,
  ].find(Boolean);
  if (queryError) throw new Error(queryError.message);

  const categories = (categoriesResult.data || []) as CategoryRow[];
  const category = categories.find((entry) => entry.code.trim().toUpperCase() === categoryCode);
  if (!category) {
    throw new Error(`Category ${categoryCode} not found`);
  }

  const qualificationRules = ((qualificationRulesResult.data || []) as QualificationRuleRow[])
    .filter((rule) => rule.category_id === category.id)
    .map((rule) => ({
      categoryId: rule.category_id,
      categoryCode: category.code,
      bestThirdPlacedCount: rule.best_third_placed_count,
      bestThirdPlacedMethod: rule.best_third_placed_method,
    }));
  const { configsByRef, configsByCategoryCode } = buildDrawSelectedConfigs(qualificationRules);
  const categoryConfigs = configsByCategoryCode.get(categoryCode) || [];

  if (categoryConfigs.length === 0) {
    throw new Error(`Match references draw reference ${categoryCode}-THIRD-DRAW-1 that has no configuration support`);
  }

  const teamsInCategory = ((teamsResult.data || []) as TeamRow[]).filter(
    (team) => team.category_id === category.id
  );
  const teamsInCategoryIds = new Set(teamsInCategory.map((team) => team.id));

  const candidateErrors = validateCandidateTeamIds({
    candidateTeamIds: params.candidateTeamIds,
    expectedCount: 3,
    teamsInCategory: teamsInCategoryIds,
  });
  if (candidateErrors.length > 0) {
    throw new Error(candidateErrors[0]);
  }
  const candidateTeamIds = params.candidateTeamIds.map((id) => id.trim());
  const eligibleTeamIds = new Set(candidateTeamIds);

  const assignmentErrors = validateDrawSelectedAssignments({
    categoryCode,
    configsByRef,
    configsByCategoryCode,
    assignments: params.assignments,
    eligibleTeamIds,
  });
  if (assignmentErrors.length > 0) {
    throw new Error(assignmentErrors[0]);
  }

  const groupIdByTeamId = new Map<string, string>();
  for (const member of (groupMembersResult.data || []) as GroupMemberRow[]) {
    if (member.team_id) groupIdByTeamId.set(member.team_id, member.group_id);
  }

  const currentActiveDrawsResult = await params.client
    .from('tournament_qualification_draws')
    .select('id, version')
    .eq('category_id', category.id)
    .eq('qualification_slot', GROUP_THIRD_PLACE_QUALIFICATION_SLOT)
    .is('superseded_at', null)
    .order('version', { ascending: false });

  if (currentActiveDrawsResult.error) {
    throw new Error(currentActiveDrawsResult.error.message);
  }

  const currentActiveDraws = (currentActiveDrawsResult.data || []) as ActiveDrawRow[];
  if (currentActiveDraws.length > 1) {
    throw new Error(`Multiple active qualification draws found for ${categoryCode}`);
  }

  const previousDraw = currentActiveDraws[0];
  if (previousDraw) {
    const { error: supersedeError } = await params.client
      .from('tournament_qualification_draws')
      .update({ superseded_at: now })
      .eq('id', previousDraw.id);
    if (supersedeError) {
      throw new Error(supersedeError.message);
    }
  }

  const noteText = [MANUAL_CANDIDATE_CONFIRMATION_MARKER, params.note || '']
    .filter(Boolean)
    .join(' ')
    .trim();

  const { data: drawData, error: drawInsertError } = await params.client
    .from('tournament_qualification_draws')
    .insert({
      category_id: category.id,
      qualification_slot: GROUP_THIRD_PLACE_QUALIFICATION_SLOT,
      slots_available: categoryConfigs.length,
      version: (previousDraw?.version || 0) + 1,
      drawn_by: params.actorUserId || null,
      drawn_at: now,
      note: noteText || null,
    })
    .select('id, category_id, qualification_slot')
    .single();

  if (drawInsertError || !drawData) {
    throw new Error(drawInsertError?.message || 'Failed to create qualification draw');
  }

  const draw = drawData as TournamentQualificationDrawRow;
  const drawOrderByTeamId = new Map(
    params.assignments.map((assignment) => {
      const sourceRef = assignment.sourceRef.trim().toUpperCase();
      const config = configsByRef.get(sourceRef);
      return [assignment.teamId.trim(), config?.drawPosition || 0] as const;
    })
  );

  // The full manually-confirmed candidate list is always stored (append-only,
  // versioned) even though only 2 of the 3 are selected — this preserves the
  // audit trail of who the eligible candidates were, not just who was picked.
  const candidateRows = candidateTeamIds.map((teamId) => ({
    draw_id: draw.id,
    team_id: teamId,
    group_id: groupIdByTeamId.get(teamId) || null,
    is_selected: drawOrderByTeamId.has(teamId),
    draw_order: drawOrderByTeamId.get(teamId) || null,
  }));

  const { error: candidateInsertError } = await params.client
    .from('tournament_qualification_draw_candidates')
    .insert(candidateRows);
  if (candidateInsertError) {
    throw new Error(candidateInsertError.message);
  }

  const { teamIdsBySourceRef, errors: selectionErrors } = buildDrawSelectedSelectionMaps({
    configsByRef,
    activeDraws: [draw],
    candidates: candidateRows as TournamentQualificationDrawCandidateRow[],
  });
  if (selectionErrors.length > 0) {
    throw new Error(selectionErrors[0]);
  }

  const drawSourceRefs = new Set(categoryConfigs.map((config) => config.sourceRef));
  const matches = ((matchesResult.data || []) as TournamentMatchRow[]).filter(
    (match) => match.category_id === category.id
  );
  const impactedMatches = matches.filter(
    (match) =>
      (match.home_source_type === 'draw_selected' &&
        drawSourceRefs.has(String(match.home_source_ref || '').trim().toUpperCase())) ||
      (match.away_source_type === 'draw_selected' &&
        drawSourceRefs.has(String(match.away_source_ref || '').trim().toUpperCase()))
  );

  const updates = buildDrawSelectedMatchUpdates({
    matches: impactedMatches,
    teamIdsBySourceRef,
    now,
  });

  const updatedMatchIds: string[] = [];
  for (const update of updates) {
    const { error: matchUpdateError } = await params.client
      .from('tournament_matches')
      .update({
        home_team_id: update.home_team_id,
        away_team_id: update.away_team_id,
        sources_resolved_at: update.sources_resolved_at,
        updated_by: params.actorUserId || null,
        updated_at: now,
      })
      .eq('id', update.id);
    if (matchUpdateError) {
      throw new Error(matchUpdateError.message);
    }
    updatedMatchIds.push(update.id);
  }

  return {
    drawId: draw.id,
    version: (previousDraw?.version || 0) + 1,
    updatedMatchIds,
    selectedSourceRefs: params.assignments.map((assignment) => assignment.sourceRef.trim().toUpperCase()),
  };
}

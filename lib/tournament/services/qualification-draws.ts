import {
  GROUP_THIRD_PLACE_QUALIFICATION_SLOT,
  buildDrawSelectedConfigs,
  validateDrawSelectedAssignments,
  type DrawSelectedAssignmentInput,
} from '@/lib/tournament/scheduling/drawSelected';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { G16_INCOMPLETE_MESSAGE, getG16ThirdPlaceCandidates } from '@/lib/tournament/services/standings';

// The physical draw for G-U16 (and any other 'draw' method) third-place
// qualification is conducted on paper at the venue; this service only
// records what an authorized tournament_super_admin manually confirms
// afterward — both the three eligible candidate teams and the two selected
// results. See TOURNAMENT_V2_SCHEDULING_AND_IMPORT.md §D-29 and the
// "Manual Qualification Placeholder Assignment" feature notes in PR #7.
//
// CANDIDATE SOURCE: the THREE ELIGIBLE candidates come from the Tournament
// V2 Standings Engine (lib/tournament/services/standings.ts,
// getG16ThirdPlaceCandidates), never from "all teams in category". If
// Standings are incomplete/unpublished, no candidates are offered and the
// caller must show G16_INCOMPLETE_MESSAGE — there is no silent fallback to
// all teams in category in normal production behavior.
//
// WRITE PATH: saveQualificationDrawSelections() performs exactly one
// client.rpc('save_qualification_draw_assignment', ...) call — migration 015
// (scripts/tournament-v2/015-qualification-draw-atomic-save.sql). All of
// supersede-previous-draw, insert-new-draw, insert-candidates, resolve
// affected Matches, and write the audit log run inside that single Postgres
// transaction; the RPC is the sole write boundary and the sole source of
// truth for validation. The TS-side pre-validation below (candidate/
// assignment checks, reusing the same helpers Preview uses, plus the
// Standings-match assertion) exists only for fast user feedback without a
// network round trip — it is never trusted for correctness, and the RPC
// re-validates everything from scratch.

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
  activeDrawId: string | null;
  candidateOptions: CandidateOption[];
  candidatesIncompleteReason: string | null;
  placeholderSourceRefs: string[];
  versions: DrawVersionSummary[];
}

interface SaveQualificationDrawSelectionsParams {
  client: TournamentClient;
  tournamentId: string;
  categoryCode: string;
  candidateTeamIds: string[];
  assignments: DrawSelectedAssignmentInput[];
  expectedActiveDrawId: string | null;
  note?: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
}

export interface SaveQualificationDrawSelectionsResult {
  drawId: string;
  version: number;
  updatedMatchIds: string[];
  selectedSourceRefs: string[];
  previousDrawId: string | null;
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

async function resolveActiveDrawId(params: {
  client: TournamentClient;
  categoryId: string;
}): Promise<string | null> {
  const { data, error } = await params.client
    .from('tournament_qualification_draws')
    .select('id')
    .eq('category_id', params.categoryId)
    .eq('qualification_slot', GROUP_THIRD_PLACE_QUALIFICATION_SLOT)
    .is('superseded_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.id as string | undefined) || null;
}

/**
 * Defense-in-depth: even though the UI dropdown is already sourced from the
 * Standings Engine (see getQualificationDrawState), the write path
 * (preview/save) independently re-verifies that the submitted candidates are
 * EXACTLY the Standings-computed eligible set — never a caller-supplied
 * substitute. Throws (never silently substitutes "all teams") if Standings
 * are incomplete or the submitted set doesn't match.
 */
async function assertCandidatesMatchStandings(params: {
  client: TournamentClient;
  tournamentId: string;
  categoryCode: string;
  candidateTeamIds: string[];
}): Promise<void> {
  const g16Candidates = await getG16ThirdPlaceCandidates({
    client: params.client,
    tournamentId: params.tournamentId,
    categoryCode: params.categoryCode,
  });
  if (!g16Candidates.isComplete) {
    throw new Error(g16Candidates.incompleteReason || MANUAL_CANDIDATE_CONFIRMATION_MARKER);
  }
  const standingsTeamIds = new Set(g16Candidates.candidates.map((c) => c.teamId));
  const submittedTeamIds = new Set(params.candidateTeamIds.map((id) => id.trim()));
  const matches =
    standingsTeamIds.size === submittedTeamIds.size &&
    [...standingsTeamIds].every((id) => submittedTeamIds.has(id));
  if (!matches) {
    throw new Error('candidate teams do not match the Standings Engine eligible third-place teams');
  }
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

  // Candidate source: the Standings Engine's exactly-three eligible
  // third-place teams — never "all teams in category". If a category has no
  // draw-method placeholders configured, there is nothing to source
  // candidates for at all.
  let candidateOptions: CandidateOption[] = [];
  let candidatesIncompleteReason: string | null = null;
  if (placeholderConfigs.length > 0) {
    const g16Candidates = await getG16ThirdPlaceCandidates({
      client: params.client,
      tournamentId: params.tournamentId,
      categoryCode,
    });
    if (g16Candidates.isComplete) {
      candidateOptions = g16Candidates.candidates.map((candidate) => ({
        teamId: candidate.teamId,
        teamCode: candidate.teamCode,
        teamName: candidate.teamName,
      }));
    } else {
      candidatesIncompleteReason = G16_INCOMPLETE_MESSAGE;
    }
  }

  const draws = ((drawsResult.data || []) as DrawRow[]).filter((draw) => draw.category_id === category.id);
  const drawIds = draws.map((draw) => draw.id);
  const activeDrawId = draws.find((draw) => draw.superseded_at === null)?.id || null;

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
    activeDrawId,
    candidateOptions,
    candidatesIncompleteReason,
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
  activeDrawId: string | null;
  affectedMatches: PreviewMatchSummary[];
}

/**
 * Read-only preview: validates candidates/selections exactly like Save, and
 * reports which matches would be resolved and to which teams — without
 * writing anything (no draw row, no candidate rows, no match updates). Also
 * returns the current active draw id so the UI can submit it back as
 * expected_active_draw_id on the real Save call.
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
  await assertCandidatesMatchStandings({
    client: params.client,
    tournamentId: params.tournamentId,
    categoryCode,
    candidateTeamIds: params.candidateTeamIds,
  });
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

  const activeDrawId = await resolveActiveDrawId({ client: params.client, categoryId: category.id });

  return { activeDrawId, affectedMatches };
}

interface SaveQualificationDrawAssignmentRpcResult {
  drawId: string;
  version: number;
  updatedMatchIds: string[];
  selectedSourceRefs: string[];
  previousDrawId: string | null;
}

/**
 * Write path — performs exactly one client.rpc(...) call
 * (tournament.save_qualification_draw_assignment, migration 015). Everything
 * from superseding the previous draw through writing the audit log runs in
 * that single Postgres transaction; if any step fails, the whole thing rolls
 * back. The pre-validation below is fast-feedback only — the RPC re-validates
 * candidates/assignments/category/tournament state from scratch and is the
 * only thing that actually writes.
 */
export async function saveQualificationDrawSelections(
  params: SaveQualificationDrawSelectionsParams
): Promise<SaveQualificationDrawSelectionsResult> {
  const categoryCode = params.categoryCode.trim().toUpperCase();

  const [categoriesResult, qualificationRulesResult, teamsResult] = await Promise.all([
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
  ]);

  const queryError = [categoriesResult.error, qualificationRulesResult.error, teamsResult.error].find(Boolean);
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
  await assertCandidatesMatchStandings({
    client: params.client,
    tournamentId: params.tournamentId,
    categoryCode,
    candidateTeamIds: params.candidateTeamIds,
  });
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

  const noteText = [MANUAL_CANDIDATE_CONFIRMATION_MARKER, params.note || '']
    .filter(Boolean)
    .join(' ')
    .trim();

  const { data, error } = await params.client.rpc('save_qualification_draw_assignment', {
    p_tournament_id: params.tournamentId,
    p_category_code: categoryCode,
    p_candidate_team_ids: candidateTeamIds,
    p_assignments: params.assignments.map((assignment) => ({
      source_ref: assignment.sourceRef.trim().toUpperCase(),
      team_id: assignment.teamId.trim(),
    })),
    p_expected_active_draw_id: params.expectedActiveDrawId,
    p_note: noteText || null,
    p_actor_id: params.actorUserId || null,
    p_actor_email: params.actorEmail || null,
  });

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error('save_qualification_draw_assignment returned no data');
  }

  const result = data as SaveQualificationDrawAssignmentRpcResult;

  return {
    drawId: result.drawId,
    version: result.version,
    updatedMatchIds: result.updatedMatchIds || [],
    selectedSourceRefs: result.selectedSourceRefs || [],
    previousDrawId: result.previousDrawId,
  };
}

import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { getGroupStandings } from '@/lib/tournament/services/standings';
import {
  resolveQualificationCutoff,
  validateQualificationDrawSelection,
  type ExistingQualificationDrawInput,
  type ResolveQualificationCutoffResult,
} from '@/lib/tournament/standings/resolveQualificationCutoff';
import {
  hashQualificationCutoffDrawValue,
  issueQualificationCutoffDrawPreviewToken,
  verifyQualificationCutoffDrawPreviewToken,
} from './qualificationCutoffDrawPreviewToken';

// Tournament V2 — Qualification Cutoff Tie Draw within Group (D-30). A
// SEPARATE feature from PR #7's G-U16 cross-group best-third-place draw
// (lib/tournament/services/qualification-draws.ts) — see Migration 019's
// header comment for why the underlying tables/RPC could not be reused.
// This service NEVER touches tournament_matches, draw_selected
// placeholders, goals, cards, reports, or Quick Result.

type TournamentClient = ReturnType<typeof getTournamentServiceClient>;

export class QualificationCutoffDrawError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

interface CategoryRow {
  id: string;
  code: string;
}

interface GroupRow {
  id: string;
  category_id: string;
  code: string;
}

interface QualificationRuleRow {
  category_id: string;
  qualify_rank_per_group: number;
}

interface TeamRow {
  id: string;
  name: string;
  team_code: string;
}

interface CutoffDrawRow {
  id: string;
  group_id: string;
  cutoff_position: number;
  available_slots: number;
  candidate_snapshot: string;
  version: number;
  drawn_by: string | null;
  drawn_at: string;
  note: string | null;
  superseded_at: string | null;
}

interface CutoffDrawCandidateRow {
  draw_id: string;
  team_id: string;
  points_at_draw: number;
  is_selected: boolean;
}

async function resolveTournamentGroup(params: {
  client: TournamentClient;
  tournamentId: string;
  categoryCode: string;
  groupCode: string;
}): Promise<{ category: CategoryRow; group: GroupRow; qualifyRankPerGroup: number }> {
  const categoryCode = params.categoryCode.trim().toUpperCase();
  const groupCode = params.groupCode.trim().toUpperCase();

  const [categoriesResult, groupsResult, rulesResult] = await Promise.all([
    params.client.from('tournament_categories').select('id, code').eq('tournament_id', params.tournamentId).is('deleted_at', null),
    params.client.from('tournament_groups').select('id, category_id, code').eq('tournament_id', params.tournamentId),
    params.client.from('tournament_qualification_rules').select('category_id, qualify_rank_per_group').eq('tournament_id', params.tournamentId),
  ]);
  const queryError = [categoriesResult.error, groupsResult.error, rulesResult.error].find(Boolean);
  if (queryError) throw new Error(queryError.message);

  const category = ((categoriesResult.data || []) as CategoryRow[]).find((c) => c.code.trim().toUpperCase() === categoryCode);
  if (!category) throw new QualificationCutoffDrawError('QUALIFICATION_CUTOFF_DRAW_CATEGORY_NOT_FOUND', `Category ${categoryCode} not found`);

  const group = ((groupsResult.data || []) as GroupRow[]).find((g) => g.category_id === category.id && g.code.trim().toUpperCase() === groupCode);
  if (!group) throw new QualificationCutoffDrawError('QUALIFICATION_CUTOFF_DRAW_GROUP_NOT_FOUND', `Group ${groupCode} not found in category ${categoryCode}`);

  const rule = ((rulesResult.data || []) as QualificationRuleRow[]).find((r) => r.category_id === category.id);
  const qualifyRankPerGroup = rule?.qualify_rank_per_group ?? 2;

  return { category, group, qualifyRankPerGroup };
}

async function loadActiveDraw(params: { client: TournamentClient; groupId: string }): Promise<{ draw: CutoffDrawRow | null; existingDraw: ExistingQualificationDrawInput | null }> {
  const { data, error } = await params.client
    .from('tournament_qualification_cutoff_draws')
    .select('id, group_id, cutoff_position, available_slots, candidate_snapshot, version, drawn_by, drawn_at, note, superseded_at')
    .eq('group_id', params.groupId)
    .is('superseded_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const draw = (data as CutoffDrawRow | null) || null;
  if (!draw) return { draw: null, existingDraw: null };

  const candidatesResult = await params.client
    .from('tournament_qualification_cutoff_draw_candidates')
    .select('draw_id, team_id, points_at_draw, is_selected')
    .eq('draw_id', draw.id);
  if (candidatesResult.error) throw new Error(candidatesResult.error.message);
  const selectedTeamIds = ((candidatesResult.data || []) as CutoffDrawCandidateRow[]).filter((c) => c.is_selected).map((c) => c.team_id);

  return { draw, existingDraw: { selectedTeamIds, candidateSnapshot: draw.candidate_snapshot } };
}

async function resolveCurrentCutoff(params: {
  client: TournamentClient;
  tournamentId: string;
  categoryCode: string;
  groupCode: string;
}): Promise<{ category: CategoryRow; group: GroupRow; resolution: ResolveQualificationCutoffResult; activeDraw: CutoffDrawRow | null }> {
  const { category, group, qualifyRankPerGroup } = await resolveTournamentGroup(params);
  const [groupStandings, { draw, existingDraw }] = await Promise.all([
    getGroupStandings({ client: params.client, tournamentId: params.tournamentId, categoryCode: params.categoryCode, groupCode: params.groupCode }),
    loadActiveDraw({ client: params.client, groupId: group.id }),
  ]);

  const resolution = resolveQualificationCutoff({
    teams: groupStandings.rows.map((r) => ({ teamId: r.teamId, points: r.points })),
    qualifyRankPerGroup,
    isGroupComplete: groupStandings.isComplete,
    existingDraw,
  });

  return { category, group, resolution, activeDraw: draw };
}

export interface QualificationCutoffDrawTeamOption {
  teamId: string;
  teamName: string;
  teamCode: string;
  pointsAtDraw?: number;
}

export interface QualificationCutoffDrawVersionSummary {
  drawId: string;
  version: number;
  isActive: boolean;
  drawnBy: string | null;
  drawnAt: string;
  note: string | null;
  availableSlots: number;
  candidates: Array<{ teamId: string; teamCode: string; teamName: string; pointsAtDraw: number; isSelected: boolean }>;
}

export interface QualificationCutoffDrawContext {
  tournamentId: string;
  categoryId: string;
  groupId: string;
  groupCode: string;
  activeDrawId: string | null;
  automaticQualifiers: QualificationCutoffDrawTeamOption[];
  automaticEliminated: QualificationCutoffDrawTeamOption[];
  drawCandidates: QualificationCutoffDrawTeamOption[];
  availableSlots: number;
  selectedByDraw: string[];
  eliminatedByDraw: string[];
  qualificationState: ResolveQualificationCutoffResult['qualificationState'];
  explanation: string;
  cutoffPosition: number;
  cutoffPoints: number | null;
  candidateSnapshot: string;
  versions: QualificationCutoffDrawVersionSummary[];
}

/** Read-only context for the admin form: current cutoff resolution and full
 * version history. No eligibility assertion — the form surfaces
 * 'incomplete'/'resolved' (no draw needed) as read-only notices. */
export async function loadQualificationCutoffDrawContext(params: {
  client: TournamentClient;
  tournamentId: string;
  categoryCode: string;
  groupCode: string;
}): Promise<QualificationCutoffDrawContext> {
  const { category, group, resolution, activeDraw } = await resolveCurrentCutoff(params);

  const allTeamIds = [...resolution.automaticQualifiers, ...resolution.automaticEliminated, ...resolution.drawCandidates];
  let teamsById = new Map<string, TeamRow>();
  if (allTeamIds.length > 0) {
    const { data, error } = await params.client.from('tournament_teams').select('id, name, team_code').in('id', allTeamIds);
    if (error) throw new Error(error.message);
    teamsById = new Map(((data || []) as TeamRow[]).map((t) => [t.id, t]));
  }
  const toOption = (teamId: string): QualificationCutoffDrawTeamOption => {
    const team = teamsById.get(teamId);
    return { teamId, teamName: team?.name || 'TBD', teamCode: team?.team_code || '' };
  };

  const drawIdsResult = await params.client
    .from('tournament_qualification_cutoff_draws')
    .select('id, group_id, cutoff_position, available_slots, candidate_snapshot, version, drawn_by, drawn_at, note, superseded_at')
    .eq('group_id', group.id)
    .order('version', { ascending: false });
  if (drawIdsResult.error) throw new Error(drawIdsResult.error.message);
  const drawRows = (drawIdsResult.data || []) as CutoffDrawRow[];
  const drawIds = drawRows.map((d) => d.id);

  let candidatesByDrawId = new Map<string, CutoffDrawCandidateRow[]>();
  if (drawIds.length > 0) {
    const { data, error } = await params.client
      .from('tournament_qualification_cutoff_draw_candidates')
      .select('draw_id, team_id, points_at_draw, is_selected')
      .in('draw_id', drawIds);
    if (error) throw new Error(error.message);
    candidatesByDrawId = new Map();
    for (const row of (data || []) as CutoffDrawCandidateRow[]) {
      const list = candidatesByDrawId.get(row.draw_id) || [];
      list.push(row);
      candidatesByDrawId.set(row.draw_id, list);
    }
  }

  const versions: QualificationCutoffDrawVersionSummary[] = drawRows.map((draw) => ({
    drawId: draw.id,
    version: draw.version,
    isActive: draw.superseded_at === null,
    drawnBy: draw.drawn_by,
    drawnAt: draw.drawn_at,
    note: draw.note,
    availableSlots: draw.available_slots,
    candidates: (candidatesByDrawId.get(draw.id) || []).map((c) => ({
      teamId: c.team_id,
      teamCode: teamsById.get(c.team_id)?.team_code || '',
      teamName: teamsById.get(c.team_id)?.name || '',
      pointsAtDraw: c.points_at_draw,
      isSelected: c.is_selected,
    })),
  }));

  return {
    tournamentId: params.tournamentId,
    categoryId: category.id,
    groupId: group.id,
    groupCode: group.code,
    activeDrawId: activeDraw?.id || null,
    automaticQualifiers: resolution.automaticQualifiers.map(toOption),
    automaticEliminated: resolution.automaticEliminated.map(toOption),
    drawCandidates: resolution.drawCandidates.map(toOption),
    availableSlots: resolution.availableSlots,
    selectedByDraw: resolution.selectedByDraw,
    eliminatedByDraw: resolution.eliminatedByDraw,
    qualificationState: resolution.qualificationState,
    explanation: resolution.explanation,
    cutoffPosition: resolution.cutoffPosition,
    cutoffPoints: resolution.cutoffPoints,
    candidateSnapshot: resolution.candidateSnapshot,
    versions,
  };
}

function canonicalSelectedTeamIdsHash(selectedTeamIds: string[]): string {
  return hashQualificationCutoffDrawValue([...selectedTeamIds].sort().join(','));
}

export interface PreviewQualificationCutoffDrawParams {
  client: TournamentClient;
  tournamentId: string;
  categoryCode: string;
  groupCode: string;
  selectedTeamIds: string[];
  actorUserId: string | null;
}

export interface QualificationCutoffDrawPreview {
  categoryId: string;
  groupId: string;
  groupCode: string;
  activeDrawId: string | null;
  drawCandidates: QualificationCutoffDrawTeamOption[];
  availableSlots: number;
  selectedTeamIds: string[];
  candidateSnapshot: string;
  previewToken: string;
  previewExpiresAt: string;
}

export async function previewQualificationCutoffDraw(params: PreviewQualificationCutoffDrawParams): Promise<QualificationCutoffDrawPreview> {
  const { category, group, resolution, activeDraw } = await resolveCurrentCutoff(params);

  if (resolution.qualificationState === 'incomplete') {
    throw new QualificationCutoffDrawError('QUALIFICATION_CUTOFF_DRAW_GROUP_INCOMPLETE', 'Group standings are not yet complete');
  }
  if (resolution.qualificationState === 'resolved') {
    throw new QualificationCutoffDrawError('QUALIFICATION_CUTOFF_DRAW_NOT_APPLICABLE', 'This group has no cutoff tie cluster requiring a draw');
  }

  const selectedTeamIds = params.selectedTeamIds.map((id) => id.trim()).filter(Boolean);
  const validation = validateQualificationDrawSelection({
    drawCandidates: resolution.drawCandidates,
    availableSlots: resolution.availableSlots,
    selectedTeamIds,
  });
  if (!validation.ok) {
    throw new QualificationCutoffDrawError(validation.code, validation.message);
  }

  const teamsResult = await params.client.from('tournament_teams').select('id, name, team_code').in('id', resolution.drawCandidates);
  if (teamsResult.error) throw new Error(teamsResult.error.message);
  const teamsById = new Map(((teamsResult.data || []) as TeamRow[]).map((t) => [t.id, t]));

  const issued = issueQualificationCutoffDrawPreviewToken({
    tournamentId: params.tournamentId,
    categoryId: category.id,
    groupId: group.id,
    actorUserId: params.actorUserId,
    expectedActiveDrawId: activeDraw?.id || null,
    candidateSnapshot: resolution.candidateSnapshot,
    selectedTeamIdsHash: canonicalSelectedTeamIdsHash(selectedTeamIds),
  });

  return {
    categoryId: category.id,
    groupId: group.id,
    groupCode: group.code,
    activeDrawId: activeDraw?.id || null,
    drawCandidates: resolution.drawCandidates.map((teamId) => {
      const team = teamsById.get(teamId);
      return { teamId, teamName: team?.name || 'TBD', teamCode: team?.team_code || '' };
    }),
    availableSlots: resolution.availableSlots,
    selectedTeamIds,
    candidateSnapshot: resolution.candidateSnapshot,
    previewToken: issued.token,
    previewExpiresAt: issued.expiresAt,
  };
}

export interface SaveQualificationCutoffDrawParams {
  client: TournamentClient;
  tournamentId: string;
  categoryCode: string;
  groupCode: string;
  selectedTeamIds: string[];
  previewToken: string;
  idempotencyKey: string;
  note?: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
}

export interface SaveQualificationCutoffDrawResult {
  drawId: string;
  version: number;
  availableSlots: number;
  selectedTeamIds: string[];
  idempotent: boolean;
}

function parseRpcErrorCode(message: string): { code: string; detail: string } {
  const separatorIndex = message.indexOf(':');
  if (separatorIndex > 0 && /^[A-Z0-9_]+$/.test(message.slice(0, separatorIndex).trim())) {
    return { code: message.slice(0, separatorIndex).trim(), detail: message.slice(separatorIndex + 1).trim() };
  }
  return { code: 'QUALIFICATION_CUTOFF_DRAW_FAILED', detail: message };
}

function isRpcUnavailableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202') return true;
  const message = (error.message || '').toLowerCase();
  return message.includes('could not find the function') || (message.includes('function') && message.includes('does not exist'));
}

/**
 * Publish path — performs exactly one client.rpc(...) call
 * (tournament.save_qualification_cutoff_draw, Migration 019). All writes
 * (supersede previous draw, insert new draw, insert candidates, audit log)
 * happen inside that single Postgres transaction. Fails closed with
 * QUALIFICATION_CUTOFF_DRAW_RPC_UNAVAILABLE if the RPC is missing — there is
 * no non-transactional fallback.
 */
export async function saveQualificationCutoffDraw(params: SaveQualificationCutoffDrawParams): Promise<SaveQualificationCutoffDrawResult> {
  if (!params.idempotencyKey || !params.idempotencyKey.trim()) {
    throw new QualificationCutoffDrawError('QUALIFICATION_CUTOFF_DRAW_IDEMPOTENCY_KEY_REQUIRED', 'idempotencyKey is required');
  }

  const { category, group, resolution, activeDraw } = await resolveCurrentCutoff(params);
  const selectedTeamIds = params.selectedTeamIds.map((id) => id.trim()).filter(Boolean);

  if (!params.previewToken || !params.previewToken.trim()) {
    throw new QualificationCutoffDrawError('QUALIFICATION_CUTOFF_DRAW_PREVIEW_REQUIRED', 'A valid Qualification Cutoff Draw preview is required before saving.');
  }
  const tokenVerification = verifyQualificationCutoffDrawPreviewToken(params.previewToken);
  if (!tokenVerification.ok) {
    throw new QualificationCutoffDrawError(
      tokenVerification.code,
      tokenVerification.code === 'QUALIFICATION_CUTOFF_DRAW_PREVIEW_EXPIRED'
        ? 'Qualification Cutoff Draw preview has expired — request a new preview before saving'
        : 'Qualification Cutoff Draw preview token is invalid or was tampered with'
    );
  }

  const claims = tokenVerification.claims;
  const claimsMatchRequest =
    claims.tournamentId === params.tournamentId &&
    claims.categoryId === category.id &&
    claims.groupId === group.id &&
    claims.actorUserId === params.actorUserId &&
    claims.expectedActiveDrawId === (activeDraw?.id || null) &&
    claims.candidateSnapshot === resolution.candidateSnapshot &&
    claims.selectedTeamIdsHash === canonicalSelectedTeamIdsHash(selectedTeamIds);

  if (!claimsMatchRequest) {
    throw new QualificationCutoffDrawError(
      'QUALIFICATION_CUTOFF_DRAW_PREVIEW_MISMATCH',
      'The submitted draw result no longer matches what was previewed (tournament, category, group, actor, active draw, candidate pool, or selection changed) — preview again'
    );
  }

  const { data: rpcData, error: rpcError } = await params.client.rpc('save_qualification_cutoff_draw', {
    p_tournament_id: params.tournamentId,
    p_category_code: params.categoryCode.trim().toUpperCase(),
    p_group_code: params.groupCode.trim().toUpperCase(),
    p_selected_team_ids: selectedTeamIds,
    p_expected_active_draw_id: activeDraw?.id || null,
    p_expected_candidate_snapshot: resolution.candidateSnapshot,
    p_idempotency_key: params.idempotencyKey,
    p_note: params.note || null,
    p_actor_id: params.actorUserId,
    p_actor_email: params.actorEmail,
  });

  if (rpcError) {
    if (isRpcUnavailableError(rpcError)) {
      throw new QualificationCutoffDrawError(
        'QUALIFICATION_CUTOFF_DRAW_RPC_UNAVAILABLE',
        'The Qualification Cutoff Draw save transaction (Migration 019) is not available in this environment.'
      );
    }
    const { code, detail } = parseRpcErrorCode(rpcError.message);
    throw new QualificationCutoffDrawError(code, detail);
  }

  const result = rpcData as { drawId: string; version: number; availableSlots: number; selectedTeamIds: string[]; idempotent: boolean };

  return {
    drawId: result.drawId,
    version: result.version,
    availableSlots: result.availableSlots,
    selectedTeamIds: result.selectedTeamIds || [],
    idempotent: result.idempotent,
  };
}

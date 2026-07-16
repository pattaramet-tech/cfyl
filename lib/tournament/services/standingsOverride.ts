import { getTournamentServiceClient } from '../db/supabase-tournament';
import { logTournamentAdminAction } from './audit';
import {
  hashStandingsOverrideBeforeState,
  hashStandingsOverrideText,
  issueStandingsOverridePreviewToken,
  verifyStandingsOverridePreviewToken,
  type StandingsOverrideBeforeState,
} from './standingsOverridePreviewToken';

// Manual Standings Override — Tournament Super Admin only. Mirrors PR #9's
// Quick Result Preview/Submit safety pattern: Save requires a server-signed
// Preview Token (never trusts client-side "I previewed this" state), and
// every scope check (tournament/group/team/rank) is re-validated fresh on
// the server at both Preview and Save time.
//
// Data model: tournament_standing_overrides holds exactly one active row
// per (group_id, team_id) — this module does not invent an append-only
// override table. Change history is provided by tournament_audit_logs, not
// by versioning this table itself (see TOURNAMENT_V2_DATA_MODEL.md).
//
// Not transactional: the override write and the audit-log write are two
// independent Supabase requests (same limitation as PR #9's Quick Result —
// no approved RPC/transaction mechanism exists for Tournament V2). See
// saveStandingsOverride's compensating-rollback comment below for exactly
// what happens when the audit write fails.

type TournamentClient = ReturnType<typeof getTournamentServiceClient>;

export class StandingsOverrideError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

interface TournamentRow {
  id: string;
  status: string;
  deleted_at: string | null;
}

interface GroupRow {
  id: string;
  tournament_id: string;
  category_id: string;
  code: string;
}

interface TeamRow {
  id: string;
  tournament_id: string;
  category_id: string;
  deleted_at: string | null;
}

interface GroupMemberRow {
  group_id: string;
  team_id: string | null;
}

interface OverrideRow {
  group_id: string;
  team_id: string;
  override_rank: number;
  reason: string;
}

interface ScopeValidationParams {
  client: TournamentClient;
  tournamentId: string;
  groupId: string;
  teamId: string;
  overrideRank: number;
}

interface ScopeContext {
  existingOverride: StandingsOverrideBeforeState | null;
}

/**
 * Freshly re-validates every scope constraint (must be called at BOTH
 * Preview and Save time — never reused from a cached/prior result):
 *  1. Tournament exists and is not deleted/archived
 *  2. Group belongs to the specified Tournament
 *  3. Team belongs to the same Tournament
 *  4. Team belongs to the selected Group via tournament_group_members
 *  5. override_rank is within [1, resolved team count in the Group]
 *  6. Team is not soft-deleted
 *  7. Group's category matches the team's category (catches a Group
 *     mistakenly targeted from another Category/Tournament)
 *  8. override_rank does not collide with another team's active override
 *     in the same Group (STANDINGS_OVERRIDE_RANK_CONFLICT)
 */
async function validateStandingsOverrideScope(params: ScopeValidationParams): Promise<ScopeContext> {
  const [tournamentResult, groupResult, teamResult] = await Promise.all([
    params.client.from('tournaments').select('id, status, deleted_at').eq('id', params.tournamentId).maybeSingle(),
    params.client.from('tournament_groups').select('id, tournament_id, category_id, code').eq('id', params.groupId).maybeSingle(),
    params.client.from('tournament_teams').select('id, tournament_id, category_id, deleted_at').eq('id', params.teamId).maybeSingle(),
  ]);
  if (tournamentResult.error) throw new Error(tournamentResult.error.message);
  if (groupResult.error) throw new Error(groupResult.error.message);
  if (teamResult.error) throw new Error(teamResult.error.message);

  const tournament = tournamentResult.data as TournamentRow | null;
  if (!tournament || tournament.deleted_at) {
    throw new StandingsOverrideError('STANDINGS_OVERRIDE_TOURNAMENT_NOT_FOUND', 'Tournament not found', 404);
  }
  // 'archived' is the only status treated as frozen/no-longer-editable for
  // standings overrides — 'upcoming'/'active'/'completed' all remain valid
  // (a completed tournament may still need a late correction).
  if (tournament.status === 'archived') {
    throw new StandingsOverrideError(
      'STANDINGS_OVERRIDE_TOURNAMENT_NOT_ACTIVE',
      'Tournament is archived and no longer accepts standings overrides',
      409
    );
  }

  const group = groupResult.data as GroupRow | null;
  if (!group) {
    throw new StandingsOverrideError('STANDINGS_OVERRIDE_GROUP_NOT_FOUND', 'Group not found', 404);
  }
  if (group.tournament_id !== params.tournamentId) {
    throw new StandingsOverrideError(
      'STANDINGS_OVERRIDE_GROUP_TOURNAMENT_MISMATCH',
      'Group does not belong to the specified tournament',
      400
    );
  }

  const team = teamResult.data as TeamRow | null;
  if (!team) {
    throw new StandingsOverrideError('STANDINGS_OVERRIDE_TEAM_NOT_FOUND', 'Team not found', 404);
  }
  if (team.deleted_at) {
    throw new StandingsOverrideError('STANDINGS_OVERRIDE_TEAM_DELETED', 'Team has been deleted', 400);
  }
  if (team.tournament_id !== params.tournamentId) {
    throw new StandingsOverrideError(
      'STANDINGS_OVERRIDE_TEAM_TOURNAMENT_MISMATCH',
      'Team does not belong to the specified tournament',
      400
    );
  }
  if (team.category_id !== group.category_id) {
    throw new StandingsOverrideError(
      'STANDINGS_OVERRIDE_TEAM_CATEGORY_MISMATCH',
      'Team belongs to a different category than the group (group is from another category/tournament)',
      400
    );
  }

  const [groupMembersResult, existingOverrideResult, groupOverridesResult] = await Promise.all([
    params.client.from('tournament_group_members').select('group_id, team_id').eq('group_id', params.groupId),
    params.client
      .from('tournament_standing_overrides')
      .select('group_id, team_id, override_rank, reason')
      .eq('group_id', params.groupId)
      .eq('team_id', params.teamId)
      .maybeSingle(),
    params.client.from('tournament_standing_overrides').select('group_id, team_id, override_rank, reason').eq('group_id', params.groupId),
  ]);
  if (groupMembersResult.error) throw new Error(groupMembersResult.error.message);
  if (existingOverrideResult.error) throw new Error(existingOverrideResult.error.message);
  if (groupOverridesResult.error) throw new Error(groupOverridesResult.error.message);

  const groupMembers = (groupMembersResult.data || []) as GroupMemberRow[];
  const teamIsInGroup = groupMembers.some((member) => member.team_id === params.teamId);
  if (!teamIsInGroup) {
    throw new StandingsOverrideError('STANDINGS_OVERRIDE_TEAM_NOT_IN_GROUP', 'Team is not a member of this group', 400);
  }

  const resolvedTeamCount = groupMembers.filter((member) => !!member.team_id).length;
  if (!Number.isInteger(params.overrideRank) || params.overrideRank < 1 || params.overrideRank > resolvedTeamCount) {
    throw new StandingsOverrideError(
      'STANDINGS_OVERRIDE_RANK_OUT_OF_RANGE',
      `override_rank must be an integer between 1 and ${resolvedTeamCount} (the number of resolved teams in this group)`,
      400
    );
  }

  const existingOverrideRow = (existingOverrideResult.data as OverrideRow | null) || null;
  const otherActiveOverrides = ((groupOverridesResult.data || []) as OverrideRow[]).filter(
    (row) => row.team_id !== params.teamId
  );
  const rankConflict = otherActiveOverrides.find((row) => row.override_rank === params.overrideRank);
  if (rankConflict) {
    throw new StandingsOverrideError(
      'STANDINGS_OVERRIDE_RANK_CONFLICT',
      `override_rank ${params.overrideRank} is already used by another team's active override in this group`,
      409
    );
  }

  return {
    existingOverride: existingOverrideRow
      ? { overrideRank: existingOverrideRow.override_rank, reason: existingOverrideRow.reason }
      : null,
  };
}

export interface PreviewStandingsOverrideParams {
  client: TournamentClient;
  tournamentId: string;
  groupId: string;
  teamId: string;
  overrideRank: number;
  reason: string;
  actorUserId: string | null;
}

export interface PreviewStandingsOverrideResult {
  previewToken: string;
  previewExpiresAt: string;
  before: StandingsOverrideBeforeState | null;
  after: { tournamentId: string; groupId: string; teamId: string; overrideRank: number; reason: string };
}

function assertReasonAndRank(reason: string, overrideRank: number): string {
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    throw new StandingsOverrideError('STANDINGS_OVERRIDE_REASON_REQUIRED', 'reason is required for a manual standings override', 400);
  }
  if (!Number.isInteger(overrideRank) || overrideRank < 1) {
    throw new StandingsOverrideError('STANDINGS_OVERRIDE_RANK_INVALID', 'override_rank must be a positive integer', 400);
  }
  return trimmedReason;
}

/**
 * Read-only: validates full scope and returns a signed previewToken that
 * Save requires. Writes nothing to the database — same pattern as PR #9's
 * previewQuickResult.
 */
export async function previewStandingsOverride(
  params: PreviewStandingsOverrideParams
): Promise<PreviewStandingsOverrideResult> {
  const reason = assertReasonAndRank(params.reason, params.overrideRank);

  const scope = await validateStandingsOverrideScope({
    client: params.client,
    tournamentId: params.tournamentId,
    groupId: params.groupId,
    teamId: params.teamId,
    overrideRank: params.overrideRank,
  });

  const issued = issueStandingsOverridePreviewToken({
    tournamentId: params.tournamentId,
    groupId: params.groupId,
    teamId: params.teamId,
    overrideRank: params.overrideRank,
    reasonHash: hashStandingsOverrideText(reason),
    actorUserId: params.actorUserId,
    beforeStateHash: hashStandingsOverrideBeforeState(scope.existingOverride),
  });

  return {
    previewToken: issued.token,
    previewExpiresAt: issued.expiresAt,
    before: scope.existingOverride,
    after: { tournamentId: params.tournamentId, groupId: params.groupId, teamId: params.teamId, overrideRank: params.overrideRank, reason },
  };
}

export interface SaveStandingsOverrideParams {
  client: TournamentClient;
  tournamentId: string;
  groupId: string;
  teamId: string;
  overrideRank: number;
  reason: string;
  actorUserId: string | null;
  actorEmail: string | null;
  previewToken: string;
}

export interface SaveStandingsOverrideResult {
  groupId: string;
  teamId: string;
  overrideRank: number;
  reason: string;
  auditLogged: true;
}

async function rollbackOverrideWrite(params: {
  client: TournamentClient;
  groupId: string;
  teamId: string;
  before: StandingsOverrideBeforeState | null;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    if (params.before) {
      const { error } = await params.client
        .from('tournament_standing_overrides')
        .update({ override_rank: params.before.overrideRank, reason: params.before.reason })
        .eq('group_id', params.groupId)
        .eq('team_id', params.teamId);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    }
    const { error } = await params.client
      .from('tournament_standing_overrides')
      .delete()
      .eq('group_id', params.groupId)
      .eq('team_id', params.teamId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function saveStandingsOverride(params: SaveStandingsOverrideParams): Promise<SaveStandingsOverrideResult> {
  const reason = assertReasonAndRank(params.reason, params.overrideRank);

  if (!params.previewToken || !params.previewToken.trim()) {
    throw new StandingsOverrideError(
      'STANDINGS_OVERRIDE_PREVIEW_REQUIRED',
      'A valid standings override preview is required before saving.',
      400
    );
  }

  const tokenVerification = verifyStandingsOverridePreviewToken(params.previewToken);
  if (!tokenVerification.ok) {
    throw new StandingsOverrideError(
      tokenVerification.code,
      tokenVerification.code === 'STANDINGS_OVERRIDE_PREVIEW_EXPIRED'
        ? 'Standings override preview has expired — request a new preview before saving'
        : 'Standings override preview token is invalid or was tampered with',
      400
    );
  }

  const claims = tokenVerification.claims;
  const claimsMatchRequest =
    claims.tournamentId === params.tournamentId &&
    claims.groupId === params.groupId &&
    claims.teamId === params.teamId &&
    claims.overrideRank === params.overrideRank &&
    claims.reasonHash === hashStandingsOverrideText(reason) &&
    claims.actorUserId === params.actorUserId;

  if (!claimsMatchRequest) {
    throw new StandingsOverrideError(
      'STANDINGS_OVERRIDE_PREVIEW_MISMATCH',
      'The submitted request no longer matches the previewed tournament, group, team, rank, reason, or actor — preview again',
      400
    );
  }

  // Never trust the Preview-time scope snapshot for the actual write —
  // re-validate everything fresh, including duplicate-rank, at Save time.
  const scope = await validateStandingsOverrideScope({
    client: params.client,
    tournamentId: params.tournamentId,
    groupId: params.groupId,
    teamId: params.teamId,
    overrideRank: params.overrideRank,
  });

  const currentBeforeHash = hashStandingsOverrideBeforeState(scope.existingOverride);
  if (currentBeforeHash !== claims.beforeStateHash) {
    throw new StandingsOverrideError(
      'STANDINGS_OVERRIDE_STATE_CHANGED',
      'The existing override for this team has changed since Preview — preview again',
      409
    );
  }

  const { error: upsertError } = await params.client
    .from('tournament_standing_overrides')
    .upsert(
      { group_id: params.groupId, team_id: params.teamId, override_rank: params.overrideRank, reason, created_by: params.actorUserId || null },
      { onConflict: 'group_id,team_id' }
    );
  if (upsertError) throw new Error(upsertError.message);

  const auditResult = await logTournamentAdminAction({
    tournamentId: params.tournamentId,
    admin: { id: params.actorUserId, email: params.actorEmail },
    action: 'standings.manual_override',
    entityType: 'standing-override',
    entityId: `${params.groupId}:${params.teamId}`,
    entityLabel: `group=${params.groupId} team=${params.teamId}`,
    oldData: scope.existingOverride,
    newData: { group_id: params.groupId, team_id: params.teamId, override_rank: params.overrideRank, reason },
  });

  if (!auditResult.ok) {
    // The override mutation and the Audit Log write are separate,
    // non-transactional requests. A required Audit Log is part of what
    // "success" means for a manual override, so a failed audit write
    // triggers a best-effort compensating rollback of the override row back
    // to its exact pre-Save state (restoring the prior row, or deleting a
    // newly-inserted one) rather than silently reporting success with a
    // missing audit trail. If the rollback itself also fails, that is
    // reported as a distinct, more severe error — never swallowed — because
    // at that point the override row may be inconsistent with the audit
    // trail and needs manual verification. True atomicity for this
    // multi-write sequence would require a Postgres RPC, which does not
    // exist for Tournament V2 (no approved RPC/transaction mechanism, same
    // as PR #9's Quick Result).
    const rollback = await rollbackOverrideWrite({
      client: params.client,
      groupId: params.groupId,
      teamId: params.teamId,
      before: scope.existingOverride,
    });
    if (rollback.ok) {
      throw new StandingsOverrideError(
        'STANDINGS_OVERRIDE_AUDIT_FAILED_ROLLED_BACK',
        `Audit log write failed (${auditResult.error || 'unknown error'}) — the override was rolled back to its previous state. No change was applied. Please retry.`,
        500
      );
    }
    throw new StandingsOverrideError(
      'STANDINGS_OVERRIDE_AUDIT_FAILED_ROLLBACK_FAILED',
      `Audit log write failed (${auditResult.error || 'unknown error'}) AND the compensating rollback also failed (${rollback.error || 'unknown error'}). The override row may now be inconsistent with the audit trail and requires manual verification.`,
      500
    );
  }

  return { groupId: params.groupId, teamId: params.teamId, overrideRank: params.overrideRank, reason, auditLogged: true };
}

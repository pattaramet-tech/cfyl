import { getTournamentServiceClient } from '../db/supabase-tournament';
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
// ATOMIC (migration 017): the entire write path — the authoritative
// scope/rank/duplicate revalidation, the expected-before-state check, the
// tournament_standing_overrides upsert, and the tournament_audit_logs insert
// — executes inside tournament.save_standings_override() as one Postgres
// transaction, locking the target Group row first (the same class of fix
// PR #6's migration 013b, PR #7's migration 015, and PR #9's migration 016
// applied for their own equivalent gaps). saveStandingsOverride() below makes
// exactly one client.rpc(...) call for the write; there is no
// compensating-rollback logic anymore because there is nothing left to
// compensate for.

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
 * Freshly re-validates every scope constraint — used at Preview time (and
 * only at Preview time; Save's authoritative revalidation happens inside the
 * RPC, under the Group lock, see migration 017):
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
 *
 * This is fast-feedback only — none of it is trusted for correctness at
 * Save time, since a Preview and a Save can be arbitrarily far apart in
 * time and another admin's concurrent Save can invalidate any of it.
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

/**
 * Minimal, NON-authoritative read used only at Save time to derive the
 * primitive expected-before-state values the RPC will re-check under its
 * Group lock. Deliberately not the full validateStandingsOverrideScope() —
 * all authoritative scope/rank/duplicate validation now happens inside
 * tournament.save_standings_override() itself (migration 017), where it is
 * actually race-free. This read can only ever be stale in the direction of
 * "the row already changed since this read" — which the RPC's own
 * expected-state comparison, under the lock, catches and rejects with
 * STANDINGS_OVERRIDE_STATE_CHANGED regardless.
 */
async function readExistingOverride(params: {
  client: TournamentClient;
  groupId: string;
  teamId: string;
}): Promise<StandingsOverrideBeforeState | null> {
  const { data, error } = await params.client
    .from('tournament_standing_overrides')
    .select('override_rank, reason')
    .eq('group_id', params.groupId)
    .eq('team_id', params.teamId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { override_rank: number; reason: string } | null;
  return row ? { overrideRank: row.override_rank, reason: row.reason } : null;
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

/** Parses the "CODE: message" format tournament.save_standings_override()
 * raises exceptions in (see migration 017) into a StandingsOverrideError
 * with the correct established HTTP status — same technique PR #9's
 * toQuickResultError uses for tournament.submit_quick_result(). */
const STANDINGS_OVERRIDE_ERROR_STATUS: Record<string, number> = {
  STANDINGS_OVERRIDE_TOURNAMENT_NOT_FOUND: 404,
  STANDINGS_OVERRIDE_TOURNAMENT_NOT_ACTIVE: 409,
  STANDINGS_OVERRIDE_GROUP_NOT_FOUND: 404,
  STANDINGS_OVERRIDE_GROUP_TOURNAMENT_MISMATCH: 400,
  STANDINGS_OVERRIDE_TEAM_NOT_FOUND: 404,
  STANDINGS_OVERRIDE_TEAM_DELETED: 400,
  STANDINGS_OVERRIDE_TEAM_TOURNAMENT_MISMATCH: 400,
  STANDINGS_OVERRIDE_TEAM_CATEGORY_MISMATCH: 400,
  STANDINGS_OVERRIDE_TEAM_NOT_IN_GROUP: 400,
  STANDINGS_OVERRIDE_RANK_INVALID: 400,
  STANDINGS_OVERRIDE_RANK_OUT_OF_RANGE: 400,
  STANDINGS_OVERRIDE_RANK_CONFLICT: 409,
  STANDINGS_OVERRIDE_REASON_REQUIRED: 400,
  STANDINGS_OVERRIDE_STATE_CHANGED: 409,
};

function toStandingsOverrideError(message: string): StandingsOverrideError | null {
  const match = message.match(/^([A-Z][A-Z_]*):\s*([\s\S]*)$/);
  if (!match) return null;
  const code = match[1];
  return new StandingsOverrideError(code, match[2] || message, STANDINGS_OVERRIDE_ERROR_STATUS[code] || 500);
}

/**
 * The entire write path — the authoritative scope/rank/duplicate
 * revalidation, the expected-before-state check, the override upsert, and
 * the audit log insert — executes inside
 * tournament.save_standings_override() (migration 017) as one Postgres
 * transaction, with the target Group locked first. This function makes
 * exactly one client.rpc(...) call for the write; there is no
 * compensating-rollback logic here anymore because there is nothing left to
 * compensate for — a failure anywhere inside the RPC rolls back the whole
 * thing atomically.
 */
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

  // Fast, NON-authoritative pre-check (see readExistingOverride doc comment
  // above) — a stale read here can only make the RPC's own expected-state
  // comparison, under its Group lock, reject with STATE_CHANGED; it can
  // never let a stale write through, since the RPC re-derives the exact same
  // comparison from primitives, authoritatively, before ever writing.
  const existingOverride = await readExistingOverride({ client: params.client, groupId: params.groupId, teamId: params.teamId });
  const currentBeforeHash = hashStandingsOverrideBeforeState(existingOverride);
  if (currentBeforeHash !== claims.beforeStateHash) {
    throw new StandingsOverrideError(
      'STANDINGS_OVERRIDE_STATE_CHANGED',
      'The existing override for this team has changed since Preview — preview again',
      409
    );
  }

  const { data, error } = await params.client.rpc('save_standings_override', {
    p_tournament_id: params.tournamentId,
    p_group_id: params.groupId,
    p_team_id: params.teamId,
    p_override_rank: params.overrideRank,
    p_reason: reason,
    p_actor_id: params.actorUserId,
    p_actor_email: params.actorEmail,
    p_expected_row_exists: existingOverride !== null,
    p_expected_override_rank: existingOverride?.overrideRank ?? null,
    p_expected_reason: existingOverride?.reason ?? null,
  });

  if (error) {
    const parsed = toStandingsOverrideError(error.message);
    throw parsed || new Error(error.message);
  }
  if (!data) {
    throw new Error('save_standings_override returned no data');
  }

  const result = data as { groupId: string; teamId: string; overrideRank: number; reason: string; auditLogged: true };

  return {
    groupId: result.groupId,
    teamId: result.teamId,
    overrideRank: result.overrideRank,
    reason: result.reason,
    auditLogged: result.auditLogged,
  };
}

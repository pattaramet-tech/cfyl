/**
 * Faithful JS re-implementation of tournament.save_standings_override()
 * (scripts/tournament-v2/017-standings-override-atomic-save.sql), mirroring
 * its exact contract: lock the Group first, re-validate every authoritative
 * input under that lock, compare the exact primitive expected-before state,
 * then atomically upsert the override row and insert the audit log — both
 * writes together, or neither.
 *
 * IMPORTANT: models real Postgres transaction semantics — every write is
 * staged on a deep-cloned copy of the affected tables first; the real `db`
 * argument is only mutated once, at the very end, after every step has
 * succeeded. If validation fails, the expected-state check finds a mismatch,
 * or an `injection.failAt` failure point is hit, the function returns an
 * `error` and `db` is left completely untouched — exactly like an unhandled
 * exception rolling back the whole Postgres transaction. `injection` is a
 * test-only hook (this file only — never wired into route.ts or any
 * production code path), the same pattern
 * mockSubmitQuickResultRpc.ts/mockSaveQualificationDrawAssignmentRpc.ts use.
 */
type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

export interface SaveStandingsOverrideRpcArgs {
  p_tournament_id: string;
  p_group_id: string;
  p_team_id: string;
  p_override_rank: number;
  p_reason: string;
  p_actor_id: string | null;
  p_actor_email: string | null;
  p_expected_row_exists: boolean;
  p_expected_override_rank: number | null;
  p_expected_reason: string | null;
}

export interface SaveStandingsOverrideRpcResult {
  groupId: string;
  teamId: string;
  overrideRank: number;
  reason: string;
  auditLogged: true;
}

export interface RpcOutcome {
  data: SaveStandingsOverrideRpcResult | null;
  error: { message: string } | null;
}

export interface RpcFailureInjection {
  /** Simulates a failure at this step — nothing before it is ever committed to `db`. */
  failAt?: 'override' | 'audit';
}

let mockIdCounter = 0;
function mockId(prefix: string): string {
  mockIdCounter += 1;
  return `${prefix}-${mockIdCounter}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function mockSaveStandingsOverrideRpc(
  db: Db,
  args: SaveStandingsOverrideRpcArgs,
  injection: RpcFailureInjection = {}
): RpcOutcome {
  const now = new Date().toISOString();
  const reason = (args.p_reason || '').trim();

  // ---- 0. Cheap input-shape validation ----
  if (!reason) {
    return { data: null, error: { message: 'STANDINGS_OVERRIDE_REASON_REQUIRED: reason is required for a manual standings override' } };
  }
  if (args.p_override_rank == null || !Number.isInteger(args.p_override_rank) || args.p_override_rank < 1) {
    return { data: null, error: { message: 'STANDINGS_OVERRIDE_RANK_INVALID: override_rank must be a positive integer' } };
  }

  // ---- 1. "Lock" (find) the Group first ----
  const group = (db.tournament_groups || []).find((g) => g.id === args.p_group_id);
  if (!group) {
    return { data: null, error: { message: `STANDINGS_OVERRIDE_GROUP_NOT_FOUND: group ${args.p_group_id} not found` } };
  }
  if (group.tournament_id !== args.p_tournament_id) {
    return {
      data: null,
      error: { message: `STANDINGS_OVERRIDE_GROUP_TOURNAMENT_MISMATCH: group ${args.p_group_id} does not belong to tournament ${args.p_tournament_id}` },
    };
  }

  // ---- 2. Re-validate every authoritative input under the lock ----
  const tournament = (db.tournaments || []).find((t) => t.id === args.p_tournament_id);
  if (!tournament || tournament.deleted_at) {
    return { data: null, error: { message: `STANDINGS_OVERRIDE_TOURNAMENT_NOT_FOUND: tournament ${args.p_tournament_id} not found` } };
  }
  if (tournament.status === 'archived') {
    return {
      data: null,
      error: { message: `STANDINGS_OVERRIDE_TOURNAMENT_NOT_ACTIVE: tournament ${args.p_tournament_id} is archived and no longer accepts standings overrides` },
    };
  }

  const team = (db.tournament_teams || []).find((t) => t.id === args.p_team_id);
  if (!team) {
    return { data: null, error: { message: `STANDINGS_OVERRIDE_TEAM_NOT_FOUND: team ${args.p_team_id} not found` } };
  }
  if (team.deleted_at) {
    return { data: null, error: { message: `STANDINGS_OVERRIDE_TEAM_DELETED: team ${args.p_team_id} has been deleted` } };
  }
  if (team.tournament_id !== args.p_tournament_id) {
    return {
      data: null,
      error: { message: `STANDINGS_OVERRIDE_TEAM_TOURNAMENT_MISMATCH: team ${args.p_team_id} does not belong to tournament ${args.p_tournament_id}` },
    };
  }
  if (team.category_id !== group.category_id) {
    return {
      data: null,
      error: { message: `STANDINGS_OVERRIDE_TEAM_CATEGORY_MISMATCH: team ${args.p_team_id} belongs to a different category than group ${args.p_group_id}` },
    };
  }

  const groupMembers = (db.tournament_group_members || []).filter((m) => m.group_id === args.p_group_id);
  const teamInGroup = groupMembers.some((m) => m.team_id === args.p_team_id);
  if (!teamInGroup) {
    return { data: null, error: { message: `STANDINGS_OVERRIDE_TEAM_NOT_IN_GROUP: team ${args.p_team_id} is not a member of group ${args.p_group_id}` } };
  }

  const resolvedTeamCount = groupMembers.filter((m) => !!m.team_id).length;
  if (args.p_override_rank > resolvedTeamCount) {
    return {
      data: null,
      error: { message: `STANDINGS_OVERRIDE_RANK_OUT_OF_RANGE: override_rank must be between 1 and ${resolvedTeamCount} (the number of resolved teams in this group)` },
    };
  }

  const rankConflict = (db.tournament_standing_overrides || []).some(
    (o) => o.group_id === args.p_group_id && o.team_id !== args.p_team_id && o.override_rank === args.p_override_rank
  );
  if (rankConflict) {
    return {
      data: null,
      error: { message: `STANDINGS_OVERRIDE_RANK_CONFLICT: override_rank ${args.p_override_rank} is already used by another team's active override in group ${args.p_group_id}` },
    };
  }

  // ---- 3. Expected-before-state check — under the "lock" ----
  const existing = (db.tournament_standing_overrides || []).find(
    (o) => o.group_id === args.p_group_id && o.team_id === args.p_team_id
  );
  const stateChanged = args.p_expected_row_exists
    ? !existing || existing.override_rank !== args.p_expected_override_rank || existing.reason !== args.p_expected_reason
    : !!existing;
  if (stateChanged) {
    return {
      data: null,
      error: { message: 'STANDINGS_OVERRIDE_STATE_CHANGED: the existing override for this team has changed since Preview — preview again' },
    };
  }

  // ---- Staging phase: nothing below this line touches `db` directly. ----
  const stagedOverrides = clone(db.tournament_standing_overrides || []);
  const stagedAuditLogs = clone(db.tournament_audit_logs || []);

  const oldData = existing
    ? { group_id: args.p_group_id, team_id: args.p_team_id, override_rank: existing.override_rank, reason: existing.reason }
    : null;
  const newData = { group_id: args.p_group_id, team_id: args.p_team_id, override_rank: args.p_override_rank, reason };
  const entityLabel = `group=${args.p_group_id} team=${args.p_team_id}`;

  if (injection.failAt === 'override') {
    return { data: null, error: { message: 'SIMULATED_FAILURE: override upsert' } };
  }

  const existingIndex = stagedOverrides.findIndex((o) => o.group_id === args.p_group_id && o.team_id === args.p_team_id);
  const overrideRow: Row = {
    id: existing?.id ?? mockId('mock-override'),
    group_id: args.p_group_id,
    team_id: args.p_team_id,
    override_rank: args.p_override_rank,
    reason,
    created_by: args.p_actor_id,
    created_at: existing?.created_at ?? now,
  };
  if (existingIndex >= 0) {
    stagedOverrides[existingIndex] = overrideRow;
  } else {
    stagedOverrides.push(overrideRow);
  }

  if (injection.failAt === 'audit') {
    return { data: null, error: { message: 'SIMULATED_FAILURE: audit insert' } };
  }

  stagedAuditLogs.push({
    id: mockId('mock-audit'),
    tournament_id: args.p_tournament_id,
    admin_id: args.p_actor_id,
    admin_email: args.p_actor_email,
    action: 'standings.manual_override',
    entity_type: 'standing-override',
    entity_id: args.p_team_id,
    entity_label: entityLabel,
    old_data: oldData,
    new_data: newData,
    created_at: now,
  });

  // ---- Commit phase: every step above succeeded — write staged state back. ----
  db.tournament_standing_overrides = stagedOverrides;
  db.tournament_audit_logs = stagedAuditLogs;

  return {
    data: {
      groupId: args.p_group_id,
      teamId: args.p_team_id,
      overrideRank: args.p_override_rank,
      reason,
      auditLogged: true,
    },
    error: null,
  };
}

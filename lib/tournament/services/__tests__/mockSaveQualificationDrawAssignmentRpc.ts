/**
 * Faithful JS re-implementation of
 * tournament.save_qualification_draw_assignment()
 * (scripts/tournament-v2/015-qualification-draw-atomic-save.sql), mirroring
 * its exact contract: authoritative re-validation of tournament/category/
 * qualification-rule/candidate/assignment state, an optimistic-concurrency
 * check against expected_active_draw_id, then supersede-previous-draw ->
 * insert-draw -> insert-candidates -> resolve-Matches -> write-audit-log, all
 * as one atomic unit.
 *
 * IMPORTANT: models real Postgres transaction semantics — every write is
 * staged on a deep-cloned copy of the affected tables first; the real `db`
 * argument is only mutated once, at the very end, after every step has
 * succeeded. If validation fails, the concurrency check fails, or an
 * `injection.failAt` failure point is hit, the function returns an `error`
 * and `db` is left completely untouched — exactly like an unhandled
 * exception rolling back the whole Postgres transaction. `injection` is a
 * test-only hook (this file only — never wired into route.ts or any
 * production code path) that lets tests prove specific steps roll back
 * everything before them, the same way the real migration's tests can't
 * safely fabricate a mid-transaction Postgres failure but this mock can.
 *
 * Same role as the sibling PR's mockRollbackRpc.ts.
 */
type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

export interface SaveQualificationDrawAssignmentRpcArgs {
  p_tournament_id: string;
  p_category_code: string;
  p_candidate_team_ids: string[];
  p_assignments: Array<{ source_ref: string; team_id: string }>;
  p_expected_active_draw_id: string | null;
  p_note: string | null;
  p_actor_id: string | null;
  p_actor_email: string | null;
}

export interface SaveQualificationDrawAssignmentRpcResult {
  drawId: string;
  version: number;
  updatedMatchIds: string[];
  selectedSourceRefs: string[];
  previousDrawId: string | null;
}

export interface RpcOutcome {
  data: SaveQualificationDrawAssignmentRpcResult | null;
  error: { message: string } | null;
}

export interface RpcFailureInjection {
  /** Simulates a failure at this step — nothing before it is ever committed to `db`. */
  failAt?: 'candidates' | 'matchUpdate' | 'audit';
}

const QUALIFICATION_SLOT = 'group_third_place';
let mockIdCounter = 0;
function mockId(prefix: string): string {
  mockIdCounter += 1;
  return `${prefix}-${mockIdCounter}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function mockSaveQualificationDrawAssignmentRpc(
  db: Db,
  args: SaveQualificationDrawAssignmentRpcArgs,
  injection: RpcFailureInjection = {}
): RpcOutcome {
  const now = new Date().toISOString();
  const categoryCode = String(args.p_category_code || '').trim().toUpperCase();

  const tournament = (db.tournaments || []).find((t) => t.id === args.p_tournament_id);
  if (!tournament || tournament.deleted_at) {
    return { data: null, error: { message: `QUALIFICATION_DRAW_TOURNAMENT_NOT_FOUND: tournament ${args.p_tournament_id} not found` } };
  }
  if (tournament.status !== 'active') {
    return { data: null, error: { message: `QUALIFICATION_DRAW_TOURNAMENT_NOT_ACTIVE: tournament ${args.p_tournament_id} has status "${tournament.status}"` } };
  }

  const category = (db.tournament_categories || []).find(
    (c) => c.tournament_id === args.p_tournament_id && String(c.code).trim().toUpperCase() === categoryCode && !c.deleted_at
  );
  if (!category) {
    return { data: null, error: { message: `QUALIFICATION_DRAW_CATEGORY_NOT_FOUND: category ${categoryCode} not found in tournament ${args.p_tournament_id}` } };
  }
  const categoryId = category.id as string;

  const rule = (db.tournament_qualification_rules || []).find(
    (r) => r.tournament_id === args.p_tournament_id && r.category_id === categoryId
  );
  if (!rule || rule.best_third_placed_method !== 'draw' || (rule.best_third_placed_count as number) <= 0) {
    return { data: null, error: { message: `QUALIFICATION_DRAW_CONFIG_NOT_FOUND: category ${categoryCode} has no draw_selected qualification configuration` } };
  }
  const ruleCount = rule.best_third_placed_count as number;
  const expectedRefs = Array.from({ length: ruleCount }, (_, i) => `${categoryCode}-THIRD-DRAW-${i + 1}`);

  const candidateIds = (args.p_candidate_team_ids || []).map((id) => String(id).trim());
  if (candidateIds.length !== 3) {
    return { data: null, error: { message: `QUALIFICATION_DRAW_INVALID_CANDIDATE_COUNT: exactly 3 candidate teams are required (received ${candidateIds.length})` } };
  }
  if (new Set(candidateIds).size !== 3) {
    return { data: null, error: { message: 'QUALIFICATION_DRAW_DUPLICATE_CANDIDATE: duplicate candidate team in candidate list' } };
  }
  const matchedCandidateCount = (db.tournament_teams || []).filter(
    (t) => candidateIds.includes(t.id as string) && t.category_id === categoryId && t.tournament_id === args.p_tournament_id && !t.deleted_at
  ).length;
  if (matchedCandidateCount !== 3) {
    return { data: null, error: { message: `QUALIFICATION_DRAW_CANDIDATE_NOT_IN_CATEGORY: one or more candidate teams do not belong to category ${categoryCode}` } };
  }

  const assignments = args.p_assignments || [];
  if (assignments.length !== ruleCount) {
    return { data: null, error: { message: `QUALIFICATION_DRAW_INVALID_ASSIGNMENT_COUNT: exactly ${ruleCount} assignments are required (received ${assignments.length})` } };
  }
  const submittedRefs = Array.from(new Set(assignments.map((a) => String(a.source_ref).trim().toUpperCase()))).sort();
  if (submittedRefs.length !== assignments.length) {
    return { data: null, error: { message: 'QUALIFICATION_DRAW_DUPLICATE_ASSIGNMENT_REF: duplicate draw_selected source_ref in assignments' } };
  }
  const sortedExpectedRefs = [...expectedRefs].sort();
  if (JSON.stringify(submittedRefs) !== JSON.stringify(sortedExpectedRefs)) {
    return { data: null, error: { message: `QUALIFICATION_DRAW_UNKNOWN_ASSIGNMENT_REF: assignments must reference exactly ${sortedExpectedRefs}, got ${submittedRefs}` } };
  }
  const assignmentTeamIds = assignments.map((a) => String(a.team_id).trim());
  if (new Set(assignmentTeamIds).size !== assignmentTeamIds.length) {
    return { data: null, error: { message: 'QUALIFICATION_DRAW_DUPLICATE_ASSIGNMENT_TEAM: the same team cannot occupy more than one placeholder' } };
  }
  if (assignmentTeamIds.some((teamId) => !candidateIds.includes(teamId))) {
    return { data: null, error: { message: 'QUALIFICATION_DRAW_ASSIGNMENT_NOT_CANDIDATE: a selected team is not among the 3 confirmed candidates' } };
  }

  const activeDraw = (db.tournament_qualification_draws || []).find(
    (d) => d.category_id === categoryId && d.qualification_slot === QUALIFICATION_SLOT && (d.superseded_at ?? null) === null
  );
  const activeDrawId = (activeDraw?.id as string | undefined) ?? null;
  const expectedActiveDrawId = args.p_expected_active_draw_id ?? null;
  if (activeDrawId !== expectedActiveDrawId) {
    return {
      data: null,
      error: { message: `QUALIFICATION_DRAW_STALE_STATE: expected active draw ${expectedActiveDrawId} but found ${activeDrawId} — the draw changed since this was last read` },
    };
  }

  const nextVersion = ((activeDraw?.version as number | undefined) ?? 0) + 1;

  // ---- Staging phase: nothing below this line touches `db` directly. ----
  const stagedDraws = clone(db.tournament_qualification_draws || []);
  const stagedCandidates = clone(db.tournament_qualification_draw_candidates || []);
  const stagedMatches = clone(db.tournament_matches || []);
  const stagedAuditLogs = clone(db.tournament_audit_logs || []);

  if (activeDraw) {
    const staged = stagedDraws.find((d) => d.id === activeDraw.id);
    if (staged) staged.superseded_at = now;
  }

  const newDrawId = mockId('mock-draw');
  stagedDraws.push({
    id: newDrawId,
    category_id: categoryId,
    qualification_slot: QUALIFICATION_SLOT,
    slots_available: ruleCount,
    version: nextVersion,
    drawn_by: args.p_actor_id,
    drawn_at: now,
    note: args.p_note,
    superseded_at: null,
  });

  if (injection.failAt === 'candidates') {
    return { data: null, error: { message: 'SIMULATED_FAILURE: candidate insert' } };
  }

  const drawOrderByTeamId = new Map<string, number>();
  for (const assignment of assignments) {
    const match = String(assignment.source_ref).trim().toUpperCase().match(/-THIRD-DRAW-(\d+)$/);
    if (match) drawOrderByTeamId.set(String(assignment.team_id).trim(), Number(match[1]));
  }
  for (const teamId of candidateIds) {
    const groupMember = (db.tournament_group_members || []).find((gm) => gm.team_id === teamId);
    stagedCandidates.push({
      id: mockId('mock-cand'),
      draw_id: newDrawId,
      team_id: teamId,
      group_id: groupMember ? groupMember.group_id : null,
      is_selected: drawOrderByTeamId.has(teamId),
      draw_order: drawOrderByTeamId.get(teamId) ?? null,
    });
  }

  if (injection.failAt === 'matchUpdate') {
    return { data: null, error: { message: 'SIMULATED_FAILURE: match update' } };
  }

  const teamIdBySourceRef = new Map(assignments.map((a) => [String(a.source_ref).trim().toUpperCase(), String(a.team_id).trim()]));
  const updatedMatchIds: string[] = [];
  const matchedMatches = stagedMatches
    .filter(
      (m) =>
        m.category_id === categoryId &&
        !m.deleted_at &&
        ((m.home_source_type === 'draw_selected' && expectedRefs.includes(String(m.home_source_ref || '').trim().toUpperCase())) ||
          (m.away_source_type === 'draw_selected' && expectedRefs.includes(String(m.away_source_ref || '').trim().toUpperCase())))
    )
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  for (const m of matchedMatches) {
    let resolvedAny = false;
    if (m.home_source_type === 'draw_selected') {
      const resolved = teamIdBySourceRef.get(String(m.home_source_ref || '').trim().toUpperCase());
      if (resolved) {
        m.home_team_id = resolved;
        resolvedAny = true;
      }
    }
    if (m.away_source_type === 'draw_selected') {
      const resolved = teamIdBySourceRef.get(String(m.away_source_ref || '').trim().toUpperCase());
      if (resolved) {
        m.away_team_id = resolved;
        resolvedAny = true;
      }
    }
    if (resolvedAny) {
      m.sources_resolved_at = now;
    }
    m.updated_by = args.p_actor_id;
    m.updated_at = now;
    updatedMatchIds.push(m.id as string);
  }

  if (injection.failAt === 'audit') {
    return { data: null, error: { message: 'SIMULATED_FAILURE: audit insert' } };
  }

  stagedAuditLogs.push({
    id: mockId('mock-audit'),
    tournament_id: args.p_tournament_id,
    admin_id: args.p_actor_id,
    admin_email: args.p_actor_email,
    action: 'qualification-draws.confirm_manual_placeholder_assignment',
    entity_type: 'qualification-draw',
    entity_id: newDrawId,
    entity_label: `${categoryCode} ${expectedRefs.join(', ')}`,
    new_data: {
      category_code: categoryCode,
      candidate_team_ids: candidateIds,
      selections: assignments,
      updated_match_ids: updatedMatchIds,
      source: 'manual_candidate_confirmation',
      draw_id: newDrawId,
      version: nextVersion,
      previous_draw_id: activeDrawId,
    },
    created_at: now,
  });

  // ---- Commit phase: every step above succeeded — write staged state back. ----
  db.tournament_qualification_draws = stagedDraws;
  db.tournament_qualification_draw_candidates = stagedCandidates;
  db.tournament_matches = stagedMatches;
  db.tournament_audit_logs = stagedAuditLogs;

  return {
    data: {
      drawId: newDrawId,
      version: nextVersion,
      updatedMatchIds,
      selectedSourceRefs: expectedRefs,
      previousDrawId: activeDrawId,
    },
    error: null,
  };
}

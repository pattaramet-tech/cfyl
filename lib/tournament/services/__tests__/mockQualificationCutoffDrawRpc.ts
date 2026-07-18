// Faithful JS re-implementation of Migration 019's SQL contract
// (scripts/tournament-v2/019-qualification-cutoff-tie-draw.sql), used as the
// mock `.rpc('save_qualification_cutoff_draw', ...)` handler across the
// Qualification Cutoff Tie Draw test suite. Proves the APPLICATION LAYER's
// contract with the RPC — it does NOT prove the real SQL executes correctly
// against a live Postgres instance, since Migration 019 has not been applied
// anywhere yet. Keep this file's logic in sync with the migration by hand.

export type Row = Record<string, unknown>;
export type Db = Record<string, Row[]>;

interface RpcResult {
  data: Row | null;
  error: { message: string } | null;
}

function err(message: string): RpcResult {
  return { data: null, error: { message } };
}

function candidateSnapshot(clusterTeamIds: string[], availableSlots: number): string {
  return `v1|slots=${availableSlots}|candidates=${[...clusterTeamIds].sort().join(',')}`;
}

/** Creates a `.rpc()` handler bound to `db`. `db` must already contain
 * `tournament_group_members` (rows: {group_id, team_id}) and
 * `tournament_matches` (official rows: {group_id, status,
 * result_workflow_status, deleted_at, home_team_id, away_team_id,
 * winner_team_id}) and `tournament_qualification_rules` (rows:
 * {category_id, qualify_rank_per_group}) so the mock can compute the same
 * authoritative candidate pool the real RPC would. */
export function createMockSaveQualificationCutoffDrawRpc(db: Db, params: { categoryId: string; groupId: string }) {
  return function saveQualificationCutoffDrawRpc(name: string, args: Record<string, unknown>): RpcResult {
    if (name !== 'save_qualification_cutoff_draw') return err('unexpected rpc');
    if (!args.p_idempotency_key || String(args.p_idempotency_key).trim() === '') {
      return err('QUALIFICATION_CUTOFF_DRAW_IDEMPOTENCY_KEY_REQUIRED: idempotency_key is required');
    }

    const groupMembers = ((db.tournament_group_members || []) as Row[]).filter((m) => m.group_id === params.groupId);
    const teamIds = groupMembers.map((m) => m.team_id as string);

    // Idempotency — checked before anything else, mirroring the RPC.
    const existing = ((db.tournament_qualification_cutoff_draws || []) as Row[]).find(
      (d) => d.group_id === params.groupId && d.idempotency_key === args.p_idempotency_key
    );
    if (existing) {
      const existingSelected = ((db.tournament_qualification_cutoff_draw_candidates || []) as Row[])
        .filter((c) => c.draw_id === existing.id && c.is_selected)
        .map((c) => c.team_id as string)
        .sort();
      const requestedSelected = [...((args.p_selected_team_ids as string[]) || [])].sort();
      if (JSON.stringify(existingSelected) !== JSON.stringify(requestedSelected)) {
        return err('QUALIFICATION_CUTOFF_DRAW_IDEMPOTENCY_PAYLOAD_MISMATCH: idempotency_key already used with a different selection');
      }
      return {
        data: {
          drawId: existing.id,
          version: existing.version,
          availableSlots: existing.available_slots,
          selectedTeamIds: existingSelected,
          idempotent: true,
        },
        error: null,
      };
    }

    const rule = ((db.tournament_qualification_rules || []) as Row[]).find((r) => r.category_id === params.categoryId);
    const qualifyRankPerGroup = (rule?.qualify_rank_per_group as number) ?? 2;

    const officialMatches = ((db.tournament_matches || []) as Row[]).filter(
      (m) => m.group_id === params.groupId && m.status === 'finished' && m.result_workflow_status === 'published' && !m.deleted_at
    );
    const expectedMatchCount = (teamIds.length * (teamIds.length - 1)) / 2;
    if (officialMatches.length < expectedMatchCount) {
      return err('QUALIFICATION_CUTOFF_DRAW_GROUP_INCOMPLETE: group has not completed its round-robin');
    }

    if (teamIds.length <= qualifyRankPerGroup) {
      return err('QUALIFICATION_CUTOFF_DRAW_NOT_APPLICABLE: group has no cutoff (team count <= quota)');
    }

    const pointsByTeam = new Map<string, number>(teamIds.map((id) => [id, 0]));
    for (const m of officialMatches) {
      const winner = m.winner_team_id as string;
      if (pointsByTeam.has(winner)) pointsByTeam.set(winner, (pointsByTeam.get(winner) || 0) + 3);
    }
    const sorted = [...teamIds].sort((a, b) => (pointsByTeam.get(b) || 0) - (pointsByTeam.get(a) || 0) || (a < b ? -1 : a > b ? 1 : 0));
    const cutoffPoints = pointsByTeam.get(sorted[qualifyRankPerGroup - 1]) || 0;
    const cluster = teamIds.filter((id) => pointsByTeam.get(id) === cutoffPoints);
    const above = teamIds.filter((id) => (pointsByTeam.get(id) || 0) > cutoffPoints);
    const availableSlots = qualifyRankPerGroup - above.length;

    if (cluster.length <= availableSlots) {
      return err('QUALIFICATION_CUTOFF_DRAW_NOT_APPLICABLE: group has no tie cluster straddling the cutoff — no draw is needed');
    }

    const freshSnapshot = candidateSnapshot(cluster, availableSlots);
    if (args.p_expected_candidate_snapshot !== freshSnapshot) {
      return err(`QUALIFICATION_CUTOFF_DRAW_STALE_CANDIDATES: candidate pool changed since Preview — expected ${args.p_expected_candidate_snapshot}, got ${freshSnapshot}`);
    }

    const selected = ((args.p_selected_team_ids as string[]) || []).map((id) => id.trim());
    if (selected.length !== availableSlots) {
      return err(`QUALIFICATION_CUTOFF_DRAW_SELECTION_COUNT_MISMATCH: exactly ${availableSlots} team(s) must be selected (received ${selected.length})`);
    }
    if (new Set(selected).size !== selected.length) {
      return err('QUALIFICATION_CUTOFF_DRAW_DUPLICATE_SELECTION: duplicate team in the draw selection');
    }
    if (selected.some((id) => !cluster.includes(id))) {
      return err('QUALIFICATION_CUTOFF_DRAW_SELECTION_NOT_CANDIDATE: a selected team is not in the cutoff tie cluster candidate pool');
    }

    const activeDraw = ((db.tournament_qualification_cutoff_draws || []) as Row[]).find(
      (d) => d.group_id === params.groupId && !d.superseded_at
    );
    const activeDrawId = activeDraw ? (activeDraw.id as string) : null;
    if (activeDrawId !== ((args.p_expected_active_draw_id as string | null) || null)) {
      return err(`QUALIFICATION_CUTOFF_DRAW_STALE_STATE: expected active draw ${args.p_expected_active_draw_id} but found ${activeDrawId}`);
    }

    const nextVersion = activeDraw ? (activeDraw.version as number) + 1 : 1;
    if (activeDraw) activeDraw.superseded_at = '2026-07-20T14:00:00.000Z';

    const newDrawId = `cutoffdraw-${Math.random().toString(36).slice(2)}`;
    db.tournament_qualification_cutoff_draws = db.tournament_qualification_cutoff_draws || [];
    db.tournament_qualification_cutoff_draws.push({
      id: newDrawId,
      group_id: params.groupId,
      cutoff_position: qualifyRankPerGroup,
      available_slots: availableSlots,
      candidate_snapshot: freshSnapshot,
      idempotency_key: args.p_idempotency_key,
      version: nextVersion,
      drawn_by: args.p_actor_id,
      superseded_at: null,
    });

    db.tournament_qualification_cutoff_draw_candidates = db.tournament_qualification_cutoff_draw_candidates || [];
    for (const teamId of cluster) {
      db.tournament_qualification_cutoff_draw_candidates.push({
        draw_id: newDrawId,
        team_id: teamId,
        points_at_draw: pointsByTeam.get(teamId),
        is_selected: selected.includes(teamId),
      });
    }

    db.tournament_audit_logs = db.tournament_audit_logs || [];
    db.tournament_audit_logs.push({
      tournament_id: args.p_tournament_id,
      admin_id: args.p_actor_id,
      action: 'qualification-cutoff-draw.save',
      entity_type: 'tournament_group',
      entity_id: params.groupId,
      new_data: { draw_id: newDrawId, version: nextVersion, selected_team_ids: selected },
    });

    return {
      data: { drawId: newDrawId, version: nextVersion, availableSlots, selectedTeamIds: selected, idempotent: false },
      error: null,
    };
  };
}

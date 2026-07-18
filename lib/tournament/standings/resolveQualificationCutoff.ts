// Tournament V2 — Qualification Cutoff Tie Draw within Group (new business
// rule, directed by the system owner; see TOURNAMENT_V2_DECISION_CHECKLIST.md
// D-30). Source of truth for a completely SEPARATE concept from Standings
// ordering (resolveTournamentTiebreak.ts, D-09):
//
//   - Standings ordering (D-09) decides DISPLAY POSITION using points, then
//     H2H, then group-wide GD/GF, then Fair Play. It CAN fully separate two
//     teams that share the same points total.
//   - Qualification Cutoff (this module) decides WHO ADVANCES using POINTS
//     ONLY. If two or more teams share the exact same points total and that
//     shared points value straddles the group's automatic-qualify cutoff
//     (qualifyRankPerGroup), NONE of H2H/GD/GF/Fair Play/FIFA-ranking may be
//     used to decide who advances — a manual physical draw is required.
//
// This is why a team can simultaneously have a definite, fully-resolved
// STANDINGS POSITION (e.g. "3rd, ahead of team C on head-to-head") while its
// QUALIFICATION remains 'pending_draw' — the two questions are answered by
// completely different rules on purpose.
//
// Pure: deterministic, no DB access, no randomization. Never itself decides
// which team a tie cluster selects — that is exclusively a physical,
// human-conducted draw, manually recorded by an admin (see
// validateQualificationDrawSelection below and the Migration 019 RPC).

export interface QualificationCutoffTeamInput {
  teamId: string;
  points: number;
}

export interface ExistingQualificationDrawInput {
  /** Team IDs the recorded draw selected to fill the remaining slots. */
  selectedTeamIds: string[];
  /** Deterministic fingerprint of the candidate pool the draw was recorded
   * against (see candidateSnapshot below) — compared against a freshly
   * computed snapshot to detect staleness (e.g. a Score Correction changed
   * who is tied since the draw was recorded). */
  candidateSnapshot: string;
}

export interface ResolveQualificationCutoffParams {
  /** Every team in the group, each with its official (published-results-only)
   * points total. Order does not matter — the resolver sorts internally. */
  teams: QualificationCutoffTeamInput[];
  /** D-09/D-07 qualify_rank_per_group — number of automatic-qualify slots. */
  qualifyRankPerGroup: number;
  /** Round-robin completeness, computed by the caller (same rule
   * calculateGroupStandings already uses). A cutoff decision is never made
   * for an incomplete group. */
  isGroupComplete: boolean;
  /** Deterministic fingerprint of every official match's (id, version) pair
   * in this group — see buildOfficialResultRevision() below. REQUIRED,
   * because it is what makes staleness detection safe against
   * "resurrection": the derived points/candidate-pool alone is a LOSSY
   * summary that can coincidentally repeat (e.g. a Score Correction changes
   * results, then a second correction reverts them to the exact same
   * points distribution) even though the underlying official results were
   * genuinely revised twice in between. tournament_matches.version only
   * ever increments (it is the existing optimistic-lock column every
   * publish/correction RPC already bumps), so a fingerprint built from it
   * can never repeat once any relevant match has been revised again — this
   * is baked into candidateSnapshot below, not just compared separately, so
   * every caller gets the safety automatically. */
  officialResultRevision: string;
  /** The currently active (non-superseded) manual draw result for this
   * group's cutoff, if one has been recorded. Absent/null when no draw has
   * happened yet. */
  existingDraw?: ExistingQualificationDrawInput | null;
}

export type QualificationCutoffState = 'resolved' | 'pending_draw' | 'draw_recorded' | 'incomplete' | 'stale_draw';

export interface ResolveQualificationCutoffResult {
  /** Teams that qualify without any draw — strictly above the cutoff
   * points value, or the sole team occupying the boundary slot. */
  automaticQualifiers: string[];
  /** Teams eliminated without any draw — strictly below the cutoff points
   * value. */
  automaticEliminated: string[];
  /** The tie cluster straddling the cutoff — every team sharing the exact
   * points value at the boundary. Empty when there is no straddling tie
   * (resolved cleanly by points alone). */
  drawCandidates: string[];
  /** How many of drawCandidates' slots remain to be filled by the draw.
   * Always between 1 and drawCandidates.length when drawCandidates is
   * non-empty; 0 otherwise. */
  availableSlots: number;
  /** Teams the recorded draw selected to fill availableSlots — populated
   * only when qualificationState is 'draw_recorded'. */
  selectedByDraw: string[];
  /** drawCandidates minus selectedByDraw — populated only when
   * qualificationState is 'draw_recorded'. */
  eliminatedByDraw: string[];
  qualificationState: QualificationCutoffState;
  explanation: string;
  /** = qualifyRankPerGroup, echoed back for caller/UI convenience. */
  cutoffPosition: number;
  /** Points value at the cutoff boundary, or null when the group has no
   * more teams than qualifyRankPerGroup (everyone qualifies, no cutoff). */
  cutoffPoints: number | null;
  /** Deterministic fingerprint of drawCandidates + availableSlots, for the
   * caller to compare against a stored draw's candidateSnapshot (staleness
   * detection) or to persist alongside a newly recorded draw. Plain
   * canonical string, not a cryptographic hash — callers may hash it
   * themselves for compact storage if desired. */
  candidateSnapshot: string;
}

/** Deterministic fingerprint of a group's official match state — every
 * official (published) match's (id, version) pair, sorted by id. MUST be
 * computed identically by every caller (see calculateGroupStandings.ts /
 * lib/tournament/services/standings.ts / qualification-cutoff-draws.ts) and
 * by Migration 020's SQL, or staleness comparisons across the app-layer/RPC
 * boundary would be meaningless. Sorting the "id:version" strings directly
 * is equivalent to sorting by id alone, since every id is a fixed-length
 * UUID and therefore always differs before either string reaches its own
 * colon. */
export function buildOfficialResultRevision(matches: { matchId: string; version: number }[]): string {
  return [...matches]
    .map((m) => `${m.matchId}:${m.version}`)
    .sort()
    .join(',');
}

function buildCandidateSnapshot(drawCandidates: string[], availableSlots: number, officialResultRevision: string): string {
  const sorted = [...drawCandidates].sort();
  return `v2|slots=${availableSlots}|candidates=${sorted.join(',')}|rev=${officialResultRevision}`;
}

function emptyResult(params: {
  qualificationState: QualificationCutoffState;
  explanation: string;
  cutoffPosition: number;
  officialResultRevision: string;
  automaticQualifiers?: string[];
  automaticEliminated?: string[];
}): ResolveQualificationCutoffResult {
  return {
    automaticQualifiers: params.automaticQualifiers || [],
    automaticEliminated: params.automaticEliminated || [],
    drawCandidates: [],
    availableSlots: 0,
    selectedByDraw: [],
    eliminatedByDraw: [],
    qualificationState: params.qualificationState,
    explanation: params.explanation,
    cutoffPosition: params.cutoffPosition,
    cutoffPoints: null,
    candidateSnapshot: buildCandidateSnapshot([], 0, params.officialResultRevision),
  };
}

/**
 * Resolves which teams automatically qualify/are eliminated by points alone,
 * and identifies the tie cluster (if any) straddling the automatic-qualify
 * cutoff that requires a manual draw. Never picks a winner from a straddling
 * cluster itself — see qualificationState 'pending_draw' vs 'draw_recorded'.
 */
export function resolveQualificationCutoff(params: ResolveQualificationCutoffParams): ResolveQualificationCutoffResult {
  const { teams, qualifyRankPerGroup, isGroupComplete, existingDraw, officialResultRevision } = params;

  if (!isGroupComplete) {
    return emptyResult({
      qualificationState: 'incomplete',
      explanation: 'ผลการแข่งขันในกลุ่มยังไม่ครบ ยังไม่สามารถตัดสินสิทธิ์เข้ารอบได้',
      cutoffPosition: qualifyRankPerGroup,
      officialResultRevision,
    });
  }

  // Sort by points descending; ties are broken here ONLY for a stable,
  // deterministic internal ordering (never surfaced as a qualification
  // decision) — teamId is used as the tiebreak key so the sort never
  // depends on H2H/GD/GF/Fair Play/insertion order.
  const sorted = [...teams].sort((a, b) => b.points - a.points || (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0));

  if (sorted.length <= qualifyRankPerGroup) {
    return {
      ...emptyResult({
        qualificationState: 'resolved',
        explanation: 'จำนวนทีมในกลุ่มไม่เกินโควตาเข้ารอบ ทุกทีมเข้ารอบโดยไม่ต้องจับฉลาก',
        cutoffPosition: qualifyRankPerGroup,
        officialResultRevision,
        automaticQualifiers: sorted.map((t) => t.teamId),
        automaticEliminated: [],
      }),
    };
  }

  const cutoffPoints = sorted[qualifyRankPerGroup - 1].points;
  const aboveCluster = sorted.filter((t) => t.points > cutoffPoints).map((t) => t.teamId);
  const belowCluster = sorted.filter((t) => t.points < cutoffPoints).map((t) => t.teamId);
  const cluster = sorted.filter((t) => t.points === cutoffPoints).map((t) => t.teamId);
  const availableSlots = qualifyRankPerGroup - aboveCluster.length;

  // No tie at the boundary at all (clusterSize === 1) OR the whole cluster
  // fits within the remaining slots (Tie Cluster อยู่เหนือเส้นทั้งหมด) —
  // resolved cleanly by points, no draw needed. Any PREVIOUSLY active draw
  // for this group is intentionally ignored here — a group that is
  // 'resolved' by points has no candidate pool to compare a stale draw
  // against at all (see "Qualification ปัจจุบันตัดสินได้ด้วยคะแนนและควรเป็น
  // resolved" — the draw row, if any, is simply not consulted; it becomes
  // relevant again only if a LATER correction reintroduces a straddling
  // tie, at which point officialResultRevision guarantees it can never be
  // silently treated as still valid, even if the reintroduced candidate set
  // happens to be byte-identical to the original one).
  if (cluster.length <= availableSlots) {
    return {
      automaticQualifiers: [...aboveCluster, ...cluster],
      automaticEliminated: belowCluster,
      drawCandidates: [],
      availableSlots: 0,
      selectedByDraw: [],
      eliminatedByDraw: [],
      qualificationState: 'resolved',
      explanation:
        cluster.length === 1
          ? 'ไม่มีทีมคะแนนเท่ากันตรงเส้นโควตา ตัดสินด้วยคะแนนได้ทันที'
          : 'ทีมที่คะแนนเท่ากันตรงเส้นโควตาทั้งหมดอยู่ในโควตาเข้ารอบ เข้ารอบทั้งหมดโดยไม่ต้องจับฉลาก',
      cutoffPosition: qualifyRankPerGroup,
      cutoffPoints,
      candidateSnapshot: buildCandidateSnapshot([], 0, officialResultRevision),
    };
  }

  // Straddling tie cluster — a manual draw is required for availableSlots
  // among cluster.length candidates. officialResultRevision is baked into
  // the snapshot so that even a candidate SET + availableSlots that reverts
  // to being byte-identical to an earlier draw's snapshot is still
  // correctly detected as stale, as long as at least one official match in
  // the group was revised (its version bumped) at any point in between —
  // see buildOfficialResultRevision's doc comment.
  const candidateSnapshot = buildCandidateSnapshot(cluster, availableSlots, officialResultRevision);

  if (!existingDraw) {
    return {
      automaticQualifiers: aboveCluster,
      automaticEliminated: belowCluster,
      drawCandidates: [...cluster].sort(),
      availableSlots,
      selectedByDraw: [],
      eliminatedByDraw: [],
      qualificationState: 'pending_draw',
      explanation: `มี ${cluster.length} ทีมคะแนนเท่ากัน (${cutoffPoints} คะแนน) คร่อมเส้นโควตาเข้ารอบ (อันดับ ${qualifyRankPerGroup}) เหลือ ${availableSlots} สิทธิ์ — ต้องจับฉลากตัดสิน ห้ามใช้ H2H/ผลต่างประตู/ประตูได้/แฟร์เพลย์`,
      cutoffPosition: qualifyRankPerGroup,
      cutoffPoints,
      candidateSnapshot,
    };
  }

  if (existingDraw.candidateSnapshot !== candidateSnapshot) {
    return {
      automaticQualifiers: aboveCluster,
      automaticEliminated: belowCluster,
      drawCandidates: [...cluster].sort(),
      availableSlots,
      selectedByDraw: [],
      eliminatedByDraw: [],
      qualificationState: 'stale_draw',
      explanation: 'ผลจับฉลากที่บันทึกไว้ล้าสมัย (ข้อมูลผลการแข่งขันเปลี่ยนไปตั้งแต่จับฉลาก) ต้องตรวจสอบตัวอย่างและบันทึกผลจับฉลากใหม่',
      cutoffPosition: qualifyRankPerGroup,
      cutoffPoints,
      candidateSnapshot,
    };
  }

  const selectedByDraw = [...existingDraw.selectedTeamIds].sort();
  const eliminatedByDraw = cluster.filter((teamId) => !existingDraw.selectedTeamIds.includes(teamId)).sort();

  return {
    automaticQualifiers: aboveCluster,
    automaticEliminated: belowCluster,
    drawCandidates: [...cluster].sort(),
    availableSlots,
    selectedByDraw,
    eliminatedByDraw,
    qualificationState: 'draw_recorded',
    explanation: `จับฉลากแล้ว: ${selectedByDraw.length} ทีมเข้ารอบจาก ${cluster.length} ทีมคะแนนเท่ากัน`,
    cutoffPosition: qualifyRankPerGroup,
    cutoffPoints,
    candidateSnapshot,
  };
}

export type DrawSelectionValidationErrorCode =
  | 'QUALIFICATION_CUTOFF_DRAW_NOT_APPLICABLE'
  | 'QUALIFICATION_CUTOFF_DRAW_SELECTION_COUNT_MISMATCH'
  | 'QUALIFICATION_CUTOFF_DRAW_DUPLICATE_SELECTION'
  | 'QUALIFICATION_CUTOFF_DRAW_SELECTION_NOT_CANDIDATE';

export type DrawSelectionValidationResult =
  | { ok: true }
  | { ok: false; code: DrawSelectionValidationErrorCode; message: string };

/**
 * Validates a PROPOSED manual draw selection against the authoritative
 * candidate pool/available slots resolveQualificationCutoff just computed.
 * Pure — used by both the app-layer service (fast feedback) and mirrored
 * inside the Migration 019 RPC (authoritative). Never itself selects a
 * winner.
 */
export function validateQualificationDrawSelection(params: {
  drawCandidates: string[];
  availableSlots: number;
  selectedTeamIds: string[];
}): DrawSelectionValidationResult {
  if (params.drawCandidates.length === 0 || params.availableSlots <= 0) {
    return {
      ok: false,
      code: 'QUALIFICATION_CUTOFF_DRAW_NOT_APPLICABLE',
      message: 'This group has no cutoff tie cluster requiring a draw',
    };
  }

  const trimmed = params.selectedTeamIds.map((id) => id.trim()).filter(Boolean);
  if (trimmed.length !== params.availableSlots) {
    return {
      ok: false,
      code: 'QUALIFICATION_CUTOFF_DRAW_SELECTION_COUNT_MISMATCH',
      message: `Exactly ${params.availableSlots} team(s) must be selected (received ${trimmed.length})`,
    };
  }

  const uniqueIds = new Set(trimmed);
  if (uniqueIds.size !== trimmed.length) {
    return { ok: false, code: 'QUALIFICATION_CUTOFF_DRAW_DUPLICATE_SELECTION', message: 'Duplicate team in the draw selection' };
  }

  const candidateSet = new Set(params.drawCandidates);
  for (const teamId of trimmed) {
    if (!candidateSet.has(teamId)) {
      return {
        ok: false,
        code: 'QUALIFICATION_CUTOFF_DRAW_SELECTION_NOT_CANDIDATE',
        message: `Selected team ${teamId} is not in the cutoff tie cluster candidate pool`,
      };
    }
  }

  return { ok: true };
}

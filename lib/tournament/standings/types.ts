// Tournament V2 Standings Engine — pure types shared by all calculation
// modules. Source of truth: TOURNAMENT_V2_DECISION_CHECKLIST.md D-09 (no
// draws, penalty-decided winners, tiebreak order), D-06 (Fair Play values),
// D-07 (cross-group best-third-place), D-29 (G-U16 draw override).

/** A single group-stage match already filtered to official/published/eligible
 * scope — see lib/tournament/standings/loadOfficialResults.ts for the filter. */
export interface OfficialMatchResult {
  matchId: string;
  groupId: string;
  categoryId: string;
  homeTeamId: string;
  awayTeamId: string;
  /** Regulation-time goals only — penalty shootout goals are excluded per D-09. */
  regulationHomeScore: number;
  regulationAwayScore: number;
  winnerTeamId: string;
  decidedBy: 'regulation' | 'penalty';
}

export interface TeamFairPlayInput {
  teamId: string;
  /** Per-player-per-match Fair Play deductions, already resolved to the
   * single most-severe-event value per D-06 (see calculateFairPlayScore.ts). */
  events: FairPlayEvent[];
}

export interface FairPlayEvent {
  matchId: string;
  playerId: string;
  /** Negative point value: -1 yellow, -3 second-yellow, -4 direct red, -5 yellow+direct-red. */
  points: number;
}

export interface TeamRawStats {
  teamId: string;
  teamName: string;
  teamCode: string;
  groupId: string;
  played: number;
  won: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  fairPlayScore: number;
}

export type TiebreakRuleName =
  | 'points'
  | 'head_to_head_points'
  | 'head_to_head_goal_diff'
  | 'head_to_head_goals_for'
  | 'group_goal_diff'
  | 'group_goals_for'
  | 'fair_play'
  | 'lot';

export type TieResolutionState = 'resolved' | 'pending_draw' | 'pending_manual_override';

export interface StandingsRow {
  teamId: string;
  teamName: string;
  teamCode: string;
  groupId: string;
  groupCode: string;
  position: number;
  played: number;
  won: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  fairPlayScore: number;
  qualificationStatus: 'qualified' | 'eliminated' | 'pending';
  tiebreakExplanation: string;
  tieState: TieResolutionState;
  /** Manual override applied to this team's position, if any (D-13 / tournament_standing_overrides). */
  overrideApplied: boolean;
  overrideReason: string | null;
  /** Non-null only when an override row existed for this team but was NOT
   * applied — rank outside the group's valid range, or colliding with
   * another team's override rank in the same group. The team's position
   * still reflects its naturally computed order; it is never dropped. */
  overrideRejectedReason: string | null;
}

export interface GroupStandingsResult {
  groupId: string;
  groupCode: string;
  rows: StandingsRow[];
  /** True when every team in the group has played every other team once
   * (round-robin complete) — used by the UI to show an "incomplete" notice
   * and by cross-group ranking to decide whether a group's 3rd place is
   * final enough to be treated as an eligible qualification candidate. */
  isComplete: boolean;
  /** Qualification Cutoff Tie Draw state for this group's automatic-qualify
   * boundary (qualifyRankPerGroup) — see resolveQualificationCutoff.ts. This
   * is a SEPARATE concept from `isComplete`/`tieState` (which describe
   * standings ordering): a group can be `isComplete=true` with every row's
   * `tieState='resolved'` and still have `qualificationCutoffState` be
   * 'pending_draw' or 'stale_draw', because a Standings-ordering tiebreak
   * (H2H/GD/GF/Fair Play) is never allowed to decide qualification when
   * points are tied across the cutoff. Cross-group best-third-place logic
   * (rankCrossGroupCandidates.ts) treats any group whose
   * qualificationCutoffState is not 'resolved' as not-yet-ready — see
   * "Deferred Decision: Cross-group qualification after group-cutoff draw". */
  qualificationCutoffState: 'resolved' | 'pending_draw' | 'draw_recorded' | 'incomplete' | 'stale_draw';
}

export interface CrossGroupCandidate {
  teamId: string;
  teamName: string;
  teamCode: string;
  groupId: string;
  groupCode: string;
  rank: number;
  points: number;
  goalDifference: number;
  goalsFor: number;
  fairPlayScore: number;
  /** Number of counted (official, group-stage) matches this team has
   * played. Raw point/GD/GF totals are only comparable across groups when
   * every candidate has the same countedMatches — see
   * rankBestThirdPlacedTeams' normalization_required state. */
  countedMatches: number;
}

export type CrossGroupRankingState = 'resolved' | 'unresolved_tie' | 'normalization_required' | 'incomplete';

export interface BestThirdPlacedRankingResult {
  /** Candidates in final ranked order (index 0 = best). Empty when state is
   * 'normalization_required' — no ranking, and no qualification decision,
   * is produced in that state. */
  ranked: CrossGroupCandidate[];
  /** 'resolved': ranking fully separated every candidate.
   * 'unresolved_tie': candidates were comparable (equal countedMatches) but
   *   remain tied after Fair Play — draw/lot required, per D-07 step 5.
   * 'normalization_required': candidates played different numbers of
   *   counted matches and no approved normalization rule exists yet — raw
   *   totals are not comparable, so no ranking or qualification decision is
   *   made at all.
   * 'incomplete': one or more source groups aren't ready yet (incomplete
   *   group, unresolved 3rd-place tie within a group) — there is no
   *   candidate set to rank at all yet. */
  state: CrossGroupRankingState;
  /** True only when state === 'resolved'. Kept for backward compatibility
   * with existing callers that only checked this boolean. */
  fullyResolved: boolean;
  explanation: string;
}

export interface G16ThirdPlaceCandidatesResult {
  /** Exactly the 3 third-place teams (one per group) eligible for the
   * physical paper draw — D-29. The engine identifies WHO is eligible; it
   * never selects which 2 of the 3 advance. */
  candidates: CrossGroupCandidate[];
  /** False if any source group's 3rd place is not yet determinable
   * (incomplete group, unresolved tie for 3rd within a group, etc). */
  isComplete: boolean;
  incompleteReason: string | null;
}

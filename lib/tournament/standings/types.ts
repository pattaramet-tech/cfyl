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
}

export interface BestThirdPlacedRankingResult {
  /** Candidates in final ranked order (index 0 = best). */
  ranked: CrossGroupCandidate[];
  /** True if the ranking sequence (points/GD/GF/FairPlay) fully separated
   * every candidate; false if a tie remains after Fair Play (draw/lot
   * required — the engine never breaks this itself, per D-07 step 5). */
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

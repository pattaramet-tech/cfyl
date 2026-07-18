import type { GroupStandingsResult, OfficialMatchResult, StandingsRow, TeamRawStats } from './types';
import { calculateFairPlayScore, type RawCardRow } from './calculateFairPlayScore';
import { resolveTournamentTiebreak } from './resolveTournamentTiebreak';

export interface TeamInput {
  teamId: string;
  teamName: string;
  teamCode: string;
}

export interface StandingOverrideInput {
  teamId: string;
  overrideRank: number;
  reason: string;
}

export interface CalculateGroupStandingsParams {
  groupId: string;
  groupCode: string;
  teams: TeamInput[];
  /** Only official/published/eligible matches for this group — see
   * lib/tournament/standings/loadOfficialResults.ts. Never pass Quick
   * Result, draft, or unpublished data here. */
  matches: OfficialMatchResult[];
  cardRows: RawCardRow[];
  overrides?: StandingOverrideInput[];
  /** D-09/D-07: how many automatically qualify per group (usually 2). */
  qualifyRankPerGroup: number;
  /** Whether this category's qualification rule uses a best-third-place
   * mechanism (ranked or draw) — determines whether the rank immediately
   * below qualifyRankPerGroup is 'pending' (still possibly qualifying) or
   * 'eliminated'. */
  bestThirdPlacedEligible: boolean;
}

function computeRawStats(teams: TeamInput[], matches: OfficialMatchResult[], groupId: string, cardRows: RawCardRow[]): TeamRawStats[] {
  return teams.map((team) => {
    let played = 0;
    let won = 0;
    let lost = 0;
    let goalsFor = 0;
    let goalsAgainst = 0;
    let points = 0;

    for (const match of matches) {
      const isHome = match.homeTeamId === team.teamId;
      const isAway = match.awayTeamId === team.teamId;
      if (!isHome && !isAway) continue;

      played += 1;
      const scored = isHome ? match.regulationHomeScore : match.regulationAwayScore;
      const conceded = isHome ? match.regulationAwayScore : match.regulationHomeScore;
      goalsFor += scored;
      goalsAgainst += conceded;

      if (match.winnerTeamId === team.teamId) {
        won += 1;
        points += 3;
      } else {
        lost += 1;
      }
    }

    return {
      teamId: team.teamId,
      teamName: team.teamName,
      teamCode: team.teamCode,
      groupId,
      played,
      won,
      lost,
      goalsFor,
      goalsAgainst,
      goalDifference: goalsFor - goalsAgainst,
      points,
      fairPlayScore: calculateFairPlayScore(cardRows, team.teamId),
    };
  });
}

function clusterByPoints(sortedByPoints: TeamRawStats[]): TeamRawStats[][] {
  const clusters: TeamRawStats[][] = [];
  let current: TeamRawStats[] = [];
  let currentPoints: number | null = null;
  for (const team of sortedByPoints) {
    if (team.points !== currentPoints) {
      if (current.length > 0) clusters.push(current);
      current = [team];
      currentPoints = team.points;
    } else {
      current.push(team);
    }
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

/**
 * Pure: computes the full group standings table, applying D-09's tiebreak
 * sequence and D-06 Fair Play. Deterministic — the same matches/cards input
 * always produces the same ordering and explanation.
 */
export function calculateGroupStandings(params: CalculateGroupStandingsParams): GroupStandingsResult {
  const rawStats = computeRawStats(params.teams, params.matches, params.groupId, params.cardRows);
  const sortedByPoints = [...rawStats].sort((a, b) => b.points - a.points);
  const pointsClusters = clusterByPoints(sortedByPoints);

  const orderedWithExplanation: Array<{ stats: TeamRawStats; explanation: string; tieState: 'resolved' | 'pending_draw' | 'pending_manual_override' }> = [];

  for (const cluster of pointsClusters) {
    if (cluster.length === 1) {
      orderedWithExplanation.push({ stats: cluster[0], explanation: 'ไม่มีทีมอื่นคะแนนเท่ากัน', tieState: 'resolved' });
      continue;
    }
    const tiebreakEntries = resolveTournamentTiebreak({ pointsTiedTeams: cluster, groupMatches: params.matches });
    for (const entry of tiebreakEntries) {
      const stats = cluster.find((t) => t.teamId === entry.teamId) as TeamRawStats;
      orderedWithExplanation.push({ stats, explanation: entry.explanation, tieState: entry.tieState });
    }
  }

  const totalCount = orderedWithExplanation.length;
  const allOverridesByTeamId = new Map((params.overrides || []).map((o) => [o.teamId, o]));

  // Step 1: reject any override whose rank falls outside the group's actual
  // size. An out-of-range override must never silently drop the team it
  // targets — it simply isn't applied, and the reason is surfaced via
  // overrideRejectedReason on that team's row.
  const rankValidOverrides = new Map<string, StandingOverrideInput>();
  const rejectedReasons = new Map<string, string>();
  for (const [teamId, override] of allOverridesByTeamId) {
    if (!Number.isInteger(override.overrideRank) || override.overrideRank < 1 || override.overrideRank > totalCount) {
      rejectedReasons.set(
        teamId,
        `Override rank ${override.overrideRank} is outside the valid range 1-${totalCount} and was not applied`
      );
      continue;
    }
    rankValidOverrides.set(teamId, override);
  }

  // Step 2: reject rank collisions. If two or more teams claim the same
  // rank, NONE of them are applied — never pick an arbitrary "winner" and
  // drop the other team. All colliding teams fall back to their naturally
  // computed order instead, with the collision explained on their row.
  const teamIdsByRank = new Map<number, string[]>();
  for (const [teamId, override] of rankValidOverrides) {
    const list = teamIdsByRank.get(override.overrideRank) || [];
    list.push(teamId);
    teamIdsByRank.set(override.overrideRank, list);
  }
  const validOverridesByTeamId = new Map<string, StandingOverrideInput>();
  for (const [teamId, override] of rankValidOverrides) {
    const collidingTeamIds = teamIdsByRank.get(override.overrideRank) || [];
    if (collidingTeamIds.length > 1) {
      const others = collidingTeamIds.filter((id) => id !== teamId).join(', ');
      rejectedReasons.set(
        teamId,
        `Override rank ${override.overrideRank} collides with another team's override (${others}) and was not applied`
      );
      continue;
    }
    validOverridesByTeamId.set(teamId, override);
  }

  // Manual override (tournament_standing_overrides, already-approved table):
  // a validly-overridden team's rank takes priority; teams without a valid
  // override fill the remaining positions in their computed relative order.
  let finalOrder = orderedWithExplanation;
  if (validOverridesByTeamId.size > 0) {
    const overridden = orderedWithExplanation
      .filter((e) => validOverridesByTeamId.has(e.stats.teamId))
      .sort((a, b) => (validOverridesByTeamId.get(a.stats.teamId) as StandingOverrideInput).overrideRank - (validOverridesByTeamId.get(b.stats.teamId) as StandingOverrideInput).overrideRank);
    const nonOverridden = orderedWithExplanation.filter((e) => !validOverridesByTeamId.has(e.stats.teamId));

    // Interleave: place overridden teams at their exact rank, fill gaps with
    // non-overridden teams in their computed relative order. Ranks here are
    // already guaranteed unique and in-range by the validation above, so
    // every slot assignment below is unconditional.
    const slots: (typeof orderedWithExplanation[number] | null)[] = new Array(totalCount).fill(null);
    for (const entry of overridden) {
      const rank = (validOverridesByTeamId.get(entry.stats.teamId) as StandingOverrideInput).overrideRank;
      slots[rank - 1] = entry;
    }
    let fillIndex = 0;
    for (const entry of nonOverridden) {
      while (slots[fillIndex] !== null) fillIndex += 1;
      slots[fillIndex] = entry;
    }
    finalOrder = slots.filter((s): s is typeof orderedWithExplanation[number] => s !== null);
  }

  // Defensive invariant: this function must never silently drop a team,
  // regardless of override state. A violation here means a logic bug in
  // this function, not a data-quality issue — fail loudly rather than
  // returning a standings table with a missing or duplicated team.
  const finalTeamIds = finalOrder.map((entry) => entry.stats.teamId);
  if (finalTeamIds.length !== totalCount || new Set(finalTeamIds).size !== totalCount) {
    throw new Error(
      `calculateGroupStandings invariant violated for group ${params.groupId}: expected ${totalCount} unique teams in the final order, got ${finalTeamIds.length} rows (${new Set(finalTeamIds).size} unique team IDs)`
    );
  }

  const expectedMatchCount = (params.teams.length * (params.teams.length - 1)) / 2;
  const isComplete = params.matches.length >= expectedMatchCount;

  const rows: StandingsRow[] = finalOrder.map((entry, index) => {
    const position = index + 1;
    const appliedOverride = validOverridesByTeamId.get(entry.stats.teamId);
    let qualificationStatus: StandingsRow['qualificationStatus'];
    if (!isComplete) {
      qualificationStatus = 'pending';
    } else if (position <= params.qualifyRankPerGroup) {
      qualificationStatus = 'qualified';
    } else if (position === params.qualifyRankPerGroup + 1 && params.bestThirdPlacedEligible) {
      qualificationStatus = 'pending';
    } else {
      qualificationStatus = 'eliminated';
    }

    return {
      teamId: entry.stats.teamId,
      teamName: entry.stats.teamName,
      teamCode: entry.stats.teamCode,
      groupId: params.groupId,
      groupCode: params.groupCode,
      position,
      played: entry.stats.played,
      won: entry.stats.won,
      lost: entry.stats.lost,
      goalsFor: entry.stats.goalsFor,
      goalsAgainst: entry.stats.goalsAgainst,
      goalDifference: entry.stats.goalDifference,
      points: entry.stats.points,
      fairPlayScore: entry.stats.fairPlayScore,
      qualificationStatus,
      tiebreakExplanation: appliedOverride ? `จัดอันดับโดย Admin: ${appliedOverride.reason}` : entry.explanation,
      // tieState reflects what the natural D-09 computation produced — an
      // applied override is conveyed separately via overrideApplied/
      // overrideReason, so a resolved-then-overridden row still shows how it
      // would have ranked naturally.
      tieState: entry.tieState,
      overrideApplied: !!appliedOverride,
      overrideReason: appliedOverride?.reason || null,
      overrideRejectedReason: rejectedReasons.get(entry.stats.teamId) || null,
    };
  });

  return { groupId: params.groupId, groupCode: params.groupCode, rows, isComplete };
}

import type { OfficialMatchResult, TeamRawStats, TieResolutionState } from './types';

// D-09 (DECISION LOCKED 2026-07-14) group tiebreak order:
//   1. points (primary sort, handled by the caller before invoking this)
//   2. head-to-head points (among tied teams only)
//   3. head-to-head goal difference
//   4. head-to-head goals for
//   5. group-wide goal difference (all matches in the group)
//   6. group-wide goals for
//   7. Fair Play
//   8. lot (draw) — this engine NEVER breaks a tie itself; an unresolved
//      cluster is returned with tieState='pending_draw'.
//
// "หากมีหลายทีมคะแนนเท่ากัน และเกณฑ์ Head-to-head แยกบางทีมออกได้แล้ว ให้เริ่ม
// คำนวณ Head-to-head ใหม่เฉพาะทีมที่ยังเท่ากัน" — only the head-to-head step is
// recursively recomputed for a shrinking tied subset (mini-league). The
// group-wide goal-difference/goals-for/Fair-Play steps are plain, whole-group
// values that do not depend on which subset is being compared, so they are
// applied once (no recursion) to whatever remains tied after head-to-head.

export interface TiebreakEntry {
  teamId: string;
  position: number;
  explanation: string;
  tieState: TieResolutionState;
}

export interface TiebreakResult {
  orderedTeamIds: string[];
  entries: Map<string, TiebreakEntry>;
}

interface H2HStats {
  teamId: string;
  points: number;
  goalDiff: number;
  goalsFor: number;
}

function computeHeadToHead(teamIds: string[], matches: OfficialMatchResult[]): Map<string, H2HStats> {
  const teamIdSet = new Set(teamIds);
  const stats = new Map<string, H2HStats>(teamIds.map((id) => [id, { teamId: id, points: 0, goalDiff: 0, goalsFor: 0 }]));

  for (const match of matches) {
    if (!teamIdSet.has(match.homeTeamId) || !teamIdSet.has(match.awayTeamId)) continue;
    const home = stats.get(match.homeTeamId) as H2HStats;
    const away = stats.get(match.awayTeamId) as H2HStats;
    home.goalsFor += match.regulationHomeScore;
    home.goalDiff += match.regulationHomeScore - match.regulationAwayScore;
    away.goalsFor += match.regulationAwayScore;
    away.goalDiff += match.regulationAwayScore - match.regulationHomeScore;
    if (match.winnerTeamId === match.homeTeamId) home.points += 3;
    else if (match.winnerTeamId === match.awayTeamId) away.points += 3;
  }

  return stats;
}

/** Groups an already-sorted team list into clusters of exactly-equal sort keys. */
function clusterByKey<T>(sorted: T[], keyFn: (item: T) => string): T[][] {
  const clusters: T[][] = [];
  let current: T[] = [];
  let currentKey: string | null = null;
  for (const item of sorted) {
    const key = keyFn(item);
    if (key !== currentKey) {
      if (current.length > 0) clusters.push(current);
      current = [item];
      currentKey = key;
    } else {
      current.push(item);
    }
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

function resolveByGroupWideCriteria(
  teams: TeamRawStats[],
  explanations: Map<string, string[]>
): { teamId: string; tieState: TieResolutionState }[] {
  const sorted = [...teams].sort(
    (a, b) => b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor
  );
  const gdGfClusters = clusterByKey(sorted, (t) => `${t.goalDifference}|${t.goalsFor}`);

  const result: { teamId: string; tieState: TieResolutionState }[] = [];
  for (const cluster of gdGfClusters) {
    if (cluster.length === 1) {
      explanations.get(cluster[0].teamId)?.push('แยกด้วยผลต่างประตู/ประตูได้รวมทั้งกลุ่ม');
      result.push({ teamId: cluster[0].teamId, tieState: 'resolved' });
      continue;
    }
    // Still tied on group-wide GD/GF — try Fair Play.
    const sortedByFairPlay = [...cluster].sort((a, b) => b.fairPlayScore - a.fairPlayScore);
    const fpClusters = clusterByKey(sortedByFairPlay, (t) => String(t.fairPlayScore));
    for (const fpCluster of fpClusters) {
      if (fpCluster.length === 1) {
        explanations.get(fpCluster[0].teamId)?.push('แยกด้วยคะแนนแฟร์เพลย์');
        result.push({ teamId: fpCluster[0].teamId, tieState: 'resolved' });
      } else {
        for (const team of fpCluster) {
          explanations.get(team.teamId)?.push('เสมอทุกเกณฑ์ที่อนุมัติแล้ว รอจับฉลาก');
          result.push({ teamId: team.teamId, tieState: 'pending_draw' });
        }
      }
    }
  }
  return result;
}

/** Recursive mini-league head-to-head resolution for one tied cluster. */
function resolveClusterByHeadToHead(
  teams: TeamRawStats[],
  matches: OfficialMatchResult[],
  explanations: Map<string, string[]>
): { teamId: string; tieState: TieResolutionState }[] {
  if (teams.length === 1) {
    return [{ teamId: teams[0].teamId, tieState: 'resolved' }];
  }

  const h2h = computeHeadToHead(
    teams.map((t) => t.teamId),
    matches
  );
  const sorted = [...teams].sort((a, b) => {
    const ha = h2h.get(a.teamId) as H2HStats;
    const hb = h2h.get(b.teamId) as H2HStats;
    return hb.points - ha.points || hb.goalDiff - ha.goalDiff || hb.goalsFor - ha.goalsFor;
  });
  const h2hClusters = clusterByKey(sorted, (t) => {
    const h = h2h.get(t.teamId) as H2HStats;
    return `${h.points}|${h.goalDiff}|${h.goalsFor}`;
  });

  const result: { teamId: string; tieState: TieResolutionState }[] = [];
  for (const cluster of h2hClusters) {
    if (cluster.length === 1) {
      explanations.get(cluster[0].teamId)?.push('แยกด้วยผลการแข่งขันที่พบกันเอง (Head-to-head)');
      result.push({ teamId: cluster[0].teamId, tieState: 'resolved' });
    } else if (cluster.length === teams.length) {
      // Head-to-head made zero progress on this exact set — fall through to
      // group-wide criteria instead of recursing on an unchanged cluster
      // (which would infinite-loop).
      result.push(...resolveByGroupWideCriteria(cluster, explanations));
    } else {
      // Head-to-head separated this as a genuinely smaller tied subset —
      // mini-league recursion: recompute head-to-head again, scoped only to
      // this shrunk cluster.
      result.push(...resolveClusterByHeadToHead(cluster, matches, explanations));
    }
  }
  return result;
}

/**
 * Resolves final group order for teams already tied on points. Pure:
 * deterministic given the same teams+matches input. Never invents a winner
 * for a fully unresolved tie — returns tieState='pending_draw' instead.
 */
export function resolveTournamentTiebreak(params: {
  pointsTiedTeams: TeamRawStats[];
  groupMatches: OfficialMatchResult[];
}): TiebreakEntry[] {
  const explanations = new Map<string, string[]>(params.pointsTiedTeams.map((t) => [t.teamId, []]));

  if (params.pointsTiedTeams.length === 1) {
    const team = params.pointsTiedTeams[0];
    return [{ teamId: team.teamId, position: 1, explanation: 'ไม่มีทีมอื่นคะแนนเท่ากัน', tieState: 'resolved' }];
  }

  const resolved = resolveClusterByHeadToHead(params.pointsTiedTeams, params.groupMatches, explanations);

  return resolved.map((entry, index) => ({
    teamId: entry.teamId,
    position: index + 1,
    explanation: explanations.get(entry.teamId)?.join(' → ') || 'ไม่มีทีมอื่นคะแนนเท่ากัน',
    tieState: entry.tieState,
  }));
}

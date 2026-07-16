import type { BestThirdPlacedRankingResult, CrossGroupCandidate, G16ThirdPlaceCandidatesResult, GroupStandingsResult } from './types';

// D-07 (DECISION LOCKED 2026-07-14) cross-group best-third-place ranking —
// GENERAL rule, for categories whose tournament_qualification_rules row has
// best_third_placed_method='ranked':
//   1. total points
//   2. goal difference
//   3. goals scored
//   4. Fair Play
//   5. lot (draw) — this engine never breaks a tie itself.
//
// D-29 (DECISION LOCKED 2026-07-14) — G-U16 category OVERRIDE: does NOT use
// this ranking at all. G-U16's tournament_qualification_rules row has
// best_third_placed_method='draw'. This module intentionally keeps
// "identify the 3 eligible candidates" (rankGroupThirdPlaceCandidates,
// shared by both methods) completely separate from "rank them by points/GD/GF"
// (rankBestThirdPlacedTeams, 'ranked' method only) — the G-U16 path calls
// only the former, never the latter, so the central engine can never
// accidentally apply ranked selection to a draw-method category.

function extractThirdPlaceRows(groupStandings: GroupStandingsResult[]): {
  candidates: CrossGroupCandidate[];
  isComplete: boolean;
  incompleteReason: string | null;
} {
  const candidates: CrossGroupCandidate[] = [];
  const incompleteGroups: string[] = [];

  for (const group of groupStandings) {
    if (!group.isComplete) {
      incompleteGroups.push(group.groupCode);
      continue;
    }
    const thirdPlaceRow = group.rows.find((row) => row.position === 3);
    if (!thirdPlaceRow) {
      incompleteGroups.push(group.groupCode);
      continue;
    }
    if (thirdPlaceRow.tieState !== 'resolved' && !thirdPlaceRow.overrideApplied) {
      incompleteGroups.push(`${group.groupCode} (อันดับ 3 ยังไม่ยุติ)`);
      continue;
    }
    candidates.push({
      teamId: thirdPlaceRow.teamId,
      teamName: thirdPlaceRow.teamName,
      teamCode: thirdPlaceRow.teamCode,
      groupId: group.groupId,
      groupCode: group.groupCode,
      rank: 3,
      points: thirdPlaceRow.points,
      goalDifference: thirdPlaceRow.goalDifference,
      goalsFor: thirdPlaceRow.goalsFor,
      fairPlayScore: thirdPlaceRow.fairPlayScore,
    });
  }

  return {
    candidates,
    isComplete: incompleteGroups.length === 0,
    incompleteReason: incompleteGroups.length > 0 ? `กลุ่มที่ยังไม่พร้อม: ${incompleteGroups.join(', ')}` : null,
  };
}

/**
 * Shared by both 'ranked' and 'draw' qualification methods: identifies the
 * pool of third-place teams eligible for cross-group qualification, from
 * already-computed, complete, tie-resolved group standings. Does NOT rank or
 * select among them — that is the caller's job, via a DIFFERENT function
 * depending on the category's method (see below).
 */
export function extractEligibleThirdPlaceCandidates(groupStandings: GroupStandingsResult[]): {
  candidates: CrossGroupCandidate[];
  isComplete: boolean;
  incompleteReason: string | null;
} {
  return extractThirdPlaceRows(groupStandings);
}

/**
 * D-07 general rule ('ranked' method categories only). Orders third-place
 * candidates by points → goal difference → goals for → Fair Play. Never
 * breaks a final tie itself — returns fullyResolved=false instead (D-07 step
 * 5, "จับฉลาก", is a physical/manual step, out of this engine's scope, same
 * as the group-stage tiebreak's 'lot' step).
 */
export function rankBestThirdPlacedTeams(candidates: CrossGroupCandidate[]): BestThirdPlacedRankingResult {
  const sorted = [...candidates].sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      b.fairPlayScore - a.fairPlayScore
  );

  // Fully resolved only if no two candidates anywhere in the ranking remain
  // completely tied on all four criteria.
  const anyFullTie = sorted.some((candidate, index) => {
    if (index === 0) return false;
    const prev = sorted[index - 1];
    return (
      candidate.points === prev.points &&
      candidate.goalDifference === prev.goalDifference &&
      candidate.goalsFor === prev.goalsFor &&
      candidate.fairPlayScore === prev.fairPlayScore
    );
  });

  const explanation = anyFullTie
    ? 'มีทีมเสมอกันทุกเกณฑ์ (คะแนน/ผลต่างประตู/ประตูได้/แฟร์เพลย์) ต้องจับฉลากตัดสิน'
    : 'จัดอันดับตามคะแนน → ผลต่างประตู → ประตูได้ → แฟร์เพลย์';

  return { ranked: sorted, fullyResolved: !anyFullTie, explanation };
}

/**
 * D-29 G-U16 override. Returns exactly the eligible third-place candidates
 * for the physical paper draw — never selects which 2 of the 3 advance. That
 * selection is recorded by an authorized admin via PR #7's manual
 * qualification-placeholder-assignment workflow (draw_selected placeholders),
 * never computed or randomized here.
 */
export function identifyG16ThirdPlaceCandidates(groupStandings: GroupStandingsResult[]): G16ThirdPlaceCandidatesResult {
  const { candidates, isComplete, incompleteReason } = extractThirdPlaceRows(groupStandings);

  if (isComplete && candidates.length !== 3) {
    return {
      candidates,
      isComplete: false,
      incompleteReason: `คาดว่าจะมี 3 กลุ่ม แต่พบทีมอันดับ 3 ที่ยุติแล้ว ${candidates.length} ทีม`,
    };
  }

  return { candidates, isComplete, incompleteReason };
}

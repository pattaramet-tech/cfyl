import {
  calculateMatchPoints,
  getSuspensionServingState,
  type CardCount,
} from './suspension-shared';

export interface PublicPlayerCardLike {
  match_id: string;
  card_type: string;
}

export interface PublicPlayerGoalLike {
  goals?: number | null;
  is_own_goal?: boolean | null;
}

export interface PublicPlayerSummary {
  goals: number;
  yellow: number;
  red: number;
  second_yellow: number;
  discipline_points: number;
}

function normalizeCardType(value: string): keyof CardCount | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'yellow' || normalized === 'red' || normalized === 'second_yellow') {
    return normalized;
  }
  return null;
}

/**
 * Public player totals use the same per-match CFYL discipline scoring helper as the
 * suspension engine. Own goals are excluded from player scoring totals.
 */
export function buildPublicPlayerSummary(
  cards: PublicPlayerCardLike[],
  goals: PublicPlayerGoalLike[]
): PublicPlayerSummary {
  const cardsByMatch = new Map<string, CardCount>();
  let yellow = 0;
  let red = 0;
  let secondYellow = 0;

  for (const card of cards) {
    const type = normalizeCardType(card.card_type);
    if (!type || !card.match_id) continue;
    const count = cardsByMatch.get(card.match_id) || { yellow: 0, red: 0, second_yellow: 0 };
    count[type] += 1;
    cardsByMatch.set(card.match_id, count);
    if (type === 'yellow') yellow += 1;
    if (type === 'red') red += 1;
    if (type === 'second_yellow') secondYellow += 1;
  }

  const disciplinePoints = Array.from(cardsByMatch.values()).reduce(
    (sum, count) => sum + calculateMatchPoints(count),
    0
  );
  const totalGoals = goals.reduce(
    (sum, goal) => sum + (goal.is_own_goal ? 0 : Math.max(0, Number(goal.goals || 0))),
    0
  );

  return {
    goals: totalGoals,
    yellow,
    red,
    second_yellow: secondYellow,
    discipline_points: disciplinePoints,
  };
}

export type PublicSuspensionHistoryStatus = 'active' | 'served' | 'no_next_match';

export function getPublicSuspensionHistoryStatus(
  suspension: {
    serving_match_ids?: string[] | null;
    suspended_from_match_id?: string | null;
    ban_matches?: number | null;
    served_completed_at?: string | null;
  },
  matchesById: Map<string, { status?: string | null }>
): PublicSuspensionHistoryStatus {
  if (suspension.served_completed_at) return 'served';
  const state = getSuspensionServingState(suspension, matchesById);
  if (state.isServed) return 'served';
  if (state.isActive) return 'active';
  return 'no_next_match';
}

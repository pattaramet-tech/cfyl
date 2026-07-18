import type { FairPlayEvent } from './types';

// D-06 (DECISION LOCKED 2026-07-14) Fair Play values — used ONLY for
// Standings tiebreak, never for Suspension (a separate card-count/type based
// rule set, out of scope here). Source: TOURNAMENT_V2_DECISION_CHECKLIST.md.
//
//   yellow card                          = -1
//   red card from a second yellow        = -3
//   direct red card                      = -4
//   yellow followed by a direct red      = -5
//
// "หนึ่งคนในหนึ่ง Match ถูกหักเฉพาะเหตุการณ์ที่รุนแรงที่สุดเพียงรายการเดียว"
// — one player in one match is deducted for exactly ONE value: the single
// most severe classification for that match, never a sum of multiple
// deductions. A team's Fair Play score is the sum of every player's
// single per-match deduction across the whole group stage.

export interface RawCardRow {
  matchId: string;
  playerId: string;
  teamId: string;
  cardType: 'yellow' | 'red' | 'second_yellow';
}

/** Classifies one player's cards within a single match into the single
 * most-severe D-06 event, per the schema convention: a genuine "second
 * yellow leading to sending-off" is recorded as card_type='second_yellow'
 * (not a second 'yellow' row — the unique(match_id, player_id, card_type)
 * constraint would reject that), so 'yellow' + 'red' together in the same
 * match represents two distinct incidents (an earlier caution, then a
 * separate direct red), matching the "yellow followed by direct red" tier. */
function classifyPlayerMatchEvent(cardTypes: Set<string>): number {
  const hasRed = cardTypes.has('red');
  const hasYellow = cardTypes.has('yellow');
  const hasSecondYellow = cardTypes.has('second_yellow');

  if (hasRed && hasYellow) return -5; // yellow then direct red
  if (hasRed) return -4; // direct red only
  if (hasSecondYellow) return -3; // second yellow (sending-off)
  if (hasYellow) return -1; // single yellow
  return 0;
}

/** Pure: groups raw card rows by (matchId, playerId), classifies each group
 * into its single D-06 event value, and returns one FairPlayEvent per
 * player-match. Deleted/superseded cards must already be excluded by the
 * caller (data-loading layer) before this function ever sees them. */
export function buildFairPlayEvents(cards: RawCardRow[]): FairPlayEvent[] {
  const byPlayerMatch = new Map<string, { matchId: string; playerId: string; types: Set<string> }>();

  for (const card of cards) {
    const key = `${card.matchId}|${card.playerId}`;
    const entry = byPlayerMatch.get(key) || { matchId: card.matchId, playerId: card.playerId, types: new Set<string>() };
    entry.types.add(card.cardType);
    byPlayerMatch.set(key, entry);
  }

  return Array.from(byPlayerMatch.values()).map((entry) => ({
    matchId: entry.matchId,
    playerId: entry.playerId,
    points: classifyPlayerMatchEvent(entry.types),
  }));
}

/** Pure: sums a team's total Fair Play score from raw card rows scoped to a
 * team (caller must pre-filter cards to matches within the relevant group /
 * eligible match scope). Lower (more negative) is worse; a team with fewer
 * total deductions (a less negative score) ranks better in the tiebreak. */
export function calculateFairPlayScore(cards: RawCardRow[], teamId: string): number {
  const teamCards = cards.filter((card) => card.teamId === teamId);
  const events = buildFairPlayEvents(teamCards);
  return events.reduce((sum, event) => sum + event.points, 0);
}

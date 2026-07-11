/**
 * Suspension Shared Module — pure, client-safe logic only.
 *
 * This module MUST NEVER:
 *   - create a Supabase client
 *   - read process.env
 *   - import a Node-only module
 *   - perform a database call
 *
 * lib/suspension-calc.ts creates a Supabase client (using SUPABASE_SERVICE_ROLE_KEY) at
 * module-evaluation time and throws if env vars are missing. That is safe for server-only
 * code (API routes), but importing ANY runtime value from it — even a single named export —
 * pulls the whole module (and its top-level throw) into any bundle that imports it. If a
 * 'use client' component does this, the throw executes in the browser (where the service-role
 * key is never defined) and crashes the page.
 *
 * Client Components must import runtime helpers ONLY from this file. Type-only imports
 * (`import type { ... }`) from suspension-calc.ts remain safe from either module, since they
 * are erased at compile time and never execute.
 */

export interface CardCount {
  yellow: number;
  red: number;
  second_yellow: number;
}

export interface PointSource {
  match_id: string;
  matchday: number;
  points: number;
  reason: string;
  points_before: number;
  points_after: number;
}

export interface SuspendedMatchDetail {
  match_id: string;
  matchday: number;
  match_date: string;
  match_time: string | null;
  match_code: string;
  opponent_name: string;
  opponent_id: string;
  is_home: boolean;
  status: string;
}

export interface SuspensionDetails {
  trigger_match_id: string;
  trigger_matchday: number;
  trigger_event: string;
  points_before: number;
  points_added: number;
  points_after: number;
  threshold_crossed: number;
  ban_matches_count: number;
  suspended_matches: SuspendedMatchDetail[];
}

/**
 * Parse matchday number from any format:
 * "MatchDay 2" → 2, "MD2" → 2, 2 → 2, "2" → 2
 */
export function parseMatchdayNumber(val: string | number | null | undefined): number {
  if (val == null) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const str = String(val).trim();
  const m = str.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * CFYL Point Scoring per match:
 * - 1 yellow = 2 pts
 * - 2 yellows (or 1 second_yellow) = 4 pts
 * - 1 red (direct) = 6 pts
 * - 1 yellow + 1 red = 8 pts
 */
export function calculateMatchPoints(cards: CardCount): number {
  const { yellow, red, second_yellow } = cards;
  const hasSecondYellow = second_yellow >= 1;
  const hasRed = red >= 1;

  // Yellow or 2nd-yellow + Red in same match = 8 pts
  if (hasRed && (yellow >= 1 || hasSecondYellow)) return 8;
  // Direct Red = 6 pts
  if (hasRed) return 6;
  // second_yellow = standalone "2nd yellow in match" = 4 pts
  if (hasSecondYellow) return 4;
  // Backward compat: 2 separate yellow records in same match = 4 pts
  if (yellow >= 2) return 4;
  // 1 yellow = 2 pts
  if (yellow >= 1) return 2;
  return 0;
}

/**
 * Check if a match has second_yellow or 2+ yellows = ejection via yellow card rule
 */
export function isSecondYellowEjection(cards: CardCount): boolean {
  return cards.second_yellow >= 1 || cards.yellow >= 2;
}

/**
 * Check if a match has direct red ejection
 */
export function isDirectRedEjection(cards: CardCount): boolean {
  return cards.red >= 1;
}

/**
 * Classify player's discipline event in a match
 * Returns suspension type, accumulated points, and ban matches for the event
 *
 * CRITICAL: Ejection events (second_yellow, direct_red, yellow_red) do NOT accumulate points
 * Only normal yellow cards accumulate points
 */
export type SuspensionType =
  | 'accumulated_points'
  | 'second_yellow'
  | 'direct_red'
  | 'yellow_red'
  | 'manual'
  | 'legacy';

export type DisciplineEventType =
  | 'normal_yellow_accumulation'
  | 'second_yellow_ejection'
  | 'direct_red_ejection'
  | 'yellow_red_ejection'
  | 'none';

export interface DisciplineEventClassification {
  eventType: DisciplineEventType;
  suspensionType: SuspensionType | null;
  accumulatedPointsFromThisMatch: number;
  ejectionBanMatches: number;
  sourceCardIds: string[];
  notes: string[];
}

/**
 * Determine if a suspension is active or served
 * Used to display correct status in admin/public pages
 */
export interface SuspensionServingState {
  servedCount: number;
  remainingCount: number;
  isActive: boolean;
  isServed: boolean;
}

export function getSuspensionServingState(
  suspension: any,
  matchesById: Map<string, any>
): SuspensionServingState {
  let servedCount = 0;
  let remainingCount = 0;

  // Use serving_match_ids if available (new format)
  if (suspension.serving_match_ids && Array.isArray(suspension.serving_match_ids)) {
    for (const matchId of suspension.serving_match_ids) {
      const match = matchesById.get(matchId);
      if (!match) {
        remainingCount++; // Unknown status = count as remaining
        continue;
      }

      if (match.status === 'finished') {
        servedCount++;
      } else if (match.status === 'scheduled') {
        remainingCount++;
      }
      // postponed/cancelled are not counted toward either
    }
  } else if (suspension.suspended_from_match_id) {
    // Fallback: legacy format using single suspended_from_match_id
    const match = matchesById.get(suspension.suspended_from_match_id);
    if (match) {
      if (match.status === 'finished') {
        servedCount = 1;
        remainingCount = Math.max(0, (suspension.ban_matches || 1) - 1);
      } else if (match.status === 'scheduled') {
        remainingCount = suspension.ban_matches || 1;
      }
    }
  }

  return {
    servedCount,
    remainingCount,
    isActive: remainingCount > 0,
    isServed: remainingCount === 0 && servedCount > 0,
  };
}

export function classifyPlayerMatchDiscipline(
  cardsData: CardCount
): DisciplineEventClassification {
  const { yellow, red, second_yellow } = cardsData;
  const yellowCount = yellow;
  const redCount = red;
  const secondYellowCount = second_yellow;

  // Classify event type (ejections take priority)
  let eventType: DisciplineEventType = 'none';
  let suspensionType: SuspensionType | null = null;
  let ejectionBanMatches = 0;

  if (redCount > 0 && (yellowCount > 0 || secondYellowCount > 0)) {
    // Yellow + Red in same match = yellow_red ejection
    eventType = 'yellow_red_ejection';
    suspensionType = 'yellow_red';
    ejectionBanMatches = 1;
  } else if (redCount > 0) {
    // Direct red ejection
    eventType = 'direct_red_ejection';
    suspensionType = 'direct_red';
    ejectionBanMatches = 1;
  } else if (secondYellowCount > 0 || yellowCount >= 2) {
    // Second yellow or 2+ yellows = second_yellow ejection
    eventType = 'second_yellow_ejection';
    suspensionType = 'second_yellow';
    ejectionBanMatches = 1;
  } else if (yellowCount > 0) {
    // Normal yellow accumulation (no ejection)
    eventType = 'normal_yellow_accumulation';
    suspensionType = 'accumulated_points';
  }

  // IMPORTANT: Ejection events do NOT accumulate points
  // Only normal yellow cards contribute to point accumulation
  const accumulatedPointsFromThisMatch =
    eventType === 'normal_yellow_accumulation' ? yellowCount * 2 : 0;

  const notes: string[] = [];
  if (eventType !== 'none' && ejectionBanMatches > 0) {
    notes.push(`Ejection event: ${eventType}, ban_matches=${ejectionBanMatches}`);
  }
  if (accumulatedPointsFromThisMatch > 0) {
    notes.push(`Accumulated points: ${accumulatedPointsFromThisMatch} from ${yellowCount} yellow(s)`);
  }

  return {
    eventType,
    suspensionType,
    accumulatedPointsFromThisMatch,
    ejectionBanMatches,
    sourceCardIds: [], // Card counts only, no individual IDs available
    notes,
  };
}

/**
 * Build the complete chronological normal-yellow-accumulation point history for a player.
 * Ejection matches (second_yellow/direct_red/yellow_red) contribute 0 points and are excluded —
 * only normal yellow cards accumulate points toward the ban thresholds.
 *
 * This is the single source of truth for point_sources: every suspension record created in a
 * given recalculation run (ejection or accumulated_points) stores this SAME full array, so the
 * point history is never lost and always reflects the player's current total, not a frozen
 * snapshot from the match that originally triggered a ban.
 */
export function buildNormalYellowPointHistory(
  seasonCards: Array<{ match_id: string; matchday: number; cards: CardCount; reason: string }>
): PointSource[] {
  const pointSources: PointSource[] = [];
  let cumulative = 0;
  for (const card of seasonCards) {
    const classification = classifyPlayerMatchDiscipline(card.cards);
    if (classification.eventType !== 'normal_yellow_accumulation') continue;

    const pointsBefore = cumulative;
    cumulative += classification.accumulatedPointsFromThisMatch;
    pointSources.push({
      match_id: card.match_id,
      matchday: card.matchday,
      points: classification.accumulatedPointsFromThisMatch,
      reason: card.reason,
      points_before: pointsBefore,
      points_after: cumulative,
    });
  }
  return pointSources;
}

/**
 * Build the complete chronological CFYL DISCIPLINARY point history for a player —
 * every carded match, using official CFYL point values, regardless of event type:
 *   normal yellow = 2, second yellow / two yellows = 4, direct red = 6, yellow+red = 8
 *
 * This is DISTINCT from buildNormalYellowPointHistory(), which excludes ejections and
 * exists solely to drive the accumulated-points BAN THRESHOLD (6/12/18/24). A direct red
 * must visibly score 6 CFYL points, but must NOT contribute those 6 points toward the
 * yellow-accumulation threshold — otherwise the player is punished twice for one card
 * (once by the ejection's own ban, again by an accumulated-points ban it should never
 * trigger). Never feed this history into getHighestThresholdCrossed()/threshold logic;
 * it exists purely for the visible score and the point-history table.
 */
export function buildDisciplinaryPointHistory(
  seasonCards: Array<{ match_id: string; matchday: number; cards: CardCount; reason: string }>
): PointSource[] {
  const pointSources: PointSource[] = [];
  let cumulative = 0;
  for (const card of seasonCards) {
    const points = calculateMatchPoints(card.cards);
    if (points === 0) continue;

    const pointsBefore = cumulative;
    cumulative += points;
    pointSources.push({
      match_id: card.match_id,
      matchday: card.matchday,
      points,
      reason: card.reason,
      points_before: pointsBefore,
      points_after: cumulative,
    });
  }
  return pointSources;
}

/**
 * A suspension record's `total_points` is a frozen snapshot taken when that specific
 * threshold/ejection was first triggered. The player's CURRENT visible CFYL disciplinary
 * score keeps moving as more cards arrive, and is only reflected in the latest entry of
 * `point_sources` (see buildDisciplinaryPointHistory). Admin and Public must both display
 * this current value — for every suspension_type, including ejections — not the frozen
 * trigger-time snapshot.
 */
export function getCurrentDisciplinaryPoints(record: {
  total_points?: number | null;
  point_sources?: Array<{ points_after: number }> | null;
}): number {
  const sources = record.point_sources;
  if (sources && sources.length > 0) {
    return sources[sources.length - 1].points_after;
  }
  return record.total_points ?? 0;
}

const EJECTION_SUSPENSION_TYPES = ['second_yellow', 'direct_red', 'yellow_red'] as const;

/** True for ejection-based suspension_type values (never for accumulated_points/legacy/manual). */
export function isEjectionSuspensionType(type: string | null | undefined): boolean {
  return !!type && (EJECTION_SUSPENSION_TYPES as readonly string[]).includes(type);
}

/** Thai display label for an ejection event, keyed by suspension_type. */
export function getEjectionEventLabel(suspensionType: string): string {
  switch (suspensionType) {
    case 'direct_red':
      return 'ใบแดงโดยตรง';
    case 'second_yellow':
      return 'ใบเหลืองที่สอง';
    case 'yellow_red':
      return 'ใบเหลือง + ใบแดง';
    default:
      return suspensionType;
  }
}

/**
 * Mark legacy (suspension_type null/'legacy') records as superseded when the same
 * player+team already has an event-based record. Event-based records are authoritative;
 * a superseded legacy record's suspended_from_match_id may be stale and must never be
 * treated as an active ban. Shared by Admin and Public so both apply identical rules.
 */
export function markSupersededLegacyRecords<
  T extends { player_id: string; team_id: string; suspension_type?: string | null }
>(records: T[]): Array<T & { _superseded: boolean }> {
  const SYSTEM_TYPES = ['accumulated_points', 'second_yellow', 'direct_red', 'yellow_red'];
  const playersWithEventRecords = new Set<string>();
  for (const r of records) {
    if (SYSTEM_TYPES.includes(r.suspension_type ?? '')) {
      playersWithEventRecords.add(`${r.player_id}::${r.team_id}`);
    }
  }
  return records.map((r) => ({
    ...r,
    _superseded:
      (r.suspension_type == null || r.suspension_type === 'legacy') &&
      playersWithEventRecords.has(`${r.player_id}::${r.team_id}`),
  }));
}

/**
 * CFYL Suspension Thresholds:
 * - 6 pts = 1 match ban
 * - 12 pts = 2 match ban
 * - 18 pts = 2 match ban
 * - 24 pts = 2 match ban
 */
export function calculateBanMatches(totalPoints: number): number {
  if (totalPoints >= 12) return 2;
  if (totalPoints >= 6) return 1;
  return 0;
}

export function getThresholdCrossed(totalPoints: number): number {
  if (totalPoints >= 24) return 24;
  if (totalPoints >= 18) return 18;
  if (totalPoints >= 12) return 12;
  if (totalPoints >= 6) return 6;
  return 0;
}

/**
 * Find highest threshold crossed in a single point change
 * Used to create only one accumulated_points suspension per match
 * even if multiple thresholds are crossed
 *
 * Example: before=4, after=12 → return 12 (not 6)
 */
export function getHighestThresholdCrossed(pointsBefore: number, pointsAfter: number): number {
  if (pointsBefore < 24 && pointsAfter >= 24) return 24;
  if (pointsBefore < 18 && pointsAfter >= 18) return 18;
  if (pointsBefore < 12 && pointsAfter >= 12) return 12;
  if (pointsBefore < 6 && pointsAfter >= 6) return 6;
  return 0;
}

/**
 * Pure: given a list of existing system-generated events and a set of desired event keys,
 * return the IDs of events that are no longer needed (stale).
 * Never receives legacy or manual records — the caller's DB query filters those out.
 */
export function computeStaleEventIds(
  existingSystemEvents: Array<{
    id: string;
    trigger_match_id: string | null;
    suspension_type: string | null;
    accumulated_threshold: number | null;
  }>,
  desiredKeys: Set<string>
): string[] {
  return existingSystemEvents
    .filter((e) => {
      const key = `${e.trigger_match_id}::${e.suspension_type}::${e.accumulated_threshold ?? 0}`;
      return !desiredKeys.has(key);
    })
    .map((e) => e.id);
}

export function getTriggerEventText(reason: string, points: number): string {
  if (reason.includes('R') && reason.includes('Y')) return `ใบเหลือง + ใบแดง (${points} คะแนน)`;
  if (reason.includes('R')) return `ใบแดงโดยตรง (${points} คะแนน)`;
  const yMatch = reason.match(/^(\d+)Y$/);
  if (yMatch && parseInt(yMatch[1]) >= 2) return `ใบเหลือง ${yMatch[1]} ใบ (${points} คะแนน)`;
  return `ใบเหลือง 1 ใบ (${points} คะแนน)`;
}

/**
 * Check if a match is eligible to be counted as a suspension-serving match.
 * Finished matches count as served slots; scheduled matches count as remaining slots.
 * Postponed/cancelled matches are skipped — they do not consume a ban slot.
 *
 * Key invariant: a finished chronological match must never be skipped merely because
 * recalculation runs after the match has already been played.
 */
export function isEligibleSuspensionServingMatch(match: any): boolean {
  return match?.status === 'scheduled' || match?.status === 'finished';
}

const EVENT_SUSPENSION_TYPES = [
  'accumulated_points',
  'second_yellow',
  'direct_red',
  'yellow_red',
] as const;

/**
 * Determine whether a suspension record makes a player "actively suspended"
 * for a specific match, when that match has the given status.
 *
 * Decision rules:
 *
 * Event-based records (suspension_type IN system types):
 *   1. If served_completed_at is set → fully served, never active.
 *   2. serving_match_ids is the SOLE source of truth.
 *   3. A serving slot is "active" only when the match is still SCHEDULED.
 *      A FINISHED slot means the player already served their ban for that match;
 *      it must not re-appear as "currently suspended".
 *   4. suspended_from_match_id and suspension_details are NOT consulted.
 *
 * Legacy / null / manual records:
 *   Use the original fallback order: suspended_from_match_id, then
 *   suspension_details.suspended_matches.
 *
 * @param suspension          A suspension DB row with all event fields populated.
 * @param matchId             The match ID being checked.
 * @param currentMatchStatus  Status of that match ('scheduled'|'finished'|etc.).
 */
export function isSuspendedForMatch(
  suspension: any,
  matchId: string,
  currentMatchStatus: string
): boolean {
  const type: string | null = suspension.suspension_type ?? null;
  const isEventBased =
    type !== null &&
    (EVENT_SUSPENSION_TYPES as readonly string[]).includes(type);

  if (isEventBased) {
    // Fully served → never active
    if (suspension.served_completed_at != null) return false;

    // serving_match_ids is the only source of truth for event-based records
    const servingIds: string[] = Array.isArray(suspension.serving_match_ids)
      ? suspension.serving_match_ids
      : [];
    if (!servingIds.includes(matchId)) return false;

    // Active only for SCHEDULED matches.
    // A FINISHED match in serving_match_ids is a served slot, not an active ban.
    return currentMatchStatus === 'scheduled';
  }

  // Legacy (suspension_type IS NULL or 'legacy') or manual:
  // use the original fallback order.
  if (suspension.suspended_from_match_id === matchId) return true;
  const suspendedMatches = suspension.suspension_details?.suspended_matches;
  if (Array.isArray(suspendedMatches)) {
    return suspendedMatches.some((m: any) => m.match_id === matchId);
  }
  return false;
}

/**
 * Pure helper: classify current serving match IDs into served / active / stale.
 * Exported for unit testing.
 */
export function classifyServingMatchIds(
  servingMatchIds: string[],
  matchStatuses: Map<string, string>
): { servedIds: string[]; activeIds: string[]; staleIds: string[] } {
  const servedIds: string[] = [];
  const activeIds: string[] = [];
  const staleIds: string[] = [];
  for (const id of servingMatchIds) {
    const status = matchStatuses.get(id);
    if (status === 'finished') servedIds.push(id);
    else if (status === 'scheduled') activeIds.push(id);
    else staleIds.push(id); // postponed, cancelled, or not in DB
  }
  return { servedIds, activeIds, staleIds };
}

/**
 * Pure helper: are two string arrays identical (length + element-by-element)?
 */
export function servingArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

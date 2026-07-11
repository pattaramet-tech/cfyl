/**
 * Pure search + sort logic for the Admin Suspension Management table.
 *
 * Client-safe: imports only from suspension-shared and suspension-status, neither of
 * which creates a Supabase client or reads process.env. See suspension-shared.ts's
 * header comment for why that distinction matters — this file must stay pure too.
 */

import { getCurrentDisciplinaryPoints } from './suspension-shared';
import { getSuspensionStatus, type SuspensionStatusKey } from './suspension-status';

export interface SuspendedMatchLike {
  match_id: string;
  matchday: number;
  match_date: string;
  match_time: string | null;
  status: string;
}

export interface SuspensionTableRecord {
  id: string;
  total_points: number;
  ban_matches: number;
  point_sources?: Array<{ points_after: number }> | null;
  suspension_details?: { suspended_matches?: SuspendedMatchLike[] | null } | null;
  player?: { full_name?: string | null; player_code?: string | null; shirt_no?: number | null } | null;
  team?: { name?: string | null; short_name?: string | null } | null;
}

export type SuspensionSortColumn =
  | 'name'
  | 'team'
  | 'shirt_no'
  | 'points'
  | 'ban'
  | 'suspended_match'
  | 'status';

export type SortDirection = 'asc' | 'desc';

/**
 * Normalize search input: Unicode-normalize (NFKC, important for Thai combining
 * marks), trim, collapse repeated whitespace, lowercase. Case-insensitive and
 * whitespace-insensitive by construction.
 */
export function normalizeSearchText(input: string): string {
  return input.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * True when `record` matches the (already-typed, not-yet-normalized) search query
 * across player name/code/shirt number, team name/short name, current disciplinary
 * points, suspended-match MD numbers, and the localized suspension status text.
 * Empty/whitespace-only query always matches (no-op filter).
 */
export function matchesSuspensionSearch(
  record: SuspensionTableRecord,
  query: string,
  today: string
): boolean {
  const q = normalizeSearchText(query);
  if (!q) return true;

  const currentPoints = getCurrentDisciplinaryPoints(record);
  const status = getSuspensionStatus(record, today);
  const suspendedMdTokens = (record.suspension_details?.suspended_matches ?? []).map(
    (m) => `md${m.matchday}`
  );

  const haystack = [
    record.player?.full_name,
    record.player?.player_code,
    record.player?.shirt_no != null ? String(record.player.shirt_no) : null,
    record.team?.name,
    record.team?.short_name,
    String(currentPoints),
    ...suspendedMdTokens,
    status.label,
    status.key,
  ]
    .filter((v): v is string => !!v)
    .map(normalizeSearchText)
    .join(' ');

  return haystack.includes(q);
}

function fullName(record: SuspensionTableRecord): string {
  return record.player?.full_name ?? '';
}

function playerCode(record: SuspensionTableRecord): string {
  return record.player?.player_code ?? '';
}

function teamName(record: SuspensionTableRecord): string {
  return record.team?.name ?? '';
}

/** Remaining (scheduled, not-yet-served) ban slots — never `ban_matches > 0` alone. */
function remainingBanCount(record: SuspensionTableRecord): number {
  const matches = record.suspension_details?.suspended_matches ?? [];
  return matches.filter((m) => m.status === 'scheduled').length;
}

interface SuspendedMatchSortKey {
  priority: number; // 0 = has a scheduled remaining match, 1 = finished/served only, 2 = none assigned
  date: string;
  time: string;
  matchday: number;
}

/**
 * Representative serving-match sort key: prefers the earliest still-scheduled ban
 * slot (most actionable), falls back to a finished slot, falls back to "none".
 */
function suspendedMatchSortKey(record: SuspensionTableRecord): SuspendedMatchSortKey {
  const matches = record.suspension_details?.suspended_matches ?? [];
  const scheduled = matches.find((m) => m.status === 'scheduled');
  const finished = matches.find((m) => m.status === 'finished');
  const rep = scheduled ?? finished ?? null;
  return {
    priority: scheduled ? 0 : finished ? 1 : 2,
    date: rep?.match_date ?? '',
    time: rep?.match_time ?? '',
    matchday: rep?.matchday ?? 0,
  };
}

/** Ascending comparator by actual serving-match chronology (date → time → matchday), never MD alone. */
function compareBySuspendedMatchKey(a: SuspensionTableRecord, b: SuspensionTableRecord): number {
  const ka = suspendedMatchSortKey(a);
  const kb = suspendedMatchSortKey(b);
  if (ka.priority !== kb.priority) return ka.priority - kb.priority;
  if (ka.date !== kb.date) return ka.date.localeCompare(kb.date);
  if (ka.time !== kb.time) return ka.time.localeCompare(kb.time);
  if (ka.matchday !== kb.matchday) return ka.matchday - kb.matchday;
  return fullName(a).localeCompare(fullName(b), 'th');
}

/** Status priority for the explicit Status COLUMN sort (active is most urgent on its own). */
function statusColumnPriority(key: SuspensionStatusKey): number {
  switch (key) {
    case 'active':
      return 0;
    case 'no_next_match':
      return 1;
    case 'pending':
    case 'warning':
      return 2;
    case 'served':
      return 3;
    case 'normal':
    default:
      return 4;
  }
}

/** Status priority for the DEFAULT table order — pending and active are both "currently suspended". */
function defaultStatusPriority(key: SuspensionStatusKey): number {
  switch (key) {
    case 'active':
    case 'pending':
      return 0; // Currently suspended
    case 'no_next_match':
      return 1; // No next match / needs attention
    case 'warning':
      return 2; // Accumulated-point warning
    case 'served':
      return 3;
    case 'normal':
    default:
      return 4;
  }
}

/** Ascending base comparator for a single column, before direction is applied. */
function baseCompare(
  column: SuspensionSortColumn,
  a: SuspensionTableRecord,
  b: SuspensionTableRecord,
  today: string
): number {
  switch (column) {
    case 'name': {
      const cmp = fullName(a).localeCompare(fullName(b), 'th');
      return cmp !== 0 ? cmp : playerCode(a).localeCompare(playerCode(b));
    }
    case 'team': {
      const cmp = teamName(a).localeCompare(teamName(b), 'th');
      return cmp !== 0 ? cmp : fullName(a).localeCompare(fullName(b), 'th');
    }
    case 'points': {
      const diff = getCurrentDisciplinaryPoints(a) - getCurrentDisciplinaryPoints(b);
      return diff !== 0 ? diff : fullName(a).localeCompare(fullName(b), 'th');
    }
    case 'ban': {
      const remaining = remainingBanCount(a) - remainingBanCount(b);
      if (remaining !== 0) return remaining;
      const total = a.ban_matches - b.ban_matches;
      if (total !== 0) return total;
      return fullName(a).localeCompare(fullName(b), 'th');
    }
    case 'suspended_match':
      return compareBySuspendedMatchKey(a, b);
    case 'status': {
      const pa = statusColumnPriority(getSuspensionStatus(a, today).key);
      const pb = statusColumnPriority(getSuspensionStatus(b, today).key);
      if (pa !== pb) return pa - pb;
      const pts = getCurrentDisciplinaryPoints(b) - getCurrentDisciplinaryPoints(a); // DESC
      if (pts !== 0) return pts;
      return fullName(a).localeCompare(fullName(b), 'th');
    }
    case 'shirt_no': {
      // handled separately in compareSuspensionRecords — null must stay last in both directions
      return 0;
    }
    default:
      return 0;
  }
}

/**
 * Full comparator for a clicked column header, honoring direction.
 * shirt_no is special-cased: null values always sort last, in both ascending and
 * descending order — reversing the whole comparator would otherwise put them first.
 */
export function compareSuspensionRecords(
  a: SuspensionTableRecord,
  b: SuspensionTableRecord,
  column: SuspensionSortColumn,
  direction: SortDirection,
  today: string
): number {
  if (column === 'shirt_no') {
    const aVal = a.player?.shirt_no ?? null;
    const bVal = b.player?.shirt_no ?? null;
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    return direction === 'asc' ? aVal - bVal : bVal - aVal;
  }
  const base = baseCompare(column, a, b, today);
  return direction === 'asc' ? base : -base;
}

/**
 * Default table order (no column explicitly selected): currently suspended first,
 * then no-next-match, then warning, then served, then normal. Within a tier: next
 * serving date ascending, then current disciplinary points descending, then name.
 */
export function compareSuspensionRecordsDefault(
  a: SuspensionTableRecord,
  b: SuspensionTableRecord,
  today: string
): number {
  const pa = defaultStatusPriority(getSuspensionStatus(a, today).key);
  const pb = defaultStatusPriority(getSuspensionStatus(b, today).key);
  if (pa !== pb) return pa - pb;

  const matchCmp = compareBySuspendedMatchKey(a, b);
  if (matchCmp !== 0) return matchCmp;

  const pts = getCurrentDisciplinaryPoints(b) - getCurrentDisciplinaryPoints(a); // DESC
  if (pts !== 0) return pts;

  return fullName(a).localeCompare(fullName(b), 'th');
}

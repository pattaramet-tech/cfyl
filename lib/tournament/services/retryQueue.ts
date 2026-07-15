// Client-side Quick Result retry queue for weak-network conditions (Phase 5b,
// Stage A). Each queued submission carries a stable idempotency key generated
// once, at Preview→Submit time — retries always reuse that same key, so a
// flaky network can never cause a duplicate server-side submission (the
// server-side uniqueness on (match_id, stage, idempotency_key) is the actual
// guarantee; this queue is what makes retrying safe to attempt at all).

export type RetryQueueItemStatus = 'waiting' | 'retrying' | 'success' | 'failed';

export interface RetryQueueItem {
  idempotencyKey: string;
  matchId: string;
  tournamentId: string;
  venueId: string;
  homeScore: number;
  awayScore: number;
  expectedVersion: number;
  status: RetryQueueItemStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

const STORAGE_KEY = 'tournament_v2_quick_result_retry_queue';

function readQueue(): RetryQueueItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RetryQueueItem[];
  } catch {
    return [];
  }
}

function writeQueue(items: RetryQueueItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // best-effort
  }
}

/** Enqueue a submission. Reuses the item if the same idempotencyKey is already queued. */
export function enqueueRetry(item: Omit<RetryQueueItem, 'status' | 'attempts' | 'lastError' | 'createdAt'>): RetryQueueItem[] {
  const queue = readQueue();
  const existingIndex = queue.findIndex((entry) => entry.idempotencyKey === item.idempotencyKey);
  const next: RetryQueueItem = {
    ...item,
    status: 'waiting',
    attempts: existingIndex >= 0 ? queue[existingIndex].attempts : 0,
    lastError: null,
    createdAt: existingIndex >= 0 ? queue[existingIndex].createdAt : new Date().toISOString(),
  };
  const updated = existingIndex >= 0 ? [...queue.slice(0, existingIndex), next, ...queue.slice(existingIndex + 1)] : [...queue, next];
  writeQueue(updated);
  return updated;
}

export function markRetrying(idempotencyKey: string): RetryQueueItem[] {
  const queue = readQueue();
  const updated = queue.map((entry) =>
    entry.idempotencyKey === idempotencyKey ? { ...entry, status: 'retrying' as const, attempts: entry.attempts + 1 } : entry
  );
  writeQueue(updated);
  return updated;
}

export function markSuccess(idempotencyKey: string): RetryQueueItem[] {
  const queue = readQueue().filter((entry) => entry.idempotencyKey !== idempotencyKey);
  writeQueue(queue);
  return queue;
}

export function markFailed(idempotencyKey: string, error: string): RetryQueueItem[] {
  const queue = readQueue();
  const updated = queue.map((entry) =>
    entry.idempotencyKey === idempotencyKey ? { ...entry, status: 'failed' as const, lastError: error } : entry
  );
  writeQueue(updated);
  return updated;
}

/** User-initiated cancel — only safe while the item hasn't succeeded server-side. */
export function cancelQueuedRetry(idempotencyKey: string): RetryQueueItem[] {
  const queue = readQueue().filter((entry) => entry.idempotencyKey !== idempotencyKey || entry.status === 'success');
  writeQueue(queue);
  return queue;
}

export function getRetryQueue(): RetryQueueItem[] {
  return readQueue();
}

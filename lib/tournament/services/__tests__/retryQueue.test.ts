import { beforeEach, describe, expect, it } from 'vitest';
import { cancelQueuedRetry, enqueueRetry, getRetryQueue, markFailed, markRetrying, markSuccess } from '../retryQueue';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

beforeEach(() => {
  (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window = {
    localStorage: new MemoryStorage(),
  };
});

const baseItem = {
  idempotencyKey: 'idem-1',
  matchId: 'match-1',
  tournamentId: 'tour-1',
  venueId: 'venue-1',
  homeScore: 2,
  awayScore: 1,
  expectedVersion: 3,
  previewToken: 'payload.signature',
};

describe('retryQueue', () => {
  it('enqueues a submission for retry', () => {
    const queue = enqueueRetry(baseItem);
    expect(queue).toHaveLength(1);
    expect(queue[0].status).toBe('waiting');
  });

  it('preserves the original preview token together with the payload and idempotency key', () => {
    const queue = enqueueRetry(baseItem);
    expect(queue[0].previewToken).toBe('payload.signature');
    expect(queue[0].idempotencyKey).toBe('idem-1');
    expect(queue[0].homeScore).toBe(2);
    expect(queue[0].awayScore).toBe(1);
  });

  it('reuses the same idempotency key when re-enqueued instead of duplicating', () => {
    enqueueRetry(baseItem);
    const queue = enqueueRetry(baseItem);
    expect(queue).toHaveLength(1);
    expect(queue.filter((item) => item.idempotencyKey === 'idem-1')).toHaveLength(1);
  });

  it('tracks retrying -> success transition and removes the item on success', () => {
    enqueueRetry(baseItem);
    markRetrying('idem-1');
    expect(getRetryQueue()[0].status).toBe('retrying');
    expect(getRetryQueue()[0].attempts).toBe(1);

    const afterSuccess = markSuccess('idem-1');
    expect(afterSuccess).toHaveLength(0);
  });

  it('tracks a permanent failure distinctly from waiting/retrying', () => {
    enqueueRetry(baseItem);
    const failed = markFailed('idem-1', 'network_error');
    expect(failed[0].status).toBe('failed');
    expect(failed[0].lastError).toBe('network_error');
  });

  it('allows the user to cancel a queued (not-yet-successful) retry', () => {
    enqueueRetry(baseItem);
    const afterCancel = cancelQueuedRetry('idem-1');
    expect(afterCancel).toHaveLength(0);
  });
});

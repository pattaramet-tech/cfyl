import { beforeEach, describe, expect, it } from 'vitest';
import { clearLocalDraft, loadLocalDraft, saveLocalDraft } from '../localDraft';

// Minimal localStorage polyfill for the Node test environment (no jsdom in
// this repo). Scoped to this file only.
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
  clear(): void {
    this.store.clear();
  }
}

beforeEach(() => {
  (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window = {
    localStorage: new MemoryStorage(),
  };
});

describe('localDraft', () => {
  it('persists and restores a draft for the same match', () => {
    saveLocalDraft({
      tournamentId: 'tour-1',
      venueId: 'venue-1',
      matchId: 'match-1',
      homeScore: '2',
      awayScore: '1',
      matchVersion: 3,
      savedAt: '2026-08-01T00:00:00Z',
    });

    const restored = loadLocalDraft('tour-1', 'venue-1', 'match-1');
    expect(restored?.homeScore).toBe('2');
    expect(restored?.awayScore).toBe('1');
  });

  it('does not leak a draft into a different match', () => {
    saveLocalDraft({
      tournamentId: 'tour-1',
      venueId: 'venue-1',
      matchId: 'match-1',
      homeScore: '2',
      awayScore: '1',
      matchVersion: 3,
      savedAt: '2026-08-01T00:00:00Z',
    });

    expect(loadLocalDraft('tour-1', 'venue-1', 'match-2')).toBeNull();
    expect(loadLocalDraft('tour-1', 'venue-OTHER', 'match-1')).toBeNull();
  });

  it('clears a draft after successful submission', () => {
    saveLocalDraft({
      tournamentId: 'tour-1',
      venueId: 'venue-1',
      matchId: 'match-1',
      homeScore: '2',
      awayScore: '1',
      matchVersion: 3,
      savedAt: '2026-08-01T00:00:00Z',
    });
    clearLocalDraft('tour-1', 'venue-1', 'match-1');
    expect(loadLocalDraft('tour-1', 'venue-1', 'match-1')).toBeNull();
  });

  it('returns null when no draft exists', () => {
    expect(loadLocalDraft('tour-x', 'venue-x', 'match-x')).toBeNull();
  });
});

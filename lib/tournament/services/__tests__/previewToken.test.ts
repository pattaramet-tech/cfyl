import { beforeEach, describe, expect, it, vi } from 'vitest';
import { issuePreviewToken, verifyPreviewToken, QUICK_RESULT_PREVIEW_TOKEN_TTL_MS } from '../previewToken';

const baseClaims = {
  tournamentId: 'tour-1',
  matchId: 'match-1',
  venueId: 'venue-1',
  homeScore: 2,
  awayScore: 1,
  matchVersion: 3,
  actorUserId: 'operator-1',
};

describe('previewToken', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
  });

  it('issues a token that verifies successfully with matching claims', () => {
    const issued = issuePreviewToken(baseClaims);
    const result = verifyPreviewToken(issued.token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.tournamentId).toBe('tour-1');
      expect(result.claims.matchId).toBe('match-1');
      expect(result.claims.homeScore).toBe(2);
      expect(result.claims.awayScore).toBe(1);
      expect(result.claims.matchVersion).toBe(3);
      expect(result.claims.actorUserId).toBe('operator-1');
      expect(result.claims.purpose).toBe('quick_result_preview_v1');
    }
  });

  it('sets expiresAt roughly TTL milliseconds from now', () => {
    const before = Date.now();
    const issued = issuePreviewToken(baseClaims);
    const expiresAtMs = new Date(issued.expiresAt).getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + QUICK_RESULT_PREVIEW_TOKEN_TTL_MS - 1000);
    expect(expiresAtMs).toBeLessThanOrEqual(before + QUICK_RESULT_PREVIEW_TOKEN_TTL_MS + 1000);
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const issued = issuePreviewToken(baseClaims);
    const [payload, signature] = issued.token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    decoded.homeScore = 99; // tamper
    const tamperedPayload = Buffer.from(JSON.stringify(decoded), 'utf-8').toString('base64url');
    const tamperedToken = `${tamperedPayload}.${signature}`;

    const result = verifyPreviewToken(tamperedToken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('QUICK_RESULT_PREVIEW_INVALID');
  });

  it('rejects a malformed token (wrong shape)', () => {
    expect(verifyPreviewToken('not-a-valid-token').ok).toBe(false);
    expect(verifyPreviewToken('').ok).toBe(false);
    expect(verifyPreviewToken('a.b.c').ok).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const issued = issuePreviewToken(baseClaims);
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'a-different-secret';
    const result = verifyPreviewToken(issued.token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('QUICK_RESULT_PREVIEW_INVALID');
  });

  it('rejects an expired token', () => {
    vi.useFakeTimers();
    try {
      const issued = issuePreviewToken(baseClaims);
      vi.advanceTimersByTime(QUICK_RESULT_PREVIEW_TOKEN_TTL_MS + 1000);
      const result = verifyPreviewToken(issued.token);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('QUICK_RESULT_PREVIEW_EXPIRED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts a token right up until expiry', () => {
    vi.useFakeTimers();
    try {
      const issued = issuePreviewToken(baseClaims);
      vi.advanceTimersByTime(QUICK_RESULT_PREVIEW_TOKEN_TTL_MS - 1000);
      const result = verifyPreviewToken(issued.token);
      expect(result.ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

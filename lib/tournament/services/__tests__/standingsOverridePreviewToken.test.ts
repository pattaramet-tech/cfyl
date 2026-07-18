import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hashStandingsOverrideBeforeState,
  hashStandingsOverrideText,
  issueStandingsOverridePreviewToken,
  STANDINGS_OVERRIDE_PREVIEW_TOKEN_TTL_MS,
  verifyStandingsOverridePreviewToken,
} from '../standingsOverridePreviewToken';

const baseClaims = {
  tournamentId: 'tour-1',
  groupId: 'group-a',
  teamId: 'team-1',
  overrideRank: 1,
  reasonHash: hashStandingsOverrideText('คำสั่งกรรมการกลาง'),
  actorUserId: 'admin-1',
  beforeStateHash: hashStandingsOverrideBeforeState(null),
};

describe('standingsOverridePreviewToken', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
  });

  it('issues a token that verifies successfully with matching claims', () => {
    const issued = issueStandingsOverridePreviewToken(baseClaims);
    const result = verifyStandingsOverridePreviewToken(issued.token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.tournamentId).toBe('tour-1');
      expect(result.claims.groupId).toBe('group-a');
      expect(result.claims.teamId).toBe('team-1');
      expect(result.claims.overrideRank).toBe(1);
      expect(result.claims.purpose).toBe('standings_override_preview_v1');
    }
  });

  it('sets expiresAt roughly TTL milliseconds from now', () => {
    const before = Date.now();
    const issued = issueStandingsOverridePreviewToken(baseClaims);
    const expiresAtMs = new Date(issued.expiresAt).getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + STANDINGS_OVERRIDE_PREVIEW_TOKEN_TTL_MS - 1000);
    expect(expiresAtMs).toBeLessThanOrEqual(before + STANDINGS_OVERRIDE_PREVIEW_TOKEN_TTL_MS + 1000);
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const issued = issueStandingsOverridePreviewToken(baseClaims);
    const [payload, signature] = issued.token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    decoded.overrideRank = 99; // tamper
    const tamperedPayload = Buffer.from(JSON.stringify(decoded), 'utf-8').toString('base64url');
    const tamperedToken = `${tamperedPayload}.${signature}`;

    const result = verifyStandingsOverridePreviewToken(tamperedToken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('STANDINGS_OVERRIDE_PREVIEW_INVALID');
  });

  it('rejects a malformed token', () => {
    expect(verifyStandingsOverridePreviewToken('not-a-valid-token').ok).toBe(false);
    expect(verifyStandingsOverridePreviewToken('').ok).toBe(false);
    expect(verifyStandingsOverridePreviewToken('a.b.c').ok).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const issued = issueStandingsOverridePreviewToken(baseClaims);
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'a-different-secret';
    const result = verifyStandingsOverridePreviewToken(issued.token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('STANDINGS_OVERRIDE_PREVIEW_INVALID');
  });

  it('rejects an expired token', () => {
    vi.useFakeTimers();
    try {
      const issued = issueStandingsOverridePreviewToken(baseClaims);
      vi.advanceTimersByTime(STANDINGS_OVERRIDE_PREVIEW_TOKEN_TTL_MS + 1000);
      const result = verifyStandingsOverridePreviewToken(issued.token);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('STANDINGS_OVERRIDE_PREVIEW_EXPIRED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts a token right up until expiry', () => {
    vi.useFakeTimers();
    try {
      const issued = issueStandingsOverridePreviewToken(baseClaims);
      vi.advanceTimersByTime(STANDINGS_OVERRIDE_PREVIEW_TOKEN_TTL_MS - 1000);
      const result = verifyStandingsOverridePreviewToken(issued.token);
      expect(result.ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hashStandingsOverrideBeforeState is stable for the same state and different for different states', () => {
    const a = hashStandingsOverrideBeforeState({ overrideRank: 1, reason: 'x' });
    const b = hashStandingsOverrideBeforeState({ overrideRank: 1, reason: 'x' });
    const c = hashStandingsOverrideBeforeState({ overrideRank: 2, reason: 'x' });
    const none1 = hashStandingsOverrideBeforeState(null);
    const none2 = hashStandingsOverrideBeforeState(null);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(none1).toBe(none2);
    expect(a).not.toBe(none1);
  });
});

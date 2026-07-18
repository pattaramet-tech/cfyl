import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FULL_REPORT_PREVIEW_TOKEN_TTL_MS,
  hashFullReportPayload,
  issueFullReportPreviewToken,
  verifyFullReportPreviewToken,
} from '../fullReportPreviewToken';

const baseClaims = {
  tournamentId: 'tour-1',
  matchId: 'match-1',
  venueId: 'venue-1',
  actorUserId: 'operator-1',
  expectedMatchVersion: 1,
  payloadHash: hashFullReportPayload('{"regulationHomeScore":2}'),
  quickResultComparisonHash: null,
};

describe('fullReportPreviewToken', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
  });

  it('issues a token that verifies successfully with matching claims', () => {
    const issued = issueFullReportPreviewToken(baseClaims);
    const result = verifyFullReportPreviewToken(issued.token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.tournamentId).toBe('tour-1');
      expect(result.claims.matchId).toBe('match-1');
      expect(result.claims.expectedMatchVersion).toBe(1);
      expect(result.claims.purpose).toBe('full_match_report_preview_v1');
    }
  });

  it('sets expiresAt roughly TTL milliseconds from now', () => {
    const before = Date.now();
    const issued = issueFullReportPreviewToken(baseClaims);
    const expiresAtMs = new Date(issued.expiresAt).getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + FULL_REPORT_PREVIEW_TOKEN_TTL_MS - 1000);
    expect(expiresAtMs).toBeLessThanOrEqual(before + FULL_REPORT_PREVIEW_TOKEN_TTL_MS + 1000);
  });

  it('rejects a tampered payload', () => {
    const issued = issueFullReportPreviewToken(baseClaims);
    const [payload, signature] = issued.token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    decoded.expectedMatchVersion = 99;
    const tamperedPayload = Buffer.from(JSON.stringify(decoded), 'utf-8').toString('base64url');
    const tamperedToken = `${tamperedPayload}.${signature}`;

    const result = verifyFullReportPreviewToken(tamperedToken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FULL_REPORT_PREVIEW_INVALID');
  });

  it('rejects a malformed token', () => {
    expect(verifyFullReportPreviewToken('not-a-valid-token').ok).toBe(false);
    expect(verifyFullReportPreviewToken('').ok).toBe(false);
  });

  it('rejects an expired token', () => {
    vi.useFakeTimers();
    try {
      const issued = issueFullReportPreviewToken(baseClaims);
      vi.advanceTimersByTime(FULL_REPORT_PREVIEW_TOKEN_TTL_MS + 1000);
      const result = verifyFullReportPreviewToken(issued.token);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('FULL_REPORT_PREVIEW_EXPIRED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('hashFullReportPayload is stable for identical input and differs for different input', () => {
    const a = hashFullReportPayload('{"x":1}');
    const b = hashFullReportPayload('{"x":1}');
    const c = hashFullReportPayload('{"x":2}');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

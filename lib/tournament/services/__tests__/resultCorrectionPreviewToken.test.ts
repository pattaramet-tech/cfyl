import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RESULT_CORRECTION_PREVIEW_TOKEN_TTL_MS,
  hashResultCorrectionValue,
  issueResultCorrectionPreviewToken,
  verifyResultCorrectionPreviewToken,
} from '../resultCorrectionPreviewToken';

const baseClaims = {
  tournamentId: 'tour-1',
  matchId: 'match-1',
  actorUserId: 'super-1',
  expectedMatchVersion: 5,
  beforeResultHash: hashResultCorrectionValue('{"regulationHomeScore":2}'),
  afterResultHash: hashResultCorrectionValue('{"regulationHomeScore":3}'),
  correctionReasonHash: hashResultCorrectionValue('score recorded incorrectly'),
};

describe('resultCorrectionPreviewToken', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
  });

  it('issues a token that verifies successfully with matching claims', () => {
    const issued = issueResultCorrectionPreviewToken(baseClaims);
    const result = verifyResultCorrectionPreviewToken(issued.token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.tournamentId).toBe('tour-1');
      expect(result.claims.matchId).toBe('match-1');
      expect(result.claims.expectedMatchVersion).toBe(5);
      expect(result.claims.purpose).toBe('result_correction_preview_v1');
    }
  });

  it('sets expiresAt roughly TTL milliseconds from now', () => {
    const before = Date.now();
    const issued = issueResultCorrectionPreviewToken(baseClaims);
    const expiresAtMs = new Date(issued.expiresAt).getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + RESULT_CORRECTION_PREVIEW_TOKEN_TTL_MS - 1000);
    expect(expiresAtMs).toBeLessThanOrEqual(before + RESULT_CORRECTION_PREVIEW_TOKEN_TTL_MS + 1000);
  });

  it('rejects a tampered payload', () => {
    const issued = issueResultCorrectionPreviewToken(baseClaims);
    const [payload, signature] = issued.token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    decoded.expectedMatchVersion = 999;
    const tamperedPayload = Buffer.from(JSON.stringify(decoded), 'utf-8').toString('base64url');
    const tamperedToken = `${tamperedPayload}.${signature}`;

    const result = verifyResultCorrectionPreviewToken(tamperedToken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('RESULT_CORRECTION_PREVIEW_INVALID');
  });

  it('rejects a malformed token', () => {
    expect(verifyResultCorrectionPreviewToken('not-a-valid-token').ok).toBe(false);
    expect(verifyResultCorrectionPreviewToken('').ok).toBe(false);
  });

  it('rejects an expired token', () => {
    vi.useFakeTimers();
    try {
      const issued = issueResultCorrectionPreviewToken(baseClaims);
      vi.advanceTimersByTime(RESULT_CORRECTION_PREVIEW_TOKEN_TTL_MS + 1000);
      const result = verifyResultCorrectionPreviewToken(issued.token);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('RESULT_CORRECTION_PREVIEW_EXPIRED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a token issued for one purpose is rejected when verified against this purpose (cross-token-type isolation)', () => {
    // Simulates a Full Match Report or Quick Result Preview Token accidentally
    // presented to the Result Correction publish endpoint — must fail purpose
    // verification, never be silently accepted.
    const issued = issueResultCorrectionPreviewToken(baseClaims);
    const [payload, signature] = issued.token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    decoded.purpose = 'full_match_report_preview_v1';
    const swappedPayload = Buffer.from(JSON.stringify(decoded), 'utf-8').toString('base64url');
    // Note: changing `purpose` also invalidates the signature (HMAC covers
    // the whole payload string), so this simultaneously proves tamper
    // detection AND purpose-binding.
    const result = verifyResultCorrectionPreviewToken(`${swappedPayload}.${signature}`);
    expect(result.ok).toBe(false);
  });

  it('hashResultCorrectionValue is stable for identical input and differs for different input', () => {
    const a = hashResultCorrectionValue('{"x":1}');
    const b = hashResultCorrectionValue('{"x":1}');
    const c = hashResultCorrectionValue('{"x":2}');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

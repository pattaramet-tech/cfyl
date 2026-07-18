import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QUALIFICATION_CUTOFF_DRAW_PREVIEW_TOKEN_TTL_MS,
  hashQualificationCutoffDrawValue,
  issueQualificationCutoffDrawPreviewToken,
  verifyQualificationCutoffDrawPreviewToken,
} from '../qualificationCutoffDrawPreviewToken';

const baseClaims = {
  tournamentId: 'tour-1',
  categoryId: 'cat-1',
  groupId: 'group-a',
  actorUserId: 'super-1',
  expectedActiveDrawId: null,
  candidateSnapshot: 'v1|slots=1|candidates=team-b,team-c',
  selectedTeamIdsHash: hashQualificationCutoffDrawValue('team-b'),
};

describe('qualificationCutoffDrawPreviewToken', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
  });

  it('issues a token that verifies successfully with matching claims', () => {
    const issued = issueQualificationCutoffDrawPreviewToken(baseClaims);
    const result = verifyQualificationCutoffDrawPreviewToken(issued.token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.groupId).toBe('group-a');
      expect(result.claims.purpose).toBe('qualification_cutoff_draw_preview_v1');
    }
  });

  it('sets expiresAt roughly TTL milliseconds from now', () => {
    const before = Date.now();
    const issued = issueQualificationCutoffDrawPreviewToken(baseClaims);
    const expiresAtMs = new Date(issued.expiresAt).getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + QUALIFICATION_CUTOFF_DRAW_PREVIEW_TOKEN_TTL_MS - 1000);
    expect(expiresAtMs).toBeLessThanOrEqual(before + QUALIFICATION_CUTOFF_DRAW_PREVIEW_TOKEN_TTL_MS + 1000);
  });

  it('39. rejects an expired token', () => {
    vi.useFakeTimers();
    try {
      const issued = issueQualificationCutoffDrawPreviewToken(baseClaims);
      vi.advanceTimersByTime(QUALIFICATION_CUTOFF_DRAW_PREVIEW_TOKEN_TTL_MS + 1000);
      const result = verifyQualificationCutoffDrawPreviewToken(issued.token);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('QUALIFICATION_CUTOFF_DRAW_PREVIEW_EXPIRED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('38. rejects a tampered payload', () => {
    const issued = issueQualificationCutoffDrawPreviewToken(baseClaims);
    const [payload, signature] = issued.token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    decoded.candidateSnapshot = 'v1|slots=1|candidates=tampered';
    const tamperedPayload = Buffer.from(JSON.stringify(decoded), 'utf-8').toString('base64url');
    const result = verifyQualificationCutoffDrawPreviewToken(`${tamperedPayload}.${signature}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('QUALIFICATION_CUTOFF_DRAW_PREVIEW_INVALID');
  });

  it('rejects a malformed token', () => {
    expect(verifyQualificationCutoffDrawPreviewToken('not-a-valid-token').ok).toBe(false);
    expect(verifyQualificationCutoffDrawPreviewToken('').ok).toBe(false);
  });

  it('hashQualificationCutoffDrawValue is stable for identical input and differs for different input', () => {
    const a = hashQualificationCutoffDrawValue('team-b');
    const b = hashQualificationCutoffDrawValue('team-b');
    const c = hashQualificationCutoffDrawValue('team-c');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

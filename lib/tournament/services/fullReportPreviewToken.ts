import { createHash } from 'crypto';
import { issueSignedToken, verifySignedToken, type SignedTokenBase } from './signedToken';

// Server-signed, stateless proof that a Full Match Report Preview actually
// happened before Publish — same pattern as PR #9's Quick Result Preview
// Token and PR #10's Standings Override Preview Token, built on the shared
// HMAC helper in signedToken.ts. Publish is rejected without a valid token
// bound to the exact tournament/match/venue/actor/version/payload that was
// previewed; any change after Preview invalidates the token (via the
// payload hash) and forces a fresh Preview.

export const FULL_REPORT_PREVIEW_TOKEN_PURPOSE = 'full_match_report_preview_v1';

// 15 minutes, matching the Quick Result and Standings Override Preview Tokens.
export const FULL_REPORT_PREVIEW_TOKEN_TTL_MS = 15 * 60 * 1000;

const SECRET_ENV_VAR = 'TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET';

/** Stable hash of the canonical Full Report payload (scores, winner,
 * decided_by, goals, cards, report text) — bound into the token so any edit
 * after Preview invalidates it. Canonicalization (stable key order, no
 * incidental whitespace differences) is the caller's responsibility (see
 * buildCanonicalFullReportPayload in fullMatchReport.ts). */
export function hashFullReportPayload(canonicalPayloadJson: string): string {
  return createHash('sha256').update(canonicalPayloadJson, 'utf-8').digest('hex');
}

export interface FullReportPreviewClaims extends SignedTokenBase {
  purpose: typeof FULL_REPORT_PREVIEW_TOKEN_PURPOSE;
  tournamentId: string;
  matchId: string;
  venueId: string | null;
  actorUserId: string | null;
  expectedMatchVersion: number;
  payloadHash: string;
  /** Hash/version of the latest Quick Result submission compared during
   * Preview, or null when no Quick Result exists for this match — bound so
   * a Quick Result submitted between Preview and Publish forces a fresh
   * Preview (the comparison shown to the operator must still be accurate). */
  quickResultComparisonHash: string | null;
}

export type IssueFullReportPreviewTokenParams = Omit<FullReportPreviewClaims, 'purpose' | 'issuedAt' | 'expiresAt'>;

export interface IssuedFullReportPreviewToken {
  token: string;
  expiresAt: string;
}

export function issueFullReportPreviewToken(
  claims: IssueFullReportPreviewTokenParams
): IssuedFullReportPreviewToken {
  return issueSignedToken<FullReportPreviewClaims>({
    claims: { ...claims, purpose: FULL_REPORT_PREVIEW_TOKEN_PURPOSE },
    ttlMs: FULL_REPORT_PREVIEW_TOKEN_TTL_MS,
    secretEnvVar: SECRET_ENV_VAR,
  });
}

export type FullReportPreviewTokenVerificationCode = 'FULL_REPORT_PREVIEW_INVALID' | 'FULL_REPORT_PREVIEW_EXPIRED';

export type FullReportPreviewTokenVerification =
  | { ok: true; claims: FullReportPreviewClaims }
  | { ok: false; code: FullReportPreviewTokenVerificationCode };

/** Verifies signature, purpose, and expiry only. Callers must separately
 * compare claims against the live request (see FULL_REPORT_PREVIEW_MISMATCH
 * in fullMatchReport.ts). */
export function verifyFullReportPreviewToken(token: string): FullReportPreviewTokenVerification {
  const result = verifySignedToken<FullReportPreviewClaims>({
    token,
    purpose: FULL_REPORT_PREVIEW_TOKEN_PURPOSE,
    secretEnvVar: SECRET_ENV_VAR,
  });
  if (result.ok) return result;
  return {
    ok: false,
    code: result.code === 'EXPIRED' ? 'FULL_REPORT_PREVIEW_EXPIRED' : 'FULL_REPORT_PREVIEW_INVALID',
  };
}

import { createHash } from 'crypto';
import { issueSignedToken, verifySignedToken, type SignedTokenBase } from './signedToken';

// Server-signed, stateless proof that a Result Correction Preview actually
// happened before Publish — same pattern as PR #9/#10/#11's Preview Tokens,
// built on the shared HMAC helper in signedToken.ts. Correction is rejected
// without a valid token bound to the exact tournament/match/actor/version and
// the exact before/after result + reason that were previewed; any change
// after Preview invalidates the token (via the hashes) and forces a fresh
// Preview.

export const RESULT_CORRECTION_PREVIEW_TOKEN_PURPOSE = 'result_correction_preview_v1';

// 15 minutes, matching every other Tournament V2 Preview Token.
export const RESULT_CORRECTION_PREVIEW_TOKEN_TTL_MS = 15 * 60 * 1000;

const SECRET_ENV_VAR = 'TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET';

/** Stable hash of a canonical result-correction payload (before or after
 * result, or the correction reason) — bound into the token so any edit after
 * Preview invalidates it. Canonicalization (stable key order) is the
 * caller's responsibility. */
export function hashResultCorrectionValue(canonicalJson: string): string {
  return createHash('sha256').update(canonicalJson, 'utf-8').digest('hex');
}

export interface ResultCorrectionPreviewClaims extends SignedTokenBase {
  purpose: typeof RESULT_CORRECTION_PREVIEW_TOKEN_PURPOSE;
  tournamentId: string;
  matchId: string;
  actorUserId: string | null;
  expectedMatchVersion: number;
  /** Hash of the official result as it stood immediately before correction
   * (regulation/penalty scores, decided_by, winner_team_id, result_type) —
   * bound so a race that changes the published result between Preview and
   * Publish forces a fresh Preview. */
  beforeResultHash: string;
  /** Hash of the proposed corrected result. */
  afterResultHash: string;
  /** Hash of the correction reason text. */
  correctionReasonHash: string;
}

export type IssueResultCorrectionPreviewTokenParams = Omit<
  ResultCorrectionPreviewClaims,
  'purpose' | 'issuedAt' | 'expiresAt'
>;

export interface IssuedResultCorrectionPreviewToken {
  token: string;
  expiresAt: string;
}

export function issueResultCorrectionPreviewToken(
  claims: IssueResultCorrectionPreviewTokenParams
): IssuedResultCorrectionPreviewToken {
  return issueSignedToken<ResultCorrectionPreviewClaims>({
    claims: { ...claims, purpose: RESULT_CORRECTION_PREVIEW_TOKEN_PURPOSE },
    ttlMs: RESULT_CORRECTION_PREVIEW_TOKEN_TTL_MS,
    secretEnvVar: SECRET_ENV_VAR,
  });
}

export type ResultCorrectionPreviewTokenVerificationCode = 'RESULT_CORRECTION_PREVIEW_INVALID' | 'RESULT_CORRECTION_PREVIEW_EXPIRED';

export type ResultCorrectionPreviewTokenVerification =
  | { ok: true; claims: ResultCorrectionPreviewClaims }
  | { ok: false; code: ResultCorrectionPreviewTokenVerificationCode };

/** Verifies signature, purpose, and expiry only. Callers must separately
 * compare claims against the live request (see RESULT_CORRECTION_PREVIEW_MISMATCH
 * in resultCorrection.ts). */
export function verifyResultCorrectionPreviewToken(token: string): ResultCorrectionPreviewTokenVerification {
  const result = verifySignedToken<ResultCorrectionPreviewClaims>({
    token,
    purpose: RESULT_CORRECTION_PREVIEW_TOKEN_PURPOSE,
    secretEnvVar: SECRET_ENV_VAR,
  });
  if (result.ok) return result;
  return {
    ok: false,
    code: result.code === 'EXPIRED' ? 'RESULT_CORRECTION_PREVIEW_EXPIRED' : 'RESULT_CORRECTION_PREVIEW_INVALID',
  };
}

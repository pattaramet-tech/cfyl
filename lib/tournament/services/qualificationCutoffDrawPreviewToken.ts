import { createHash } from 'crypto';
import { issueSignedToken, verifySignedToken, type SignedTokenBase } from './signedToken';

// Server-signed, stateless proof that a Qualification Cutoff Tie Draw
// Preview actually happened before Save (D-30) — same pattern as every
// other Tournament V2 Preview Token, built on the shared HMAC helper in
// signedToken.ts. Save is rejected without a valid token bound to the
// exact tournament/category/group/actor/expected-active-draw/candidate-pool/
// selection that was previewed; any change after Preview (including a Score
// Correction that alters the candidate pool) invalidates the token and
// forces a fresh Preview.

export const QUALIFICATION_CUTOFF_DRAW_PREVIEW_TOKEN_PURPOSE = 'qualification_cutoff_draw_preview_v1';

// 15 minutes, matching every other Tournament V2 Preview Token.
export const QUALIFICATION_CUTOFF_DRAW_PREVIEW_TOKEN_TTL_MS = 15 * 60 * 1000;

const SECRET_ENV_VAR = 'TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET';

export function hashQualificationCutoffDrawValue(canonicalValue: string): string {
  return createHash('sha256').update(canonicalValue, 'utf-8').digest('hex');
}

export interface QualificationCutoffDrawPreviewClaims extends SignedTokenBase {
  purpose: typeof QUALIFICATION_CUTOFF_DRAW_PREVIEW_TOKEN_PURPOSE;
  tournamentId: string;
  categoryId: string;
  groupId: string;
  actorUserId: string | null;
  /** The active (non-superseded) draw id this Preview was computed against,
   * or null when no draw has ever been recorded for this group yet. */
  expectedActiveDrawId: string | null;
  /** Deterministic fingerprint of the tied candidate pool at Preview time —
   * see resolveQualificationCutoff.ts buildCandidateSnapshot(). Any change
   * to official results between Preview and Save changes this value. */
  candidateSnapshot: string;
  /** Hash of the exact proposed selection (sorted, comma-joined team ids) —
   * so editing the selection after Preview forces a fresh Preview. */
  selectedTeamIdsHash: string;
}

export type IssueQualificationCutoffDrawPreviewTokenParams = Omit<
  QualificationCutoffDrawPreviewClaims,
  'purpose' | 'issuedAt' | 'expiresAt'
>;

export interface IssuedQualificationCutoffDrawPreviewToken {
  token: string;
  expiresAt: string;
}

export function issueQualificationCutoffDrawPreviewToken(
  claims: IssueQualificationCutoffDrawPreviewTokenParams
): IssuedQualificationCutoffDrawPreviewToken {
  return issueSignedToken<QualificationCutoffDrawPreviewClaims>({
    claims: { ...claims, purpose: QUALIFICATION_CUTOFF_DRAW_PREVIEW_TOKEN_PURPOSE },
    ttlMs: QUALIFICATION_CUTOFF_DRAW_PREVIEW_TOKEN_TTL_MS,
    secretEnvVar: SECRET_ENV_VAR,
  });
}

export type QualificationCutoffDrawPreviewTokenVerificationCode =
  | 'QUALIFICATION_CUTOFF_DRAW_PREVIEW_INVALID'
  | 'QUALIFICATION_CUTOFF_DRAW_PREVIEW_EXPIRED';

export type QualificationCutoffDrawPreviewTokenVerification =
  | { ok: true; claims: QualificationCutoffDrawPreviewClaims }
  | { ok: false; code: QualificationCutoffDrawPreviewTokenVerificationCode };

/** Verifies signature, purpose, and expiry only. Callers must separately
 * compare claims against the live request. */
export function verifyQualificationCutoffDrawPreviewToken(token: string): QualificationCutoffDrawPreviewTokenVerification {
  const result = verifySignedToken<QualificationCutoffDrawPreviewClaims>({
    token,
    purpose: QUALIFICATION_CUTOFF_DRAW_PREVIEW_TOKEN_PURPOSE,
    secretEnvVar: SECRET_ENV_VAR,
  });
  if (result.ok) return result;
  return {
    ok: false,
    code: result.code === 'EXPIRED' ? 'QUALIFICATION_CUTOFF_DRAW_PREVIEW_EXPIRED' : 'QUALIFICATION_CUTOFF_DRAW_PREVIEW_INVALID',
  };
}

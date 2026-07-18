import { createHash } from 'crypto';
import { issueSignedToken, verifySignedToken, type SignedTokenBase } from './signedToken';

// Server-signed, stateless proof that a Manual Standings Override Preview
// actually happened before Save — same pattern as the Quick Result Preview
// Token (PR #9), built on the shared HMAC helper in signedToken.ts. Closes
// the gap where a caller could POST an override straight to Save without
// ever calling Preview, and additionally binds a hash of the override's
// pre-Preview state so a Save is rejected if the row changed underneath the
// operator between Preview and Save (see beforeStateHash below).

export const STANDINGS_OVERRIDE_PREVIEW_TOKEN_PURPOSE = 'standings_override_preview_v1';

// 15 minutes, matching the Quick Result Preview Token TTL.
export const STANDINGS_OVERRIDE_PREVIEW_TOKEN_TTL_MS = 15 * 60 * 1000;

const SECRET_ENV_VAR = 'TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET';

/** Stable, order-independent hash of free-text/JSON state — used for both
 * the reason (so it isn't embedded verbatim in a bearer token that may end
 * up in logs) and the pre-Preview override row snapshot. */
export function hashStandingsOverrideText(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

export interface StandingsOverrideBeforeState {
  overrideRank: number;
  reason: string;
}

export function hashStandingsOverrideBeforeState(before: StandingsOverrideBeforeState | null): string {
  if (!before) return hashStandingsOverrideText('none');
  return hashStandingsOverrideText(JSON.stringify({ overrideRank: before.overrideRank, reason: before.reason }));
}

export interface StandingsOverridePreviewClaims extends SignedTokenBase {
  purpose: typeof STANDINGS_OVERRIDE_PREVIEW_TOKEN_PURPOSE;
  tournamentId: string;
  groupId: string;
  teamId: string;
  overrideRank: number;
  reasonHash: string;
  actorUserId: string | null;
  beforeStateHash: string;
}

export type IssueStandingsOverridePreviewTokenParams = Omit<
  StandingsOverridePreviewClaims,
  'purpose' | 'issuedAt' | 'expiresAt'
>;

export interface IssuedStandingsOverridePreviewToken {
  token: string;
  expiresAt: string;
}

export function issueStandingsOverridePreviewToken(
  claims: IssueStandingsOverridePreviewTokenParams
): IssuedStandingsOverridePreviewToken {
  return issueSignedToken<StandingsOverridePreviewClaims>({
    claims: { ...claims, purpose: STANDINGS_OVERRIDE_PREVIEW_TOKEN_PURPOSE },
    ttlMs: STANDINGS_OVERRIDE_PREVIEW_TOKEN_TTL_MS,
    secretEnvVar: SECRET_ENV_VAR,
  });
}

export type StandingsOverridePreviewTokenVerificationCode =
  | 'STANDINGS_OVERRIDE_PREVIEW_INVALID'
  | 'STANDINGS_OVERRIDE_PREVIEW_EXPIRED';

export type StandingsOverridePreviewTokenVerification =
  | { ok: true; claims: StandingsOverridePreviewClaims }
  | { ok: false; code: StandingsOverridePreviewTokenVerificationCode };

/** Verifies signature, purpose, and expiry only. Callers must separately
 * compare claims against the live request (see STANDINGS_OVERRIDE_PREVIEW_MISMATCH
 * and STANDINGS_OVERRIDE_STATE_CHANGED in the standings admin route). */
export function verifyStandingsOverridePreviewToken(token: string): StandingsOverridePreviewTokenVerification {
  const result = verifySignedToken<StandingsOverridePreviewClaims>({
    token,
    purpose: STANDINGS_OVERRIDE_PREVIEW_TOKEN_PURPOSE,
    secretEnvVar: SECRET_ENV_VAR,
  });
  if (result.ok) return result;
  return {
    ok: false,
    code: result.code === 'EXPIRED' ? 'STANDINGS_OVERRIDE_PREVIEW_EXPIRED' : 'STANDINGS_OVERRIDE_PREVIEW_INVALID',
  };
}

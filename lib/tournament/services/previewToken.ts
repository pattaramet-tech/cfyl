import { issueSignedToken, verifySignedToken, type SignedTokenBase } from './signedToken';

// Server-signed, stateless proof that a Quick Result Preview actually
// happened before Submit — closes the gap where a caller could send
// `expected_version`/`idempotency_key` directly to Submit without ever
// calling Preview. Built on the generic HMAC helper in signedToken.ts (see
// that file — this module is now a thin, purpose-specific wrapper so other
// features, e.g. the Standings Override Preview Token, can reuse the same
// signing primitive instead of re-implementing HMAC signing/verification).
//
// No database migration: the token is entirely self-contained (base64url
// payload + HMAC-SHA256 signature), verified server-side on every Submit.
//
// Secret is read lazily inside issue/verify — never at module load — so a
// missing TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET cannot break unrelated
// build-time page compilation (mirrors the lazy-read pattern already used by
// getTournamentServiceClient()/getTournamentClient(), as opposed to
// lib/tournament/services/auth.ts's top-level throw for League env vars).

export const QUICK_RESULT_PREVIEW_TOKEN_PURPOSE = 'quick_result_preview_v1';

// 15 minutes: long enough for a Result-entry operator to review the Preview
// screen at the venue, short enough that a stale token is unlikely to still
// carry a valid (non-conflicting) match version by the time it's used.
export const QUICK_RESULT_PREVIEW_TOKEN_TTL_MS = 15 * 60 * 1000;

const SECRET_ENV_VAR = 'TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET';

export interface PreviewTokenClaims extends SignedTokenBase {
  purpose: typeof QUICK_RESULT_PREVIEW_TOKEN_PURPOSE;
  tournamentId: string;
  matchId: string;
  venueId: string | null;
  homeScore: number;
  awayScore: number;
  matchVersion: number;
  actorUserId: string | null;
}

export type IssuePreviewTokenParams = Omit<PreviewTokenClaims, 'purpose' | 'issuedAt' | 'expiresAt'>;

export interface IssuedPreviewToken {
  token: string;
  expiresAt: string;
}

export function issuePreviewToken(claims: IssuePreviewTokenParams): IssuedPreviewToken {
  return issueSignedToken<PreviewTokenClaims>({
    claims: { ...claims, purpose: QUICK_RESULT_PREVIEW_TOKEN_PURPOSE },
    ttlMs: QUICK_RESULT_PREVIEW_TOKEN_TTL_MS,
    secretEnvVar: SECRET_ENV_VAR,
  });
}

export type PreviewTokenVerificationCode = 'QUICK_RESULT_PREVIEW_INVALID' | 'QUICK_RESULT_PREVIEW_EXPIRED';

export type PreviewTokenVerification =
  | { ok: true; claims: PreviewTokenClaims }
  | { ok: false; code: PreviewTokenVerificationCode };

/** Verifies signature, purpose, and expiry only. Does not check that the
 * claims match a particular request — callers must do that comparison
 * themselves against the live request (see QUICK_RESULT_PREVIEW_MISMATCH in
 * lib/tournament/services/quickResult.ts). */
export function verifyPreviewToken(token: string): PreviewTokenVerification {
  const result = verifySignedToken<PreviewTokenClaims>({
    token,
    purpose: QUICK_RESULT_PREVIEW_TOKEN_PURPOSE,
    secretEnvVar: SECRET_ENV_VAR,
  });
  if (result.ok) return result;
  return {
    ok: false,
    code: result.code === 'EXPIRED' ? 'QUICK_RESULT_PREVIEW_EXPIRED' : 'QUICK_RESULT_PREVIEW_INVALID',
  };
}

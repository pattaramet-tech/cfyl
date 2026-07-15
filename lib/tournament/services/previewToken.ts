import { createHmac, timingSafeEqual } from 'crypto';

// Server-signed, stateless proof that a Quick Result Preview actually
// happened before Submit — closes the gap where a caller could send
// `expected_version`/`idempotency_key` directly to Submit without ever
// calling Preview. No existing signing helper was found in the repo (only
// Supabase JWT verification via auth.getUser(), which is a different
// mechanism entirely), so this is a new, narrowly-scoped HMAC token.
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

export interface PreviewTokenClaims {
  purpose: typeof QUICK_RESULT_PREVIEW_TOKEN_PURPOSE;
  tournamentId: string;
  matchId: string;
  venueId: string | null;
  homeScore: number;
  awayScore: number;
  matchVersion: number;
  actorUserId: string | null;
  issuedAt: number;
  expiresAt: number;
}

export type IssuePreviewTokenParams = Omit<PreviewTokenClaims, 'purpose' | 'issuedAt' | 'expiresAt'>;

export interface IssuedPreviewToken {
  token: string;
  expiresAt: string;
}

function getSecret(): string {
  const secret = process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET;
  if (!secret) {
    throw new Error('[QUICK_RESULT_PREVIEW] Missing TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET');
  }
  return secret;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function issuePreviewToken(claims: IssuePreviewTokenParams): IssuedPreviewToken {
  const now = Date.now();
  const full: PreviewTokenClaims = {
    ...claims,
    purpose: QUICK_RESULT_PREVIEW_TOKEN_PURPOSE,
    issuedAt: now,
    expiresAt: now + QUICK_RESULT_PREVIEW_TOKEN_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(full), 'utf-8').toString('base64url');
  const signature = sign(payload, getSecret());
  return { token: `${payload}.${signature}`, expiresAt: new Date(full.expiresAt).toISOString() };
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
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, code: 'QUICK_RESULT_PREVIEW_INVALID' };
  }
  const [payload, signature] = parts;

  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return { ok: false, code: 'QUICK_RESULT_PREVIEW_INVALID' };
  }

  const expectedSignature = sign(payload, secret);
  const providedBuffer = Buffer.from(signature, 'utf-8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf-8');
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    return { ok: false, code: 'QUICK_RESULT_PREVIEW_INVALID' };
  }

  let claims: PreviewTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as PreviewTokenClaims;
  } catch {
    return { ok: false, code: 'QUICK_RESULT_PREVIEW_INVALID' };
  }

  if (claims.purpose !== QUICK_RESULT_PREVIEW_TOKEN_PURPOSE) {
    return { ok: false, code: 'QUICK_RESULT_PREVIEW_INVALID' };
  }
  if (Date.now() > claims.expiresAt) {
    return { ok: false, code: 'QUICK_RESULT_PREVIEW_EXPIRED' };
  }

  return { ok: true, claims };
}

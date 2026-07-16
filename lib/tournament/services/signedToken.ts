import { createHmac, timingSafeEqual } from 'crypto';

// Generic server-only HMAC token signing/verification, extracted from the
// Quick Result Preview Token (PR #9, lib/tournament/services/previewToken.ts)
// so that other server-signed "prove this step actually happened" tokens
// (e.g. the Standings Override Preview Token) can reuse the same primitive
// instead of re-implementing HMAC signing. Never used client-side — the
// secret is read from a server-only env var and never shipped to the client.
//
// Wire format is unchanged from the original previewToken.ts implementation:
// base64url(JSON of the full claims object, including purpose/issuedAt/
// expiresAt inline) + "." + base64url(HMAC-SHA256 signature). No database
// storage — the token is entirely self-contained and stateless.

export interface SignedTokenBase {
  purpose: string;
  issuedAt: number;
  expiresAt: number;
}

export interface IssuedSignedToken {
  token: string;
  expiresAt: string;
}

export type SignedTokenVerificationCode = 'INVALID' | 'EXPIRED';

export type SignedTokenVerification<TClaims extends SignedTokenBase> =
  | { ok: true; claims: TClaims }
  | { ok: false; code: SignedTokenVerificationCode };

function getSecret(envVar: string): string {
  const secret = process.env[envVar];
  if (!secret) {
    throw new Error(`[SIGNED_TOKEN] Missing ${envVar}`);
  }
  return secret;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** `claims` must already include `purpose`; `issuedAt`/`expiresAt` are stamped here. */
export function issueSignedToken<TClaims extends SignedTokenBase>(params: {
  claims: Omit<TClaims, 'issuedAt' | 'expiresAt'>;
  ttlMs: number;
  secretEnvVar: string;
}): IssuedSignedToken {
  const now = Date.now();
  const full = { ...params.claims, issuedAt: now, expiresAt: now + params.ttlMs } as TClaims;
  const payload = Buffer.from(JSON.stringify(full), 'utf-8').toString('base64url');
  const signature = sign(payload, getSecret(params.secretEnvVar));
  return { token: `${payload}.${signature}`, expiresAt: new Date(full.expiresAt).toISOString() };
}

/** Verifies signature, purpose, and expiry only — callers must separately
 * compare claims against the live request (see the *_MISMATCH error codes
 * in quickResult.ts and the standings override route). */
export function verifySignedToken<TClaims extends SignedTokenBase>(params: {
  token: string;
  purpose: string;
  secretEnvVar: string;
}): SignedTokenVerification<TClaims> {
  const parts = params.token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, code: 'INVALID' };
  }
  const [payload, signature] = parts;

  let secret: string;
  try {
    secret = getSecret(params.secretEnvVar);
  } catch {
    return { ok: false, code: 'INVALID' };
  }

  const expectedSignature = sign(payload, secret);
  const providedBuffer = Buffer.from(signature, 'utf-8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf-8');
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    return { ok: false, code: 'INVALID' };
  }

  let claims: TClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as TClaims;
  } catch {
    return { ok: false, code: 'INVALID' };
  }

  if (claims.purpose !== params.purpose) {
    return { ok: false, code: 'INVALID' };
  }
  if (Date.now() > claims.expiresAt) {
    return { ok: false, code: 'EXPIRED' };
  }

  return { ok: true, claims };
}

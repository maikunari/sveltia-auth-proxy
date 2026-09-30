// Pure helpers for the auth flow. Kept free of Hono and Worker bindings so
// they can be unit-tested with `node --test`.

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

// Split a comma- or newline-separated config value into trimmed entries.
export function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function isEmailAllowed(email: string, allowedEmails: string | undefined): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return parseList(allowedEmails).some((allowed) => allowed.toLowerCase() === normalized);
}

// Returns the redirect URI if its origin is on the allow-list, otherwise null.
// This stops the proxy from handing the GitHub token to an arbitrary site.
export function validateRedirectUri(
  redirectUri: string | undefined,
  allowedOrigins: string | undefined,
): string | null {
  if (!redirectUri) return null;
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const allowed = parseList(allowedOrigins).map((origin) => origin.replace(/\/+$/, '').toLowerCase());
  if (!allowed.includes(url.origin.toLowerCase())) return null;
  url.hash = '';
  return url.toString();
}

export type GoogleIdTokenClaims = {
  iss?: string;
  aud?: string;
  exp?: number;
  email?: string;
  email_verified?: boolean | string;
};

export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
  } catch {
    return null;
  }
}

// Validates the claims of an ID token received directly from Google's token
// endpoint over TLS (OpenID Connect Core 3.1.3.7 allows skipping the signature
// check in that case). Returns the verified email or an error message.
export function verifyGoogleIdTokenClaims(
  claims: GoogleIdTokenClaims | null,
  clientId: string,
  nowMs: number,
): { email: string } | { error: string } {
  if (!claims) return { error: 'Google returned an unreadable ID token' };
  if (!claims.iss || !GOOGLE_ISSUERS.includes(claims.iss)) return { error: 'ID token has the wrong issuer' };
  if (claims.aud !== clientId) return { error: 'ID token was issued for a different client' };
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= nowMs) return { error: 'ID token has expired' };
  if (typeof claims.email !== 'string' || !claims.email) return { error: 'Google did not return an email address' };
  if (claims.email_verified !== true && claims.email_verified !== 'true') {
    return { error: 'Google has not verified this email address' };
  }
  return { email: claims.email };
}

// Parses GitHub's `github-authentication-token-expiration` response header,
// e.g. "2026-12-31 23:59:59 UTC" or "2026-12-31 15:59:59 -0800".
export function parseGitHubTokenExpiration(header: string | null): number | null {
  if (!header) return null;
  const match = header.trim().match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (UTC|[+-]\d{4})$/);
  if (!match) return null;
  const [, date, time, zone] = match;
  const offset = zone === 'UTC' ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const ms = Date.parse(`${date}T${time}${offset}`);
  return Number.isNaN(ms) ? null : ms;
}

// Seconds until the token expires, or null when it has no known expiry.
export function secondsUntil(expiresAtMs: number | null, nowMs: number): number | null {
  if (expiresAtMs === null) return null;
  return Math.max(0, Math.floor((expiresAtMs - nowMs) / 1000));
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function randomToken(byteLength = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

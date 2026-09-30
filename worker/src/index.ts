import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  base64UrlDecode,
  base64UrlEncode,
  decodeJwtPayload,
  escapeHtml,
  isEmailAllowed,
  parseGitHubTokenExpiration,
  pkceChallenge,
  randomToken,
  secondsUntil,
  validateRedirectUri,
  verifyGoogleIdTokenClaims,
  type GoogleIdTokenClaims,
} from './auth.ts';

export type Bindings = {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  // Comma-separated emails allowed to sign in, e.g. "editor@example.com,seo@example.com"
  ALLOWED_EMAILS: string;
  // Comma-separated origins the token may be sent back to, e.g. "https://www.example.com"
  ALLOWED_REDIRECT_ORIGINS: string;
  // The one repository the CMS edits, e.g. "owner/repo"
  GITHUB_REPO: string;
  // Fine-grained PAT scoped to GITHUB_REPO (Contents: read and write)
  GITHUB_PAT: string;
};

type Env = { Bindings: Bindings };

type OAuthState = {
  state: string;
  verifier: string;
  redirect: string;
};

const REQUIRED_BINDINGS: (keyof Bindings)[] = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'ALLOWED_EMAILS',
  'ALLOWED_REDIRECT_ORIGINS',
  'GITHUB_REPO',
  'GITHUB_PAT',
];

const STATE_COOKIE = 'sveltia_oauth';
const STATE_MAX_AGE = 600; // 10 minutes to finish signing in with Google
const TOKEN_WARNING_DAYS = 14;

const app = new Hono<Env>();

app.get('/', (c) => {
  return c.json({ message: 'Sveltia Auth Proxy is running' });
});

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

// Start sign-in: remember where to return to, then send the user to Google.
app.get('/auth', async (c) => {
  const missing = missingBindings(c.env);
  if (missing.length > 0) {
    console.error(`Proxy is missing configuration: ${missing.join(', ')}`);
    return errorPage(c, 'The sign-in service is not configured yet.', null, 500);
  }

  const redirect = validateRedirectUri(c.req.query('redirect_uri'), c.env.ALLOWED_REDIRECT_ORIGINS);
  if (!redirect) {
    return errorPage(c, 'This site is not allowed to use this sign-in service.', null, 400);
  }

  const oauthState: OAuthState = { state: randomToken(), verifier: randomToken(), redirect };
  setCookie(c, STATE_COOKIE, base64UrlEncode(new TextEncoder().encode(JSON.stringify(oauthState))), {
    prefix: 'host',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: STATE_MAX_AGE,
  });

  const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizeUrl.search = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(c),
    response_type: 'code',
    scope: 'openid email',
    state: oauthState.state,
    code_challenge: await pkceChallenge(oauthState.verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();

  c.header('Cache-Control', 'no-store');
  return c.redirect(authorizeUrl.toString(), 302);
});

// Google redirects here with an authorization code.
app.get('/callback', async (c) => {
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');

  const saved = readStateCookie(getCookie(c, STATE_COOKIE, 'host'));
  deleteCookie(c, STATE_COOKIE, { prefix: 'host', path: '/', secure: true });

  const missing = missingBindings(c.env);
  if (missing.length > 0) {
    console.error(`Proxy is missing configuration: ${missing.join(', ')}`);
    return errorPage(c, 'The sign-in service is not configured yet.', null, 500);
  }

  if (!saved || saved.state !== c.req.query('state')) {
    return errorPage(c, 'Your sign-in session expired. Please start again from the site.', null, 400);
  }

  // Re-check in case the allow-list changed during sign-in.
  const redirect = validateRedirectUri(saved.redirect, c.env.ALLOWED_REDIRECT_ORIGINS);
  if (!redirect) {
    return errorPage(c, 'This site is not allowed to use this sign-in service.', null, 400);
  }

  if (c.req.query('error')) {
    return errorPage(c, 'Google sign-in was cancelled.', redirect, 400);
  }

  const code = c.req.query('code');
  if (!code) {
    return errorPage(c, 'Google did not return a sign-in code.', redirect, 400);
  }

  const identity = await exchangeGoogleCode(c, code, saved.verifier);
  if ('error' in identity) {
    console.error(`Google sign-in failed: ${identity.error}`);
    return errorPage(c, 'Google sign-in failed. Please try again.', redirect, 401);
  }

  if (!isEmailAllowed(identity.email, c.env.ALLOWED_EMAILS)) {
    console.warn(`Sign-in refused for ${identity.email}: not on ALLOWED_EMAILS`);
    return errorPage(
      c,
      `${identity.email} is not allowed to edit this site. Sign in with the Google account the site owner added, or ask them to add this one.`,
      redirect,
      403,
    );
  }

  const github = await checkGitHubToken(c.env);
  if ('error' in github) {
    console.error(`GitHub token check failed: ${github.error}`);
    return errorPage(
      c,
      'You are signed in, but the site’s GitHub access is not working (the token may have expired). Please contact the site administrator.',
      redirect,
      502,
    );
  }

  const params = new URLSearchParams({ auth_token: c.env.GITHUB_PAT });
  const expiresIn = secondsUntil(github.expiresAt, Date.now());
  if (expiresIn !== null) params.set('expires_in', String(expiresIn));

  return c.redirect(`${redirect}#${params.toString()}`, 302);
});

function missingBindings(env: Bindings): string[] {
  return REQUIRED_BINDINGS.filter((name) => !env[name]);
}

function callbackUrl(c: Context<Env>): string {
  return `${new URL(c.req.url).origin}/callback`;
}

function readStateCookie(value: string | undefined): OAuthState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(value)));
    if (typeof parsed.state !== 'string' || typeof parsed.verifier !== 'string' || typeof parsed.redirect !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function exchangeGoogleCode(
  c: Context<Env>,
  code: string,
  verifier: string,
): Promise<{ email: string } | { error: string }> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: callbackUrl(c),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    return { error: `token endpoint returned ${response.status}: ${await response.text()}` };
  }

  const { id_token } = await response.json<{ id_token?: string }>();
  if (!id_token) return { error: 'token response had no id_token' };

  const claims = decodeJwtPayload(id_token) as GoogleIdTokenClaims | null;
  return verifyGoogleIdTokenClaims(claims, c.env.GOOGLE_CLIENT_ID, Date.now());
}

// Confirms the PAT can still write to GITHUB_REPO and reads its expiry, so a
// dead token shows a clear error instead of a broken CMS.
async function checkGitHubToken(env: Bindings): Promise<{ expiresAt: number | null } | { error: string }> {
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      'User-Agent': 'sveltia-auth-proxy',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    return { error: `GET /repos/${env.GITHUB_REPO} returned ${response.status}` };
  }

  const repo = await response.json<{ permissions?: { push?: boolean } }>();
  if (!repo.permissions?.push) {
    return { error: `token cannot write to ${env.GITHUB_REPO}` };
  }

  const expiresAt = parseGitHubTokenExpiration(response.headers.get('github-authentication-token-expiration'));
  if (expiresAt === null) {
    console.warn('GITHUB_PAT has no expiry date; replace it with an expiring fine-grained token');
  } else if (expiresAt - Date.now() < TOKEN_WARNING_DAYS * 86_400_000) {
    console.warn(`GITHUB_PAT expires on ${new Date(expiresAt).toISOString()}; rotate it soon`);
  }

  return { expiresAt };
}

function errorPage(c: Context<Env>, message: string, redirect: string | null, status: 400 | 401 | 403 | 500 | 502) {
  const retry = redirect ? `/auth?redirect_uri=${encodeURIComponent(redirect)}` : null;
  const links = redirect
    ? `<p><a href="${escapeHtml(retry!)}">Try a different Google account</a> · <a href="${escapeHtml(redirect)}">Back to the site</a></p>`
    : '';

  c.header('Cache-Control', 'no-store');
  return c.html(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign-in problem</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box; }
    main { background: #fff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); padding: 32px; max-width: 440px; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    p { line-height: 1.5; margin: 0 0 12px; overflow-wrap: anywhere; }
    a { color: #4f46e5; }
  </style>
</head>
<body>
  <main>
    <h1>Couldn’t sign you in</h1>
    <p>${escapeHtml(message)}</p>
    ${links}
  </main>
</body>
</html>`,
    status,
  );
}

export default app;

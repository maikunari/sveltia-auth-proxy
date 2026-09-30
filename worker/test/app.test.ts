import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import app, { type Bindings } from '../src/index.ts';

const PROXY = 'https://proxy.example.workers.dev';
const SITE = 'https://www.example.com/admin/';
const PAT = 'github_pat_test-token';

const env: Bindings = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  ALLOWED_EMAILS: 'editor@example.com, seo@example.com',
  ALLOWED_REDIRECT_ORIGINS: 'https://www.example.com',
  GITHUB_REPO: 'owner/repo',
  GITHUB_PAT: PAT,
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function fakeIdToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`;
}

type Stub = { email?: string; githubStatus?: number; push?: boolean; expiration?: string | null };

// Stubs Google's token endpoint and the GitHub repo lookup; records the calls.
function stubFetch({ email = 'editor@example.com', githubStatus = 200, push = true, expiration = '2099-01-01 00:00:00 UTC' }: Stub = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === 'https://oauth2.googleapis.com/token') {
      const idToken = fakeIdToken({
        iss: 'https://accounts.google.com',
        aud: 'client-id',
        exp: Math.floor(Date.now() / 1000) + 300,
        email,
        email_verified: true,
      });
      return Response.json({ id_token: idToken });
    }
    if (url === 'https://api.github.com/repos/owner/repo') {
      const headers = new Headers();
      if (expiration) headers.set('github-authentication-token-expiration', expiration);
      return Response.json({ permissions: { push } }, { status: githubStatus, headers });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return calls;
}

async function startSignIn(redirectUri = SITE) {
  const res = await app.request(`${PROXY}/auth?redirect_uri=${encodeURIComponent(redirectUri)}`, {}, env);
  const location = new URL(res.headers.get('location') ?? 'about:blank');
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  return { res, location, cookie, state: location.searchParams.get('state') };
}

async function finishSignIn(stub?: Stub) {
  const calls = stubFetch(stub);
  const { cookie, state } = await startSignIn();
  const res = await app.request(`${PROXY}/callback?code=abc&state=${state}`, { headers: { Cookie: cookie } }, env);
  return { res, calls, body: await res.text() };
}

test('GET /auth sends allowed sites to Google with state and PKCE', async () => {
  const { res, location, cookie } = await startSignIn();
  assert.equal(res.status, 302);
  assert.equal(location.origin + location.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(location.searchParams.get('client_id'), 'client-id');
  assert.equal(location.searchParams.get('redirect_uri'), `${PROXY}/callback`);
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(location.searchParams.get('state'));
  assert.match(cookie, /^__Host-sveltia_oauth=/);
  assert.match(res.headers.get('set-cookie') ?? '', /HttpOnly/);
});

test('GET /auth refuses redirect URIs that are not allow-listed', async () => {
  for (const uri of ['https://evil.test/admin/', 'https://www.example.com.evil.test/', '']) {
    const res = await app.request(`${PROXY}/auth?redirect_uri=${encodeURIComponent(uri)}`, {}, env);
    assert.equal(res.status, 400);
    assert.equal(res.headers.get('set-cookie'), null);
  }
});

test('GET /auth reports missing configuration without leaking values', async () => {
  const res = await app.request(`${PROXY}/auth?redirect_uri=${encodeURIComponent(SITE)}`, {}, { ...env, GITHUB_PAT: '' });
  assert.equal(res.status, 500);
});

test('callback hands an allowed user the PAT with a truthful expires_in', async () => {
  const { res, calls } = await finishSignIn({ expiration: '2099-01-01 00:00:00 UTC' });
  assert.equal(res.status, 302);
  const location = res.headers.get('location') ?? '';
  assert.ok(location.startsWith(`${SITE}#`));
  const fragment = new URLSearchParams(location.split('#')[1]);
  assert.equal(fragment.get('auth_token'), PAT);
  const expected = Math.floor((Date.parse('2099-01-01T00:00:00Z') - Date.now()) / 1000);
  assert.ok(Math.abs(Number(fragment.get('expires_in')) - expected) <= 2);

  const tokenCall = calls.find((call) => call.url === 'https://oauth2.googleapis.com/token');
  const body = new URLSearchParams(String(tokenCall?.init?.body));
  assert.equal(body.get('redirect_uri'), `${PROXY}/callback`);
  assert.ok(body.get('code_verifier'));
});

test('callback omits expires_in when the PAT has no expiry', async () => {
  const { res } = await finishSignIn({ expiration: null });
  const fragment = new URLSearchParams((res.headers.get('location') ?? '').split('#')[1]);
  assert.equal(fragment.get('auth_token'), PAT);
  assert.equal(fragment.has('expires_in'), false);
});

test('callback refuses emails that are not on the allow-list', async () => {
  const { res, calls, body } = await finishSignIn({ email: 'stranger@example.com' });
  assert.equal(res.status, 403);
  assert.ok(!body.includes(PAT));
  assert.ok(!calls.some((call) => call.url.startsWith('https://api.github.com/')));
});

test('callback does not hand out a PAT GitHub rejects', async () => {
  for (const stub of [{ githubStatus: 401 }, { push: false }]) {
    const { res, body } = await finishSignIn(stub);
    assert.equal(res.status, 502);
    assert.equal(res.headers.get('location'), null);
    assert.ok(!body.includes(PAT));
  }
});

test('callback rejects a state that does not match the cookie', async () => {
  const calls = stubFetch();
  const { cookie } = await startSignIn();
  const res = await app.request(`${PROXY}/callback?code=abc&state=forged`, { headers: { Cookie: cookie } }, env);
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('callback rejects a request with no sign-in cookie', async () => {
  const calls = stubFetch();
  const res = await app.request(`${PROXY}/callback?code=abc&state=anything`, {}, env);
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

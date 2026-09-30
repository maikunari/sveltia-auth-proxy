import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isEmailAllowed,
  parseGitHubTokenExpiration,
  parseList,
  secondsUntil,
  validateRedirectUri,
  verifyGoogleIdTokenClaims,
} from '../src/auth.ts';

test('parseList splits on commas and newlines and drops blanks', () => {
  assert.deepEqual(parseList(' a@example.com, b@example.com\n\nc@example.com ,'), [
    'a@example.com',
    'b@example.com',
    'c@example.com',
  ]);
  assert.deepEqual(parseList(undefined), []);
});

test('isEmailAllowed matches case-insensitively and exactly', () => {
  const list = 'Editor@Example.com, seo@example.com';
  assert.equal(isEmailAllowed('editor@example.com', list), true);
  assert.equal(isEmailAllowed(' SEO@example.com ', list), true);
  assert.equal(isEmailAllowed('other@example.com', list), false);
  assert.equal(isEmailAllowed('editor@example.com.evil.test', list), false);
  assert.equal(isEmailAllowed('', list), false);
  assert.equal(isEmailAllowed('editor@example.com', ''), false);
  assert.equal(isEmailAllowed('editor@example.com', undefined), false);
});

test('validateRedirectUri only accepts allow-listed origins', () => {
  const origins = 'https://www.example.com, https://example.com/';
  assert.equal(validateRedirectUri('https://www.example.com/admin/', origins), 'https://www.example.com/admin/');
  assert.equal(validateRedirectUri('https://example.com/admin/#old', origins), 'https://example.com/admin/');
  assert.equal(validateRedirectUri('https://evil.test/admin/', origins), null);
  assert.equal(validateRedirectUri('https://www.example.com.evil.test/admin/', origins), null);
  assert.equal(validateRedirectUri('http://www.example.com/admin/', origins), null);
  assert.equal(validateRedirectUri('javascript:alert(1)', origins), null);
  assert.equal(validateRedirectUri('/admin/', origins), null);
  assert.equal(validateRedirectUri(undefined, origins), null);
  assert.equal(validateRedirectUri('https://www.example.com/admin/', ''), null);
});

test('verifyGoogleIdTokenClaims checks issuer, audience, expiry and verified email', () => {
  const now = 1_700_000_000_000;
  const good = {
    iss: 'https://accounts.google.com',
    aud: 'client-id',
    exp: now / 1000 + 300,
    email: 'editor@example.com',
    email_verified: true,
  };
  assert.deepEqual(verifyGoogleIdTokenClaims(good, 'client-id', now), { email: 'editor@example.com' });
  assert.ok('error' in verifyGoogleIdTokenClaims(null, 'client-id', now));
  assert.ok('error' in verifyGoogleIdTokenClaims({ ...good, iss: 'https://evil.test' }, 'client-id', now));
  assert.ok('error' in verifyGoogleIdTokenClaims({ ...good, aud: 'other-client' }, 'client-id', now));
  assert.ok('error' in verifyGoogleIdTokenClaims({ ...good, exp: now / 1000 - 1 }, 'client-id', now));
  assert.ok('error' in verifyGoogleIdTokenClaims({ ...good, email_verified: false }, 'client-id', now));
  assert.ok('error' in verifyGoogleIdTokenClaims({ ...good, email: undefined }, 'client-id', now));
});

test('parseGitHubTokenExpiration reads the header formats GitHub sends', () => {
  assert.equal(parseGitHubTokenExpiration('2026-12-31 23:59:59 UTC'), Date.parse('2026-12-31T23:59:59Z'));
  assert.equal(parseGitHubTokenExpiration('2026-12-31 15:59:59 -0800'), Date.parse('2026-12-31T23:59:59Z'));
  assert.equal(parseGitHubTokenExpiration(null), null);
  assert.equal(parseGitHubTokenExpiration('next tuesday'), null);
});

test('secondsUntil is truthful and never negative', () => {
  assert.equal(secondsUntil(10_000, 4_500), 5);
  assert.equal(secondsUntil(1_000, 5_000), 0);
  assert.equal(secondsUntil(null, 5_000), null);
});

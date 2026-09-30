# Sveltia Auth Proxy

A Cloudflare Worker that lets a small, fixed list of people sign in to a [Sveltia CMS](https://github.com/sveltia/sveltia-cms) admin with their Google account, without giving them GitHub accounts.

The Worker signs people in with Google OAuth, checks their email against an allow-list stored in the Worker's own configuration, and hands the CMS a GitHub token that can only edit one repository. There is no database, so nothing can pause and no keep-alive job is needed.

## Project Structure

```
├── worker/                 # Cloudflare Worker (Hono framework)
│   ├── src/
│   │   ├── index.ts        # Routes: /auth and /callback
│   │   └── auth.ts         # Pure helpers (allow-list, redirect and token checks)
│   ├── test/               # node --test suites
│   ├── package.json
│   ├── tsconfig.json
│   ├── wrangler.toml       # Wrangler configuration
│   └── dev.vars.example    # Example local configuration
└── README.md
```

## How it works

1. The CMS admin page sends the browser to `/auth?redirect_uri=https://your-site.com/admin/`.
2. The Worker checks that `redirect_uri` is on an allowed origin, then sends the browser to Google's sign-in page.
3. Google sends the browser back to `/callback`. The Worker exchanges the code with Google (with PKCE and a state cookie) and reads the verified email address.
4. If the email is in `ALLOWED_EMAILS`, the Worker checks that `GITHUB_PAT` can still write to `GITHUB_REPO`, then redirects to `redirect_uri#auth_token=<GITHUB_PAT>&expires_in=<seconds>`.
   - `expires_in` is the real number of seconds until the PAT expires, read from GitHub. It is left out if the PAT has no expiry date.
5. Anything else (email not allowed, Google cancelled, PAT expired or missing access) shows an error page on the Worker with a "Try a different Google account" link. The token is never sent back in those cases.

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later (v22.18 or later to run the tests)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- A [GitHub account](https://github.com) with write access to the site's repository
- A [Google Cloud Console](https://console.cloud.google.com/) project (for the Google OAuth client)

## Setup

### 1. Create a Google OAuth client

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Go to "APIs & Services" → "OAuth consent screen".
   - Choose "External" user type.
   - Fill in app name, user support email and developer contact.
   - Add scopes: `email`, `openid`.
   - While the app is in "Testing" mode, only listed test users can sign in. Publish it (no Google review is needed for these scopes) or add every editor as a test user.
3. Go to "APIs & Services" → "Credentials" → "Create Credentials" → "OAuth client ID".
   - Application type: "Web application".
   - Authorized redirect URIs:
     ```
     https://sveltia-auth-proxy.<your-subdomain>.workers.dev/callback
     http://localhost:8787/callback
     ```
     (The second one is only needed for local development.)
   - Copy the **Client ID** and **Client Secret**.

An existing OAuth client works too: add the Worker's `/callback` URL to its authorized redirect URIs. If Google no longer shows the old client secret, use "Add secret" on the client to create a new one.

### 2. Create a fine-grained GitHub token for the one repository

Use a **fine-grained** personal access token, never a classic token. Every signed-in editor's browser receives this token, so it must only be able to touch the site's repository.

1. Go to GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → "Generate new token".
2. Token name: e.g. `Sveltia CMS – owner/repo`.
3. Resource owner: the account or organization that owns the repository.
4. Expiration: pick a date (for example 90 days or 1 year) and put a reminder in your calendar to rotate it. The Worker logs a warning in the last 14 days, and once it expires editors get a clear error instead of a broken CMS.
5. Repository access: **Only select repositories** → select the site's repository only.
6. Permissions → Repository permissions:
   - **Contents: Read and write**
   - **Metadata: Read-only** (selected automatically)
   - Leave everything else as "No access".
7. Generate the token and copy it (starts with `github_pat_`).

### 3. Install and configure the Worker

```bash
cd worker
npm install
npx wrangler login
```

Set the configuration as Worker secrets. They are secrets so that per-site values stay out of this public repository and survive `wrangler deploy`:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID          # from step 1
npx wrangler secret put GOOGLE_CLIENT_SECRET      # from step 1
npx wrangler secret put ALLOWED_EMAILS            # e.g. editor@example.com,seo@example.com
npx wrangler secret put ALLOWED_REDIRECT_ORIGINS  # e.g. https://example.com,https://www.example.com
npx wrangler secret put GITHUB_REPO               # e.g. owner/repo
npx wrangler secret put GITHUB_PAT                # from step 2
```

### 4. Deploy

```bash
npm run deploy
```

Note your worker URL (e.g., `https://sveltia-auth-proxy.<your-subdomain>.workers.dev`) and make sure its `/callback` is in the Google client's authorized redirect URIs (step 1).

### 5. Configure your CMS site

Your admin page sends people to:

```
https://sveltia-auth-proxy.<your-subdomain>.workers.dev/auth?redirect_uri=https://your-site.com/admin/
```

The origin of `redirect_uri` (`https://your-site.com`) must be listed in `ALLOWED_REDIRECT_ORIGINS`. See "Client Integration" below for the page that receives the token.

## Upgrading from the Supabase-backed version

Earlier versions kept users in a Supabase `users` table and signed in through Supabase Auth. This version needs no Supabase at all. To switch an existing deployment:

1. Note the emails in the Supabase `users` table and the `github_repo` of the site (from the `sites` table). This version serves one site per Worker; if the `sites` table has more than one row, deploy a separate Worker per site.
2. Add `https://<your-worker-host>/callback` to the Google OAuth client that Supabase used (step 1 above), and get its client ID and secret.
3. Create the fine-grained token (step 2 above).
4. Set the six secrets (step 3 above). Setting `GITHUB_PAT` first is safe: the old code keeps working with the new token.
5. `npm run deploy`. This also removes the old daily Supabase keep-alive cron (`crons = []` in `wrangler.toml`).
6. Sign in through the CMS to check it works, then revoke the old classic token on GitHub.
7. Once you are happy, delete the old secrets (`npx wrangler secret delete SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`), any external keep-alive job, and the Supabase project.

To roll back before step 7, run `npx wrangler rollback` in `worker/`. It restores the version before the last deploy, including the secrets it had at the time.

## Managing editors

The allow-list is the `ALLOWED_EMAILS` secret: a comma-separated list of Google account emails, matched case-insensitively. To add or remove someone, set the whole list again:

```bash
cd worker
npx wrangler secret put ALLOWED_EMAILS
```

The change takes effect immediately; no redeploy is needed. Removing someone stops them signing in again, but a token already stored in their browser keeps working until you rotate `GITHUB_PAT`.

## Rotating the GitHub token

1. Create a new fine-grained token as in step 2.
2. `npx wrangler secret put GITHUB_PAT` and paste the new token.
3. Sign in once through the CMS to check it works, then delete the old token on GitHub.

Editors whose browsers still hold the old token need to sign out of the CMS and sign in again.

## Client Integration

After a successful sign-in the browser lands on your `redirect_uri` with the token in the URL fragment. Store it where Sveltia CMS looks for it (`sveltia-cms.user` in `localStorage`) before the CMS loads:

```html
<!-- admin/index.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>CMS Admin</title>
</head>
<body>
  <script>
    (function() {
      const AUTH_URL = 'https://sveltia-auth-proxy.<your-subdomain>.workers.dev/auth';
      const TOKEN_KEY = 'sveltia-cms.user';

      const params = new URLSearchParams(window.location.hash.substring(1));
      const token = params.get('auth_token');
      if (token) {
        localStorage.setItem(TOKEN_KEY, JSON.stringify({ backendName: 'github', token }));
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }

      if (!localStorage.getItem(TOKEN_KEY)) {
        const redirectUri = encodeURIComponent(window.location.origin + window.location.pathname);
        window.location.href = AUTH_URL + '?redirect_uri=' + redirectUri;
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/@sveltia/cms/dist/sveltia-cms.js';
      document.body.appendChild(script);
    })();
  </script>
</body>
</html>
```

`expires_in` (when present) is the number of seconds until the GitHub token itself expires. You can use it to send people back to `/auth` before that happens.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check, returns status message |
| `/health` | GET | Health check endpoint |
| `/auth` | GET | Starts Google sign-in. Query: `redirect_uri` (required, must be on an allowed origin) |
| `/callback` | GET | Google OAuth callback. Redirects to `redirect_uri#auth_token=...&expires_in=...` on success, or shows an error page |

## Configuration

All values are Worker secrets (`wrangler secret put <NAME>`), or lines in `worker/.dev.vars` for local development.

| Name | Description |
|------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `ALLOWED_EMAILS` | Comma-separated Google account emails allowed to sign in |
| `ALLOWED_REDIRECT_ORIGINS` | Comma-separated site origins the token may be sent to, e.g. `https://www.example.com` (scheme + host, no path) |
| `GITHUB_REPO` | The repository the CMS edits, as `owner/repo` |
| `GITHUB_PAT` | Fine-grained PAT limited to `GITHUB_REPO` with Contents read/write |

If any of these is missing, `/auth` shows "not configured yet" and the Worker log names the missing setting.

## Security notes

- The GitHub token is stored in the editor's browser (`localStorage`), because Sveltia CMS talks to GitHub directly. That is why it must be a fine-grained token limited to the one repository, with an expiry date.
- The token is only ever sent to origins listed in `ALLOWED_REDIRECT_ORIGINS`.
- Sign-in uses Google's authorization-code flow with PKCE and a short-lived `__Host-` state cookie. Only verified Google email addresses are accepted.

## Troubleshooting

### "… is not allowed to edit this site"
- The Google account's email is not in `ALLOWED_EMAILS`. Check for typos; matching ignores case but nothing else.
- If the person has several Google accounts, use "Try a different Google account" and pick the right one.

### "This site is not allowed to use this sign-in service"
- The origin of `redirect_uri` is not in `ALLOWED_REDIRECT_ORIGINS`. `https://example.com` and `https://www.example.com` are different origins; list both if the site answers on both.

### "The site's GitHub access is not working"
- `GITHUB_PAT` has expired, was revoked, or cannot write to `GITHUB_REPO`. Run `npm run tail` in `worker/` while signing in to see the exact GitHub response, then rotate the token.

### Google shows "redirect_uri_mismatch"
- Add `https://<your-worker-host>/callback` exactly to the OAuth client's authorized redirect URIs.

### Google OAuth not working for some users
- **Important**: If your OAuth consent screen is in "Testing" mode, only users added to the test users list can sign in. To allow any Google user, go to Google Cloud Console → OAuth consent screen → click "Publish App" to move to production.

## Local Development

```bash
cd worker
cp dev.vars.example .dev.vars   # fill in real values; .dev.vars is gitignored
npm run dev                     # http://localhost:8787
npm test                        # unit and route tests (Node 22.18+)
npm run typecheck
```

For local sign-in, add `http://localhost:8787/callback` to the Google client's redirect URIs and your local site's origin (e.g. `http://localhost:8080`) to `ALLOWED_REDIRECT_ORIGINS` in `.dev.vars`.

## License

MIT

# Sveltia Auth Proxy

A Cloudflare Worker-based authentication proxy for Sveltia CMS with Supabase backend. Provides multi-tenant authentication with support for Google OAuth, email/password, and magic link sign-in methods.

## Project Structure

```
├── worker/                 # Cloudflare Worker (Hono framework)
│   ├── src/
│   │   └── index.ts        # Main worker entry point
│   ├── package.json
│   ├── tsconfig.json
│   ├── wrangler.toml       # Wrangler configuration
│   └── dev.vars.example    # Example environment variables
├── supabase/               # Supabase configuration
│   ├── config.toml
│   └── migrations/         # Database migrations
└── README.md
```

## Features

- **Multi-tenant support**: Each site has its own branding (logo, name, primary color)
- **Multiple auth methods**: Google OAuth, email/password, magic link
- **User authorization**: Only users in the `users` table can access their assigned site
- **Repository validation**: Ensures users can only access their authorized GitHub repo
- **Redirect-based auth flow**: Works cross-origin between worker and CMS site

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- A [Supabase account](https://supabase.com)
- A [GitHub account](https://github.com) with a Personal Access Token
- A [Google Cloud Console](https://console.cloud.google.com/) project (for Google OAuth)

## Setup

### 1. Create a GitHub Personal Access Token

1. Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Give it a descriptive name (e.g., "Sveltia CMS Auth")
4. Select scopes:
   - `repo` (Full control of private repositories)
5. Click "Generate token" and copy the token (starts with `ghp_`)
6. Save this token securely - you'll need it later

### 2. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for the project to be provisioned
3. Go to Project Settings → API and note down:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon/public key** (safe to expose in browser)
   - **service_role key** (keep secret - has admin access)

### 3. Configure Google OAuth in Supabase

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Go to "APIs & Services" → "OAuth consent screen"
   - Choose "External" user type
   - Fill in app name, user support email, developer contact
   - Add scopes: `email`, `profile`, `openid`
   - Add test users if in testing mode
4. Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "OAuth client ID"
   - Application type: "Web application"
   - Name: "Sveltia Auth Proxy"
   - Authorized redirect URIs: Add your Supabase callback URL:
     ```
     https://<your-project-ref>.supabase.co/auth/v1/callback
     ```
   - Click "Create" and copy the **Client ID** and **Client Secret**
5. In Supabase Dashboard:
   - Go to Authentication → Providers → Google
   - Enable Google provider
   - Paste the Client ID and Client Secret from Google
   - Save

### 4. Apply Database Migrations

Install the Supabase CLI and apply migrations:

```bash
# Install Supabase CLI (if not already installed)
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project (find project ref in Supabase dashboard URL)
supabase link --project-ref <your-project-ref>

# Apply migrations
supabase db push
```

### 5. Add Sites and Users to Database

In Supabase Dashboard → SQL Editor, run:

```sql
-- Add a site
INSERT INTO sites (slug, github_repo, brand_name, primary_color)
VALUES ('my-site', 'owner/repo', 'My Site CMS', '#6366f1');

-- Get the site ID
SELECT id FROM sites WHERE slug = 'my-site';

-- Add an authorized user (replace <site-uuid> with the ID from above)
INSERT INTO users (email, site_id, role)
VALUES ('your-email@example.com', '<site-uuid>', 'admin');
```

The email must match the Google account email you'll use to sign in.

### 6. Set Up Cloudflare Worker

1. Navigate to the worker directory:
   ```bash
   cd worker
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy the example environment file for local development:
   ```bash
   cp dev.vars.example .dev.vars
   ```

4. Edit `.dev.vars` with your actual values from steps 1-2:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_KEY=your-service-role-key
   GITHUB_PAT=ghp_your-personal-access-token
   ```

5. Test locally:
   ```bash
   npm run dev
   ```

   Visit `http://localhost:8787` - you should see `{"message":"Sveltia Auth Proxy is running"}`

### 7. Deploy to Cloudflare

1. Login to Cloudflare (if not already):
   ```bash
   npx wrangler login
   ```

2. Set production secrets:
   ```bash
   npx wrangler secret put SUPABASE_URL
   # Enter: https://your-project.supabase.co

   npx wrangler secret put SUPABASE_ANON_KEY
   # Enter: your-anon-key

   npx wrangler secret put SUPABASE_SERVICE_KEY
   # Enter: your-service-role-key

   npx wrangler secret put GITHUB_PAT
   # Enter: ghp_your-personal-access-token
   ```

3. Deploy:
   ```bash
   npm run deploy
   ```

4. Note your worker URL (e.g., `https://sveltia-auth-proxy.<your-subdomain>.workers.dev`)

### 8. Update Supabase Redirect URLs

After deploying, add your worker callback URL to Supabase:

1. Go to Supabase Dashboard → Authentication → URL Configuration
2. Add to "Redirect URLs":
   ```
   https://sveltia-auth-proxy.<your-subdomain>.workers.dev/callback
   ```
   For local development, also add:
   ```
   http://localhost:8787/callback
   ```

### 9. Configure Your CMS Site

In your Sveltia CMS site, configure the backend to use your auth proxy:

```yaml
# In your CMS config (e.g., admin/config.yml)
backend:
  name: github
  repo: owner/repo
  branch: main
  base_url: https://sveltia-auth-proxy.<your-subdomain>.workers.dev
  auth_endpoint: /auth
```

Or if using the redirect flow, your site should redirect to:
```
https://sveltia-auth-proxy.<your-subdomain>.workers.dev/auth?redirect_uri=https://your-site.com/admin/
```

## Client Integration

Your CMS admin page needs to handle the authentication response. After successful auth, the user is redirected back to your `redirect_uri` with the token in the URL fragment.

### Handling the Auth Response

```html
<!-- admin/index.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>CMS Admin</title>
  <script src="https://unpkg.com/sveltia-cms/dist/sveltia-cms.js"></script>
</head>
<body>
  <script>
    // Handle auth callback - this runs before Sveltia CMS initializes
    (function() {
      const hash = window.location.hash.substring(1);
      if (!hash) return;

      const params = new URLSearchParams(hash);
      const token = params.get('auth_token');
      const error = params.get('auth_error');
      const expiresIn = params.get('expires_in');

      if (error) {
        console.error('Auth error:', error);
        alert('Authentication failed: ' + error);
        // Clear the hash
        history.replaceState(null, '', window.location.pathname);
        return;
      }

      if (token) {
        // Store the token for Sveltia CMS to use
        const expiresAt = Date.now() + (parseInt(expiresIn, 10) * 1000);
        localStorage.setItem('git.token', JSON.stringify({
          token: token,
          expires_at: expiresAt
        }));

        // Clear the hash and reload to initialize CMS with token
        history.replaceState(null, '', window.location.pathname);
        window.location.reload();
      }
    })();
  </script>
</body>
</html>
```

### Initiating Authentication

If you need to manually trigger auth (e.g., a custom login button):

```javascript
function login() {
  const authUrl = 'https://sveltia-auth-proxy.<your-subdomain>.workers.dev/auth';
  const redirectUri = encodeURIComponent(window.location.href);
  const site = 'my-site'; // Optional: for custom branding

  window.location.href = `${authUrl}?redirect_uri=${redirectUri}&site=${site}`;
}
```

### Checking Auth Status

```javascript
function isAuthenticated() {
  try {
    const stored = localStorage.getItem('git.token');
    if (!stored) return false;

    const { token, expires_at } = JSON.parse(stored);
    return token && expires_at > Date.now();
  } catch {
    return false;
  }
}

function logout() {
  localStorage.removeItem('git.token');
  window.location.reload();
}
```

### Token Storage Format

The token is stored in `localStorage` under the key `git.token`:

```json
{
  "token": "ghp_xxxxxxxxxxxx",
  "expires_at": 1704672000000
}
```

- `token`: The GitHub PAT for repository access
- `expires_at`: Unix timestamp (milliseconds) when the token expires (8 hours from auth)

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check, returns status message |
| `/health` | GET | Health check endpoint |
| `/auth` | GET | Serves the auth UI page |
| `/auth` | POST | Legacy token validation endpoint |
| `/callback` | GET | OAuth callback handler |
| `/callback/validate` | POST | Validates Supabase token, returns GitHub PAT |
| `/api/site/:slug` | GET | Get site branding information |

### Auth Flow

1. CMS redirects to `/auth?redirect_uri=https://your-site.com/admin/`
2. User authenticates via Google, email/password, or magic link
3. Worker validates user exists in `users` table
4. On success, redirects back to `redirect_uri#auth_token=<github_pat>&expires_in=28800`
5. On error, redirects back with `redirect_uri#auth_error=<message>`

### Query Parameters for `/auth`

| Parameter | Description |
|-----------|-------------|
| `redirect_uri` | URL to redirect back to after authentication |
| `site` | Site slug for custom branding (optional) |

## Database Schema

### sites
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| slug | TEXT | Unique site identifier |
| github_repo | TEXT | GitHub repo in `owner/repo` format |
| logo_url | TEXT | URL to site logo (optional) |
| brand_name | TEXT | Display name for auth page |
| primary_color | TEXT | Hex color for buttons/accents |
| created_at | TIMESTAMPTZ | Creation timestamp |

### users
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| email | TEXT | User email address |
| site_id | UUID | Foreign key to sites |
| role | TEXT | Either 'admin' or 'editor' |
| created_at | TIMESTAMPTZ | Creation timestamp |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anonymous/public key |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (keep secret!) |
| `GITHUB_PAT` | GitHub Personal Access Token for CMS operations |

## Troubleshooting

### "User not authorized" error
- Verify the user's email exists in the `users` table
- The email must exactly match the Google account email

### Google OAuth not working
- Check that the Supabase callback URL is added to Google Cloud Console authorized redirect URIs
- Verify Google provider is enabled in Supabase Authentication settings

### Redirect issues after auth
- Ensure the worker callback URL is added to Supabase redirect URLs
- Check that `redirect_uri` is being passed correctly

### Local development issues
- Make sure `.dev.vars` file exists with correct values
- Add `http://localhost:8787/callback` to Supabase redirect URLs

## Local Development

### Running the Worker

```bash
cd worker
npm run dev
```

The worker will be available at `http://localhost:8787`.

### Creating New Migrations

```bash
supabase migration new <migration_name>
```

This creates a new migration file in `supabase/migrations/`.

## License

MIT

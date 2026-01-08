import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createClient } from '@supabase/supabase-js';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_KEY: string;
  GITHUB_PAT: string;
};

type AuthRequest = {
  token: string;
  repo: string;
};

type Site = {
  id: string;
  slug: string;
  github_repo: string;
};

type User = {
  id: string;
  email: string;
  site_id: string;
  role: string;
  sites: Site;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', cors());

app.get('/', (c) => {
  return c.json({ message: 'Sveltia Auth Proxy is running' });
});

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

// Serve Auth UI page
app.get('/auth', async (c) => {
  const siteSlug = c.req.query('site');
  const redirectUri = c.req.query('redirect_uri') || '';

  // Fetch site branding if slug provided
  let branding = {
    logo_url: null as string | null,
    brand_name: 'Sign In',
    primary_color: '#6366f1',
  };

  if (siteSlug) {
    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);
    const { data: site } = await supabase
      .from('sites')
      .select('logo_url, brand_name, primary_color')
      .eq('slug', siteSlug)
      .single();

    if (site) {
      branding = {
        logo_url: site.logo_url,
        brand_name: site.brand_name || 'Sign In',
        primary_color: site.primary_color || '#6366f1',
      };
    }
  }

  return c.html(authPageHtml(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY, branding, redirectUri));
});

// Get site branding
app.get('/api/site/:slug', async (c) => {
  const slug = c.req.param('slug');
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);

  const { data: site, error } = await supabase
    .from('sites')
    .select('slug, logo_url, brand_name, primary_color')
    .eq('slug', slug)
    .single();

  if (error || !site) {
    return c.json({ error: 'Site not found' }, 404);
  }

  return c.json(site);
});

// Handle OAuth callback from Supabase (token in URL fragment)
app.get('/callback', (c) => {
  const redirectUri = c.req.query('redirect_uri') || '';
  // Return HTML that reads the fragment client-side and validates via /callback/validate
  return c.html(callbackHtml(redirectUri));
});

// Validate the access token and return GitHub PAT
app.post('/callback/validate', async (c) => {
  const { access_token } = await c.req.json<{ access_token: string }>();

  if (!access_token) {
    return c.json({ error: 'Missing access_token' }, 400);
  }

  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);

  // Validate the token
  const { data: userData, error: authError } = await supabase.auth.getUser(access_token);

  if (authError || !userData.user) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  const email = userData.user.email;

  if (!email) {
    return c.json({ error: 'No email in token' }, 401);
  }

  // Validate user exists in users table
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, email')
    .eq('email', email)
    .single();

  if (userError || !user) {
    return c.json({ error: 'User not authorized' }, 401);
  }

  return c.json({
    success: true,
    token: c.env.GITHUB_PAT,
    expires_in: 28800, // 8 hours
  });
});

type SiteBranding = {
  logo_url: string | null;
  brand_name: string;
  primary_color: string;
};

function authPageHtml(supabaseUrl: string, supabaseAnonKey: string, branding: SiteBranding, redirectUri: string): string {
  const logoHtml = branding.logo_url
    ? `<img src="${branding.logo_url}" alt="${branding.brand_name}" class="logo" />`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${branding.brand_name} - Sign In</title>
  <script src="https://unpkg.com/@supabase/supabase-js@2"></script>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      padding: 40px;
      width: 100%;
      max-width: 400px;
    }
    .header {
      text-align: center;
      margin-bottom: 32px;
    }
    .logo {
      max-width: 120px;
      max-height: 60px;
      margin-bottom: 16px;
    }
    .brand-name {
      font-size: 24px;
      font-weight: 600;
      color: #333;
    }
    .divider {
      display: flex;
      align-items: center;
      margin: 24px 0;
      color: #666;
      font-size: 14px;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      border-bottom: 1px solid #e0e0e0;
    }
    .divider span {
      padding: 0 16px;
    }
    .auth-button {
      width: 100%;
      padding: 12px 16px;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      background: white;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      transition: background 0.2s, border-color 0.2s;
      margin-bottom: 12px;
    }
    .auth-button:hover {
      background: #f9f9f9;
      border-color: #ccc;
    }
    .auth-button.primary {
      background: ${branding.primary_color};
      color: white;
      border-color: ${branding.primary_color};
    }
    .auth-button.primary:hover {
      opacity: 0.9;
    }
    .auth-button svg {
      width: 20px;
      height: 20px;
    }
    .form-group {
      margin-bottom: 16px;
    }
    .form-group label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      color: #333;
      margin-bottom: 6px;
    }
    .form-group input {
      width: 100%;
      padding: 12px;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      font-size: 14px;
      transition: border-color 0.2s;
    }
    .form-group input:focus {
      outline: none;
      border-color: ${branding.primary_color};
    }
    .error-message {
      color: #dc2626;
      font-size: 14px;
      margin-top: 8px;
      display: none;
    }
    .success-message {
      color: #16a34a;
      font-size: 14px;
      margin-top: 8px;
      display: none;
    }
    .tabs {
      display: flex;
      margin-bottom: 24px;
      border-bottom: 1px solid #e0e0e0;
    }
    .tab {
      flex: 1;
      padding: 12px;
      text-align: center;
      font-size: 14px;
      font-weight: 500;
      color: #666;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: color 0.2s, border-color 0.2s;
    }
    .tab.active {
      color: ${branding.primary_color};
      border-bottom-color: ${branding.primary_color};
    }
    .tab-content {
      display: none;
    }
    .tab-content.active {
      display: block;
    }
    .loading {
      text-align: center;
      padding: 20px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      ${logoHtml}
      <div class="brand-name">${branding.brand_name}</div>
    </div>

    <button id="google-btn" class="auth-button" type="button">
      <svg viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
      Continue with Google
    </button>

    <div class="divider"><span>or</span></div>

    <div class="tabs">
      <div id="tab-email" class="tab active">Email</div>
      <div id="tab-magic" class="tab">Magic Link</div>
    </div>

    <div id="email-tab" class="tab-content active">
      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" placeholder="you@example.com" />
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" placeholder="Your password" />
      </div>
      <button id="email-btn" class="auth-button primary" type="button">Sign In</button>
    </div>

    <div id="magic-tab" class="tab-content">
      <div class="form-group">
        <label for="magic-email">Email</label>
        <input type="email" id="magic-email" placeholder="you@example.com" />
      </div>
      <button id="magic-btn" class="auth-button primary" type="button">Send Magic Link</button>
    </div>

    <div id="error" class="error-message"></div>
    <div id="success" class="success-message"></div>
  </div>

  <script>
    const SUPABASE_URL = '${supabaseUrl}';
    const SUPABASE_ANON_KEY = '${supabaseAnonKey}';
    const REDIRECT_URI = '${redirectUri}';
    const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Build callback URL with redirect_uri preserved
    function getCallbackUrl() {
      let callbackUrl = window.location.origin + '/callback';
      if (REDIRECT_URI) {
        callbackUrl += '?redirect_uri=' + encodeURIComponent(REDIRECT_URI);
      }
      return callbackUrl;
    }

    // Redirect to the final destination with token
    function redirectWithToken(token, expiresIn) {
      if (REDIRECT_URI) {
        const url = REDIRECT_URI + '#auth_token=' + encodeURIComponent(token) + '&expires_in=' + expiresIn;
        window.location.href = url;
      } else {
        showSuccess('Authentication successful! You can close this window.');
      }
    }

    // Redirect with error
    function redirectWithError(error) {
      if (REDIRECT_URI) {
        const url = REDIRECT_URI + '#auth_error=' + encodeURIComponent(error);
        window.location.href = url;
      } else {
        showError(error);
      }
    }

    // Listen for auth state changes
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        // Validate user and get GitHub PAT
        try {
          const response = await fetch('/callback/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ access_token: session.access_token })
          });

          const data = await response.json();

          if (!response.ok || !data.success) {
            throw new Error(data.error || 'Validation failed');
          }

          // Redirect back to the site with token
          redirectWithToken(data.token, data.expires_in);
        } catch (error) {
          redirectWithError(error.message);
        }
      }
    });

    function showTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById('tab-' + tab).classList.add('active');
      document.getElementById(tab + '-tab').classList.add('active');
      hideMessages();
    }

    function showError(message) {
      const el = document.getElementById('error');
      el.textContent = message;
      el.style.display = 'block';
      document.getElementById('success').style.display = 'none';
    }

    function showSuccess(message) {
      const el = document.getElementById('success');
      el.textContent = message;
      el.style.display = 'block';
      document.getElementById('error').style.display = 'none';
    }

    function hideMessages() {
      document.getElementById('error').style.display = 'none';
      document.getElementById('success').style.display = 'none';
    }

    async function signInWithGoogle() {
      hideMessages();
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: getCallbackUrl()
        }
      });
      if (error) showError(error.message);
    }

    async function signInWithEmail() {
      hideMessages();
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;

      if (!email || !password) {
        showError('Please enter email and password');
        return;
      }

      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) showError(error.message);
    }

    async function signInWithMagicLink() {
      hideMessages();
      const email = document.getElementById('magic-email').value;

      if (!email) {
        showError('Please enter your email');
        return;
      }

      const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: getCallbackUrl()
        }
      });
      if (error) {
        showError(error.message);
      } else {
        showSuccess('Check your email for the magic link!');
      }
    }

    // Attach event listeners when DOM is ready
    document.addEventListener('DOMContentLoaded', function() {
      document.getElementById('google-btn').addEventListener('click', signInWithGoogle);
      document.getElementById('email-btn').addEventListener('click', signInWithEmail);
      document.getElementById('magic-btn').addEventListener('click', signInWithMagicLink);
      document.getElementById('tab-email').addEventListener('click', function() { showTab('email'); });
      document.getElementById('tab-magic').addEventListener('click', function() { showTab('magic'); });

      // Allow Enter key to submit forms
      document.getElementById('password').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') signInWithEmail();
      });
      document.getElementById('magic-email').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') signInWithMagicLink();
      });
    });
  </script>
</body>
</html>`;
}

function callbackHtml(redirectUri: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Authenticating...</title></head>
<body>
<p>Authenticating...</p>
<script>
(async function() {
  const REDIRECT_URI = '${redirectUri}';

  function redirectWithToken(token, expiresIn) {
    if (REDIRECT_URI) {
      const url = REDIRECT_URI + '#auth_token=' + encodeURIComponent(token) + '&expires_in=' + expiresIn;
      window.location.href = url;
    } else {
      document.body.innerHTML = '<p>Authentication successful! You can close this window.</p>';
    }
  }

  function redirectWithError(error) {
    if (REDIRECT_URI) {
      const url = REDIRECT_URI + '#auth_error=' + encodeURIComponent(error);
      window.location.href = url;
    } else {
      document.body.innerHTML = '<p>Authentication failed: ' + error + '</p>';
    }
  }

  try {
    // Parse the URL fragment
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');

    if (!accessToken) {
      throw new Error('No access token in URL');
    }

    // Validate token with the server
    const response = await fetch('/callback/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: accessToken })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Validation failed');
    }

    // Redirect back to the site with token
    redirectWithToken(data.token, data.expires_in);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    redirectWithError(errorMessage);
  }
})();
</script>
</body>
</html>`;
}

app.post('/auth', async (c) => {
  const body = await c.req.json<AuthRequest>();
  const { token, repo } = body;

  if (!token || !repo) {
    return c.json({ error: 'Missing token or repo' }, 400);
  }

  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);

  // Validate JWT and extract user info
  const { data: userData, error: authError } = await supabase.auth.getUser(token);

  if (authError || !userData.user) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  const email = userData.user.email;

  if (!email) {
    return c.json({ error: 'No email in token' }, 401);
  }

  // Look up user and their associated site
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, email, site_id, role, sites(id, slug, github_repo)')
    .eq('email', email)
    .single();

  if (userError || !user) {
    return c.json({ error: 'User not found' }, 401);
  }

  const typedUser = user as unknown as User;

  // Verify the requested repo matches the user's allowed site
  if (typedUser.sites.github_repo !== repo) {
    return c.json({ error: 'Unauthorized for this repository' }, 401);
  }

  return c.json({
    access_token: c.env.GITHUB_PAT,
    token_type: 'bearer',
  });
});

export default app;

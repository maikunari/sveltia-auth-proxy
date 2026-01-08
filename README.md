# Sveltia Auth Proxy

A Cloudflare Worker-based authentication proxy for Sveltia CMS with Supabase backend.

## Project Structure

```
├── worker/           # Cloudflare Worker (Hono framework)
│   ├── src/
│   │   └── index.ts  # Main worker entry point
│   ├── package.json
│   ├── tsconfig.json
│   └── wrangler.toml # Wrangler configuration
├── supabase/         # Supabase configuration
│   ├── config.toml
│   └── migrations/   # Database migrations
└── README.md
```

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (included in worker dependencies)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (optional, for local development)

## Setup

### Cloudflare Worker

1. Navigate to the worker directory:
   ```bash
   cd worker
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure your environment variables in `wrangler.toml` or set secrets:
   ```bash
   npx wrangler secret put OAUTH_CLIENT_SECRET
   ```

4. Start local development:
   ```bash
   npm run dev
   ```

5. Deploy to Cloudflare:
   ```bash
   npm run deploy
   ```

### Supabase

1. Install the Supabase CLI:
   ```bash
   npm install -g supabase
   ```

2. Initialize Supabase locally (if not already done):
   ```bash
   supabase start
   ```

3. Apply migrations:
   ```bash
   supabase db push
   ```

4. For production, link your project:
   ```bash
   supabase link --project-ref <your-project-ref>
   ```

## Development

### Running the Worker Locally

```bash
cd worker
npm run dev
```

The worker will be available at `http://localhost:8787`.

### Creating Migrations

```bash
supabase migration new <migration_name>
```

This creates a new migration file in `supabase/migrations/`.

## Environment Variables

### Worker

| Variable | Description |
|----------|-------------|
| `OAUTH_CLIENT_ID` | OAuth provider client ID |
| `OAUTH_CLIENT_SECRET` | OAuth provider client secret (set as secret) |

## License

MIT

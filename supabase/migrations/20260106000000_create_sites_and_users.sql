-- Create sites table
CREATE TABLE sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    github_repo TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'editor')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (email, site_id)
);

-- Create index for faster lookups
CREATE INDEX idx_users_site_id ON users(site_id);
CREATE INDEX idx_users_email ON users(email);

-- Enable RLS
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- RLS policies: only service role can read
CREATE POLICY "Service role can read sites"
    ON sites
    FOR SELECT
    TO service_role
    USING (true);

CREATE POLICY "Service role can insert sites"
    ON sites
    FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "Service role can update sites"
    ON sites
    FOR UPDATE
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can delete sites"
    ON sites
    FOR DELETE
    TO service_role
    USING (true);

CREATE POLICY "Service role can read users"
    ON users
    FOR SELECT
    TO service_role
    USING (true);

CREATE POLICY "Service role can insert users"
    ON users
    FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "Service role can update users"
    ON users
    FOR UPDATE
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can delete users"
    ON users
    FOR DELETE
    TO service_role
    USING (true);

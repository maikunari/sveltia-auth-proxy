-- Add branding columns to sites table
ALTER TABLE sites
ADD COLUMN logo_url TEXT,
ADD COLUMN brand_name TEXT,
ADD COLUMN primary_color TEXT DEFAULT '#6366f1';

/*
# Create notion_tokens table

1. New Tables
- `notion_tokens`
  - `id` (uuid, primary key, auto-generated)
  - `access_token` (text, not null) — the Notion OAuth access token
  - `workspace_name` (text, nullable) — the connected workspace display name
  - `created_at` (timestamptz, default now())

2. Security
- RLS enabled on `notion_tokens`.
- No policies are added: the table is ONLY accessible via the service role key
  (used by edge functions). The frontend never reads or writes this table directly,
  so anon/authenticated roles have no access. This keeps Notion access tokens
  fully server-side.

3. Purpose
- After Notion OAuth code exchange, the edge function stores the access token here
  and returns only the row UUID to the frontend. Other edge functions look up the
  token by UUID (using the service role key) to call the Notion API.
*/

CREATE TABLE IF NOT EXISTS notion_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token text NOT NULL,
  workspace_name text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE notion_tokens ENABLE ROW LEVEL SECURITY;

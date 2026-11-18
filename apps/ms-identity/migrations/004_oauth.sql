-- OAuth 2.1 authorization server for MCP clients: dynamically registered public
-- clients, single-use authorization codes and rotating refresh tokens. Codes and
-- refresh tokens are stored only as SHA-256 hashes. A family groups the refresh
-- tokens descending from one authorization code, so reuse revokes all of them.
CREATE TABLE identity.oauth_clients (
  client_id text PRIMARY KEY,
  client_name text,
  redirect_uris text[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 10),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.oauth_authorization_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES identity.oauth_clients(client_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  scope text NOT NULL,
  resource text NOT NULL,
  family_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, user_id) REFERENCES identity.members(organization_id, user_id) ON DELETE CASCADE
);
CREATE INDEX oauth_authorization_codes_expires_at ON identity.oauth_authorization_codes(expires_at);

CREATE TABLE identity.oauth_refresh_tokens (
  token_hash text PRIMARY KEY,
  family_id uuid NOT NULL,
  client_id text NOT NULL REFERENCES identity.oauth_clients(client_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  scope text NOT NULL,
  resource text NOT NULL,
  expires_at timestamptz NOT NULL,
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, user_id) REFERENCES identity.members(organization_id, user_id) ON DELETE CASCADE
);
CREATE INDEX oauth_refresh_tokens_family_id ON identity.oauth_refresh_tokens(family_id);
CREATE INDEX oauth_refresh_tokens_expires_at ON identity.oauth_refresh_tokens(expires_at);

-- BetterAuth owns credentials, sessions and verification records.
-- Organization, membership, team and project assignment stay in the domain tables.
CREATE TABLE identity."user" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  name text NOT NULL,
  image text,
  "mustChangePassword" boolean NOT NULL DEFAULT false
);

CREATE TABLE identity.session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "userId" uuid NOT NULL REFERENCES identity."user"(id) ON DELETE CASCADE,
  "expiresAt" timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  "ipAddress" text,
  "userAgent" text
);
CREATE INDEX session_user_id ON identity.session("userId");
CREATE INDEX session_expires_at ON identity.session("expiresAt");

CREATE TABLE identity.account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "providerId" text NOT NULL,
  "accountId" text NOT NULL,
  "userId" uuid NOT NULL REFERENCES identity."user"(id) ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  UNIQUE ("providerId", "accountId")
);
CREATE INDEX account_user_id ON identity.account("userId");

CREATE TABLE identity.verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  value text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  identifier text NOT NULL
);
CREATE INDEX verification_identifier ON identity.verification(identifier);

-- Preserve existing user identities. Legacy scrypt hashes are not compatible with
-- BetterAuth's password format, so migrated accounts have no credential and must be
-- provisioned again by an administrator.
INSERT INTO identity."user"(id, email, name, "emailVerified", "mustChangePassword", "createdAt", "updatedAt")
SELECT id, email, email, false, must_change_password, now(), now() FROM identity.users
ON CONFLICT (email) DO NOTHING;

ALTER TABLE identity.members DROP CONSTRAINT IF EXISTS members_user_id_fkey;
ALTER TABLE identity.members
  ADD CONSTRAINT members_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity."user"(id);
DROP TABLE identity.users;

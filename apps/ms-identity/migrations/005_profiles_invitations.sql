-- Member title, team description and lead, and invitations by link. The team lead is a
-- member of the same organization (composite key, so it cannot point to another one).
ALTER TABLE identity.members
  ADD COLUMN title text CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 120);

ALTER TABLE identity.teams
  ADD COLUMN description text CHECK (description IS NULL OR char_length(description) <= 1000),
  ADD COLUMN lead_user_id uuid,
  ADD CONSTRAINT teams_lead_member_fkey FOREIGN KEY (organization_id, lead_user_id)
    REFERENCES identity.members(organization_id, user_id);

-- The link carries the only copy of the token: rows keep its SHA-256 hash. No outbox
-- trigger: the membership created on acceptance already produces its own events.
CREATE TABLE identity.invitations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES identity.organizations(id),
  email text NOT NULL CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  role text NOT NULL CHECK (role IN ('ADMIN','PROJECT_MANAGER','TEAM_LEAD','CONTRIBUTOR','VIEWER')),
  team_ids uuid[] NOT NULL DEFAULT '{}',
  title text CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 120),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, created_by) REFERENCES identity.members(organization_id, user_id),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);
CREATE INDEX invitations_organization_created ON identity.invitations(organization_id, created_at DESC);

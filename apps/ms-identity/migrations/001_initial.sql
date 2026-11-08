CREATE SCHEMA IF NOT EXISTS identity;
CREATE TABLE identity.users (id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL, active boolean NOT NULL DEFAULT true, failed_attempts integer NOT NULL DEFAULT 0, locked_until timestamptz);
CREATE TABLE identity.organizations (id uuid PRIMARY KEY, name text NOT NULL, active boolean NOT NULL DEFAULT true);
CREATE TABLE identity.members (organization_id uuid NOT NULL REFERENCES identity.organizations(id), user_id uuid NOT NULL REFERENCES identity.users(id), role text NOT NULL CHECK (role IN ('ADMIN','PROJECT_MANAGER','TEAM_LEAD','CONTRIBUTOR','VIEWER')), active boolean NOT NULL DEFAULT true, PRIMARY KEY (organization_id,user_id));
CREATE TABLE identity.teams (organization_id uuid NOT NULL REFERENCES identity.organizations(id), id uuid NOT NULL, name text NOT NULL, active boolean NOT NULL DEFAULT true, PRIMARY KEY (organization_id,id));
CREATE TABLE identity.team_members (organization_id uuid NOT NULL, team_id uuid NOT NULL, user_id uuid NOT NULL, PRIMARY KEY (organization_id,team_id,user_id), FOREIGN KEY (organization_id,team_id) REFERENCES identity.teams(organization_id,id), FOREIGN KEY (organization_id,user_id) REFERENCES identity.members(organization_id,user_id));
CREATE TABLE identity.project_assignments (organization_id uuid NOT NULL, user_id uuid NOT NULL, project_id uuid NOT NULL, PRIMARY KEY (organization_id,user_id,project_id), FOREIGN KEY (organization_id,user_id) REFERENCES identity.members(organization_id,user_id));
CREATE INDEX ON identity.members(user_id);
CREATE TABLE identity.outbox_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), occurred_at timestamptz NOT NULL DEFAULT now(), event_type text NOT NULL, organization_id uuid NOT NULL, data jsonb NOT NULL, published_at timestamptz);
CREATE FUNCTION identity.record_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE record_data jsonb; org_id uuid;
BEGIN
  record_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  org_id := CASE WHEN TG_TABLE_NAME = 'organizations' THEN (record_data->>'id')::uuid ELSE (record_data->>'organization_id')::uuid END;
  INSERT INTO identity.outbox_events(event_type,organization_id,data) VALUES ('identity.' || TG_TABLE_NAME || '.' || lower(TG_OP), org_id, record_data);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER organization_outbox AFTER INSERT OR UPDATE OR DELETE ON identity.organizations FOR EACH ROW EXECUTE FUNCTION identity.record_change();
CREATE TRIGGER member_outbox AFTER INSERT OR UPDATE OR DELETE ON identity.members FOR EACH ROW EXECUTE FUNCTION identity.record_change();
CREATE TRIGGER team_outbox AFTER INSERT OR UPDATE OR DELETE ON identity.teams FOR EACH ROW EXECUTE FUNCTION identity.record_change();
CREATE TRIGGER team_member_outbox AFTER INSERT OR UPDATE OR DELETE ON identity.team_members FOR EACH ROW EXECUTE FUNCTION identity.record_change();
CREATE TRIGGER project_assignment_outbox AFTER INSERT OR UPDATE OR DELETE ON identity.project_assignments FOR EACH ROW EXECUTE FUNCTION identity.record_change();

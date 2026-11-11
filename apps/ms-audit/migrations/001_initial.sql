-- Audit is append-only: the database rejects edits and deletes of recorded events.
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE audit.events (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version integer NOT NULL,
  actor_id uuid NOT NULL,
  actor_source text NOT NULL,
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX audit_events_org_time ON audit.events(organization_id, occurred_at DESC, id DESC);
CREATE INDEX audit_events_org_project_time ON audit.events(organization_id, project_id, occurred_at DESC, id DESC);
CREATE INDEX audit_events_org_type_time ON audit.events(organization_id, event_type, occurred_at DESC, id DESC);
CREATE INDEX audit_events_org_actor_time ON audit.events(organization_id, actor_id, occurred_at DESC, id DESC);
CREATE INDEX audit_events_org_aggregate ON audit.events(organization_id, aggregate_type, aggregate_id);

CREATE FUNCTION audit.reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only';
END;
$$;

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit.events
FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit.events
FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();

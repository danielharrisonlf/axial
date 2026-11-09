CREATE TABLE notifications.preferences (
 organization_id uuid NOT NULL, user_id uuid NOT NULL, channel text NOT NULL CHECK (channel IN ('email','sms','whatsapp')),
 enabled boolean NOT NULL DEFAULT false, destination text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (organization_id,user_id,channel)
);
CREATE TABLE notifications.events (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, payload jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notifications.deliveries (
 id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES notifications.events(id), organization_id uuid NOT NULL,
 user_id uuid NOT NULL, channel text NOT NULL CHECK(channel IN ('email','sms','whatsapp')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','failed')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz,
 provider_id text, last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,user_id,channel)
);
CREATE INDEX ON notifications.deliveries(status,next_attempt_at);

CREATE TABLE notifications.event_preferences (
 organization_id uuid NOT NULL, user_id uuid NOT NULL, event_type text NOT NULL,
 channel text NOT NULL CHECK (channel IN ('email','sms','whatsapp')),
 enabled boolean NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (organization_id, user_id, event_type, channel)
);

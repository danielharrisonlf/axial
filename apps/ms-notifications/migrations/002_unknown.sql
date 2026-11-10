ALTER TABLE notifications.deliveries DROP CONSTRAINT IF EXISTS deliveries_status_check;
ALTER TABLE notifications.deliveries ADD CONSTRAINT deliveries_status_check CHECK (status IN ('pending','sending','accepted','failed','unknown'));
ALTER TABLE notifications.preferences ADD COLUMN IF NOT EXISTS verified_at timestamptz;

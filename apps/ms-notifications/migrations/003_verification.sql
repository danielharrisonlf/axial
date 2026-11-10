CREATE TABLE notifications.verification_challenges (
 organization_id uuid NOT NULL, user_id uuid NOT NULL, channel text NOT NULL,
 destination text NOT NULL, digest bytea NOT NULL, expires_at timestamptz NOT NULL,
 attempts integer NOT NULL DEFAULT 0, consumed_at timestamptz,
 PRIMARY KEY (organization_id,user_id,channel),
 FOREIGN KEY (organization_id,user_id,channel) REFERENCES notifications.preferences ON DELETE CASCADE
);
CREATE TABLE notifications.verification_limits (
 kind text NOT NULL, key_digest bytea NOT NULL, window_start timestamptz NOT NULL DEFAULT now(),
 sends integer NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0, last_send timestamptz,
 PRIMARY KEY(kind,key_digest)
);
CREATE FUNCTION notifications.invalidate_verification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT NEW.enabled OR OLD.destination IS DISTINCT FROM NEW.destination THEN
   NEW.verified_at := NULL;
   DELETE FROM notifications.verification_challenges WHERE organization_id=NEW.organization_id AND user_id=NEW.user_id AND channel=NEW.channel;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invalidate_verification BEFORE UPDATE ON notifications.preferences
FOR EACH ROW EXECUTE FUNCTION notifications.invalidate_verification();
-- Earlier verification marks were external assertions, not local proofs.
UPDATE notifications.preferences SET verified_at=NULL WHERE verified_at IS NOT NULL;

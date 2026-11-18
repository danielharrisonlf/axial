-- Event preferences were stored with catalog names suffixed by ".v1" (for example
-- "task.assigned.v1") while ms-projects emits "task.assigned", so opt-outs never matched.
-- Rename stored rows to the emitted names; a row already stored under the new name wins.
UPDATE notifications.event_preferences p
SET event_type = left(p.event_type, length(p.event_type) - 3), updated_at = now()
WHERE p.event_type IN ('task.assigned.v1','task.updated.v1','task.status_changed.v1','task.completed.v1')
  AND NOT EXISTS (
    SELECT 1 FROM notifications.event_preferences n
    WHERE n.organization_id = p.organization_id AND n.user_id = p.user_id AND n.channel = p.channel
      AND n.event_type = left(p.event_type, length(p.event_type) - 3)
  );
-- Remaining legacy rows are duplicates of a renamed row; "task.blocked.v1" is never emitted.
DELETE FROM notifications.event_preferences
WHERE event_type IN ('task.assigned.v1','task.updated.v1','task.status_changed.v1','task.completed.v1','task.blocked.v1');

ALTER TABLE facilities
  ADD COLUMN export_token_ttl_days integer NOT NULL DEFAULT 7;

ALTER TABLE export_tokens
  ADD COLUMN scope text,
  ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN revoked_at timestamptz;

UPDATE export_tokens
SET scope = COALESCE(scope, 'export:' || export_type)
WHERE scope IS NULL;

UPDATE export_tokens
SET created_by = COALESCE(created_by, user_id)
WHERE created_by IS NULL;

ALTER TABLE export_tokens
  ALTER COLUMN scope SET NOT NULL;

ALTER TABLE export_schedules
  ALTER COLUMN expires_hours SET DEFAULT 168;

UPDATE export_schedules
SET expires_hours = 168
WHERE expires_hours = 72;

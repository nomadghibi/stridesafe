ALTER TABLE facilities
  ADD COLUMN assessment_protocol text,
  ADD COLUMN capture_method text,
  ADD COLUMN role_policy text;

UPDATE facilities
SET assessment_protocol = COALESCE(assessment_protocol, 'tug_chair_balance'),
    capture_method = COALESCE(capture_method, 'record_upload'),
    role_policy = COALESCE(role_policy, 'clinician_admin_only');

ALTER TABLE facilities
  ALTER COLUMN assessment_protocol SET DEFAULT 'tug_chair_balance',
  ALTER COLUMN capture_method SET DEFAULT 'record_upload',
  ALTER COLUMN role_policy SET DEFAULT 'clinician_admin_only',
  ALTER COLUMN assessment_protocol SET NOT NULL,
  ALTER COLUMN capture_method SET NOT NULL,
  ALTER COLUMN role_policy SET NOT NULL;

ALTER TABLE facilities
  ADD CONSTRAINT facilities_assessment_protocol_check
    CHECK (assessment_protocol IN ('tug_chair_balance', 'tug_only', 'balance_only')),
  ADD CONSTRAINT facilities_capture_method_check
    CHECK (capture_method IN ('record_upload', 'upload_only')),
  ADD CONSTRAINT facilities_role_policy_check
    CHECK (role_policy IN ('clinician_admin_only', 'admin_only'));

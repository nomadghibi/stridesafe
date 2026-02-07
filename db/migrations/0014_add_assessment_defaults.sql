ALTER TABLE assessments
  ADD COLUMN assessment_protocol text,
  ADD COLUMN capture_method text;

UPDATE assessments a
SET assessment_protocol = COALESCE(f.assessment_protocol, 'tug_chair_balance'),
    capture_method = COALESCE(f.capture_method, 'record_upload')
FROM residents r
JOIN facilities f ON f.id = r.facility_id
WHERE a.resident_id = r.id;

ALTER TABLE assessments
  ALTER COLUMN assessment_protocol SET DEFAULT 'tug_chair_balance',
  ALTER COLUMN capture_method SET DEFAULT 'record_upload',
  ALTER COLUMN assessment_protocol SET NOT NULL,
  ALTER COLUMN capture_method SET NOT NULL;

ALTER TABLE assessments
  ADD CONSTRAINT assessments_assessment_protocol_check
    CHECK (assessment_protocol IN ('tug_chair_balance', 'tug_only', 'balance_only')),
  ADD CONSTRAINT assessments_capture_method_check
    CHECK (capture_method IN ('record_upload', 'upload_only'));

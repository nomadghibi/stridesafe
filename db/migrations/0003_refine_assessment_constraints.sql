ALTER TABLE assessments
  DROP CONSTRAINT IF EXISTS assessments_status_check;

ALTER TABLE assessments
  ADD CONSTRAINT assessments_status_check
  CHECK (status IN ('draft', 'needs_review', 'in_review', 'completed'));

ALTER TABLE assessments
  DROP CONSTRAINT IF EXISTS assessments_assistive_device_check;

UPDATE assessments
SET status = 'needs_review'
WHERE status = 'draft';

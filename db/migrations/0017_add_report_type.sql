ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS report_type TEXT;

UPDATE reports
SET report_type = 'assessment'
WHERE report_type IS NULL;

ALTER TABLE reports
  ALTER COLUMN report_type SET DEFAULT 'assessment';

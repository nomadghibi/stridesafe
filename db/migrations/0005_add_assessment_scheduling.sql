ALTER TABLE assessments
  ADD COLUMN scheduled_date date,
  ADD COLUMN due_date date,
  ADD COLUMN reassessment_due_date date,
  ADD COLUMN completed_at timestamptz;

UPDATE assessments
  SET scheduled_date = assessment_date
  WHERE scheduled_date IS NULL;

UPDATE assessments
  SET due_date = assessment_date
  WHERE due_date IS NULL;

CREATE INDEX idx_assessments_due_date ON assessments(due_date);

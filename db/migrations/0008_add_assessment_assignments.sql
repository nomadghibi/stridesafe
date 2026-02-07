ALTER TABLE assessments
  ADD COLUMN assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN assigned_at timestamptz;

CREATE INDEX idx_assessments_assigned_to ON assessments(assigned_to);

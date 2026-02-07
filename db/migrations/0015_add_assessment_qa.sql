CREATE TABLE assessment_qa (
  assessment_id uuid PRIMARY KEY REFERENCES assessments(id) ON DELETE CASCADE,
  checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  escalated boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_assessment_qa_updated_at ON assessment_qa(updated_at DESC);

CREATE TABLE gait_model_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid REFERENCES facilities(id) ON DELETE CASCADE,
  assessment_id uuid REFERENCES assessments(id) ON DELETE CASCADE,
  video_id uuid REFERENCES videos(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  model_version text NOT NULL DEFAULT 'pose_stub_v0',
  tug_seconds numeric,
  chair_stand_seconds numeric,
  balance_side_by_side boolean,
  balance_semi_tandem boolean,
  balance_tandem boolean,
  confidence numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('pending', 'running', 'completed', 'failed'))
);

CREATE INDEX idx_gait_model_runs_facility_id
  ON gait_model_runs(facility_id);

CREATE INDEX idx_gait_model_runs_assessment_id
  ON gait_model_runs(assessment_id);

CREATE INDEX idx_gait_model_runs_video_id
  ON gait_model_runs(video_id);

CREATE INDEX idx_gait_model_runs_status
  ON gait_model_runs(status);

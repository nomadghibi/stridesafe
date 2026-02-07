CREATE TABLE export_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  name text NOT NULL,
  export_type text NOT NULL,
  params jsonb,
  include jsonb,
  expires_hours integer NOT NULL DEFAULT 72,
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly')),
  day_of_week integer CHECK (day_of_week BETWEEN 0 AND 6),
  hour integer NOT NULL CHECK (hour BETWEEN 0 AND 23),
  minute integer NOT NULL CHECK (minute BETWEEN 0 AND 59),
  status text NOT NULL CHECK (status IN ('active', 'paused')),
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_export_schedules_facility ON export_schedules(facility_id);
CREATE INDEX idx_export_schedules_status ON export_schedules(status);
CREATE INDEX idx_export_schedules_next_run ON export_schedules(next_run_at);

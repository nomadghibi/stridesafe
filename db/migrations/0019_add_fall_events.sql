CREATE TABLE fall_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid REFERENCES facilities(id) ON DELETE CASCADE,
  resident_id uuid REFERENCES residents(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL,
  building text,
  floor text,
  unit text,
  room text,
  witness text,
  injury_severity text,
  ems_called boolean NOT NULL DEFAULT false,
  hospital_transfer boolean NOT NULL DEFAULT false,
  assistive_device text,
  contributing_factors jsonb,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE post_fall_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fall_event_id uuid REFERENCES fall_events(id) ON DELETE CASCADE,
  check_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  completed_at timestamptz,
  completed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fall_event_id, check_type)
);

CREATE INDEX idx_fall_events_facility ON fall_events(facility_id, occurred_at DESC);
CREATE INDEX idx_fall_events_resident ON fall_events(resident_id, occurred_at DESC);
CREATE INDEX idx_post_fall_checks_event ON post_fall_checks(fall_event_id);

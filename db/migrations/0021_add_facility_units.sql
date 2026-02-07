CREATE TABLE facility_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  label text NOT NULL,
  building text,
  floor text,
  unit text,
  room text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (facility_id, label)
);

ALTER TABLE residents
  ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES facility_units(id) ON DELETE SET NULL;

CREATE INDEX idx_facility_units_facility ON facility_units(facility_id);
CREATE INDEX idx_residents_unit_id ON residents(unit_id);

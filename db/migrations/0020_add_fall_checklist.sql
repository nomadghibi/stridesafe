ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS fall_checklist jsonb NOT NULL DEFAULT '[]'::jsonb;

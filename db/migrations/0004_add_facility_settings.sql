ALTER TABLE facilities
  ADD COLUMN reassessment_cadence_days integer NOT NULL DEFAULT 90,
  ADD COLUMN report_turnaround_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN qa_checklist jsonb NOT NULL DEFAULT '[]'::jsonb;

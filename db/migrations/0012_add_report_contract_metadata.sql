ALTER TABLE reports
  ADD COLUMN template_version text NOT NULL DEFAULT 'v1',
  ADD COLUMN generated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN generated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN finalized boolean NOT NULL DEFAULT true;

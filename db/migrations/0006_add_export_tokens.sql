CREATE TABLE export_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL,
  export_type text NOT NULL,
  params jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

CREATE TABLE export_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL,
  export_token_id uuid REFERENCES export_tokens(id) ON DELETE SET NULL,
  export_type text NOT NULL,
  params jsonb,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_export_tokens_expires_at ON export_tokens(expires_at);
CREATE INDEX idx_export_logs_facility_created_at ON export_logs(facility_id, created_at DESC);

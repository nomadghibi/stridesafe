CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid REFERENCES facilities(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb,
  channel text NOT NULL DEFAULT 'in_app',
  status text NOT NULL DEFAULT 'unread',
  event_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE UNIQUE INDEX idx_notifications_event_key
  ON notifications(event_key);

CREATE INDEX idx_notifications_user_created_at
  ON notifications(user_id, created_at DESC);

CREATE INDEX idx_notifications_facility_created_at
  ON notifications(facility_id, created_at DESC);

CREATE TABLE task_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_key text,
  task_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  payload jsonb,
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('pending', 'running', 'completed', 'failed'))
);

CREATE UNIQUE INDEX idx_task_queue_task_key
  ON task_queue(task_key);

CREATE INDEX idx_task_queue_status_run_at
  ON task_queue(status, run_at);

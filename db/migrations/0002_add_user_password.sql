ALTER TABLE users
  ADD COLUMN password_salt text,
  ADD COLUMN password_hash text;

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

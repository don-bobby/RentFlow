-- "Ask your data": per-user daily question count and a small log of what was asked.
CREATE TABLE IF NOT EXISTS ask_usage (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     DATE    NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS ask_log (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  question   VARCHAR(500) NOT NULL,
  tools      TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

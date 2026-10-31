-- Remembers operations sent from phones that may retry after losing signal, so a retry never
-- records a payment or request twice. Rows older than 30 days are cleaned up automatically.
CREATE TABLE IF NOT EXISTS op_log (
  op_id      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  method     VARCHAR(10),
  path       VARCHAR(200),
  status     INTEGER,
  response   JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_op_log_created ON op_log(created_at);

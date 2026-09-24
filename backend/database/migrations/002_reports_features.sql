-- Run this once against your RentFlow database (e.g. psql -f 002_reports_features.sql)

-- ── 14. Vacancy duration ────────────────────────────────────────────────────
ALTER TABLE houses ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMP DEFAULT NOW();
-- Backfill existing rows so current vacant units don't all show "0 days" —
-- best guess is the row's own updated_at/created_at if you have one, else now().
UPDATE houses SET status_changed_at = NOW() WHERE status_changed_at IS NULL;

-- ── 17. Deposit ledger ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deposit_transactions (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  house_id    INTEGER REFERENCES houses(id)  ON DELETE SET NULL,
  type        TEXT NOT NULL CHECK (type IN ('collected', 'refunded', 'forfeited')),
  amount      NUMERIC NOT NULL,
  notes       TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deposit_tx_tenant ON deposit_transactions(tenant_id);

-- ── 18. Audit trail ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name   TEXT,
  action      TEXT NOT NULL,          -- e.g. 'tenant.update', 'house.approve'
  entity_type TEXT NOT NULL,          -- e.g. 'tenant', 'house', 'user'
  entity_id   INTEGER,
  changes     JSONB,                  -- { field: { from, to } } pairs
  created_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

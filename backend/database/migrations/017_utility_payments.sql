-- 017_utility_payments.sql
-- Optional utility money collected from a tenant alongside (or instead of)
-- rent: water, electricity, garbage, etc. Kept in its own table so it NEVER
-- touches rent balances/arrears. The landlord's bill for the same utility is
-- an ordinary `expenses` row; these receipts are the "recovered from
-- tenants" side, and the Expenses page nets the two.
CREATE TABLE IF NOT EXISTS utility_payments (
  id             SERIAL PRIMARY KEY,
  tenant_id      INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  house_id       INTEGER REFERENCES houses(id),
  plot_id        INTEGER REFERENCES plots(id),
  utility_type   VARCHAR(50) NOT NULL,
  amount         DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  payment_date   DATE NOT NULL,
  method         VARCHAR(30),
  reference      VARCHAR(100),
  notes          TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_utility_payments_plot   ON utility_payments (plot_id);
CREATE INDEX IF NOT EXISTS idx_utility_payments_tenant ON utility_payments (tenant_id);

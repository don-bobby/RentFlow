-- 030_shared_meter_payers.sql
-- Extra water payers on a unit: a second business under the same roof that pays
-- rent as one unit with the tenant but pays its own water. Just a name (not a
-- tenant record). Their payments are kept apart from the unit tenant's.
CREATE TABLE IF NOT EXISTS shared_meter_payers (
  id         SERIAL PRIMARY KEY,
  meter_id   INTEGER NOT NULL REFERENCES shared_meters(id) ON DELETE CASCADE,
  house_id   INTEGER NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  name       VARCHAR(80) NOT NULL,
  phone      VARCHAR(20),
  category   VARCHAR(30),
  weight     NUMERIC(8,2) NOT NULL DEFAULT 1 CHECK (weight > 0),
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shared_meter_payers_meter ON shared_meter_payers (meter_id);

CREATE TABLE IF NOT EXISTS shared_meter_payments (
  id           SERIAL PRIMARY KEY,
  payer_id     INTEGER NOT NULL REFERENCES shared_meter_payers(id) ON DELETE CASCADE,
  amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL,
  method       VARCHAR(30),
  reference    VARCHAR(100),
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shared_meter_payments_payer ON shared_meter_payments (payer_id);

-- A bill share can now belong to a payer; one unit may then have two shares on a bill.
ALTER TABLE shared_bill_shares ADD COLUMN IF NOT EXISTS payer_id INTEGER REFERENCES shared_meter_payers(id) ON DELETE SET NULL;
ALTER TABLE shared_bill_shares DROP CONSTRAINT IF EXISTS shared_bill_shares_bill_id_house_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_shared_bill_shares_payer ON shared_bill_shares (bill_id, house_id, COALESCE(payer_id, 0));

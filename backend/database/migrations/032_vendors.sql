-- Vendor directory (plumbers, electricians...) linked to maintenance requests.
CREATE TABLE IF NOT EXISTS vendors (
  id          SERIAL PRIMARY KEY,
  landlord_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(120) NOT NULL,
  trade       VARCHAR(60),
  phone       VARCHAR(25),
  email       VARCHAR(120),
  area        VARCHAR(120),
  notes       TEXT,
  rating      SMALLINT CHECK (rating BETWEEN 1 AND 5),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vendors_landlord ON vendors(landlord_id);

ALTER TABLE maintenance_requests
  ADD COLUMN IF NOT EXISTS vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_assigned_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_maint_vendor ON maintenance_requests(vendor_id);

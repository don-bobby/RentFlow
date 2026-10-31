-- 031_mri_tax.sql
-- KRA Monthly Rental Income (MRI) helper. Figures only: it never files anything.
-- Rates and thresholds live in tax_settings so they can be changed when KRA's rules change.
ALTER TABLE users  ADD COLUMN IF NOT EXISTS kra_pin VARCHAR(11);
-- 'mixed' = decide per unit (unit override, else by unit type). MRI covers residential rent only.
ALTER TABLE plots  ADD COLUMN IF NOT EXISTS rental_use VARCHAR(12) NOT NULL DEFAULT 'mixed';
ALTER TABLE plots  DROP CONSTRAINT IF EXISTS plots_rental_use_check;
ALTER TABLE plots  ADD  CONSTRAINT plots_rental_use_check CHECK (rental_use IN ('residential','commercial','mixed'));
ALTER TABLE houses ADD COLUMN IF NOT EXISTS use_type VARCHAR(12);
ALTER TABLE houses DROP CONSTRAINT IF EXISTS houses_use_type_check;
ALTER TABLE houses ADD  CONSTRAINT houses_use_type_check CHECK (use_type IS NULL OR use_type IN ('residential','commercial'));

CREATE TABLE IF NOT EXISTS tax_settings (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  mri_rate           NUMERIC(5,2)  NOT NULL DEFAULT 7.5,        -- % of gross rent received
  lower_threshold    NUMERIC(12,2) NOT NULL DEFAULT 288000,      -- yearly; sources differ (280,000 in KRA's 2024 guide): confirm
  upper_threshold    NUMERIC(12,2) NOT NULL DEFAULT 15000000,
  due_day            INTEGER       NOT NULL DEFAULT 20 CHECK (due_day BETWEEN 1 AND 28),  -- of the following month: confirm
  late_filing_min    NUMERIC(10,2) NOT NULL DEFAULT 2000,
  late_filing_pct    NUMERIC(5,2)  NOT NULL DEFAULT 5,
  late_payment_pct   NUMERIC(5,2)  NOT NULL DEFAULT 5,
  late_interest_pct  NUMERIC(5,2)  NOT NULL DEFAULT 1,           -- per month or part of a month
  updated_by         INTEGER REFERENCES users(id),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO tax_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Tracks what has been filed / paid on KRA's system, per landlord and month.
CREATE TABLE IF NOT EXISTS tax_returns (
  id          SERIAL PRIMARY KEY,
  landlord_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period      CHAR(7) NOT NULL,                 -- 'YYYY-MM' of the rent
  gross       NUMERIC(14,2) NOT NULL DEFAULT 0, -- residential rent collected, when marked
  tax         NUMERIC(14,2) NOT NULL DEFAULT 0,
  filed_on    DATE,
  paid_on     DATE,
  reference   VARCHAR(60),                      -- KRA payment registration number
  notes       TEXT,
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (landlord_id, period)
);

INSERT INTO role_permissions (profile, permission, allowed) VALUES
('agent',               'tax.view', true),
('landlord_self',       'tax.view', true),
('landlord_with_agent', 'tax.view', false),
('caretaker',           'tax.view', false)
ON CONFLICT (profile, permission) DO NOTHING;

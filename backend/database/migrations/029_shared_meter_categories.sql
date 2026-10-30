-- 029_shared_meter_categories.sql
-- Optional per-meter "split by category" mode (e.g. Wachege Building: salons pay
-- one amount per unit, shops and offices another). Meters stay in the default
-- 'weight' mode (equal unless weighted) unless switched.
ALTER TABLE shared_meters      ADD COLUMN IF NOT EXISTS split_mode VARCHAR(10) NOT NULL DEFAULT 'weight';
ALTER TABLE shared_meters      DROP CONSTRAINT IF EXISTS shared_meters_split_mode_check;
ALTER TABLE shared_meters      ADD  CONSTRAINT shared_meters_split_mode_check CHECK (split_mode IN ('weight','category'));
ALTER TABLE shared_meter_units ADD COLUMN IF NOT EXISTS category VARCHAR(30);
ALTER TABLE shared_bills       ADD COLUMN IF NOT EXISTS category_rates JSONB;   -- { "Salon": 400, "Shop": 200 } as entered
ALTER TABLE shared_bill_shares ADD COLUMN IF NOT EXISTS category VARCHAR(30);

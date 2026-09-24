-- RentFlow Migration: Public Listings Enhancement
-- Run: psql -U postgres -d rentflow_db -f 001_public_listings.sql
-- ============================================================

-- Add public listing fields to houses table
ALTER TABLE houses
  ADD COLUMN IF NOT EXISTS description        TEXT,
  ADD COLUMN IF NOT EXISTS media              JSONB        DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tags               JSONB        DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS management_type    VARCHAR(20)  DEFAULT 'landlord'
                                              CHECK (management_type IN ('landlord', 'agent')),
  ADD COLUMN IF NOT EXISTS electricity_type   VARCHAR(20)  DEFAULT 'postpaid'
                                              CHECK (electricity_type IN ('prepaid', 'postpaid')),
  ADD COLUMN IF NOT EXISTS water_type         VARCHAR(20)  DEFAULT 'included'
                                              CHECK (water_type IN ('included', 'metered', 'borehole')),
  ADD COLUMN IF NOT EXISTS furnishing         VARCHAR(20)  DEFAULT 'unfurnished'
                                              CHECK (furnishing IN ('furnished', 'semi-furnished', 'unfurnished')),
  ADD COLUMN IF NOT EXISTS available_from     DATE,
  ADD COLUMN IF NOT EXISTS is_published       BOOLEAN      DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS published_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contact_phone      VARCHAR(20),
  ADD COLUMN IF NOT EXISTS contact_name       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS views_count        INTEGER      DEFAULT 0;

-- Index for fast public listing queries
CREATE INDEX IF NOT EXISTS idx_houses_published
  ON houses (is_published, status)
  WHERE is_published = TRUE;

-- Optional preset tags reference table (for autocomplete suggestions)
CREATE TABLE IF NOT EXISTS listing_tag_presets (
  id      SERIAL PRIMARY KEY,
  tag     VARCHAR(50) UNIQUE NOT NULL,
  category VARCHAR(30) -- 'amenity', 'security', 'transport', 'policy'
);

INSERT INTO listing_tag_presets (tag, category) VALUES
  ('WiFi', 'amenity'),
  ('Parking', 'amenity'),
  ('Swimming Pool', 'amenity'),
  ('Gym', 'amenity'),
  ('Garden', 'amenity'),
  ('Balcony', 'amenity'),
  ('CCTV', 'security'),
  ('Gated Community', 'security'),
  ('24hr Security', 'security'),
  ('Near Matatu Stage', 'transport'),
  ('Near CBD', 'transport'),
  ('Near School', 'transport'),
  ('Pets Allowed', 'policy'),
  ('No Pets', 'policy'),
  ('DSQ', 'amenity'),
  ('Borehole Water', 'amenity'),
  ('Generator Backup', 'amenity'),
  ('Lift/Elevator', 'amenity'),
  ('Rooftop', 'amenity'),
  ('Shopping Mall Nearby', 'transport')
ON CONFLICT (tag) DO NOTHING;

-- View: enriched public listings with plot and landlord info
DROP VIEW IF EXISTS public_listings_view;

CREATE VIEW public_listings_view AS
SELECT
  h.id,
  h.unit_number,
  h.house_type,
  h.rent_amount,
  h.description,
  h.media,
  h.tags,
  h.management_type,
  h.electricity_type,
  h.water_type,
  h.furnishing,
  h.available_from,
  h.contact_phone,
  h.contact_name,
  h.views_count,
  h.published_at,
  p.id        AS plot_id,
  p.name      AS plot_name,
  p.location,
  u.id        AS landlord_id,
  u.name      AS landlord_name,
  u.email     AS landlord_email,
  u.phone     AS landlord_phone
FROM houses h
JOIN plots  p ON p.id = h.plot_id
JOIN users  u ON u.id = p.user_id
WHERE h.is_published = TRUE
  AND h.status = 'vacant';

COMMENT ON VIEW public_listings_view IS
  'Public-facing view of published vacant units — safe to expose without auth';

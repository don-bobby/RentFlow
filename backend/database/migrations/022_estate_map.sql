-- 022_estate_map.sql
-- Admin "estate map": where each property sits on one shared map, plus the
-- roads/trees/ponds drawn between them.
ALTER TABLE plots ADD COLUMN IF NOT EXISTS map_x INTEGER;
ALTER TABLE plots ADD COLUMN IF NOT EXISTS map_z INTEGER;
ALTER TABLE plots ADD COLUMN IF NOT EXISTS map_rot SMALLINT NOT NULL DEFAULT 0 CHECK (map_rot BETWEEN 0 AND 3);

CREATE TABLE IF NOT EXISTS estate_map (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  pieces     JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO estate_map (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

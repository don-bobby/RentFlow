-- 020_building_layout.sql
-- Custom unit positions for the 3D building view.
-- A unit is placed on a floor at grid cell (layout_x, layout_z) and spans
-- layout_w x layout_d cells. NULL position = not placed yet (auto-arranged).
-- plots.layout_extras holds decorative/structural pieces drawn around the
-- units: [{ id, kind: corridor|stairs|garden|road, floor, x, z, w, d }].
ALTER TABLE houses
  ADD COLUMN IF NOT EXISTS layout_x INTEGER CHECK (layout_x IS NULL OR (layout_x >= 0 AND layout_x < 40)),
  ADD COLUMN IF NOT EXISTS layout_z INTEGER CHECK (layout_z IS NULL OR (layout_z >= 0 AND layout_z < 40)),
  ADD COLUMN IF NOT EXISTS layout_w INTEGER NOT NULL DEFAULT 1 CHECK (layout_w BETWEEN 1 AND 8),
  ADD COLUMN IF NOT EXISTS layout_d INTEGER NOT NULL DEFAULT 1 CHECK (layout_d BETWEEN 1 AND 8);

ALTER TABLE plots
  ADD COLUMN IF NOT EXISTS layout_extras JSONB NOT NULL DEFAULT '[]'::jsonb;

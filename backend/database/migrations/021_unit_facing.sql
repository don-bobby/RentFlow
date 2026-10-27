-- 021_unit_facing.sql
-- Which way a unit's front door faces in the 3D building view.
-- 0 = north (top of the layout grid), 1 = east, 2 = south (default), 3 = west.
ALTER TABLE houses ADD COLUMN IF NOT EXISTS layout_facing SMALLINT NOT NULL DEFAULT 2
  CHECK (layout_facing BETWEEN 0 AND 3);

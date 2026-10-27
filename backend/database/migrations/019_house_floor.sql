-- 019_house_floor.sql
-- Which floor a unit is on (0 = ground). Optional: the 3D building view
-- stacks units by this; units without a floor are auto-arranged instead.
ALTER TABLE houses ADD COLUMN IF NOT EXISTS floor INTEGER CHECK (floor IS NULL OR (floor >= 0 AND floor <= 60));

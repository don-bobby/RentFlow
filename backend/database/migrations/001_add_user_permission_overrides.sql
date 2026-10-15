-- Adds per-user, per-property permission overrides on top of the existing
-- role-based permission system (role_permissions table).
--
-- This migration ONLY creates the table — nothing in the app reads from it
-- yet, so running this has zero effect on how the system behaves today.
-- Stage 2 adds the admin API to create/read/delete rows here. Stage 3 wires
-- actual permission checks across the backend to respect them.
--
-- Design (see claude/per-user-per-property-permissions-scoping.md in the
-- project for the full write-up):
--   - A row either GRANTS a permission a role wouldn't normally have, or
--     REVOKES one a role normally would have — for one specific property,
--     or (plot_id IS NULL) for every property that user can already see.
--   - Most specific wins: a property-specific row beats an "all properties"
--     row, which beats the role default.
--   - Two rules enforced by the application, not the database (Postgres
--     CHECK constraints can't run subqueries against other tables):
--       1. user_id must belong to an agent/landlord/caretaker — never an
--          admin or super_admin. Admin/super_admin accounts are untouchable.
--       2. permission must already exist in role_permissions for some role
--          — this table is never used to invent a brand new permission
--          string nobody has ever had.
--     Both checks belong in the POST /api/users/:id/permissions route
--     handler added in stage 2, not here.

CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plot_id     INTEGER REFERENCES plots(id) ON DELETE CASCADE, -- NULL = every property this user can see
  permission  TEXT NOT NULL,
  effect      TEXT NOT NULL CHECK (effect IN ('grant', 'revoke')),
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, plot_id, permission)
);

-- Every lookup of "what are this user's overrides" (globally, and for one
-- specific property) goes through user_id, so that's the one index that
-- actually matters here — the UNIQUE constraint above already covers
-- (user_id, plot_id, permission) as a composite, but a plain user_id index
-- speeds up "give me ALL of this user's overrides regardless of plot_id",
-- which is what GET /api/users/:id/permissions and the resolution logic in
-- getPermissions() both need.
CREATE INDEX IF NOT EXISTS idx_user_permission_overrides_user_id
  ON user_permission_overrides(user_id);

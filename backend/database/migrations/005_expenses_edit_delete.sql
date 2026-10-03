-- 005_expenses_edit_delete.sql
--
-- expenses.js's PUT/DELETE routes were gated by role only (adminOrLandlord),
-- not the permission matrix. Fixing that in code means those routes now
-- check expenses.edit / expenses.delete — permissions that were never
-- seeded in 003, even though expenses.add was. Without this migration,
-- NOBODY except admin could edit or delete an expense anymore, including
-- agents and self-managed landlords who could before.
--
-- Granted to the same two profiles expenses.add already goes to, so add,
-- edit and delete are consistent with each other. landlord_with_agent and
-- caretaker still get neither, matching their view-only stance on expenses.
-- Safe to run more than once.

BEGIN;

INSERT INTO role_permissions (profile, permission, allowed) VALUES
  ('agent',         'expenses.edit',   true),
  ('agent',         'expenses.delete', true),
  ('landlord_self', 'expenses.edit',   true),
  ('landlord_self', 'expenses.delete', true)
ON CONFLICT (profile, permission) DO UPDATE SET allowed = EXCLUDED.allowed;

COMMIT;

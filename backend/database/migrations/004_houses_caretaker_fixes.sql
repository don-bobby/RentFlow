-- 004_houses_caretaker_fixes.sql
-- Adds three permission rows the original matrix (003) was missing, all
-- confirmed against real, already-working features rather than guessed:
--
-- 1. caretaker.houses.create   — caretakers submitting a pending unit for
--    approval is an existing, working feature; the matrix never had a row
--    for it at all.
-- 2. landlord_self.houses.approve — landlords approving/rejecting their own
--    caretaker's submitted units is also existing/working; the matrix only
--    granted this to 'agent'.
-- 3. caretaker.payments.view   — needed so the caretaker dashboard can show
--    "recent payments" and "pending dues", scoped to their own assigned
--    plot(s) only (payments.js already scopes this via getVisiblePlotIds).
--
-- Uses DO UPDATE rather than DO NOTHING so this is safe to re-run even if
-- one of these rows already exists with allowed = false for some reason.

BEGIN;

INSERT INTO role_permissions (profile, permission, allowed) VALUES
  ('caretaker',     'houses.create',  true),
  ('landlord_self', 'houses.approve', true),
  ('caretaker',     'payments.view',  true)
ON CONFLICT (profile, permission) DO UPDATE SET allowed = true;

COMMIT;

-- Rollback (run manually if needed):
-- BEGIN;
-- DELETE FROM role_permissions WHERE (profile, permission) IN
--   (('caretaker', 'houses.create'), ('landlord_self', 'houses.approve'), ('caretaker', 'payments.view'));
-- COMMIT;

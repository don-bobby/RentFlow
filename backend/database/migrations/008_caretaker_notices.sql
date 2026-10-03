-- 008_caretaker_notices.sql
--
-- Caretakers can now post notices (backend already updated to accept
-- them, scoped to their own assigned plot only — never "all", "staff", or
-- individual-tenant targeting). The frontend's "+ Post Notice" button
-- checks notices.create via the permission matrix, so without this grant
-- the button simply wouldn't show for them even though sending would work.
-- Safe to run more than once.

BEGIN;

INSERT INTO role_permissions (profile, permission, allowed) VALUES
  ('caretaker', 'notices.create', true)
ON CONFLICT (profile, permission) DO UPDATE SET allowed = EXCLUDED.allowed;

COMMIT;

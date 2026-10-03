-- 006_tenants_set_pin.sql
--
-- Splits "reset a tenant's login PIN" out from the general tenants.edit
-- permission, since they're different in sensitivity — editing a phone
-- number is routine, resetting someone's login credential is not. Seeded
-- to match tenants.edit's current grant exactly (agent + landlord_self),
-- so nothing changes in practice today; it just becomes independently
-- toggleable going forward.
-- Safe to run more than once.

BEGIN;

INSERT INTO role_permissions (profile, permission, allowed) VALUES
  ('agent',         'tenants.set_pin', true),
  ('landlord_self', 'tenants.set_pin', true)
ON CONFLICT (profile, permission) DO UPDATE SET allowed = EXCLUDED.allowed;

COMMIT;

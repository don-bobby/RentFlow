-- 007_national_id_unique.sql
--
-- National ID is now the tenant portal login key, so two tenants sharing
-- one silently breaks login for both of them.
--
-- Safe to run more than once.

BEGIN;

ALTER TABLE tenants
  ADD CONSTRAINT tenants_national_id_key UNIQUE (national_id);

COMMIT;
-- 006_agent_tenant_edit_revoke.sql
-- Agents should not be able to edit tenant records at all (no Edit button,
-- no PUT /tenants/:id access) — confirmed by Don. The matrix (003) had
-- granted agent.tenants.edit = true; this revokes it. tenants.create,
-- tenants.deactivate, tenants.view, tenants.view_sensitive are untouched —
-- only edit is being revoked.

BEGIN;

INSERT INTO role_permissions (profile, permission, allowed) VALUES
  ('agent', 'tenants.edit', false)
ON CONFLICT (profile, permission) DO UPDATE SET allowed = false;

COMMIT;

-- Rollback (run manually if needed):
-- UPDATE role_permissions SET allowed = true WHERE profile='agent' AND permission='tenants.edit';

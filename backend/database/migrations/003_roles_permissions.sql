-- 003_roles_permissions.sql
-- RentFlow: Super Admin / Agent / Landlord(with agent) / Landlord(self) / Caretaker permissions
--
-- Run this AFTER backing up (pg_dump). This migration does NOT rename the
-- 'admin' role to 'super_admin' yet — that happens in Phase 2, at the same
-- moment the new auth middleware goes live, so the app never has a moment
-- where 'admin' means nothing.

BEGIN;

-- ── 1. Agent relationship ───────────────────────────────────────────────────
-- Nullable: a landlord with no agent is self-managed, per Bob's decision.
-- ON DELETE SET NULL: if an agent user is deleted, their landlords fall back
-- to self-managed automatically (matches the agreed fallback rule).
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_agent_id ON users(agent_id);

-- ── 2. Permission matrix ────────────────────────────────────────────────────
-- One row per (profile, permission). super_admin is NOT stored here — it
-- always has every permission, enforced in code, so it can never be
-- accidentally locked out or edited.
CREATE TABLE IF NOT EXISTS role_permissions (
  id         SERIAL PRIMARY KEY,
  profile    VARCHAR(30)  NOT NULL,
  permission VARCHAR(60)  NOT NULL,
  allowed    BOOLEAN      NOT NULL DEFAULT false,
  UNIQUE (profile, permission)
);

-- Note: profile values (agent, landlord_with_agent, landlord_self, caretaker)
-- are not DB-constrained, so a new profile can be added later without a migration.

-- ── 3. Seed default permissions ─────────────────────────────────────────────
-- profiles: agent, landlord_with_agent, landlord_self, caretaker
-- (tenant is NOT a profile here — tenants authenticate separately via
-- tenants.pin / tenant_otps and the tenant-portal routes, which already
-- enforce "own data only"; they don't go through role_permissions)

INSERT INTO role_permissions (profile, permission, allowed) VALUES
-- ── Agent: everything except delete + system permissions ──
('agent', 'plots.view',              true),
('agent', 'plots.create',            true),
('agent', 'plots.edit',              true),
('agent', 'plots.delete',            false),
('agent', 'houses.view',             true),
('agent', 'houses.create',           true),
('agent', 'houses.edit',             true),
('agent', 'houses.delete',           false),
('agent', 'houses.approve',          true),
('agent', 'listings.publish',        true),
('agent', 'tenants.view',            true),
('agent', 'tenants.create',          true),
('agent', 'tenants.edit',            true),
('agent', 'tenants.deactivate',      true),
('agent', 'tenants.view_sensitive',  true),
('agent', 'payments.view',           true),
('agent', 'payments.record_manual',  true),
('agent', 'payments.reconcile_mpesa',true),
('agent', 'maintenance.view',        true),
('agent', 'maintenance.update',      true),
('agent', 'expenses.view',           true),
('agent', 'expenses.add',            true),
('agent', 'deposits.view',           true),
('agent', 'deposits.record',         true),
('agent', 'notices.view',            true),
('agent', 'notices.create',          true),
('agent', 'messages.send',           true),
('agent', 'users.create_caretaker',  true),
('agent', 'users.assign_caretaker',  true),
('agent', 'users.create_landlord',   true),
('agent', 'users.suspend_landlord',  true),
('agent', 'users.suspend_tenant',    true),
('agent', 'reports.payment_collection', true),
('agent', 'reports.unpaid_rent',        true),
('agent', 'reports.tenant_list',        true),
('agent', 'reports.maintenance',        true),
('agent', 'reports.property_summary',   true),
('agent', 'reports.occupancy',          true),
('agent', 'reports.expenses',           true),
('agent', 'reports.revenue_summary',    true),
('agent', 'reports.move_in_out',        true),
('agent', 'reports.expiring_leases',    true),

-- ── Landlord WITH an agent: view-only ──
('landlord_with_agent', 'plots.view',              true),
('landlord_with_agent', 'houses.view',              true),
('landlord_with_agent', 'tenants.view',             true),
('landlord_with_agent', 'tenants.view_sensitive',   false),
('landlord_with_agent', 'payments.view',            true),
('landlord_with_agent', 'maintenance.view',         true),
('landlord_with_agent', 'expenses.view',            true),
('landlord_with_agent', 'deposits.view',            true),
('landlord_with_agent', 'notices.view',             true),
('landlord_with_agent', 'messages.send',            true),
('landlord_with_agent', 'users.view_caretakers',    true),
('landlord_with_agent', 'reports.payment_collection', true),
('landlord_with_agent', 'reports.unpaid_rent',        true),
('landlord_with_agent', 'reports.tenant_list',        true),
('landlord_with_agent', 'reports.maintenance',        true),
('landlord_with_agent', 'reports.property_summary',   true),
('landlord_with_agent', 'reports.occupancy',          true),
('landlord_with_agent', 'reports.expenses',           false),
('landlord_with_agent', 'reports.revenue_summary',    true),
('landlord_with_agent', 'reports.move_in_out',        false),
('landlord_with_agent', 'reports.expiring_leases',    true),

-- ── Landlord SELF-managed (no agent): matches today's landlord behavior ──
('landlord_self', 'plots.view',              true),
('landlord_self', 'plots.create',            true),
('landlord_self', 'plots.edit',              true),
('landlord_self', 'plots.delete',            false),
('landlord_self', 'houses.view',             true),
('landlord_self', 'houses.create',           true),
('landlord_self', 'houses.edit',             true),
('landlord_self', 'houses.delete',           false),
('landlord_self', 'listings.publish',        true),
('landlord_self', 'tenants.view',            true),
('landlord_self', 'tenants.create',          true),
('landlord_self', 'tenants.edit',            true),
('landlord_self', 'tenants.deactivate',      true),
('landlord_self', 'tenants.view_sensitive',  true),
('landlord_self', 'payments.view',           true),
('landlord_self', 'payments.record_manual',  true),
('landlord_self', 'maintenance.view',        true),
('landlord_self', 'maintenance.update',      true),
('landlord_self', 'expenses.view',           true),
('landlord_self', 'expenses.add',            true),
('landlord_self', 'deposits.view',           true),
('landlord_self', 'deposits.record',         true),
('landlord_self', 'notices.view',            true),
('landlord_self', 'notices.create',          true),
('landlord_self', 'messages.send',           true),
('landlord_self', 'users.create_caretaker',  true),
('landlord_self', 'users.assign_caretaker',  true),
('landlord_self', 'reports.payment_collection', true),
('landlord_self', 'reports.unpaid_rent',        true),
('landlord_self', 'reports.tenant_list',        true),
('landlord_self', 'reports.maintenance',        true),
('landlord_self', 'reports.property_summary',   true),
('landlord_self', 'reports.occupancy',          true),
('landlord_self', 'reports.expenses',           true),
('landlord_self', 'reports.revenue_summary',    true),
('landlord_self', 'reports.move_in_out',        true),
('landlord_self', 'reports.expiring_leases',    true),

-- ── Caretaker: matches current README behavior (view + maintenance) ──
('caretaker', 'plots.view',        true),
('caretaker', 'houses.view',       true),
('caretaker', 'tenants.view',      true),
('caretaker', 'tenants.view_sensitive', false),
('caretaker', 'maintenance.view',  true),
('caretaker', 'maintenance.update',true),
('caretaker', 'notices.view',      true),
('caretaker', 'messages.send',     true),
('caretaker', 'reports.maintenance', true)

ON CONFLICT (profile, permission) DO NOTHING;

COMMIT;

-- ── Rollback (run manually if needed) ───────────────────────────────────────
-- BEGIN;
-- DROP TABLE IF EXISTS role_permissions;
-- ALTER TABLE users DROP COLUMN IF EXISTS agent_id;
-- COMMIT;

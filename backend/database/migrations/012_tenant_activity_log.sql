-- 012_tenant_activity_log.sql
-- Tracks tenant-portal activity for the new admin "Tenant Activity" report:
-- logins, maintenance request submissions, and messages sent to staff.
-- Deliberately does NOT log passive page views (viewing payments, arrears,
-- profile) — the user explicitly scoped this to logins + the two action
-- types below, not a full page-view tracker.
-- Notice "read" activity is NOT duplicated here — it's derived at report
-- time straight from the existing notice_reads table (notice_id, tenant_id,
-- read_at), which already tracks exactly that.
--
-- Separate from audit_log on purpose: audit_log.user_id references the
-- staff `users` table, but tenants live in their own id space (tenants.id
-- is its own SERIAL PK, distinct from tenants.user_id). Reusing audit_log
-- would mean either a nullable second FK column bolted onto a table that's
-- keyed for staff, or silently misattributing tenant activity to a staff
-- user id that happens to collide — a new table is the cleaner fix.

CREATE TABLE IF NOT EXISTS tenant_activity_log (
  id         SERIAL PRIMARY KEY,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action     VARCHAR(30) NOT NULL CHECK (action IN ('login', 'maintenance_request', 'message_sent')),
  detail     TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_activity_log_tenant_time ON tenant_activity_log (tenant_id, created_at);

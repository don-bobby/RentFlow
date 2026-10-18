const pool = require('../database/db');

// Records one tenant-portal activity event. Mirrors logAudit() in style,
// but can't reuse it — audit_log.user_id is keyed to the staff `users`
// table, and tenants have their own separate id space. Never throws: an
// activity-log failure should never break the request it's logging (same
// rule as logAudit).
async function logTenantActivity({ tenantId, action, detail }) {
  try {
    await pool.query(
      `INSERT INTO tenant_activity_log (tenant_id, action, detail) VALUES ($1, $2, $3)`,
      [tenantId, action, detail || null]
    );
  } catch (err) {
    console.error('Tenant activity log failed (non-fatal):', err.message);
  }
}

module.exports = { logTenantActivity };

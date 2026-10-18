const pool = require('../database/db');

// Staff-side companion to logTenantActivity(). Never throws — an
// activity-log failure should never break the request it's logging.
async function logStaffActivity({ userId, action, detail }) {
  try {
    await pool.query(
      `INSERT INTO staff_activity_log (user_id, action, detail) VALUES ($1, $2, $3)`,
      [userId, action, detail || null]
    );
  } catch (err) {
    console.error('Staff activity log failed (non-fatal):', err.message);
  }
}

module.exports = { logStaffActivity };

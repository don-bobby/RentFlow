const pool = require('../database/db');

// Records one audit entry. `changes` should be a plain object of
// { field: { from, to } } pairs — pass only the fields that actually changed,
// not the whole row, so the log stays meaningful to read.
// Never throws — an audit failure should never break the request it's logging.
async function logAudit({ user, action, entityType, entityId, changes }) {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, changes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user?.id || null, user?.name || null, action, entityType, entityId || null, changes ? JSON.stringify(changes) : null]
    );
  } catch (err) {
    console.error('Audit log failed (non-fatal):', err.message);
  }
}

// Builds a { field: {from, to} } diff between two flat objects, only for keys
// that actually changed. Pass the set of fields you care about — usually not
// every column (e.g. skip password hashes, timestamps).
function diff(before, after, fields) {
  const out = {};
  for (const f of fields) {
    const a = before?.[f], b = after?.[f];
    if (String(a ?? '') !== String(b ?? '')) out[f] = { from: a ?? null, to: b ?? null };
  }
  return out;
}

module.exports = { logAudit, diff };

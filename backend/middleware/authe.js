// backend/middleware/auth.js
//
// Shared staff auth middleware. Replaces the local `auth()` function that
// used to be copy-pasted into tenants.js, notices.js, payments.js, etc.
//
// KEY CHANGE from before: the token now only proves WHO the user is (their
// id). Their role, approval status and agent_id are re-read from the
// database on every request, not trusted from the (up to 7-day-old) token.
// This is what makes permission changes, suspensions, and agent
// assignments take effect immediately instead of waiting for the token
// to expire.

const jwt  = require('jsonwebtoken');
const pool = require('../database/db');

async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Tenant tokens should never reach staff routes. tenantAuth (in
  // tenantportal.js) handles those separately.
  if (decoded.role === 'tenant') {
    return res.status(403).json({ error: 'Staff access only.' });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, email, role, is_approved, agent_id, plot_id
       FROM users WHERE id = $1`,
      [decoded.id]
    );
    const user = result.rows[0];

    // Covers a deleted/removed user whose old token would otherwise
    // keep working until it expires.
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });

    if (user.role === 'landlord' && !user.is_approved) {
      return res.status(403).json({ error: 'Your account is pending admin approval.' });
    }

    // req.user is now the LIVE database row, not the token's stale copy.
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { authMiddleware };

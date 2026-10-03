// backend/middleware/permissions.js
//
// The permission engine. Reads backend/database/migrations/003_roles_permissions.sql's
// role_permissions table. super_admin is never stored there — it always gets
// everything, so it can't be locked out or accidentally edited.
//
// NOTE: until Phase 2's role rename runs, 'admin' still means super admin.
// This file treats 'admin' and 'super_admin' as the same thing so you can
// deploy this file before renaming any rows.

const pool = require('../database/db');

// Which permissions profile does this (live, DB-loaded) user belong to?
function profileFor(user) {
  if (user.role === 'admin' || user.role === 'super_admin') return 'super_admin';
  if (user.role === 'agent') return 'agent';
  if (user.role === 'landlord') return user.agent_id ? 'landlord_with_agent' : 'landlord_self';
  if (user.role === 'caretaker') return 'caretaker';
  return null; // unknown role — gets no permissions
}

// Returns { profile, permissions: [...] }. permissions is ['*'] for super_admin.
async function getPermissions(user) {
  const profile = profileFor(user);
  if (profile === 'super_admin') return { profile, permissions: ['*'] };
  if (!profile) return { profile: null, permissions: [] };

  const result = await pool.query(
    `SELECT permission FROM role_permissions WHERE profile = $1 AND allowed = true`,
    [profile]
  );
  return { profile, permissions: result.rows.map(r => r.permission) };
}

// Express middleware: use after authMiddleware.
// e.g. router.post('/', authMiddleware, requirePermission('tenants.create'), ...)
function requirePermission(permission) {
  return async (req, res, next) => {
    try {
      const { permissions } = await getPermissions(req.user);
      if (permissions.includes('*') || permissions.includes(permission)) return next();
      return res.status(403).json({ error: `Missing permission: ${permission}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

module.exports = { profileFor, getPermissions, requirePermission };

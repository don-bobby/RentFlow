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
//
// plotId is optional. Pass it when checking a permission against one
// specific property; omit it for a general check (e.g. GET /auth/me, or any
// existing call site that hasn't been migrated to pass a property yet).
//
// On top of the role's default list (role_permissions), this layers in any
// per-user overrides from user_permission_overrides — see
// claude/per-user-per-property-permissions-scoping.md in the project for
// the full design. Resolution order, most specific wins:
//   1. role default
//   2. an override with plot_id IS NULL ("applies to every property")
//   3. an override for this exact plotId (only considered when a plotId was
//      actually passed in) — this is the final word either way
// super_admin (and 'admin', which still means the same thing until the role
// rename) always gets everything and is returned before any of this runs —
// overrides can never apply to those accounts, by design.
async function getPermissions(user, plotId) {
  const profile = profileFor(user);
  if (profile === 'super_admin') return { profile, permissions: ['*'] };
  if (!profile) return { profile: null, permissions: [] };

  const result = await pool.query(
    `SELECT permission FROM role_permissions WHERE profile = $1 AND allowed = true`,
    [profile]
  );
  const permissions = new Set(result.rows.map(r => r.permission));

  const overrides = await pool.query(
    `SELECT plot_id, permission, effect FROM user_permission_overrides
     WHERE user_id = $1 AND (plot_id IS NULL OR plot_id = $2)`,
    [user.id, plotId ?? null]
  );

  const apply = (o) => {
    if (o.effect === 'grant') permissions.add(o.permission);
    else permissions.delete(o.permission);
  };
  // Global overrides first, then the plot-specific one (if any) — so the
  // plot-specific row always has the last word when both exist.
  overrides.rows.filter(o => o.plot_id === null).forEach(apply);
  if (plotId != null) overrides.rows.filter(o => o.plot_id === plotId).forEach(apply);

  return { profile, permissions: Array.from(permissions) };
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

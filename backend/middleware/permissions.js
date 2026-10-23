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
// For landlords this is only the fallback label — the real profile is
// decided PER PROPERTY by landlordProfilesFor() below, since a landlord can
// have one property run by an agent and the rest self-managed.
function profileFor(user) {
  if (user.role === 'admin' || user.role === 'super_admin') return 'super_admin';
  if (user.role === 'agent') return 'agent';
  if (user.role === 'landlord') return 'landlord_self';
  if (user.role === 'caretaker') return 'caretaker';
  return null; // unknown role — gets no permissions
}

// Which landlord profile(s) apply. With a plotId that this landlord owns:
// exactly one — landlord_with_agent if that property has an agent
// (plots.agent_id), else landlord_self. With no plotId (a general check:
// nav, /auth/me, un-migrated routes): whatever the landlord's portfolio
// needs — both, when they have a mix of agent-managed and self-managed
// properties (so a self-managed property's actions are never hidden just
// because another property has an agent; per-property checks still apply
// the right one), otherwise the single matching profile.
async function landlordProfilesFor(user, plotId) {
  if (plotId != null) {
    const r = await pool.query('SELECT agent_id FROM plots WHERE id = $1 AND user_id = $2', [plotId, user.id]);
    if (r.rows[0]) return [r.rows[0].agent_id ? 'landlord_with_agent' : 'landlord_self'];
  }
  const r = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE agent_id IS NULL)::int AS self_count,
            COUNT(*) FILTER (WHERE agent_id IS NOT NULL)::int AS managed_count
     FROM plots WHERE user_id = $1`,
    [user.id]
  );
  const { self_count, managed_count } = r.rows[0];
  if (managed_count > 0 && self_count > 0) return ['landlord_self', 'landlord_with_agent'];
  if (managed_count > 0) return ['landlord_with_agent'];
  return ['landlord_self'];
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
  let profile = profileFor(user);
  if (profile === 'super_admin') return { profile, permissions: ['*'] };
  if (!profile) return { profile: null, permissions: [] };

  let profiles = [profile];
  if (user.role === 'landlord') {
    profiles = await landlordProfilesFor(user, plotId);
    profile = profiles[0]; // label only; 'landlord_self' first when a landlord has a mix
  }

  const result = await pool.query(
    `SELECT permission FROM role_permissions WHERE profile = ANY($1) AND allowed = true`,
    [profiles]
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

// Batch version of getPermissions, for LIST endpoints whose rows span many
// properties at once — a single plotId isn't enough there, and calling
// getPermissions() once per row would mean two extra DB queries per row.
// Resolves every id in plotIds in exactly two queries total (role defaults,
// then all of this user's overrides), then applies the same resolution
// order as getPermissions() to each plot id in memory.
// Returns a Map<plotId, permissions[]>.
async function getPermissionsForPlots(user, plotIds) {
  const profile = profileFor(user);
  const uniqueIds = [...new Set(plotIds.filter((id) => id != null))];

  if (profile === 'super_admin') return new Map(uniqueIds.map((id) => [id, ['*']]));
  if (!profile) return new Map(uniqueIds.map((id) => [id, []]));

  // Landlords get a different base profile per property (agent-managed vs
  // self-managed); everyone else has one profile for all properties.
  let baseFor; // (plotId) => string[]
  if (user.role === 'landlord') {
    const [roleResult, plotRows] = await Promise.all([
      pool.query(
        `SELECT profile, permission FROM role_permissions
         WHERE profile IN ('landlord_self','landlord_with_agent') AND allowed = true`
      ),
      pool.query('SELECT id, agent_id FROM plots WHERE user_id = $1', [user.id]),
    ]);
    const byProfile = { landlord_self: [], landlord_with_agent: [] };
    for (const r of roleResult.rows) byProfile[r.profile].push(r.permission);
    const managed = new Map(plotRows.rows.map((r) => [r.id, !!r.agent_id]));
    baseFor = (id) => (managed.get(id) ? byProfile.landlord_with_agent : byProfile.landlord_self);
  } else {
    const roleResult = await pool.query(
      `SELECT permission FROM role_permissions WHERE profile = $1 AND allowed = true`,
      [profile]
    );
    const basePermissions = roleResult.rows.map((r) => r.permission);
    baseFor = () => basePermissions;
  }

  const overridesResult = await pool.query(
    `SELECT plot_id, permission, effect FROM user_permission_overrides WHERE user_id = $1`,
    [user.id]
  );
  const globalOverrides = overridesResult.rows.filter((o) => o.plot_id === null);
  const byPlot = new Map();
  for (const o of overridesResult.rows) {
    if (o.plot_id === null) continue;
    if (!byPlot.has(o.plot_id)) byPlot.set(o.plot_id, []);
    byPlot.get(o.plot_id).push(o);
  }

  const apply = (set, o) => {
    if (o.effect === 'grant') set.add(o.permission);
    else set.delete(o.permission);
  };

  const resolved = new Map();
  for (const plotId of uniqueIds) {
    const set = new Set(baseFor(plotId));
    globalOverrides.forEach((o) => apply(set, o));
    (byPlot.get(plotId) || []).forEach((o) => apply(set, o));
    resolved.set(plotId, Array.from(set));
  }
  return resolved;
}

// Filters a list of rows down to the ones this user may view for `permission`,
// resolved per-row by that row's own plot. For LIST routes (GET /, etc.)
// where the existing top-of-route requirePermission(x) check only answers
// "can this user ever see X" — it can't catch a property-specific revoke,
// since it runs with no plot in view. This is the row-level complement: it
// hides just the rows for properties where the permission has been revoked
// for this user, rather than rejecting (or allowing) the whole list.
//
// getPlotId(row) pulls the plot id out of a row — varies by table (some
// have plot_id directly, others only via a joined house/plot). A row whose
// plot id can't be determined (null/undefined) is left in as-is, same as
// before this filter existed — there's nothing to scope it by.
//
// Known gap: this can only narrow access, not widen it — a plot-specific
// GRANT override can't surface rows for a permission the user's role lacks
// entirely, because the top-of-route requirePermission(x) check already
// rejected the request before this ever runs. Fixing that needs removing
// that top-level gate in favor of this filter alone, which would also turn
// a "no access anywhere" request into an empty 200 instead of a 403 — a
// bigger behavior change, left for a follow-up.
async function filterRowsByPermission(user, rows, permission, getPlotId) {
  const byPlot = await getPermissionsForPlots(user, rows.map(getPlotId));
  return rows.filter((row) => {
    const plotId = getPlotId(row);
    if (plotId == null) return true;
    const permissions = byPlot.get(plotId) || [];
    return permissions.includes('*') || permissions.includes(permission);
  });
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

module.exports = {
  profileFor,
  getPermissions,
  getPermissionsForPlots,
  filterRowsByPermission,
  requirePermission,
};

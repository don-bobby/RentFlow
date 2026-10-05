// backend/middleware/scope.js
//
// "Which plots can this user see?" — the data-scoping half of permissions.
// requirePermission (permissions.js) answers "CAN they do X at all";
// this answers "on WHICH records".
//
// Chain, confirmed against the real schema:
//   super_admin  -> all plots
//   agent        -> plots owned by landlords where users.agent_id = agent's id,
//                    UNION plots directly assigned via plots.agent_id (a plot
//                    can be handed to an agent individually, independent of
//                    whether its landlord has that agent set at all — this
//                    second path existed in the data but was never checked
//                    here, which made those plots invisible to the very
//                    agent they were assigned to)
//   landlord     -> plots.user_id = their own id
//   caretaker    -> plots reachable via caretaker_plots.caretaker_id

const pool = require('../database/db');

// Returns either the string 'ALL' (no WHERE filter needed) or an array of
// plot ids (possibly empty) this user is scoped to.
async function getVisiblePlotIds(user) {
  switch (user.role) {
    case 'admin':
    case 'super_admin':
      return 'ALL';

    case 'agent': {
      const result = await pool.query(
        `SELECT p.id FROM plots p
         JOIN users landlord ON landlord.id = p.user_id
         WHERE landlord.agent_id = $1
         UNION
         SELECT p.id FROM plots p
         WHERE p.agent_id = $1`,
        [user.id]
      );
      return result.rows.map(r => r.id);
    }

    case 'landlord': {
      const result = await pool.query('SELECT id FROM plots WHERE user_id = $1', [user.id]);
      return result.rows.map(r => r.id);
    }

    case 'caretaker': {
      // Support multiple plot assignments via caretaker_plots, plus the
      // legacy single-assignment fallback (users.plot_id) that plots.js and
      // houses.js already relied on before this helper existed.
      const result = await pool.query(
        `SELECT plot_id AS id FROM caretaker_plots WHERE caretaker_id = $1
         UNION
         SELECT plot_id AS id FROM users WHERE id = $1 AND plot_id IS NOT NULL`,
        [user.id]
      );
      return result.rows.map(r => r.id);
    }

    default:
      return [];
  }
}

// Helper for building a WHERE clause: returns { clause, params } to splice
// into a query that already has plot_id or p.id available. Example:
//   const { clause, params } = await plotScopeSql(req.user, 'p.id', [otherParam]);
//   pool.query(`SELECT ... FROM plots p WHERE 1=1 ${clause}`, params);
async function plotScopeSql(user, plotColumn, existingParams = []) {
  const visible = await getVisiblePlotIds(user);
  if (visible === 'ALL') return { clause: '', params: existingParams };
  if (visible.length === 0) {
    // No visible plots — force an impossible match rather than an empty
    // IN () which is invalid SQL.
    return { clause: ` AND 1=0`, params: existingParams };
  }
  const params = [...existingParams, visible];
  return { clause: ` AND ${plotColumn} = ANY($${params.length})`, params };
}

module.exports = { getVisiblePlotIds, plotScopeSql };

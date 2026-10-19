const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const jwt     = require('jsonwebtoken');
const { getVisiblePlotIds } = require('../middleware/scope');
const { authMiddleware: staffAuth } = require('../middleware/auth');
const { requirePermission, getPermissions, filterRowsByPermission } = require('../middleware/permissions');
const { logAudit } = require('../utils/audit');

function flexAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

// Was gated by requirePermission('maintenance.view') as middleware, which ran
// BEFORE the per-row filter below and only ever checked the requester's
// ROLE default — so a role with no maintenance.view by default got a flat
// 403 here no matter what per-property override was granted. Removed; the
// filterRowsByPermission call below is now the only permission gate on this
// list. Someone with no access to anything now gets an empty list (200)
// instead of a 403.
router.get('/', staffAuth, async (req, res) => {
  try {
    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && visible.length === 0) return res.json({ success: true, data: [] });

    const query = `
      SELECT m.*, h.plot_id, t.full_name AS tenant_name, h.unit_number
      FROM maintenance_requests m
      LEFT JOIN tenants t ON m.tenant_id = t.id
      LEFT JOIN houses  h ON m.house_id  = h.id
      LEFT JOIN plots   p ON h.plot_id   = p.id
      ${visible === 'ALL' ? '' : 'WHERE p.id = ANY($1)'}
      ORDER BY m.reported_at DESC
    `;
    const params = visible === 'ALL' ? [] : [visible];
    const result = await pool.query(query, params);
    // getVisiblePlotIds (above) answers "can this user see this property at
    // all" — it doesn't know about a per-property maintenance.view grant or
    // revoke. This is now the ONLY permission check on this list: it
    // narrows the rows down to ones this user actually has
    // maintenance.view for, property by property.
    const data = await filterRowsByPermission(req.user, result.rows, 'maintenance.view', (row) => row.plot_id);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Was gated by requirePermission('maintenance.view') as middleware — before
// the request's property was known, so a per-property override could never
// apply. Moved down to right after the request (and its plot) is loaded.
router.get('/:id', staffAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.*, h.plot_id FROM maintenance_requests m
       LEFT JOIN houses h ON m.house_id = h.id
       WHERE m.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    const request = result.rows[0];

    const { permissions } = await getPermissions(req.user, request.plot_id);
    if (!permissions.includes('*') && !permissions.includes('maintenance.view')) {
      return res.status(403).json({ error: 'Missing permission: maintenance.view' });
    }

    const visible = await getVisiblePlotIds(req.user);
    const canView = visible === 'ALL' || (request.plot_id != null && visible.includes(request.plot_id));
    if (!canView) return res.status(403).json({ error: 'Access denied' });

    res.json({ success: true, data: request });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', flexAuth, async (req, res) => {
  const { tenant_id, house_id, issue, priority, photo_url } = req.body;
  if (!tenant_id || !issue) return res.status(400).json({ error: 'tenant_id and issue are required.' });

  try {
    let resolvedHouseId = house_id || null;

    if (req.user.role === 'tenant') {
      if (Number(tenant_id) !== Number(req.user.id)) {
        return res.status(403).json({ error: 'You can only submit maintenance requests for your own unit.' });
      }
      const tenantRow = await pool.query('SELECT house_id FROM tenants WHERE id = $1', [req.user.id]);
      if (tenantRow.rows.length === 0) return res.status(404).json({ error: 'Tenant record not found.' });
      resolvedHouseId = tenantRow.rows[0].house_id;

    } else if (req.user.role !== 'admin') {
      if (!['agent', 'landlord', 'caretaker'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      const tenantRow = await pool.query('SELECT house_id FROM tenants WHERE id = $1', [tenant_id]);
      if (tenantRow.rows.length === 0) return res.status(404).json({ error: 'Tenant not found.' });
      resolvedHouseId = house_id || tenantRow.rows[0].house_id;

      const visible = await getVisiblePlotIds(req.user);
      let plotId = null;
      if (resolvedHouseId) {
        const houseCheck = await pool.query('SELECT plot_id FROM houses WHERE id = $1', [resolvedHouseId]);
        plotId = houseCheck.rows[0]?.plot_id ?? null;
      }
      const allowed = visible === 'ALL' || (plotId != null && visible.includes(plotId));
      if (!allowed) return res.status(403).json({ error: 'You are not authorized to file a request for this tenant.' });
    }

    const result = await pool.query(
      `INSERT INTO maintenance_requests (tenant_id, house_id, issue, priority, status, photo_url)
       VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING *`,
      [tenant_id, resolvedHouseId, issue, priority || 'medium', photo_url || null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH update status — now logs the status change. Was completely silent
// before: a request moving from pending to in_progress to completed left
// no trace of who did it or when.
// Was gated by requirePermission('maintenance.update') as middleware, before
// the request's property was known — same fix as GET /:id above.
router.patch('/:id', staffAuth, async (req, res) => {
  const { status, cost } = req.body;
  const validStatuses = ['pending', 'in_progress', 'completed'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
  if (cost != null && (typeof cost !== 'object' || !cost.amount)) {
    return res.status(400).json({ error: 'cost, if provided, must be an object with at least an amount.' });
  }
  try {
    const existing = await pool.query(
      `SELECT m.id, m.status, m.issue, m.house_id, h.plot_id FROM maintenance_requests m
       LEFT JOIN houses h ON m.house_id = h.id
       WHERE m.id = $1`,
      [req.params.id]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    const plotId = existing.rows[0].plot_id;
    const { permissions } = await getPermissions(req.user, plotId);
    if (!permissions.includes('*') && !permissions.includes('maintenance.update')) {
      return res.status(403).json({ error: 'Missing permission: maintenance.update' });
    }

    if (!['admin', 'super_admin'].includes(req.user.role)) {
      const visible = await getVisiblePlotIds(req.user);
      const allowed = visible === 'ALL' || (plotId != null && visible.includes(plotId));
      if (!allowed) return res.status(403).json({ error: 'Access denied' });
    }

    // Closing out a request can optionally attach a cost, which becomes a
    // linked expense — this is the one place that connects Maintenance to
    // Expenses, so it gets its OWN permission check (expenses.add) on top
    // of the maintenance.update check above. A caretaker whose expenses.add
    // was revoked can still mark the request done; they just can't attach
    // a cost to it — this is where that revoke actually bites, not a
    // silent drop of the amount they typed.
    if (cost != null) {
      const { permissions: expensePerms } = await getPermissions(req.user, plotId);
      if (!expensePerms.includes('*') && !expensePerms.includes('expenses.add')) {
        return res.status(403).json({ error: 'Missing permission: expenses.add — you cannot record a cost for this request.' });
      }
    }

    const oldStatus = existing.rows[0].status;
    // Previously this reused $1 both as the value assigned to `status` and
    // inside the CASE comparison ($1 = 'completed'). Postgres infers a type
    // for each use of a parameter independently — if `status` is an enum
    // column, assigning $1 to it forces one type while comparing $1 against
    // the plain string 'completed' forces another, and Postgres refuses with
    // "inconsistent types deduced for parameter $1". Computing the boolean
    // in JS and passing it as its own parameter (same pattern houses.js
    // already uses for status_changed_at) sidesteps the ambiguity entirely.
    const isCompleted = status === 'completed';
    const result = await pool.query(
      `UPDATE maintenance_requests
       SET status = $1,
           resolved_at = CASE WHEN $3 THEN NOW() ELSE NULL END
       WHERE id = $2
       RETURNING *`,
      [status, req.params.id, isCompleted]
    );

    if (oldStatus !== status) {
      await logAudit({
        user: req.user,
        action: 'maintenance.status_change',
        entityType: 'maintenance_request',
        entityId: req.params.id,
        changes: { status: { from: oldStatus, to: status }, issue: { to: existing.rows[0].issue } },
      });
    }

    // Create the linked expense now the status update succeeded. Caretaker
    // entries land as 'pending' (same rule POST /expenses applies) —
    // everyone else's are trusted immediately. plot_id/house_id come from
    // THIS request, not the caller, so there's no way to point the cost at
    // a different property than the one it was actually incurred on.
    let expense = null;
    if (cost != null) {
      const isCaretaker = req.user.role === 'caretaker';
      const expStatus = isCaretaker ? 'pending' : 'confirmed';
      const confirmedBy = isCaretaker ? null : req.user.id;
      const confirmedAt = isCaretaker ? null : new Date();
      const expenseResult = await pool.query(
        `INSERT INTO expenses (plot_id, house_id, category, description, amount, expense_date, maintenance_request_id, status, created_by, confirmed_by, confirmed_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, $8, $9, $10) RETURNING *`,
        [
          plotId, existing.rows[0].house_id,
          cost.category || 'Repairs',
          cost.description || `Maintenance: ${existing.rows[0].issue}`.slice(0, 500),
          cost.amount, req.params.id, expStatus, req.user.id, confirmedBy, confirmedAt,
        ]
      );
      expense = expenseResult.rows[0];
      await logAudit({
        user: req.user, action: 'expense.create_from_maintenance', entityType: 'expense', entityId: expense.id,
        changes: { amount: { to: cost.amount }, status: { to: expStatus } },
      });
    }

    res.json({ success: true, data: result.rows[0], expense });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Was gated by requirePermission('maintenance.delete') as middleware,
// before the request's property was known — same fix as above.
router.delete('/:id', staffAuth, async (req, res) => {
  try {
    const existing = await pool.query(
      `SELECT m.id, h.plot_id FROM maintenance_requests m
       LEFT JOIN houses h ON m.house_id = h.id
       WHERE m.id = $1`,
      [req.params.id]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    const plotId = existing.rows[0].plot_id;
    const { permissions } = await getPermissions(req.user, plotId);
    if (!permissions.includes('*') && !permissions.includes('maintenance.delete')) {
      return res.status(403).json({ error: 'Missing permission: maintenance.delete' });
    }

    if (!['admin', 'super_admin'].includes(req.user.role)) {
      const visible = await getVisiblePlotIds(req.user);
      const allowed = visible === 'ALL' || (plotId != null && visible.includes(plotId));
      if (!allowed) return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query('DELETE FROM maintenance_requests WHERE id = $1 RETURNING *', [req.params.id]);
    res.json({ success: true, message: 'Request deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

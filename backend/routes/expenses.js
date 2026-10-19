const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const { getVisiblePlotIds } = require('../middleware/scope');
const { authMiddleware: staffAuth } = require('../middleware/auth');
const { requirePermission, getPermissions, filterRowsByPermission } = require('../middleware/permissions');
const { logAudit } = require('../utils/audit');


// GET all expenses — admin/super_admin see all, agent sees their landlords',
// landlord sees own, caretaker sees assigned. Previously this had NO
// scoping at all: every authenticated user, of any role, saw every expense
// in the system. An expense with no plot_id attached is only visible to
// admin, since it isn't tied to anything a non-admin role can be scoped to.
// Was gated by requirePermission('expenses.view') as middleware, which ran
// BEFORE the per-row filter below and only ever checked the requester's
// ROLE default — so a role with no expenses.view by default got a flat 403
// here no matter what per-property override was granted. Removed; the
// filterRowsByPermission call below is now the only permission gate on this
// list. Someone with no access to anything now gets an empty list (200)
// instead of a 403.
router.get('/', staffAuth, async (req, res) => {
  try {
    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && visible.length === 0) return res.json({ success: true, data: [] });

    const query = `
      SELECT e.*, p.name AS plot_name, h.unit_number,
             creator.name AS created_by_name, confirmer.name AS confirmed_by_name,
             m.issue AS maintenance_issue
      FROM expenses e
      LEFT JOIN plots   p ON e.plot_id = p.id
      LEFT JOIN houses  h ON e.house_id = h.id
      LEFT JOIN users   creator   ON e.created_by  = creator.id
      LEFT JOIN users   confirmer ON e.confirmed_by = confirmer.id
      LEFT JOIN maintenance_requests m ON e.maintenance_request_id = m.id
      ${visible === 'ALL' ? '' : 'WHERE e.plot_id = ANY($1)'}
      ORDER BY e.expense_date DESC
    `;
    const params = visible === 'ALL' ? [] : [visible];
    const result = await pool.query(query, params);
    // getVisiblePlotIds (above) answers "can this user see this property at
    // all" — it doesn't know about a per-property expenses.view grant or
    // revoke. This is now the ONLY permission check on this list: it
    // narrows the rows down to ones this user actually has expenses.view
    // for, property by property.
    const data = await filterRowsByPermission(req.user, result.rows, 'expenses.view', (row) => row.plot_id);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single expense
// Was gated by requirePermission('expenses.view') as middleware — before the
// expense's property was known, so a per-property override could never
// apply. Moved down to right after the expense (and its plot) is loaded.
router.get('/:id', staffAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM expenses WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    const expense = result.rows[0];

    const { permissions } = await getPermissions(req.user, expense.plot_id);
    if (!permissions.includes('*') && !permissions.includes('expenses.view')) {
      return res.status(403).json({ error: 'Missing permission: expenses.view' });
    }

    const visible = await getVisiblePlotIds(req.user);
    const canView = visible === 'ALL' || (expense.plot_id != null && visible.includes(expense.plot_id));
    if (!canView) return res.status(403).json({ error: 'Access denied' });

    res.json({ success: true, data: expense });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create expense — matrix grants expenses.add to agent and
// landlord_self (not landlord_with_agent or caretaker)
// Was gated by requirePermission('expenses.add') as middleware, before the
// target property was known. Also: the scope check below used to run
// OUTSIDE the try/catch, so a database hiccup in that one query would have
// crashed the request instead of returning a clean 500 — folded into the
// same try/catch as everything else.
router.post('/', staffAuth, async (req, res) => {
  let { plot_id, house_id, category, description, amount, expense_date, receipt_url, maintenance_request_id } = req.body;

  if (!amount || !expense_date) {
    return res.status(400).json({ error: 'amount and expense_date are required.' });
  }

  try {
    // A caller that knows the unit (house_id) but not the property — the
    // maintenance-closeout flow in maintenance.js is the main case — can
    // leave plot_id out and have it resolved from the house instead of
    // having to look it up itself first.
    if (!plot_id && house_id) {
      const h = await pool.query('SELECT plot_id FROM houses WHERE id = $1', [house_id]);
      plot_id = h.rows[0]?.plot_id ?? null;
    }

    const plotIdNum = plot_id != null ? Number(plot_id) : null;
    const { permissions } = await getPermissions(req.user, plotIdNum);
    if (!permissions.includes('*') && !permissions.includes('expenses.add')) {
      return res.status(403).json({ error: 'Missing permission: expenses.add' });
    }

    if (!['admin', 'super_admin'].includes(req.user.role)) {
      if (!plot_id) return res.status(400).json({ error: 'plot_id is required.' });
      const visible = await getVisiblePlotIds(req.user);
      if (!(visible === 'ALL' || visible.includes(plotIdNum))) {
        return res.status(403).json({ error: 'You do not have access to this plot.' });
      }
    }

    // Caretaker-entered costs land as 'pending' until a landlord, admin or
    // agent confirms them (expenses.edit) — everyone else's entries are
    // trusted immediately, same as before this column existed. This is the
    // one place status is decided on create; nothing else sets it.
    const isCaretaker = req.user.role === 'caretaker';
    const status = isCaretaker ? 'pending' : 'confirmed';
    const confirmedBy = isCaretaker ? null : req.user.id;
    const confirmedAt = isCaretaker ? null : new Date();

    const result = await pool.query(
      `INSERT INTO expenses (plot_id, house_id, category, description, amount, expense_date, receipt_url, maintenance_request_id, status, created_by, confirmed_by, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [plot_id || null, house_id || null, category || null, description || null, amount, expense_date, receipt_url || null, maintenance_request_id || null, status, req.user.id, confirmedBy, confirmedAt]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update expense — was gated by role only (adminOrLandlord), which let
// a landlord_with_agent (view-only) edit expenses despite not being allowed
// to add them, and blocked agent entirely despite the matrix granting them
// expenses.add. Migration 005 adds expenses.edit for agent + landlord_self,
// matching expenses.add's grant exactly, so this is now consistent with POST.
// Was gated by requirePermission('expenses.edit') as middleware, before the
// expense's property was known. Also: the existing row was previously only
// fetched inside the non-admin branch, which meant a plot-aware permission
// check had no plot to check against for an admin request — now fetched
// unconditionally so the permission check always has it.
router.put('/:id', staffAuth, async (req, res) => {
  const { plot_id, house_id, category, description, amount, expense_date, receipt_url } = req.body;
  try {
    const existing = await pool.query('SELECT plot_id FROM expenses WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });

    const oldPlot = existing.rows[0].plot_id;
    const newPlot = plot_id != null ? Number(plot_id) : oldPlot;

    // If this edit also moves the expense onto a different property, the
    // permission must hold for BOTH the old and the new one — otherwise an
    // override granted for just one property could be used to quietly move
    // an expense onto a property it was never meant to touch.
    const oldCheck = await getPermissions(req.user, oldPlot);
    let hasPermission = oldCheck.permissions.includes('*') || oldCheck.permissions.includes('expenses.edit');
    if (hasPermission && newPlot !== oldPlot) {
      const newCheck = await getPermissions(req.user, newPlot);
      hasPermission = newCheck.permissions.includes('*') || newCheck.permissions.includes('expenses.edit');
    }
    if (!hasPermission) {
      return res.status(403).json({ error: 'Missing permission: expenses.edit' });
    }

    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      const visible = await getVisiblePlotIds(req.user);
      const ownsOld = oldPlot != null && visible.includes(oldPlot);
      const ownsNew = newPlot != null && visible.includes(newPlot);
      if (!ownsOld || !ownsNew) return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(
      `UPDATE expenses SET plot_id=$1, house_id=$2, category=$3, description=$4, amount=$5, expense_date=$6, receipt_url=$7
       WHERE id=$8 RETURNING *`,
      [plot_id || null, house_id || null, category || null, description || null, amount, expense_date, receipt_url || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/expenses/:id/confirm — moves a 'pending' (caretaker-entered)
// expense to 'confirmed'. Gated on expenses.edit, same permission and
// scope check as PUT above — this IS an edit, just a specific one — so an
// agent can confirm costs for the landlords assigned to them, a
// self-managed landlord can confirm their own, and admin can confirm
// anything, with no new permission to seed or toggle. Also accepts the
// same editable fields as PUT, so the confirmer can correct a caretaker's
// entry (wrong amount/category) in the same action instead of editing
// first and confirming second.
router.patch('/:id/confirm', staffAuth, async (req, res) => {
  const { amount, category, description, expense_date } = req.body;
  try {
    const existing = await pool.query('SELECT * FROM expenses WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    const expense = existing.rows[0];

    if (expense.status === 'confirmed') {
      return res.status(400).json({ error: 'This expense is already confirmed.' });
    }

    const { permissions } = await getPermissions(req.user, expense.plot_id);
    if (!permissions.includes('*') && !permissions.includes('expenses.edit')) {
      return res.status(403).json({ error: 'Missing permission: expenses.edit' });
    }

    if (!['admin', 'super_admin'].includes(req.user.role)) {
      const visible = await getVisiblePlotIds(req.user);
      if (!(visible === 'ALL' || (expense.plot_id != null && visible.includes(expense.plot_id)))) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const result = await pool.query(
      `UPDATE expenses
       SET status = 'confirmed', confirmed_by = $1, confirmed_at = NOW(),
           amount = COALESCE($2, amount), category = COALESCE($3, category),
           description = COALESCE($4, description), expense_date = COALESCE($5, expense_date)
       WHERE id = $6 RETURNING *`,
      [req.user.id, amount ?? null, category ?? null, description ?? null, expense_date ?? null, req.params.id]
    );
    await logAudit({
      user: req.user, action: 'expense.confirm', entityType: 'expense', entityId: req.params.id,
      changes: { status: { from: 'pending', to: 'confirmed' } },
    });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE expense — same fix as PUT above. Migration 005 adds expenses.delete
// for agent + landlord_self.
// Was gated by requirePermission('expenses.delete') as middleware, before
// the expense's property was known — same problem as the routes above.
router.delete('/:id', staffAuth, async (req, res) => {
  try {
    const existing = await pool.query('SELECT plot_id FROM expenses WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });

    const plotId = existing.rows[0].plot_id;
    const { permissions } = await getPermissions(req.user, plotId);
    if (!permissions.includes('*') && !permissions.includes('expenses.delete')) {
      return res.status(403).json({ error: 'Missing permission: expenses.delete' });
    }

    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      const visible = await getVisiblePlotIds(req.user);
      if (plotId == null || !visible.includes(plotId)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const result = await pool.query('DELETE FROM expenses WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    res.json({ success: true, message: 'Expense deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

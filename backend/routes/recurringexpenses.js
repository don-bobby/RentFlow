const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const { getVisiblePlotIds } = require('../middleware/scope');
const { authMiddleware: staffAuth } = require('../middleware/auth');
const { getPermissions, filterRowsByPermission } = require('../middleware/permissions');

// Recurring expense TEMPLATES — garbage collection, water, electricity etc.
// that repeat monthly. These rows never show up as spend themselves; the
// daily cron job in jobs/recurringExpenseGenerator.js reads the active ones
// and inserts an actual `expenses` row when each is due. Permission model
// mirrors expenses.js exactly (expenses.add/edit/delete, scoped by plot_id)
// — a template is just an expense that writes itself repeatedly, so it's
// gated the same way creating or editing one would be.

// GET all recurring expense templates — same visibility/permission scoping
// as GET /api/expenses.
router.get('/', staffAuth, async (req, res) => {
  try {
    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && visible.length === 0) return res.json({ success: true, data: [] });

    const query = `
      SELECT r.*, p.name AS plot_name, h.unit_number
      FROM recurring_expenses r
      LEFT JOIN plots  p ON r.plot_id = p.id
      LEFT JOIN houses h ON r.house_id = h.id
      ${visible === 'ALL' ? '' : 'WHERE r.plot_id = ANY($1)'}
      ORDER BY r.is_active DESC, p.name NULLS LAST, r.category
    `;
    const params = visible === 'ALL' ? [] : [visible];
    const result = await pool.query(query, params);
    const data = await filterRowsByPermission(req.user, result.rows, 'expenses.view', (row) => row.plot_id);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create a recurring expense template — same permission/scope check as
// POST /api/expenses, minus the caretaker-pending logic (a caretaker can't
// create these; expenses.add isn't normally granted to that profile, and
// even if overridden for one, a recurring bill isn't a maintenance closeout
// cost, so there's no "pending until confirmed" state here).
router.post('/', staffAuth, async (req, res) => {
  let { plot_id, house_id, category, description, amount, day_of_month } = req.body;

  if (!plot_id) return res.status(400).json({ error: 'plot_id is required.' });
  if (!category) return res.status(400).json({ error: 'category is required.' });
  if (!amount) return res.status(400).json({ error: 'amount is required.' });

  try {
    const plotIdNum = Number(plot_id);
    const { permissions } = await getPermissions(req.user, plotIdNum);
    if (!permissions.includes('*') && !permissions.includes('expenses.add')) {
      return res.status(403).json({ error: 'Missing permission: expenses.add' });
    }

    if (!['admin', 'super_admin'].includes(req.user.role)) {
      const visible = await getVisiblePlotIds(req.user);
      if (!(visible === 'ALL' || visible.includes(plotIdNum))) {
        return res.status(403).json({ error: 'You do not have access to this plot.' });
      }
    }

    const dom = day_of_month ? Math.min(28, Math.max(1, parseInt(day_of_month, 10))) : 1;

    const result = await pool.query(
      `INSERT INTO recurring_expenses (plot_id, house_id, category, description, amount, day_of_month, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [plotIdNum, house_id || null, category, description || null, amount, dom, req.user.id]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update a recurring expense template — same old-plot/new-plot
// permission check as PUT /api/expenses.
router.put('/:id', staffAuth, async (req, res) => {
  const { plot_id, house_id, category, description, amount, day_of_month, is_active } = req.body;
  try {
    const existing = await pool.query('SELECT plot_id FROM recurring_expenses WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Recurring expense not found' });

    const oldPlot = existing.rows[0].plot_id;
    const newPlot = plot_id != null ? Number(plot_id) : oldPlot;

    const oldCheck = await getPermissions(req.user, oldPlot);
    let hasPermission = oldCheck.permissions.includes('*') || oldCheck.permissions.includes('expenses.edit');
    if (hasPermission && newPlot !== oldPlot) {
      const newCheck = await getPermissions(req.user, newPlot);
      hasPermission = newCheck.permissions.includes('*') || newCheck.permissions.includes('expenses.edit');
    }
    if (!hasPermission) return res.status(403).json({ error: 'Missing permission: expenses.edit' });

    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      const visible = await getVisiblePlotIds(req.user);
      const ownsOld = oldPlot != null && visible.includes(oldPlot);
      const ownsNew = newPlot != null && visible.includes(newPlot);
      if (!ownsOld || !ownsNew) return res.status(403).json({ error: 'Access denied' });
    }

    const dom = day_of_month ? Math.min(28, Math.max(1, parseInt(day_of_month, 10))) : 1;

    const result = await pool.query(
      `UPDATE recurring_expenses
       SET plot_id=$1, house_id=$2, category=$3, description=$4, amount=$5, day_of_month=$6, is_active=COALESCE($7, is_active)
       WHERE id=$8 RETURNING *`,
      [newPlot, house_id || null, category, description || null, amount, dom, is_active, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /:id/toggle — flips is_active on/off (pause/resume), same
// permission as PUT above. Separate from PUT so the list view's
// Pause/Resume button doesn't need to resend the whole form.
router.patch('/:id/toggle', staffAuth, async (req, res) => {
  try {
    const existing = await pool.query('SELECT * FROM recurring_expenses WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Recurring expense not found' });
    const template = existing.rows[0];

    const { permissions } = await getPermissions(req.user, template.plot_id);
    if (!permissions.includes('*') && !permissions.includes('expenses.edit')) {
      return res.status(403).json({ error: 'Missing permission: expenses.edit' });
    }
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      const visible = await getVisiblePlotIds(req.user);
      if (!(visible === 'ALL' || (template.plot_id != null && visible.includes(template.plot_id)))) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const result = await pool.query(
      `UPDATE recurring_expenses SET is_active = NOT is_active WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE a recurring expense template — same permission as DELETE
// /api/expenses. Does NOT delete any expenses this template already
// generated (expenses.recurring_expense_id just sets to NULL via ON DELETE
// SET NULL) — only stops future ones.
router.delete('/:id', staffAuth, async (req, res) => {
  try {
    const existing = await pool.query('SELECT plot_id FROM recurring_expenses WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Recurring expense not found' });

    const plotId = existing.rows[0].plot_id;
    const { permissions } = await getPermissions(req.user, plotId);
    if (!permissions.includes('*') && !permissions.includes('expenses.delete')) {
      return res.status(403).json({ error: 'Missing permission: expenses.delete' });
    }
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      const visible = await getVisiblePlotIds(req.user);
      if (plotId == null || !visible.includes(plotId)) return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query('DELETE FROM recurring_expenses WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Recurring expense not found' });
    res.json({ success: true, message: 'Recurring expense deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

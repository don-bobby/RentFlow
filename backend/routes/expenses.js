const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const { getVisiblePlotIds } = require('../middleware/scope');
const { authMiddleware: staffAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');


// GET all expenses — admin/super_admin see all, agent sees their landlords',
// landlord sees own, caretaker sees assigned. Previously this had NO
// scoping at all: every authenticated user, of any role, saw every expense
// in the system. An expense with no plot_id attached is only visible to
// admin, since it isn't tied to anything a non-admin role can be scoped to.
router.get('/', staffAuth, requirePermission('expenses.view'), async (req, res) => {
  try {
    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && visible.length === 0) return res.json({ success: true, data: [] });

    const query = `
      SELECT e.*, p.name AS plot_name
      FROM expenses e
      LEFT JOIN plots p ON e.plot_id = p.id
      ${visible === 'ALL' ? '' : 'WHERE e.plot_id = ANY($1)'}
      ORDER BY e.expense_date DESC
    `;
    const params = visible === 'ALL' ? [] : [visible];
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single expense
router.get('/:id', staffAuth, requirePermission('expenses.view'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM expenses WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    const expense = result.rows[0];

    const visible = await getVisiblePlotIds(req.user);
    const canView = visible === 'ALL' || (expense.plot_id != null && visible.includes(expense.plot_id));
    if (!canView) return res.status(403).json({ error: 'Access denied' });

    res.json({ success: true, data: expense });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create expense — matrix grants expenses.add to agent and
// landlord_self (not landlord_with_agent or caretaker)
router.post('/', staffAuth, requirePermission('expenses.add'), async (req, res) => {
  const { plot_id, category, description, amount, expense_date, receipt_url } = req.body;

  if (!amount || !expense_date) {
    return res.status(400).json({ error: 'amount and expense_date are required.' });
  }

  if (!['admin', 'super_admin'].includes(req.user.role)) {
    if (!plot_id) return res.status(400).json({ error: 'plot_id is required.' });
    const visible = await getVisiblePlotIds(req.user);
    if (!(visible === 'ALL' || visible.includes(Number(plot_id)))) {
      return res.status(403).json({ error: 'You do not have access to this plot.' });
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO expenses (plot_id, category, description, amount, expense_date, receipt_url)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [plot_id || null, category || null, description || null, amount, expense_date, receipt_url || null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update expense — was gated by role only (adminOrLandlord), which let
// a landlord_with_agent (view-only) edit expenses despite not being allowed
// to add them, and blocked agent entirely despite the matrix granting them
// expenses.add. Migration 005 adds expenses.edit for agent + landlord_self,
// matching expenses.add's grant exactly, so this is now consistent with POST.
router.put('/:id', staffAuth, requirePermission('expenses.edit'), async (req, res) => {
  const { plot_id, category, description, amount, expense_date, receipt_url } = req.body;
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      const existing = await pool.query('SELECT plot_id FROM expenses WHERE id = $1', [req.params.id]);
      if (existing.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });

      const visible = await getVisiblePlotIds(req.user);
      const oldPlot = existing.rows[0].plot_id;
      const newPlot = plot_id != null ? Number(plot_id) : oldPlot;
      const ownsOld = oldPlot != null && visible.includes(oldPlot);
      const ownsNew = newPlot != null && visible.includes(newPlot);
      if (!ownsOld || !ownsNew) return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(
      `UPDATE expenses SET plot_id=$1, category=$2, description=$3, amount=$4, expense_date=$5, receipt_url=$6
       WHERE id=$7 RETURNING *`,
      [plot_id || null, category || null, description || null, amount, expense_date, receipt_url || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE expense — same fix as PUT above. Migration 005 adds expenses.delete
// for agent + landlord_self.
router.delete('/:id', staffAuth, requirePermission('expenses.delete'), async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      const existing = await pool.query('SELECT plot_id FROM expenses WHERE id = $1', [req.params.id]);
      if (existing.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });

      const visible = await getVisiblePlotIds(req.user);
      if (existing.rows[0].plot_id == null || !visible.includes(existing.rows[0].plot_id)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const result = await pool.query('DELETE FROM expenses WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    res.json({ success: true, message: 'Expense deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

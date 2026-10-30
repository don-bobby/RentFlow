// Utility receipts: optional water/electricity/garbage money a tenant pays
// along with rent. Separate from rent on purpose — never changes arrears.
// Shown on the Expenses page as "recovered from tenants".
const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const { getVisiblePlotIds } = require('../middleware/scope');
const { authMiddleware: staffAuth } = require('../middleware/auth');
const { getPermissions, filterRowsByPermission } = require('../middleware/permissions');
const { logAudit } = require('../utils/audit');

const TYPES = ['Water', 'Electricity', 'Garbage Collection', 'Other'];

// GET /api/utilities — receipts the user may see (same permission as expenses)
router.get('/', staffAuth, async (req, res) => {
  try {
    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && visible.length === 0) return res.json({ success: true, data: [] });
    const run = (withShared) => pool.query(
      `SELECT u.*, t.full_name AS tenant_name, h.unit_number, p.name AS plot_name${withShared ? ', sm.id AS shared_meter_id' : ''}
       FROM utility_payments u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       LEFT JOIN houses  h ON u.house_id  = h.id
       LEFT JOIN plots   p ON u.plot_id   = p.id
       ${withShared ? `LEFT JOIN shared_meter_units smu ON smu.house_id = u.house_id
       LEFT JOIN shared_meters sm ON sm.id = smu.meter_id AND sm.utility_type = u.utility_type AND sm.active = true AND u.payment_date >= (sm.start_month || '-01')::date` : ''}
       ${visible === 'ALL' ? '' : 'WHERE u.plot_id = ANY($1)'}
       ORDER BY u.payment_date DESC, u.id DESC`,
      visible === 'ALL' ? [] : [visible]
    );
    // shared_meter_id marks receipts that fund a shared-meter bill (pass-through, not "recovered cost").
    let r;
    try { r = await run(true); } catch (e) { if (e.code === '42P01') r = await run(false); else throw e; }
    const data = await filterRowsByPermission(req.user, r.rows, 'expenses.view', (row) => row.plot_id);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/utilities — { tenant_id, payment_date, method, reference, notes,
//                         items: [{ type, amount }, ...] }
router.post('/', staffAuth, async (req, res) => {
  const { tenant_id, payment_date, method, reference, notes, items } = req.body;
  if (!tenant_id || !payment_date || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'tenant_id, payment_date and at least one utility item are required.' });
  }
  const clean = [];
  for (const it of items) {
    const amt = parseFloat(it.amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Each utility amount must be a positive number.' });
    clean.push({ type: TYPES.includes(it.type) ? it.type : 'Other', amount: amt });
  }
  const client = await pool.connect();
  try {
    const t = await client.query(
      `SELECT t.id, t.full_name, t.house_id, h.plot_id FROM tenants t LEFT JOIN houses h ON t.house_id = h.id WHERE t.id = $1`,
      [tenant_id]
    );
    const tenant = t.rows[0];
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const { permissions } = await getPermissions(req.user, tenant.plot_id);
    if (!permissions.includes('*') && !permissions.includes('payments.record_manual')) {
      return res.status(403).json({ error: 'Missing permission: payments.record_manual' });
    }
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      const visible = await getVisiblePlotIds(req.user);
      if (!(visible === 'ALL' || (tenant.plot_id != null && visible.includes(tenant.plot_id)))) {
        return res.status(403).json({ error: 'You are not authorized to record a payment for this tenant.' });
      }
    }

    await client.query('BEGIN');
    const rows = [];
    for (const it of clean) {
      const r = await client.query(
        `INSERT INTO utility_payments (tenant_id, house_id, plot_id, utility_type, amount, payment_date, method, reference, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [tenant.id, tenant.house_id, tenant.plot_id, it.type, it.amount, payment_date, method || null, reference || null, notes || null, req.user.id]
      );
      rows.push(r.rows[0]);
    }
    await client.query('COMMIT');
    await logAudit({
      user: req.user, action: 'utility.recorded', entityType: 'utility_payment', entityId: rows[0].id,
      changes: { tenant: { to: tenant.full_name }, items: { to: clean.map(c => `${c.type} ${c.amount}`).join(', ') } },
    });
    res.status(201).json({ success: true, data: rows });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Utility payment failed:', err);
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// DELETE /api/utilities/:id
router.delete('/:id', staffAuth, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM utility_payments WHERE id = $1', [req.params.id]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'Utility payment not found' });
    const { permissions } = await getPermissions(req.user, row.plot_id);
    if (!permissions.includes('*') && !permissions.includes('payments.delete')) {
      return res.status(403).json({ error: 'Missing permission: payments.delete' });
    }
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      const visible = await getVisiblePlotIds(req.user);
      if (!(visible === 'ALL' || (row.plot_id != null && visible.includes(row.plot_id)))) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }
    await pool.query('DELETE FROM utility_payments WHERE id = $1', [req.params.id]);
    await logAudit({
      user: req.user, action: 'utility.deleted', entityType: 'utility_payment', entityId: row.id,
      changes: { amount: { from: parseFloat(row.amount) }, type: { from: row.utility_type } },
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

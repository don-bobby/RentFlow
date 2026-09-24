const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const jwt     = require('jsonwebtoken');

function tenantAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'tenant') return res.status(403).json({ error: 'Tenant access only' });
    req.tenant = decoded;
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

// GET /api/tenant-portal/me — full profile + unit + plot info
router.get('/me', tenantAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.full_name, t.phone, t.email, t.national_id,
              t.move_in_date, t.deposit_paid, t.balance, t.is_active,
              h.unit_number, h.house_type, h.rent_amount, h.deposit, h.meter_no,
              p.name AS plot_name, p.location AS plot_location
       FROM tenants t
       LEFT JOIN houses h ON t.house_id = h.id
       LEFT JOIN plots  p ON h.plot_id  = p.id
       WHERE t.id = $1`,
      [req.tenant.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Tenant not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/tenant-portal/payments — own payment history
router.get('/payments', tenantAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, amount, amount_allocated, payment_date, method, receipt_no,
              notes, status, for_year, for_month
       FROM payments
       WHERE tenant_id = $1
       ORDER BY payment_date DESC`,
      [req.tenant.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/tenant-portal/arrears — unpaid months with balances
router.get('/arrears', tenantAuth, async (req, res) => {
  try {
    const tenantRes = await pool.query(
      'SELECT t.move_in_date, h.rent_amount FROM tenants t LEFT JOIN houses h ON t.house_id = h.id WHERE t.id = $1',
      [req.tenant.id]
    );
    const { move_in_date, rent_amount } = tenantRes.rows[0];
    if (!move_in_date) return res.json({ success: true, data: [] });

    const moveIn = new Date(move_in_date);
    let y = moveIn.getDate() === 1 ? moveIn.getFullYear() : (moveIn.getMonth() === 11 ? moveIn.getFullYear() + 1 : moveIn.getFullYear());
    let m = moveIn.getDate() === 1 ? moveIn.getMonth() + 1 : (moveIn.getMonth() === 11 ? 1 : moveIn.getMonth() + 2);

    const paid = await pool.query(
      `SELECT COALESCE(for_year, EXTRACT(YEAR FROM payment_date)::int) AS year,
              COALESCE(for_month, EXTRACT(MONTH FROM payment_date)::int) AS month,
              COALESCE(SUM(amount_allocated), SUM(amount)) AS total_paid
       FROM payments WHERE tenant_id = $1
       GROUP BY year, month`,
      [req.tenant.id]
    );
    const paidMap = {};
    for (const r of paid.rows) paidMap[`${r.year}-${r.month}`] = parseFloat(r.total_paid);

    const now = new Date();
    const arrears = [];
    while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
      const totalPaid = paidMap[`${y}-${m}`] || 0;
      const balance   = parseFloat(rent_amount) - totalPaid;
      if (balance > 0) {
        arrears.push({
          year: y, month: m,
          label:   new Date(y, m - 1, 1).toLocaleString('en-KE', { month: 'long', year: 'numeric' }),
          rent:    parseFloat(rent_amount),
          paid:    totalPaid,
          balance,
          partial: totalPaid > 0,
        });
      }
      m++; if (m > 12) { m = 1; y++; }
    }
    res.json({ success: true, data: arrears });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/tenant-portal/maintenance — own maintenance requests
router.get('/maintenance', tenantAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, issue, priority, status, reported_at, resolved_at
       FROM maintenance_requests WHERE tenant_id = $1
       ORDER BY reported_at DESC`,
      [req.tenant.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/tenant-portal/maintenance — submit new request
router.post('/maintenance', tenantAuth, async (req, res) => {
  const { issue, priority } = req.body;
  if (!issue) return res.status(400).json({ error: 'Issue description is required.' });
  try {
    const tenantRes = await pool.query('SELECT house_id FROM tenants WHERE id = $1', [req.tenant.id]);
    const result = await pool.query(
      `INSERT INTO maintenance_requests (tenant_id, house_id, issue, priority)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.tenant.id, tenantRes.rows[0]?.house_id, issue, priority || 'medium']
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

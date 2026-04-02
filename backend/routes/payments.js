const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const jwt     = require('jsonwebtoken');

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

// GET all payments — admin sees all, landlord sees only their tenants' payments
router.get('/', auth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const query = isAdmin
      ? `SELECT p.*, t.full_name AS tenant_name, h.unit_number
         FROM payments p
         LEFT JOIN tenants t ON p.tenant_id = t.id
         LEFT JOIN houses  h ON p.house_id  = h.id
         ORDER BY p.payment_date DESC`
      : `SELECT p.*, t.full_name AS tenant_name, h.unit_number
         FROM payments p
         LEFT JOIN tenants t ON p.tenant_id = t.id
         LEFT JOIN houses  h ON p.house_id  = h.id
         LEFT JOIN plots   pl ON h.plot_id  = pl.id
         WHERE pl.user_id = $1
         ORDER BY p.payment_date DESC`;
    const params = isAdmin ? [] : [req.user.id];
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single payment
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM payments WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST record payment
router.post('/', auth, async (req, res) => {
  const { tenant_id, unit_id, amount, payment_date, payment_method, reference_number, notes } = req.body;
  if (!tenant_id || !amount || !payment_date) return res.status(400).json({ error: 'tenant_id, amount and payment_date are required.' });

  try {
    const result = await pool.query(
      `INSERT INTO payments (tenant_id, house_id, amount, payment_date, method, receipt_no, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'matched') RETURNING *`,
      [tenant_id, unit_id || null, amount, payment_date, payment_method || 'cash', reference_number || null, notes || null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE payment (admin only)
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    const result = await pool.query('DELETE FROM payments WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
    res.json({ success: true, message: 'Payment deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

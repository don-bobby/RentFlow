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

// GET all tenants — admin sees all, landlord sees only tenants in their plots
router.get('/', auth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const query = isAdmin
      ? `SELECT t.*, h.unit_number, h.rent_amount, p.name AS plot_name
         FROM tenants t
         LEFT JOIN houses h ON t.house_id = h.id
         LEFT JOIN plots  p ON h.plot_id  = p.id
         ORDER BY t.full_name`
      : `SELECT t.*, h.unit_number, h.rent_amount, p.name AS plot_name
         FROM tenants t
         LEFT JOIN houses h ON t.house_id = h.id
         LEFT JOIN plots  p ON h.plot_id  = p.id
         WHERE p.user_id = $1
         ORDER BY t.full_name`;
    const params = isAdmin ? [] : [req.user.id];
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single tenant
router.get('/:id', auth, async (req, res) => {
  try {
    const tenant = await pool.query(
      `SELECT t.*, p.user_id AS plot_owner FROM tenants t
       LEFT JOIN houses h ON t.house_id = h.id
       LEFT JOIN plots  p ON h.plot_id  = p.id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (tenant.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
    if (req.user.role !== 'admin' && tenant.rows[0].plot_owner !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    const payments = await pool.query(
      'SELECT * FROM payments WHERE tenant_id=$1 ORDER BY payment_date DESC',
      [req.params.id]
    );
    res.json({ success: true, data: { ...tenant.rows[0], payments: payments.rows } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST add new tenant
router.post('/', auth, async (req, res) => {
  const { full_name, phone, email, national_id, house_id, move_in_date, rent_due_day, deposit_paid, emergency_phone } = req.body;
  if (!full_name || !house_id) return res.status(400).json({ error: 'full_name and house_id are required' });

  // Verify landlord owns the house's plot
  if (req.user.role === 'landlord') {
    const check = await pool.query(
      'SELECT p.user_id FROM houses h LEFT JOIN plots p ON h.plot_id = p.id WHERE h.id = $1',
      [house_id]
    );
    if (check.rows.length === 0 || check.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'You do not own this unit' });
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO tenants (full_name, phone, email, national_id, house_id, move_in_date, rent_due_day, deposit_paid, emergency_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [full_name, phone, email, national_id, house_id, move_in_date, rent_due_day || 5, deposit_paid || 0, emergency_phone]
    );
    await pool.query("UPDATE houses SET status='occupied' WHERE id=$1", [house_id]);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update tenant
router.put('/:id', auth, async (req, res) => {
  const { full_name, phone, email, national_id, house_id, move_in_date, rent_due_day, deposit_paid, emergency_phone, is_active } = req.body;
  try {
    const result = await pool.query(
      `UPDATE tenants SET full_name=$1, phone=$2, email=$3, national_id=$4,
       house_id=$5, move_in_date=$6, rent_due_day=$7, deposit_paid=$8,
       emergency_phone=$9, is_active=$10 WHERE id=$11 RETURNING *`,
      [full_name, phone, email, national_id, house_id, move_in_date, rent_due_day || 5, deposit_paid || 0, emergency_phone, is_active ?? true, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE (deactivate) tenant
router.delete('/:id', auth, async (req, res) => {
  try {
    const tenant = await pool.query('SELECT house_id FROM tenants WHERE id=$1', [req.params.id]);
    if (tenant.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
    await pool.query('UPDATE tenants SET is_active=false WHERE id=$1', [req.params.id]);
    if (tenant.rows[0].house_id) {
      await pool.query("UPDATE houses SET status='vacant' WHERE id=$1", [tenant.rows[0].house_id]);
    }
    res.json({ success: true, message: 'Tenant deactivated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

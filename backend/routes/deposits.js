const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const jwt     = require('jsonwebtoken');
const { logAudit } = require('../utils/audit');

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

function adminOrLandlord(req, res, next) {
  if (!['admin', 'landlord'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
  next();
}

// GET /api/deposits — full ledger, scoped like payments/tenants (landlord sees own)
router.get('/', auth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const query = isAdmin
      ? `SELECT d.*, t.full_name AS tenant_name, h.unit_number, p.name AS plot_name
         FROM deposit_transactions d
         LEFT JOIN tenants t ON d.tenant_id = t.id
         LEFT JOIN houses  h ON d.house_id  = h.id
         LEFT JOIN plots   p ON h.plot_id   = p.id
         ORDER BY d.created_at DESC`
      : `SELECT d.*, t.full_name AS tenant_name, h.unit_number, p.name AS plot_name
         FROM deposit_transactions d
         LEFT JOIN tenants t ON d.tenant_id = t.id
         LEFT JOIN houses  h ON d.house_id  = h.id
         LEFT JOIN plots   p ON h.plot_id   = p.id
         WHERE p.user_id = $1
         ORDER BY d.created_at DESC`;
    const params = isAdmin ? [] : [req.user.id];
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/deposits — record a refund or forfeiture (collections are auto-logged
// when a tenant is created — see tenants.js)
router.post('/', auth, adminOrLandlord, async (req, res) => {
  const { tenant_id, house_id, type, amount, notes } = req.body;
  if (!type || !amount) return res.status(400).json({ error: 'type and amount are required.' });
  if (!['collected', 'refunded', 'forfeited'].includes(type)) return res.status(400).json({ error: "type must be 'collected', 'refunded' or 'forfeited'." });
  try {
    const result = await pool.query(
      `INSERT INTO deposit_transactions (tenant_id, house_id, type, amount, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenant_id || null, house_id || null, type, amount, notes || null, req.user.id]
    );
    await logAudit({ user: req.user, action: `deposit.${type}`, entityType: 'deposit_transaction', entityId: result.rows[0].id, changes: { amount: { from: null, to: amount } } });
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

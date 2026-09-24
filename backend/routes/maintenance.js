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

// GET all maintenance requests — scoped by landlord
router.get('/', auth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const query = isAdmin
      ? `SELECT m.*, t.full_name AS tenant_name, h.unit_number
         FROM maintenance_requests m
         LEFT JOIN tenants t ON m.tenant_id = t.id
         LEFT JOIN houses  h ON m.house_id  = h.id
         ORDER BY m.reported_at DESC`
      : `SELECT m.*, t.full_name AS tenant_name, h.unit_number
         FROM maintenance_requests m
         LEFT JOIN tenants t ON m.tenant_id = t.id
         LEFT JOIN houses  h ON m.house_id  = h.id
         LEFT JOIN plots   p ON h.plot_id   = p.id
         WHERE p.user_id = $1
         ORDER BY m.reported_at DESC`;
    const params = isAdmin ? [] : [req.user.id];
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single request
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM maintenance_requests WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create request
router.post('/', auth, async (req, res) => {
  const { tenant_id, house_id, issue, priority, photo_url } = req.body;
  if (!tenant_id || !issue) return res.status(400).json({ error: 'tenant_id and issue are required.' });
  try {
    const result = await pool.query(
      `INSERT INTO maintenance_requests (tenant_id, house_id, issue, priority, status, photo_url)
       VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING *`,
      [tenant_id, house_id || null, issue, priority || 'medium', photo_url || null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH update status
router.patch('/:id', auth, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'in_progress', 'completed'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
  try {
    const result = await pool.query(
      `UPDATE maintenance_requests
       SET status = $1,
           resolved_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE NULL END
       WHERE id = $2
       RETURNING *`,
      [status, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE request (admin only)
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    const result = await pool.query('DELETE FROM maintenance_requests WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    res.json({ success: true, message: 'Request deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

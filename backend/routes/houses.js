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

// GET ALL houses — admin sees all, landlord sees only houses in their plots
router.get('/', auth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const query = isAdmin
      ? `SELECT h.*, p.name AS plot_name, p.location AS plot_location
         FROM houses h LEFT JOIN plots p ON h.plot_id = p.id
         ORDER BY h.id ASC`
      : `SELECT h.*, p.name AS plot_name, p.location AS plot_location
         FROM houses h LEFT JOIN plots p ON h.plot_id = p.id
         WHERE p.user_id = $1
         ORDER BY h.id ASC`;
    const params = isAdmin ? [] : [req.user.id];
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET ONE house
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT h.*, p.user_id AS plot_owner FROM houses h
       LEFT JOIN plots p ON h.plot_id = p.id WHERE h.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'House not found' });
    const house = result.rows[0];
    if (req.user.role !== 'admin' && house.plot_owner !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    res.json(house);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create house
router.post('/', auth, async (req, res) => {
  if (!['admin', 'landlord'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
  try {
    const { plot_id, unit_number, house_type, rent_amount, deposit, status, meter_no } = req.body;
    if (!plot_id || !unit_number || !rent_amount) return res.status(400).json({ error: 'plot_id, unit_number and rent_amount are required' });

    // Verify landlord owns this plot
    if (req.user.role === 'landlord') {
      const plotCheck = await pool.query('SELECT user_id FROM plots WHERE id = $1', [plot_id]);
      if (plotCheck.rows.length === 0 || plotCheck.rows[0].user_id !== req.user.id) {
        return res.status(403).json({ error: 'You do not own this plot' });
      }
    }

    const result = await pool.query(
      `INSERT INTO houses (plot_id, unit_number, house_type, rent_amount, deposit, status, meter_no)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [plot_id, unit_number, house_type || 'Bedsitter', rent_amount, deposit || null, status || 'vacant', meter_no || null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update house
router.put('/:id', auth, async (req, res) => {
  try {
    const check = await pool.query(
      'SELECT p.user_id FROM houses h LEFT JOIN plots p ON h.plot_id = p.id WHERE h.id = $1',
      [req.params.id]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'House not found' });
    if (req.user.role !== 'admin' && check.rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    const { plot_id, unit_number, house_type, rent_amount, deposit, status, meter_no } = req.body;
    const result = await pool.query(
      `UPDATE houses SET plot_id=$1, unit_number=$2, house_type=$3, rent_amount=$4,
       deposit=$5, status=$6, meter_no=$7 WHERE id=$8 RETURNING *`,
      [plot_id, unit_number, house_type, rent_amount, deposit || null, status || 'vacant', meter_no || null, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE house (admin only)
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    const result = await pool.query('DELETE FROM houses WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'House not found' });
    res.json({ success: true, message: 'House deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

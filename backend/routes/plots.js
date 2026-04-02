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

// GET ALL plots — admin sees all, landlord sees only their own
router.get('/', auth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const query   = isAdmin
      ? 'SELECT * FROM plots ORDER BY created_at DESC'
      : 'SELECT * FROM plots WHERE user_id = $1 ORDER BY created_at DESC';
    const params  = isAdmin ? [] : [req.user.id];
    const result  = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET ONE plot
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM plots WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Plot not found' });
    const plot = result.rows[0];
    if (req.user.role !== 'admin' && plot.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(plot);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create plot
router.post('/', auth, async (req, res) => {
  if (!['admin', 'landlord'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
  try {
    const { name, location, description, owner_id } = req.body;
    if (!name) return res.status(400).json({ error: 'Plot name is required' });

    // Admin can assign to any landlord via owner_id, otherwise assign to self
    const assignedTo = req.user.role === 'admin' && owner_id ? owner_id : req.user.id;

    const result = await pool.query(
      'INSERT INTO plots (user_id, name, location, description) VALUES ($1, $2, $3, $4) RETURNING *',
      [assignedTo, name, location || null, description || null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update plot
router.put('/:id', auth, async (req, res) => {
  try {
    const check = await pool.query('SELECT user_id FROM plots WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Plot not found' });
    if (req.user.role !== 'admin' && check.rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    const { name, location, description, owner_id } = req.body;

    // Only admin can reassign owner
    const newOwnerId = req.user.role === 'admin' && owner_id ? owner_id : check.rows[0].user_id;

    const result = await pool.query(
      'UPDATE plots SET name=$1, location=$2, description=$3, user_id=$4 WHERE id=$5 RETURNING *',
      [name, location || null, description || null, newOwnerId, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE plot (admin only)
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    const result = await pool.query('DELETE FROM plots WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Plot not found' });
    res.json({ success: true, message: 'Plot deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

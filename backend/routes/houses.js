const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const jwt     = require('jsonwebtoken');
const { logAudit, diff } = require('../utils/audit');

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

// GET ALL houses — admin sees all, landlord sees own, caretaker sees assigned plots
router.get('/', auth, async (req, res) => {
  try {
    let query, params = [];
    if (req.user.role === 'admin') {
      query = `SELECT h.*, p.name AS plot_name, p.location AS plot_location, u.name AS owner_name
               FROM houses h LEFT JOIN plots p ON h.plot_id = p.id
               LEFT JOIN users u ON p.user_id = u.id
               ORDER BY h.id ASC`;
    } else if (req.user.role === 'landlord') {
      query = `SELECT h.*, p.name AS plot_name, p.location AS plot_location
               FROM houses h LEFT JOIN plots p ON h.plot_id = p.id
               WHERE p.user_id = $1 ORDER BY h.id ASC`;
      params = [req.user.id];
    } else if (req.user.role === 'caretaker') {
      query = `SELECT h.*, p.name AS plot_name, p.location AS plot_location
               FROM houses h LEFT JOIN plots p ON h.plot_id = p.id
               WHERE p.id IN (
                 SELECT plot_id FROM caretaker_plots WHERE caretaker_id = $1
                 UNION
                 SELECT plot_id FROM users WHERE id = $1 AND plot_id IS NOT NULL
               ) ORDER BY h.id ASC`;
      params = [req.user.id];
    } else {
      return res.json([]);
    }
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
// Admin/landlord: auto-approved. Caretaker: pending approval.
router.post('/', auth, async (req, res) => {
  if (!['admin', 'landlord', 'caretaker'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
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

    // Verify caretaker is assigned to this plot
    if (req.user.role === 'caretaker') {
      const plotCheck = await pool.query(
        `SELECT 1 FROM caretaker_plots WHERE caretaker_id=$1 AND plot_id=$2
         UNION SELECT 1 FROM users WHERE id=$1 AND plot_id=$2`,
        [req.user.id, plot_id]
      );
      if (plotCheck.rows.length === 0) return res.status(403).json({ error: 'You are not assigned to this plot.' });
    }

    // Caretaker-added units require approval
    const isApproved = req.user.role !== 'caretaker';

    const result = await pool.query(
      `INSERT INTO houses (plot_id, unit_number, house_type, rent_amount, deposit, status, meter_no, is_approved, status_changed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING *`,
      [plot_id, unit_number, house_type || 'Bedsitter', rent_amount, deposit || null, status || 'vacant', meter_no || null, isApproved]
    );

    const msg = isApproved ? undefined : 'Unit submitted for approval by admin/landlord.';
    res.status(201).json({ success: true, data: result.rows[0], message: msg });
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
    const oldStatusRes = await pool.query('SELECT status, rent_amount, unit_number FROM houses WHERE id=$1', [req.params.id]);
    const statusChanged = oldStatusRes.rows[0] && oldStatusRes.rows[0].status !== (status || 'vacant');
    const result = await pool.query(
      `UPDATE houses SET plot_id=$1, unit_number=$2, house_type=$3, rent_amount=$4,
       deposit=$5, status=$6, meter_no=$7, status_changed_at = CASE WHEN $9 THEN NOW() ELSE status_changed_at END
       WHERE id=$8 RETURNING *`,
      [plot_id, unit_number, house_type, rent_amount, deposit || null, status || 'vacant', meter_no || null, req.params.id, statusChanged]
    );
    const changes = diff(oldStatusRes.rows[0], result.rows[0], ['status', 'rent_amount', 'unit_number']);
    if (Object.keys(changes).length > 0) {
      await logAudit({ user: req.user, action: 'house.update', entityType: 'house', entityId: req.params.id, changes });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/houses/:id/reject — admin/landlord rejects a caretaker-submitted unit
router.patch('/:id/reject', auth, async (req, res) => {
  if (!['admin', 'landlord'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
  const { reason } = req.body;
  try {
    const result = await pool.query(
      `UPDATE houses SET is_approved = false, rejection_reason = $1 WHERE id = $2 RETURNING *`,
      [reason || null, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'House not found' });
    await logAudit({ user: req.user, action: 'house.reject', entityType: 'house', entityId: req.params.id, changes: { is_approved: { from: null, to: false } } });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/houses/:id/approve — admin/landlord approves a caretaker-submitted unit
router.patch('/:id/approve', auth, async (req, res) => {
  if (!['admin', 'landlord'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
  try {
    const result = await pool.query(
      'UPDATE houses SET is_approved = true WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'House not found' });
    await logAudit({ user: req.user, action: 'house.approve', entityType: 'house', entityId: req.params.id, changes: { is_approved: { from: false, to: true } } });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/houses/:id/description
router.patch('/:id/description', auth, async (req, res) => {
  const { description } = req.body;
  try {
    await pool.query('UPDATE houses SET description = $1 WHERE id = $2', [description || null, req.params.id]);
    res.json({ success: true });
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

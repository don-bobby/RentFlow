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

function adminOrLandlord(req, res, next) {
  if (!['admin', 'landlord'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
  next();
}

// GET all expenses
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.*, p.name AS plot_name
       FROM expenses e
       LEFT JOIN plots p ON e.plot_id = p.id
       ORDER BY e.expense_date DESC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single expense
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM expenses WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create expense
router.post('/', auth, adminOrLandlord, async (req, res) => {
  const { plot_id, category, description, amount, expense_date, receipt_url } = req.body;

  if (!amount || !expense_date) {
    return res.status(400).json({ error: 'amount and expense_date are required.' });
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

// PUT update expense
router.put('/:id', auth, adminOrLandlord, async (req, res) => {
  const { plot_id, category, description, amount, expense_date, receipt_url } = req.body;
  try {
    const result = await pool.query(
      `UPDATE expenses SET plot_id=$1, category=$2, description=$3, amount=$4, expense_date=$5, receipt_url=$6
       WHERE id=$7 RETURNING *`,
      [plot_id || null, category || null, description || null, amount, expense_date, receipt_url || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE expense
router.delete('/:id', auth, adminOrLandlord, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM expenses WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    res.json({ success: true, message: 'Expense deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

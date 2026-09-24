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
    // Look up the tenant's move-in date + rent amount so this payment can be
    // allocated to the oldest unpaid month first — the same logic the M-Pesa
    // callback in mpesa.js already uses, so "Allocated To" is consistent no
    // matter how the payment was recorded.
    const tenantRes = await pool.query(
      `SELECT t.house_id, t.move_in_date, h.rent_amount
       FROM tenants t LEFT JOIN houses h ON t.house_id = h.id
       WHERE t.id = $1`,
      [tenant_id]
    );
    const tenant  = tenantRes.rows[0];
    const houseId = unit_id || tenant?.house_id || null;

    const insertedRows = [];

    if (tenant?.rent_amount && tenant?.move_in_date) {
      // Same "unpaid months since move-in" calculation as mpesa.js
      const paidRes = await pool.query(
        `SELECT COALESCE(for_year, EXTRACT(YEAR FROM payment_date)::int) AS year,
                COALESCE(for_month, EXTRACT(MONTH FROM payment_date)::int) AS month,
                COALESCE(SUM(amount_allocated), SUM(amount)) AS total_paid
         FROM payments WHERE tenant_id=$1 AND status != 'pending' GROUP BY year, month`,
        [tenant_id]
      );
      const paidMap = {};
      for (const p of paidRes.rows) paidMap[`${p.year}-${p.month}`] = parseFloat(p.total_paid);

      const moveIn = new Date(tenant.move_in_date);
      let y = moveIn.getDate() === 1 ? moveIn.getFullYear() : (moveIn.getMonth() === 11 ? moveIn.getFullYear() + 1 : moveIn.getFullYear());
      let m = moveIn.getDate() === 1 ? moveIn.getMonth() + 1 : (moveIn.getMonth() === 11 ? 1 : moveIn.getMonth() + 2);
      const now = new Date();
      const unpaid = [];
      while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
        const balance = parseFloat(tenant.rent_amount) - (paidMap[`${y}-${m}`] || 0);
        if (balance > 0) unpaid.push({ year: y, month: m, balance });
        m++; if (m > 12) { m = 1; y++; }
      }

      // Walk unpaid months oldest-first, splitting this payment across as
      // many rows as needed (mirrors mpesa.js's callback handler exactly).
      let remaining = parseFloat(amount);
      for (const month of unpaid) {
        if (remaining <= 0) break;
        const allocate = Math.min(remaining, month.balance);
        const row = await pool.query(
          `INSERT INTO payments (tenant_id, house_id, amount, amount_allocated, payment_date, method, receipt_no, notes, status, for_year, for_month)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'matched',$9,$10) RETURNING *`,
          [tenant_id, houseId, allocate, allocate, payment_date, payment_method || 'cash', reference_number || null, notes || null, month.year, month.month]
        );
        insertedRows.push(row.rows[0]);
        remaining -= allocate;
      }

      // Anything left over once every known unpaid month is fully covered
      // (e.g. an advance payment) is still recorded in full — it just has no
      // specific month attached, same as the frontend already displays for
      // unmatched M-Pesa payments ("—" in Allocated To). Nothing gets
      // silently dropped, unlike the mpesa.js version this is based on.
      if (remaining > 0) {
        const row = await pool.query(
          `INSERT INTO payments (tenant_id, house_id, amount, amount_allocated, payment_date, method, receipt_no, notes, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'matched') RETURNING *`,
          [tenant_id, houseId, remaining, remaining, payment_date, payment_method || 'cash', reference_number || null, notes || null]
        );
        insertedRows.push(row.rows[0]);
      }
    } else {
      // No rent_amount/move_in_date on file for this tenant — fall back to
      // the original single-row behavior (no month allocation possible).
      const row = await pool.query(
        `INSERT INTO payments (tenant_id, house_id, amount, payment_date, method, receipt_no, notes, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'matched') RETURNING *`,
        [tenant_id, houseId, amount, payment_date, payment_method || 'cash', reference_number || null, notes || null]
      );
      insertedRows.push(row.rows[0]);
    }

    // Recalculate balance dynamically after payment
    await pool.query(`
      UPDATE tenants SET balance = GREATEST(0,
        GREATEST(1,
          (EXTRACT(YEAR  FROM NOW()) - EXTRACT(YEAR  FROM move_in_date)) * 12 +
          (EXTRACT(MONTH FROM NOW()) - EXTRACT(MONTH FROM move_in_date)) + 1
        ) * (SELECT rent_amount FROM houses WHERE id = tenants.house_id) -
        COALESCE((
          SELECT SUM(amount) FROM payments
          WHERE tenant_id = $1 AND method != 'balance_charge'
        ), 0)
      ) WHERE id = $1
    `, [tenant_id]);

    res.status(201).json({ success: true, data: insertedRows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE payment (admin only)
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    const payment = await pool.query('SELECT * FROM payments WHERE id = $1', [req.params.id]);
    if (payment.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });

    const { tenant_id, amount } = payment.rows[0];

    await pool.query('DELETE FROM payments WHERE id = $1', [req.params.id]);

    // Recalculate balance after deleting payment
    if (tenant_id) {
      await pool.query(`
        UPDATE tenants SET balance = GREATEST(0,
          GREATEST(1,
            (EXTRACT(YEAR  FROM NOW()) - EXTRACT(YEAR  FROM move_in_date)) * 12 +
            (EXTRACT(MONTH FROM NOW()) - EXTRACT(MONTH FROM move_in_date)) + 1
          ) * (SELECT rent_amount FROM houses WHERE id = tenants.house_id) -
          COALESCE((
            SELECT SUM(amount) FROM payments
            WHERE tenant_id = $1 AND method != 'balance_charge'
          ), 0)
        ) WHERE id = $1
      `, [tenant_id]);
    }

    res.json({ success: true, message: 'Payment deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

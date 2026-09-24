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

// GET all tenants — balance calculated dynamically from move-in date
router.get('/', auth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const filter  = isAdmin ? '' : 'WHERE p.user_id = $1';
    const params  = isAdmin ? [] : [req.user.id];

    const result = await pool.query(`
      SELECT
        t.*,
        h.unit_number,
        h.rent_amount,
        p.name AS plot_name,
        u.name AS owner_name,

        -- Months since move-in (minimum 1)
        GREATEST(1,
          (EXTRACT(YEAR  FROM NOW()) - EXTRACT(YEAR  FROM t.move_in_date)) * 12 +
          (EXTRACT(MONTH FROM NOW()) - EXTRACT(MONTH FROM t.move_in_date)) + 1
        ) AS months_tenancy,

        -- Total rent owed since move-in
        GREATEST(1,
          (EXTRACT(YEAR  FROM NOW()) - EXTRACT(YEAR  FROM t.move_in_date)) * 12 +
          (EXTRACT(MONTH FROM NOW()) - EXTRACT(MONTH FROM t.move_in_date)) + 1
        ) * h.rent_amount AS total_rent_due,

        -- Total payments made (excluding auto-charges)
        COALESCE((
          SELECT SUM(py.amount) FROM payments py
          WHERE py.tenant_id = t.id AND py.method != 'balance_charge'
        ), 0) AS total_paid,

        -- Dynamic balance = total due - total paid
        GREATEST(0,
          GREATEST(1,
            (EXTRACT(YEAR  FROM NOW()) - EXTRACT(YEAR  FROM t.move_in_date)) * 12 +
            (EXTRACT(MONTH FROM NOW()) - EXTRACT(MONTH FROM t.move_in_date)) + 1
          ) * h.rent_amount -
          COALESCE((
            SELECT SUM(py.amount) FROM payments py
            WHERE py.tenant_id = t.id AND py.method != 'balance_charge'
          ), 0)
        ) AS balance

      FROM tenants t
      LEFT JOIN houses h ON t.house_id = h.id
      LEFT JOIN plots  p ON h.plot_id  = p.id
      LEFT JOIN users  u ON p.user_id  = u.id
      ${filter}
      ORDER BY t.full_name
    `, params);

    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET unpaid months — must be BEFORE /:id to avoid route conflict
router.get('/unpaid-months', auth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';

    // Step 1: fetch all active tenants with their rent_amount from houses
    const tenantQuery = isAdmin
      ? `SELECT t.id, t.full_name, t.move_in_date, t.phone,
                h.rent_amount, h.unit_number, p.name AS plot_name
         FROM tenants t
         LEFT JOIN houses h ON t.house_id = h.id
         LEFT JOIN plots  p ON h.plot_id  = p.id
         WHERE t.is_active = true AND t.move_in_date IS NOT NULL`
      : `SELECT t.id, t.full_name, t.move_in_date, t.phone,
                h.rent_amount, h.unit_number, p.name AS plot_name
         FROM tenants t
         LEFT JOIN houses h ON t.house_id = h.id
         LEFT JOIN plots  p ON h.plot_id  = p.id
         WHERE t.is_active = true AND t.move_in_date IS NOT NULL
           AND p.user_id = $1`;
    const tenantParams = isAdmin ? [] : [req.user.id];
    const tenants = await pool.query(tenantQuery, tenantParams);

    const tenantIds = tenants.rows.map(t => t.id);
    if (tenantIds.length === 0) return res.json({ success: true, data: [] });

    // Step 2: fetch how much has been paid per month per tenant.
    // BUG FIX: use for_year/for_month (set by payments.js allocation logic)
    // first, then fall back to payment_date year/month for older records that
    // predate the for_year/for_month columns. This ensures a payment recorded
    // in Sept 2026 that was allocated to Jan 2026 correctly marks Jan as paid.
    const paymentsResult = await pool.query(
      `SELECT
         tenant_id,
         COALESCE(for_year,  EXTRACT(YEAR  FROM payment_date)::int) AS year,
         COALESCE(for_month, EXTRACT(MONTH FROM payment_date)::int) AS month,
         SUM(COALESCE(amount_allocated, amount))                    AS total_paid
       FROM payments
       WHERE tenant_id = ANY($1)
         AND status NOT IN ('failed', 'pending')
         AND method  != 'balance_charge'
       GROUP BY tenant_id, year, month`,
      [tenantIds]
    );

    // Build a map: "tenantId-year-month" → total amount paid for that month
    const paidMap = {};
    for (const p of paymentsResult.rows) {
      const key = `${p.tenant_id}-${p.year}-${p.month}`;
      paidMap[key] = parseFloat(p.total_paid || 0);
    }

    const now = new Date();
    const results = [];

    for (const tenant of tenants.rows) {
      const rent = parseFloat(tenant.rent_amount || 0);
      const moveIn = new Date(tenant.move_in_date);

      // First billing month: if moved in on the 1st, charge that month;
      // otherwise start charging from the following month
      const startYear  = moveIn.getDate() === 1
        ? moveIn.getFullYear()
        : (moveIn.getMonth() === 11 ? moveIn.getFullYear() + 1 : moveIn.getFullYear());
      const startMonth = moveIn.getDate() === 1
        ? moveIn.getMonth() + 1
        : (moveIn.getMonth() === 11 ? 1 : moveIn.getMonth() + 2);

      const unpaidMonths = [];
      let y = startYear;
      let m = startMonth;

      while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
        const key      = `${tenant.id}-${y}-${m}`;
        const paid     = paidMap[key] || 0;
        const balance  = rent - paid;   // how much of this month is still owed

        if (balance > 0) {
          unpaidMonths.push({
            year:        y,
            month:       m,
            label:       new Date(y, m - 1, 1).toLocaleString('en-KE', { month: 'long', year: 'numeric' }),
            rent:        rent,          // ✅ full month rent — shown in pill
            balance:     balance,       // ✅ remaining balance for this month
            partial:     paid > 0,      // ✅ true when partially paid
          });
        }

        m++;
        if (m > 12) { m = 1; y++; }
      }

      if (unpaidMonths.length > 0) {
        results.push({
          tenant_id:     tenant.id,
          full_name:     tenant.full_name,
          phone:         tenant.phone,
          unit_number:   tenant.unit_number,
          plot_name:     tenant.plot_name,
          rent_amount:   rent,
          unpaid_months: unpaidMonths,
          // total_owed = sum of per-month balances (not just months × rent,
          // which overcounts partial payments)
          total_owed:    unpaidMonths.reduce((s, mo) => s + mo.balance, 0),
        });
      }
    }

    res.json({ success: true, data: results });
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
    await pool.query("UPDATE houses SET status='occupied', status_changed_at=NOW() WHERE id=$1 AND status != 'occupied'", [house_id]);
    if (deposit_paid && parseFloat(deposit_paid) > 0) {
      await pool.query(
        `INSERT INTO deposit_transactions (tenant_id, house_id, type, amount, notes, created_by)
         VALUES ($1, $2, 'collected', $3, 'Auto-recorded on tenant creation', $4)`,
        [result.rows[0].id, house_id, deposit_paid, req.user.id]
      );
    }
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update tenant
router.put('/:id', auth, async (req, res) => {
  const { full_name, phone, email, national_id, house_id, move_in_date, rent_due_day, deposit_paid, emergency_phone, is_active } = req.body;
  try {
    // Get the tenant's previous state before updating (used for house sync + audit diff)
    const prev = await pool.query('SELECT full_name, phone, house_id, move_in_date, rent_due_day, is_active FROM tenants WHERE id=$1', [req.params.id]);
    if (prev.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
    const oldHouseId  = prev.rows[0].house_id;
    const newIsActive = is_active ?? true;

    const result = await pool.query(
      `UPDATE tenants SET full_name=$1, phone=$2, email=$3, national_id=$4,
       house_id=$5, move_in_date=$6, rent_due_day=$7, deposit_paid=$8,
       emergency_phone=$9, is_active=$10 WHERE id=$11 RETURNING *`,
      [full_name, phone, email, national_id, house_id, move_in_date, rent_due_day || 5, deposit_paid || 0, emergency_phone, newIsActive, req.params.id]
    );

    // Sync house statuses
    const newHouseId = house_id ? parseInt(house_id) : null;

    if (!newIsActive) {
      // Tenant deactivated — free their unit
      if (newHouseId) await pool.query("UPDATE houses SET status='vacant', status_changed_at=NOW() WHERE id=$1 AND status != 'vacant'", [newHouseId]);
    } else {
      // Tenant is active — mark new unit as occupied
      if (newHouseId) await pool.query("UPDATE houses SET status='occupied', status_changed_at=NOW() WHERE id=$1 AND status != 'occupied'", [newHouseId]);
      // If unit changed, free the old one (only if no other active tenant is using it)
      if (oldHouseId && oldHouseId !== newHouseId) {
        const stillUsed = await pool.query(
          'SELECT id FROM tenants WHERE house_id=$1 AND is_active=true AND id!=$2',
          [oldHouseId, req.params.id]
        );
        if (stillUsed.rows.length === 0) {
          await pool.query("UPDATE houses SET status='vacant', status_changed_at=NOW() WHERE id=$1 AND status != 'vacant'", [oldHouseId]);
        }
      }
    }

    const changes = diff(prev.rows[0], result.rows[0], ['full_name', 'phone', 'house_id', 'move_in_date', 'rent_due_day', 'is_active']);
    if (Object.keys(changes).length > 0) {
      await logAudit({ user: req.user, action: 'tenant.update', entityType: 'tenant', entityId: req.params.id, changes });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE (deactivate) tenant
router.delete('/:id', auth, async (req, res) => {
  try {
    const tenant = await pool.query('SELECT house_id FROM tenants WHERE id=$1', [req.params.id]);
    if (tenant.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
    await pool.query('UPDATE tenants SET is_active=false WHERE id=$1', [req.params.id]);
    await logAudit({ user: req.user, action: 'tenant.deactivate', entityType: 'tenant', entityId: req.params.id, changes: { is_active: { from: true, to: false } } });
    if (tenant.rows[0].house_id) {
      await pool.query("UPDATE houses SET status='vacant', status_changed_at=NOW() WHERE id=$1 AND status != 'vacant'", [tenant.rows[0].house_id]);
    }
    res.json({ success: true, message: 'Tenant deactivated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

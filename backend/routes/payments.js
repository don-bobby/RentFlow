const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const { getVisiblePlotIds } = require('../middleware/scope');
const { authMiddleware: staffAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { logAudit } = require('../utils/audit');

// GET all payments — admin/super_admin see all, agent sees their landlords',
// landlord sees own, caretaker sees assigned (scoping lives in one place now)
router.get('/', staffAuth, requirePermission('payments.view'), async (req, res) => {
  try {
    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && visible.length === 0) return res.json({ success: true, data: [] });

    const query = `
      SELECT p.*, t.full_name AS tenant_name, h.unit_number, pl.name AS plot_name
      FROM payments p
      LEFT JOIN tenants t ON p.tenant_id = t.id
      LEFT JOIN houses  h ON p.house_id  = h.id
      LEFT JOIN plots   pl ON h.plot_id  = pl.id
      ${visible === 'ALL' ? '' : 'WHERE pl.id = ANY($1)'}
      ORDER BY p.payment_date DESC
    `;
    const params = visible === 'ALL' ? [] : [visible];
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single payment
router.get('/:id', staffAuth, requirePermission('payments.view'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, h.plot_id FROM payments p
       LEFT JOIN houses h ON p.house_id = h.id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
    const payment = result.rows[0];

    const visible = await getVisiblePlotIds(req.user);
    const canView = visible === 'ALL' || (payment.plot_id != null && visible.includes(payment.plot_id));
    if (!canView) return res.status(403).json({ error: 'Access denied' });

    res.json({ success: true, data: payment });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/payments/arrears/:tenantId — everything currently owed by a
// tenant: unpaid rent months plus any deposit shortfall, so the "Outstanding"
// box shown before recording a payment (and before an STK push) is actually
// accurate. This route never existed before, so that box has always silently
// shown nothing (the frontend swallows the failed request and just hides it).
router.get('/arrears/:tenantId', staffAuth, requirePermission('payments.view'), async (req, res) => {
  try {
    const tenantRes = await pool.query(
      `SELECT t.id, t.house_id, t.move_in_date, t.deposit_paid,
              h.rent_amount, h.plot_id, h.deposit AS required_deposit
       FROM tenants t LEFT JOIN houses h ON t.house_id = h.id
       WHERE t.id = $1`,
      [req.params.tenantId]
    );
    const tenant = tenantRes.rows[0];
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      const visible = await getVisiblePlotIds(req.user);
      const allowed = visible === 'ALL' || (tenant.plot_id != null && visible.includes(tenant.plot_id));
      if (!allowed) return res.status(403).json({ error: 'Access denied' });
    }

    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const unpaid_months = [];
    if (tenant.rent_amount && tenant.move_in_date) {
      const paidRes = await pool.query(
        `SELECT COALESCE(for_year, EXTRACT(YEAR FROM payment_date)::int) AS year,
                COALESCE(for_month, EXTRACT(MONTH FROM payment_date)::int) AS month,
                COALESCE(SUM(amount_allocated), SUM(amount)) AS total_paid
         FROM payments WHERE tenant_id=$1 AND status != 'pending' GROUP BY year, month`,
        [req.params.tenantId]
      );
      const paidMap = {};
      for (const p of paidRes.rows) paidMap[`${p.year}-${p.month}`] = parseFloat(p.total_paid);

      const moveIn = new Date(tenant.move_in_date);
      let y = moveIn.getDate() === 1 ? moveIn.getFullYear() : (moveIn.getMonth() === 11 ? moveIn.getFullYear() + 1 : moveIn.getFullYear());
      let m = moveIn.getDate() === 1 ? moveIn.getMonth() + 1 : (moveIn.getMonth() === 11 ? 1 : moveIn.getMonth() + 2);
      const now = new Date();
      while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
        const paid = paidMap[`${y}-${m}`] || 0;
        const balance = parseFloat(tenant.rent_amount) - paid;
        if (balance > 0) {
          unpaid_months.push({
            year: y, month: m, label: `${monthNames[m - 1]} ${y}`,
            rent: parseFloat(tenant.rent_amount), balance, partial: paid > 0,
          });
        }
        m++; if (m > 12) { m = 1; y++; }
      }
    }

    const deposit_owed = tenant.required_deposit
      ? Math.max(0, parseFloat(tenant.required_deposit) - parseFloat(tenant.deposit_paid || 0))
      : 0;
    const rent_arrears = unpaid_months.reduce((sum, mth) => sum + mth.balance, 0);

    res.json({
      success: true,
      data: {
        total_arrears: rent_arrears + deposit_owed,
        rent_arrears,
        deposit_owed,
        unpaid_months,
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST record payment
router.post('/', staffAuth, requirePermission('payments.record_manual'), async (req, res) => {
  const { tenant_id, unit_id, amount, payment_date, payment_method, reference_number, notes } = req.body;
  if (!tenant_id || !amount || !payment_date) return res.status(400).json({ error: 'tenant_id, amount and payment_date are required.' });

  try {
    const tenantRes = await pool.query(
      `SELECT t.house_id, t.move_in_date, t.full_name, t.balance, t.deposit_paid,
              h.rent_amount, h.plot_id, h.unit_number, h.deposit AS required_deposit
       FROM tenants t LEFT JOIN houses h ON t.house_id = h.id
       WHERE t.id = $1`,
      [tenant_id]
    );
    const tenant  = tenantRes.rows[0];
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const houseId = unit_id || tenant.house_id || null;

    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      const visible = await getVisiblePlotIds(req.user);
      let plotId = null;
      if (houseId) {
        const houseCheck = await pool.query('SELECT plot_id FROM houses WHERE id = $1', [houseId]);
        plotId = houseCheck.rows[0]?.plot_id ?? null;
      }
      const allowed = visible === 'ALL' || (plotId != null && visible.includes(plotId));
      if (!allowed) return res.status(403).json({ error: 'You are not authorized to record a payment for this tenant.' });
    }

    const insertedRows = [];
    const balanceBefore = parseFloat(tenant.balance || 0);

    let rentAllocated = 0, depositCollected = 0, advanceAllocated = 0;
    if (tenant?.rent_amount && tenant?.move_in_date) {
      let remaining = parseFloat(amount);

      // A deposit shortfall is cleared FIRST, before any of this payment
      // goes toward rent. A tenant still short on their deposit is more
      // exposed than one merely behind on a month's rent, so a payment is no
      // longer allowed to "jump past" an unpaid deposit to catch up rent
      // instead — it used to be collected only out of whatever was left
      // after rent was fully allocated. This mirrors the exact pattern
      // tenants.js already uses when a deposit is recorded at tenant
      // creation — a deposit_transactions row AND a direct update to
      // tenants.deposit_paid, since nothing keeps those two in sync
      // automatically. Only the portion still actually owed on the deposit
      // is taken; nothing is ever over-collected.
      if (tenant.required_deposit) {
        const depositOwed = parseFloat(tenant.required_deposit) - parseFloat(tenant.deposit_paid || 0);
        if (depositOwed > 0 && remaining > 0) {
          depositCollected = Math.min(remaining, depositOwed);
          await pool.query(
            `INSERT INTO deposit_transactions (tenant_id, house_id, type, amount, notes, created_by)
             VALUES ($1, $2, 'collected', $3, $4, $5)`,
            [tenant_id, houseId, depositCollected, `Collected alongside a rent payment on ${payment_date}`, req.user.id]
          );
          const depRes = await pool.query(
            `UPDATE tenants SET deposit_paid = deposit_paid + $1 WHERE id = $2 RETURNING deposit_paid`,
            [depositCollected, tenant_id]
          );
          await logAudit({
            user: req.user, action: 'deposit.collected', entityType: 'deposit_transaction', entityId: null,
            changes: { amount: { to: depositCollected }, deposit_paid: { to: parseFloat(depRes.rows[0].deposit_paid) }, tenant: { to: tenant.full_name } },
          });
          remaining -= depositCollected;
        }
      }

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
        rentAllocated += allocate;
      }

      // Only once the deposit AND rent are both fully covered does any
      // further leftover count as rent paid in advance. y/m already point
      // to the month right after the last one in `unpaid` (the while loop
      // above always leaves them there) — capped at 24 months as a sanity
      // guard against a data-entry typo (an extra zero on the amount)
      // causing a runaway loop.
      let safetyCap = 24;
      while (remaining > 0 && safetyCap-- > 0) {
        const allocate = Math.min(remaining, parseFloat(tenant.rent_amount));
        const row = await pool.query(
          `INSERT INTO payments (tenant_id, house_id, amount, amount_allocated, payment_date, method, receipt_no, notes, status, for_year, for_month)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'matched',$9,$10) RETURNING *`,
          [tenant_id, houseId, allocate, allocate, payment_date, payment_method || 'cash', reference_number || null, notes || null, y, m]
        );
        insertedRows.push(row.rows[0]);
        remaining -= allocate;
        advanceAllocated += allocate;
        m++; if (m > 12) { m = 1; y++; }
      }
      if (remaining > 0) {
        // Only reachable if the safety cap above was hit — an enormous
        // payment (likely a typo). Rather than silently drop it, this keeps
        // it visible and flagged for a human to actually look at.
        const row = await pool.query(
          `INSERT INTO payments (tenant_id, house_id, amount, amount_allocated, payment_date, method, receipt_no, notes, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'review') RETURNING *`,
          [tenant_id, houseId, remaining, remaining, payment_date, payment_method || 'cash', reference_number || null, (notes ? notes + ' — ' : '') + 'Unusually large payment, please verify and assign months manually.']
        );
        insertedRows.push(row.rows[0]);
      }
    } else {
      const row = await pool.query(
        `INSERT INTO payments (tenant_id, house_id, amount, payment_date, method, receipt_no, notes, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'matched') RETURNING *`,
        [tenant_id, houseId, amount, payment_date, payment_method || 'cash', reference_number || null, notes || null]
      );
      insertedRows.push(row.rows[0]);
    }

    const balanceRes = await pool.query(`
      UPDATE tenants SET balance = GREATEST(0,
        GREATEST(1,
          (EXTRACT(YEAR  FROM NOW()) - EXTRACT(YEAR  FROM move_in_date)) * 12 +
          (EXTRACT(MONTH FROM NOW()) - EXTRACT(MONTH FROM move_in_date)) + 1
        ) * (SELECT rent_amount FROM houses WHERE id = tenants.house_id) -
        COALESCE((
          SELECT SUM(amount) FROM payments
          WHERE tenant_id = $1 AND method != 'balance_charge'
        ), 0)
      ) WHERE id = $1 RETURNING balance
    `, [tenant_id]);
    const balanceAfter = parseFloat(balanceRes.rows[0]?.balance ?? 0);

    // Was never logged at all — a recorded payment left no trace in the
    // audit trail, even though it changes a tenant's balance materially.
    await logAudit({
      user: req.user,
      action: 'payment.record',
      entityType: 'payment',
      entityId: insertedRows[0]?.id,
      changes: {
        amount: { to: parseFloat(amount) },
        method: { to: payment_method || 'cash' },
        tenant: { to: tenant.full_name },
        unit: { to: tenant.unit_number || null },
        balance: { from: balanceBefore, to: balanceAfter },
      },
    });

    const parts = [];
    if (rentAllocated > 0) parts.push(`KES ${rentAllocated.toLocaleString()} to rent`);
    if (depositCollected > 0) parts.push(`KES ${depositCollected.toLocaleString()} to deposit`);
    if (advanceAllocated > 0) parts.push(`KES ${advanceAllocated.toLocaleString()} as advance rent`);
    const breakdown = parts.length > 1 ? `Applied: ${parts.join(', ')}.` : undefined;

    res.status(201).json({ success: true, data: insertedRows, message: breakdown });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/payments/:id/allocate — manually assign a payment to a month,
// for cases the automatic allocation (POST /) couldn't figure out on its
// own (e.g. a payment recorded before the tenant had a rent_amount/
// move_in_date set). Matched payments only.
router.patch('/:id/allocate', staffAuth, requirePermission('payments.record_manual'), async (req, res) => {
  const { for_year, for_month } = req.body;
  if (!for_year || !for_month) return res.status(400).json({ error: 'for_year and for_month are required.' });

  try {
    const existing = await pool.query(
      `SELECT p.*, h.plot_id, t.full_name AS tenant_name FROM payments p
       LEFT JOIN houses h ON p.house_id = h.id
       LEFT JOIN tenants t ON p.tenant_id = t.id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });

    // Only a payment that actually succeeded can be allocated to a month —
    // never failed/pending/unmatched rows, since no real money changed hands.
    if (existing.rows[0].status !== 'matched') {
      return res.status(400).json({ error: 'Only a matched payment can be allocated to a month.' });
    }

    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      const visible = await getVisiblePlotIds(req.user);
      const plotId = existing.rows[0].plot_id;
      const allowed = visible === 'ALL' || (plotId != null && visible.includes(plotId));
      if (!allowed) return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(
      `UPDATE payments SET for_year = $1, for_month = $2,
       amount_allocated = COALESCE(amount_allocated, amount)
       WHERE id = $3 RETURNING *`,
      [for_year, for_month, req.params.id]
    );

    await logAudit({
      user: req.user, action: 'payment.allocate', entityType: 'payment', entityId: req.params.id,
      changes: { for_year: { from: existing.rows[0].for_year, to: for_year }, for_month: { from: existing.rows[0].for_month, to: for_month } },
    });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE payment — no profile in the matrix has payments.delete, so this
// stays effectively admin-only, same as before, but now driven by the matrix
router.delete('/:id', staffAuth, requirePermission('payments.delete'), async (req, res) => {
  try {
    const payment = await pool.query(
      `SELECT p.*, h.plot_id, t.full_name AS tenant_name, t.balance AS balance_before
       FROM payments p
       LEFT JOIN houses h ON p.house_id = h.id
       LEFT JOIN tenants t ON p.tenant_id = t.id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (payment.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });

    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      const visible = await getVisiblePlotIds(req.user);
      const plotId = payment.rows[0].plot_id;
      const allowed = visible === 'ALL' || (plotId != null && visible.includes(plotId));
      if (!allowed) return res.status(403).json({ error: 'Access denied' });
    }

    const { tenant_id, amount, tenant_name, balance_before } = payment.rows[0];

    await pool.query('DELETE FROM payments WHERE id = $1', [req.params.id]);

    let balanceAfter = balance_before;
    if (tenant_id) {
      const balanceRes = await pool.query(`
        UPDATE tenants SET balance = GREATEST(0,
          GREATEST(1,
            (EXTRACT(YEAR  FROM NOW()) - EXTRACT(YEAR  FROM move_in_date)) * 12 +
            (EXTRACT(MONTH FROM NOW()) - EXTRACT(MONTH FROM move_in_date)) + 1
          ) * (SELECT rent_amount FROM houses WHERE id = tenants.house_id) -
          COALESCE((
            SELECT SUM(amount) FROM payments
            WHERE tenant_id = $1 AND method != 'balance_charge'
          ), 0)
        ) WHERE id = $1 RETURNING balance
      `, [tenant_id]);
      balanceAfter = balanceRes.rows[0]?.balance;
    }

    // Deleting a payment is exactly the kind of action an audit trail exists
    // for — previously this left zero trace.
    await logAudit({
      user: req.user,
      action: 'payment.delete',
      entityType: 'payment',
      entityId: req.params.id,
      changes: {
        amount: { from: parseFloat(amount) },
        tenant: { from: tenant_name },
        balance: { from: parseFloat(balance_before || 0), to: parseFloat(balanceAfter || 0) },
      },
    });

    res.json({ success: true, message: 'Payment deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

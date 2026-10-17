const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const { logAudit, diff } = require('../utils/audit');
const { getVisiblePlotIds } = require('../middleware/scope');
const { authMiddleware: staffAuth } = require('../middleware/auth');
const { requirePermission, getPermissions, filterRowsByPermission } = require('../middleware/permissions');

// Strips national_id / emergency_phone / lease_url from tenant rows unless
// the requester's profile has tenants.view_sensitive. Server-side, so the
// data never reaches the browser at all when the toggle is off — not just
// hidden by the frontend, which could be bypassed by reading the network
// response directly.
async function stripSensitiveFields(req, rows) {
  const { permissions } = await getPermissions(req.user);
  const canSee = permissions.includes('*') || permissions.includes('tenants.view_sensitive');
  if (canSee) return rows;
  return rows.map(({ national_id, emergency_phone, lease_url, ...rest }) => rest);
}

// GET all tenants — balance calculated dynamically from move-in date
// Was gated by requirePermission('tenants.view') as middleware, which ran
// BEFORE the per-row filter below and only ever checked the requester's
// ROLE default — so a role with no tenants.view by default got a flat 403
// here no matter what per-property override was granted. Removed; the
// filterRowsByPermission call below is now the only permission gate on this
// list. Someone with no access to anything now gets an empty list (200)
// instead of a 403.
router.get('/', staffAuth, async (req, res) => {
  try {
    const visible = await getVisiblePlotIds(req.user);
    const filter = visible === 'ALL' ? '' : (visible.length === 0 ? 'WHERE 1=0' : 'WHERE p.id = ANY($1)');
    const params = visible === 'ALL' || visible.length === 0 ? [] : [visible];

    const result = await pool.query(`
      SELECT
        t.id,
        t.user_id,
        t.house_id,
        t.full_name,
        t.national_id,
        t.phone,
        t.email,
        t.emergency_phone,
        t.move_in_date,
        t.rent_due_day,
        t.deposit_paid,
        t.photo_url,
        t.lease_url,
        t.is_active,
        t.created_at,
        h.unit_number,
        h.rent_amount,
        -- Required deposit for the unit, so the frontend can tell an
        -- underpaid deposit (t.deposit_paid < h.deposit) apart from rent
        -- arrears (t.balance) — these are two separate things that were
        -- both previously folded into a single misleading "Paid Up" badge.
        h.deposit AS required_deposit,
        h.plot_id,
        p.name AS plot_name,
        u.name AS owner_name,

        -- Most recent payment on file for this tenant (any method except an
        -- auto-charge), for the caretaker's "Last Payment" column.
        (SELECT py.amount FROM payments py
         WHERE py.tenant_id = t.id AND py.method != 'balance_charge'
         ORDER BY py.payment_date DESC LIMIT 1) AS last_payment_amount,
        (SELECT py.payment_date FROM payments py
         WHERE py.tenant_id = t.id AND py.method != 'balance_charge'
         ORDER BY py.payment_date DESC LIMIT 1) AS last_payment_date,
        (SELECT py.method FROM payments py
         WHERE py.tenant_id = t.id AND py.method != 'balance_charge'
         ORDER BY py.payment_date DESC LIMIT 1) AS last_payment_method,

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

    // getVisiblePlotIds (above) answers "can this user see this property at
    // all" — it doesn't know about a per-property tenants.view grant or
    // revoke. This is now the ONLY permission check on this list: it
    // narrows the rows down to ones this user actually has tenants.view
    // for, property by property.
    const visibleRows = await filterRowsByPermission(req.user, result.rows, 'tenants.view', (row) => row.plot_id);
    const data = await stripSensitiveFields(req, visibleRows);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET unpaid months — must be BEFORE /:id to avoid route conflict
// Was gated by requirePermission('tenants.view') as middleware, same problem
// as the main list above. Unlike the main list, this route never had a
// filterRowsByPermission step of its own — it only checked getVisiblePlotIds
// (property visibility), not a per-property tenants.view grant/revoke.
// Removing the old middleware gate without adding that here would have left
// a real hole: a role with no tenants.view by default, but visibility into
// a property, would see unpaid-months data for tenants they have no
// permission to view. h.plot_id is now selected and filterRowsByPermission
// is applied for parity with GET /.
router.get('/unpaid-months', staffAuth, async (req, res) => {
  try {
    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && visible.length === 0) return res.json({ success: true, data: [] });

    // Step 1: fetch all active tenants with their rent_amount from houses
    const tenantQuery = visible === 'ALL'
      ? `SELECT t.id, t.full_name, t.move_in_date, t.phone,
                h.rent_amount, h.unit_number, h.plot_id, p.name AS plot_name
         FROM tenants t
         LEFT JOIN houses h ON t.house_id = h.id
         LEFT JOIN plots  p ON h.plot_id  = p.id
         WHERE t.is_active = true AND t.move_in_date IS NOT NULL`
      : `SELECT t.id, t.full_name, t.move_in_date, t.phone,
                h.rent_amount, h.unit_number, h.plot_id, p.name AS plot_name
         FROM tenants t
         LEFT JOIN houses h ON t.house_id = h.id
         LEFT JOIN plots  p ON h.plot_id  = p.id
         WHERE t.is_active = true AND t.move_in_date IS NOT NULL
           AND p.id = ANY($1)`;
    const tenantParams = visible === 'ALL' ? [] : [visible];
    const tenantsResult = await pool.query(tenantQuery, tenantParams);

    const tenants = { rows: await filterRowsByPermission(req.user, tenantsResult.rows, 'tenants.view', (row) => row.plot_id) };

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
// Was gated by requirePermission('tenants.view') as middleware — that runs
// BEFORE this tenant's property is known, so it could only ever check the
// requester's ROLE default, never a per-property override for this specific
// plot. Moved the permission check down to right after the tenant (and
// their plot) is loaded, so an admin-granted "tenants.view for Plot X"
// override actually takes effect here.
router.get('/:id', staffAuth, async (req, res) => {
  try {
    const tenant = await pool.query(
      `SELECT
         t.id, t.user_id, t.house_id, t.full_name, t.national_id, t.phone,
         t.email, t.emergency_phone, t.move_in_date, t.rent_due_day,
         t.deposit_paid, t.photo_url, t.lease_url, t.is_active, t.created_at,
         p.id AS plot_id_actual, p.user_id AS plot_owner
       FROM tenants t
       LEFT JOIN houses h ON t.house_id = h.id
       LEFT JOIN plots  p ON h.plot_id  = p.id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (tenant.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });

    const plotId = tenant.rows[0].plot_id_actual;
    const { permissions } = await getPermissions(req.user, plotId);
    if (!permissions.includes('*') && !permissions.includes('tenants.view')) {
      return res.status(403).json({ error: 'Missing permission: tenants.view' });
    }

    const visible = await getVisiblePlotIds(req.user);
    const allowed = visible === 'ALL' || visible.includes(plotId);
    if (!allowed) return res.status(403).json({ error: 'Access denied' });

    const payments = await pool.query(
      'SELECT * FROM payments WHERE tenant_id=$1 ORDER BY payment_date DESC',
      [req.params.id]
    );
    const [tenantData] = await stripSensitiveFields(req, [tenant.rows[0]]);
    res.json({ success: true, data: { ...tenantData, payments: payments.rows } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST add new tenant
// Was gated by requirePermission('tenants.create') as middleware, checked
// before the target property (house_id's plot) was known — so a per-property
// grant of tenants.create could never apply. Also: the old scope check below
// ran BEFORE the try block, so a database error in that one query (unlikely,
// but possible) would have crashed the request instead of returning a clean
// 500 — moved inside try/catch along with everything else.
router.post('/', staffAuth, async (req, res) => {
  const { full_name, phone, email, national_id, house_id, move_in_date, rent_due_day, deposit_paid, emergency_phone } = req.body;
  if (!full_name || !house_id || !national_id || !phone) {
    return res.status(400).json({ error: 'full_name, house_id, national_id and phone are all required.' });
  }

  try {
    const houseCheck = await pool.query('SELECT plot_id FROM houses WHERE id = $1', [house_id]);
    const housePlotId = houseCheck.rows[0]?.plot_id;

    const { permissions } = await getPermissions(req.user, housePlotId);
    if (!permissions.includes('*') && !permissions.includes('tenants.create')) {
      return res.status(403).json({ error: 'Missing permission: tenants.create' });
    }

    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      const visible = await getVisiblePlotIds(req.user);
      const allowed = visible === 'ALL' || (housePlotId && visible.includes(housePlotId));
      if (!allowed) {
        return res.status(403).json({ error: 'You do not have access to this unit.' });
      }
    }

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
// Was gated by requirePermission('tenants.edit') as middleware, before the
// tenant's property was known — same problem as GET /:id above. Permission
// check moved down to right after the previous row (and its plot) is loaded.
router.put('/:id', staffAuth, async (req, res) => {
  const { full_name, phone, email, national_id, house_id, move_in_date, rent_due_day, deposit_paid, emergency_phone, is_active } = req.body;
  if (!full_name || !house_id || !national_id || !phone) {
    return res.status(400).json({ error: 'full_name, house_id, national_id and phone are all required.' });
  }
  try {
    // Get the tenant's previous state before updating (used for house sync + audit diff)
    const prev = await pool.query(
      `SELECT t.full_name, t.phone, t.house_id, t.move_in_date, t.rent_due_day, t.is_active, p.id AS plot_id_actual
       FROM tenants t LEFT JOIN houses h ON t.house_id = h.id LEFT JOIN plots p ON h.plot_id = p.id
       WHERE t.id=$1`,
      [req.params.id]
    );
    if (prev.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });

    const plotId = prev.rows[0].plot_id_actual;
    const { permissions } = await getPermissions(req.user, plotId);
    if (!permissions.includes('*') && !permissions.includes('tenants.edit')) {
      return res.status(403).json({ error: 'Missing permission: tenants.edit' });
    }

    const visible = await getVisiblePlotIds(req.user);
    const allowed = visible === 'ALL' || (plotId != null && visible.includes(plotId));
    if (!allowed) return res.status(403).json({ error: 'Access denied' });

    const oldHouseId  = prev.rows[0].house_id;

    // POST (create) already checks that a new tenant's house_id is on a plot
    // the caller can see — this PUT never did the same check for a CHANGED
    // house_id. A landlord scoped to Plot A could edit one of their own
    // tenants (passes the check above) and move them onto a house that
    // belongs to a totally different landlord's Plot B, just by sending that
    // house_id. That doesn't just misfile one tenant record — the code below
    // also flips the target house's status to "occupied" and can flip the
    // old house back to "vacant", so it corrupts another landlord's
    // occupancy data too. Blocked unless the new house is actually visible
    // to this caller (admins can still move a tenant anywhere).
    const newHouseIdNum = house_id ? parseInt(house_id) : null;
    if (visible !== 'ALL' && newHouseIdNum && newHouseIdNum !== oldHouseId) {
      const newHouseCheck = await pool.query('SELECT plot_id FROM houses WHERE id = $1', [newHouseIdNum]);
      const newHousePlotId = newHouseCheck.rows[0]?.plot_id;
      if (newHousePlotId == null || !visible.includes(newHousePlotId)) {
        return res.status(403).json({ error: 'You do not have access to that unit.' });
      }
    }

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
// Was gated by requirePermission('tenants.deactivate') as middleware, before
// the tenant's property was known — same problem as GET/PUT /:id above.
// Permission check moved down to right after the tenant (and plot) is loaded.
router.delete('/:id', staffAuth, async (req, res) => {
  try {
    const tenant = await pool.query(
      `SELECT t.house_id, p.id AS plot_id_actual
       FROM tenants t LEFT JOIN houses h ON t.house_id = h.id LEFT JOIN plots p ON h.plot_id = p.id
       WHERE t.id=$1`,
      [req.params.id]
    );
    if (tenant.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });

    const plotId = tenant.rows[0].plot_id_actual;
    const { permissions } = await getPermissions(req.user, plotId);
    if (!permissions.includes('*') && !permissions.includes('tenants.deactivate')) {
      return res.status(403).json({ error: 'Missing permission: tenants.deactivate' });
    }

    const visible = await getVisiblePlotIds(req.user);
    const allowed = visible === 'ALL' || (plotId != null && visible.includes(plotId));
    if (!allowed) return res.status(403).json({ error: 'Access denied' });

    await pool.query('UPDATE tenants SET is_active=false WHERE id=$1', [req.params.id]);
    await logAudit({ user: req.user, action: 'tenant.deactivate', entityType: 'tenant', entityId: req.params.id, changes: { is_active: { from: true, to: false } } });
    if (tenant.rows[0].house_id) {
      await pool.query("UPDATE houses SET status='vacant', status_changed_at=NOW() WHERE id=$1 AND status != 'vacant'", [tenant.rows[0].house_id]);
    }
    res.json({ success: true, message: 'Tenant deactivated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

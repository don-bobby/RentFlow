const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const { logAudit } = require('../utils/audit');
const { authMiddleware: auth } = require('../middleware/auth');
const { getVisiblePlotIds }    = require('../middleware/scope');

// Previously this file used its own `auth()` helper (valid-JWT check only,
// no role or ownership check) plus a hardcoded `p.user_id = $1` filter that
// only ever matched a literal landlord — agents/caretakers silently saw an
// empty list instead of their actual scope. Worse, POST had no ownership
// check at all: any landlord could record a deposit refund/forfeiture
// against ANY other landlord's tenant, just by passing a house_id/tenant_id
// that wasn't theirs — a live IDOR on a financial-record-creating route.
// Switched to the shared authMiddleware + getVisiblePlotIds, same pattern
// used throughout payments.js/tenants.js/etc.

function adminOrLandlord(req, res, next) {
  if (!['admin', 'landlord'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
  next();
}

// GET /api/deposits — full ledger, scoped like payments/tenants
router.get('/', auth, async (req, res) => {
  try {
    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && visible.length === 0) {
      return res.json({ success: true, data: [] });
    }
    const scopeFilter = visible === 'ALL' ? '' : 'WHERE p.id = ANY($1)';
    const params = visible === 'ALL' ? [] : [visible];
    const result = await pool.query(
      `SELECT d.*, t.full_name AS tenant_name, h.unit_number, p.name AS plot_name
       FROM deposit_transactions d
       LEFT JOIN tenants t ON d.tenant_id = t.id
       LEFT JOIN houses  h ON d.house_id  = h.id
       LEFT JOIN plots   p ON h.plot_id   = p.id
       ${scopeFilter}
       ORDER BY d.created_at DESC`,
      params
    );
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
    // Resolve whichever of house_id/tenant_id was given down to a plot id,
    // and check it's actually in this user's scope before inserting —
    // admins skip this (they can touch anything).
    if (req.user.role !== 'admin') {
      let resolvedHouseId = house_id || null;
      if (!resolvedHouseId && tenant_id) {
        const t = await pool.query('SELECT house_id FROM tenants WHERE id = $1', [tenant_id]);
        resolvedHouseId = t.rows[0]?.house_id || null;
      }
      if (resolvedHouseId) {
        const h = await pool.query('SELECT plot_id FROM houses WHERE id = $1', [resolvedHouseId]);
        const plotId = h.rows[0]?.plot_id;
        const visible = await getVisiblePlotIds(req.user);
        if (!plotId || (visible !== 'ALL' && !visible.includes(plotId))) {
          return res.status(403).json({ error: 'You do not have access to this property.' });
        }
      }
      // No house_id and no resolvable tenant_id: nothing to scope against —
      // falls through and gets recorded unscoped, same as before. (Both
      // fields are optional in the schema; this is an existing allowance,
      // not something this fix changes.)
    }

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

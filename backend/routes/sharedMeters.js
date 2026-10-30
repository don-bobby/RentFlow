// Shared meters: one meter, many units (e.g. a building's single water meter).
//   GET    /api/shared-meters?plot_id=            meters of a property (units + weights)
//   POST   /api/shared-meters                     create (meters.rates)
//   PUT    /api/shared-meters/:id                 edit number/account/active/units (meters.rates)
//   GET    /api/shared-meters/:id/summary         bills, progress, who has / hasn't contributed
//   POST   /api/shared-meters/:id/bills           enter a monthly bill (meters.record)
//   PUT    /api/shared-meters/bills/:id           change amount / due date / note, optionally re-split
//   DELETE /api/shared-meters/bills/:id
//   POST   /api/shared-meters/bills/:id/provider-paid   mark the utility company as settled
// Pass-through money: never an expense or income, never touches rent.
const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const { authMiddleware: auth } = require('../middleware/auth');
const { getVisiblePlotIds } = require('../middleware/scope');
const { getPermissions } = require('../middleware/permissions');
const { logAudit } = require('../utils/audit');
const { splitBill, computeMeter, round2 } = require('../utils/sharedMeters');

const TYPES = ['Water', 'Electricity'];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const isAdmin = (u) => ['admin', 'super_admin'].includes(u.role);
const pid = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };

async function guard(req, res, plotId, perm) {
  if (!plotId) { res.status(400).json({ error: 'Choose a property.' }); return false; }
  if (!isAdmin(req.user)) {
    const visible = await getVisiblePlotIds(req.user);
    if (!(visible === 'ALL' || visible.includes(plotId))) { res.status(403).json({ error: 'Access denied' }); return false; }
  }
  const { permissions } = await getPermissions(req.user, plotId);
  if (!permissions.includes('*') && !permissions.includes(perm)) { res.status(403).json({ error: `Missing permission: ${perm}` }); return false; }
  return true;
}
const meterOf = async (db, id) => (id ? (await db.query('SELECT * FROM shared_meters WHERE id = $1', [id])).rows[0] : null);

// Validate units for a meter: must be in the plot and not already on another active meter of the same utility.
async function checkUnits(db, plotId, type, units, meterId) {
  if (!Array.isArray(units) || !units.length) return 'Choose at least one unit on this meter.';
  const seen = new Set();
  for (const u of units) {
    const hid = pid(u.house_id), w = Number(u.weight);
    if (!hid || seen.has(hid)) return 'Each unit can only be listed once.';
    seen.add(hid);
    if (!Number.isFinite(w) || w <= 0 || w > 1000) return 'Each weight must be a number above 0 (1 = a normal unit, 2 = uses twice as much).';
  }
  const ids = [...seen];
  const ok = (await db.query('SELECT id FROM houses WHERE id = ANY($1) AND plot_id = $2', [ids, plotId])).rows.length;
  if (ok !== ids.length) return 'One of the units is not in this property.';
  const clash = (await db.query(
    `SELECT h.unit_number FROM shared_meter_units smu JOIN shared_meters m ON m.id = smu.meter_id JOIN houses h ON h.id = smu.house_id
     WHERE smu.house_id = ANY($1) AND m.utility_type = $2 AND m.active = true AND m.id <> COALESCE($3, 0) LIMIT 1`, [ids, type, meterId || null])).rows[0];
  if (clash) return `Unit ${clash.unit_number} is already on another shared ${type.toLowerCase()} meter.`;
  return null;
}

async function occupiedUnits(db, meterId) {
  return (await db.query(
    `SELECT smu.house_id, smu.weight, t.id AS tenant_id FROM shared_meter_units smu
     JOIN tenants t ON t.house_id = smu.house_id AND t.is_active = true
     WHERE smu.meter_id = $1`, [meterId])).rows
    .filter((r, i, a) => a.findIndex(x => x.house_id === r.house_id) === i);
}

async function writeShares(db, billId, meterId, amount) {
  const occ = await occupiedUnits(db, meterId);
  if (!occ.length) return false;
  const shares = splitBill(amount, occ);
  await db.query('DELETE FROM shared_bill_shares WHERE bill_id = $1', [billId]);
  for (const s of shares) {
    await db.query('INSERT INTO shared_bill_shares (bill_id, house_id, tenant_id, weight, share) VALUES ($1,$2,$3,$4,$5)', [billId, s.house_id, s.tenant_id, s.weight, s.share]);
  }
  return true;
}

router.get('/', auth, async (req, res) => {
  try {
    const plotId = pid(req.query.plot_id);
    if (!(await guard(req, res, plotId, 'meters.view'))) return;
    const { permissions } = await getPermissions(req.user, plotId);
    const meters = (await pool.query('SELECT * FROM shared_meters WHERE plot_id = $1 AND active = true ORDER BY utility_type, meter_number', [plotId])).rows;
    const units = meters.length ? (await pool.query(
      `SELECT smu.meter_id, smu.house_id, smu.weight, h.unit_number FROM shared_meter_units smu JOIN houses h ON h.id = smu.house_id WHERE smu.meter_id = ANY($1) ORDER BY h.unit_number`,
      [meters.map(m => m.id)])).rows : [];
    res.json({
      success: true,
      can_record: permissions.includes('*') || permissions.includes('meters.record'),
      can_manage: permissions.includes('*') || permissions.includes('meters.rates'),
      data: meters.map(m => ({ ...m, units: units.filter(u => u.meter_id === m.id).map(u => ({ house_id: u.house_id, unit_number: u.unit_number, weight: parseFloat(u.weight) })) })),
    });
  } catch (err) {
    if (err.code === '42P01') return res.json({ success: true, data: [], can_record: false, can_manage: false, migration_needed: true });
    console.error(err); res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  const b = req.body || {}; const plotId = pid(b.plot_id);
  const client = await pool.connect();
  try {
    if (!(await guard(req, res, plotId, 'meters.rates'))) return;
    if (!TYPES.includes(b.utility_type)) return res.status(400).json({ error: 'Choose Water or Electricity.' });
    const num = String(b.meter_number || '').trim().slice(0, 60);
    if (!num) return res.status(400).json({ error: 'Enter the meter number.' });
    if (!MONTH.test(b.start_month || '')) return res.status(400).json({ error: 'Choose the month this meter starts (receipts from that month count).' });
    const bad = await checkUnits(client, plotId, b.utility_type, b.units, null);
    if (bad) return res.status(400).json({ error: bad });
    await client.query('BEGIN');
    const m = (await client.query(
      `INSERT INTO shared_meters (plot_id, utility_type, meter_number, account_number, start_month) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [plotId, b.utility_type, num, String(b.account_number || '').trim().slice(0, 60) || null, b.start_month])).rows[0];
    for (const u of b.units) await client.query('INSERT INTO shared_meter_units (meter_id, house_id, weight) VALUES ($1,$2,$3)', [m.id, pid(u.house_id), Number(u.weight)]);
    await client.query('COMMIT');
    await logAudit({ user: req.user, action: 'shared_meter.created', entityType: 'plot', entityId: plotId, changes: { meter: { to: `${b.utility_type} ${num} (${b.units.length} units)` } } });
    res.json({ success: true, data: m });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err); if (!res.headersSent) res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

router.put('/:id', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const m = await meterOf(client, pid(req.params.id));
    if (!m) return res.status(404).json({ error: 'Meter not found.' });
    if (!(await guard(req, res, m.plot_id, 'meters.rates'))) return;
    const b = req.body || {};
    if (Array.isArray(b.units)) {
      const bad = await checkUnits(client, m.plot_id, m.utility_type, b.units, m.id);
      if (bad) return res.status(400).json({ error: bad });
    }
    await client.query('BEGIN');
    await client.query(
      `UPDATE shared_meters SET meter_number = COALESCE($1, meter_number), account_number = $2, active = COALESCE($3, active), start_month = COALESCE($4, start_month) WHERE id = $5`,
      [String(b.meter_number || '').trim().slice(0, 60) || null, b.account_number != null ? String(b.account_number).trim().slice(0, 60) || null : m.account_number,
       typeof b.active === 'boolean' ? b.active : null, MONTH.test(b.start_month || '') ? b.start_month : null, m.id]);
    if (Array.isArray(b.units)) {
      await client.query('DELETE FROM shared_meter_units WHERE meter_id = $1', [m.id]);
      for (const u of b.units) await client.query('INSERT INTO shared_meter_units (meter_id, house_id, weight) VALUES ($1,$2,$3)', [m.id, pid(u.house_id), Number(u.weight)]);
    }
    await client.query('COMMIT');
    await logAudit({ user: req.user, action: 'shared_meter.updated', entityType: 'plot', entityId: m.plot_id, changes: { meter: { to: `${m.utility_type} ${m.meter_number}` } } });
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err); if (!res.headersSent) res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

router.get('/:id/summary', auth, async (req, res) => {
  try {
    const m = await meterOf(pool, pid(req.params.id));
    if (!m) return res.status(404).json({ error: 'Meter not found.' });
    if (!(await guard(req, res, m.plot_id, 'meters.view'))) return;
    res.json({ success: true, ...(await computeMeter(pool, m.id)) });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// { billing_month, amount, due_date?, reference?, notes? }
router.post('/:id/bills', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const m = await meterOf(client, pid(req.params.id));
    if (!m) return res.status(404).json({ error: 'Meter not found.' });
    if (!(await guard(req, res, m.plot_id, 'meters.record'))) return;
    const b = req.body || {}; const amount = round2(Number(b.amount));
    if (!MONTH.test(b.billing_month || '')) return res.status(400).json({ error: 'Choose the billing month.' });
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e8) return res.status(400).json({ error: 'Enter the bill amount (above 0).' });
    if (b.billing_month < m.start_month) return res.status(400).json({ error: `This meter starts in ${m.start_month}.` });
    if (b.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.due_date)) return res.status(400).json({ error: 'Due date is not valid.' });
    await client.query('BEGIN');
    const dup = (await client.query('SELECT 1 FROM shared_bills WHERE meter_id = $1 AND billing_month = $2', [m.id, b.billing_month])).rows[0];
    if (dup) { await client.query('ROLLBACK'); return res.status(400).json({ error: `A bill for ${b.billing_month} already exists. Edit it instead.` }); }
    const bill = (await client.query(
      `INSERT INTO shared_bills (meter_id, billing_month, amount, due_date, reference, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [m.id, b.billing_month, amount, b.due_date || null, String(b.reference || '').slice(0, 100) || null, String(b.notes || '').slice(0, 500) || null, req.user.id])).rows[0];
    if (!(await writeShares(client, bill.id, m.id, amount))) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'No occupied units on this meter, so there is nobody to split the bill between.' }); }
    await client.query('COMMIT');
    await logAudit({ user: req.user, action: 'shared_bill.created', entityType: 'plot', entityId: m.plot_id, changes: { bill: { to: `${m.utility_type} ${b.billing_month} KES ${amount}` } } });
    res.json({ success: true, id: bill.id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err); if (!res.headersSent) res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

async function billAndMeter(db, id) {
  const bill = id ? (await db.query('SELECT * FROM shared_bills WHERE id = $1', [id])).rows[0] : null;
  return bill ? { bill, meter: await meterOf(db, bill.meter_id) } : {};
}

// { amount?, due_date?, reference?, notes?, resplit? }  amount change re-splits the same units;
// resplit:true re-reads who is occupied now (use after a move-in / move-out).
router.put('/bills/:id', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { bill, meter } = await billAndMeter(client, pid(req.params.id));
    if (!bill) return res.status(404).json({ error: 'Bill not found.' });
    if (!(await guard(req, res, meter.plot_id, 'meters.record'))) return;
    const b = req.body || {};
    const amount = b.amount != null ? round2(Number(b.amount)) : parseFloat(bill.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e8) return res.status(400).json({ error: 'Enter a valid amount.' });
    if (b.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.due_date)) return res.status(400).json({ error: 'Due date is not valid.' });
    await client.query('BEGIN');
    await client.query('UPDATE shared_bills SET amount = $1, due_date = $2, reference = $3, notes = $4 WHERE id = $5',
      [amount, b.due_date !== undefined ? (b.due_date || null) : bill.due_date, b.reference !== undefined ? String(b.reference || '').slice(0, 100) || null : bill.reference,
       b.notes !== undefined ? String(b.notes || '').slice(0, 500) || null : bill.notes, bill.id]);
    if (b.resplit) {
      if (!(await writeShares(client, bill.id, meter.id, amount))) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'No occupied units on this meter.' }); }
    } else if (amount !== parseFloat(bill.amount)) {
      const cur = (await client.query('SELECT house_id, tenant_id, weight FROM shared_bill_shares WHERE bill_id = $1', [bill.id])).rows;
      const shares = splitBill(amount, cur);
      for (const s of shares) await client.query('UPDATE shared_bill_shares SET share = $1 WHERE bill_id = $2 AND house_id = $3', [s.share, bill.id, s.house_id]);
    }
    await client.query('COMMIT');
    await logAudit({ user: req.user, action: 'shared_bill.updated', entityType: 'plot', entityId: meter.plot_id, changes: { bill: { from: `${bill.billing_month} KES ${bill.amount}`, to: `KES ${amount}` } } });
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err); if (!res.headersSent) res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

router.delete('/bills/:id', auth, async (req, res) => {
  try {
    const { bill, meter } = await billAndMeter(pool, pid(req.params.id));
    if (!bill) return res.status(404).json({ error: 'Bill not found.' });
    if (!(await guard(req, res, meter.plot_id, 'meters.record'))) return;
    await pool.query('DELETE FROM shared_bills WHERE id = $1', [bill.id]);
    await logAudit({ user: req.user, action: 'shared_bill.deleted', entityType: 'plot', entityId: meter.plot_id, changes: { bill: { from: `${meter.utility_type} ${bill.billing_month} KES ${bill.amount}` } } });
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.post('/bills/:id/provider-paid', auth, async (req, res) => {
  try {
    const { bill, meter } = await billAndMeter(pool, pid(req.params.id));
    if (!bill) return res.status(404).json({ error: 'Bill not found.' });
    if (!(await guard(req, res, meter.plot_id, 'meters.record'))) return;
    const d = req.body?.date === null ? null : (/^\d{4}-\d{2}-\d{2}$/.test(req.body?.date || '') ? req.body.date : new Date().toISOString().slice(0, 10));
    await pool.query('UPDATE shared_bills SET provider_paid_on = $1 WHERE id = $2', [d, bill.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

module.exports = router;

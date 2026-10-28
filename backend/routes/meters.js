// Meter readings and utility bills.
//   GET    /api/meters/rates?plot_id=            rates for a property
//   PUT    /api/meters/rates                     set a rate (meters.rates)
//   GET    /api/meters/sheet?plot_id&type&month  the reading sheet: every unit with last reading + this month's
//   POST   /api/meters/readings                  save a whole sheet of readings (meters.record)
//   DELETE /api/meters/readings/:id              remove the latest, unpaid reading of a meter
//   GET    /api/meters/bills                     bills (filters: plot_id, month, status)
//   POST   /api/meters/bills/:id/pay             tenant paid this bill -> becomes a utility receipt
const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const { authMiddleware: auth } = require('../middleware/auth');
const { getVisiblePlotIds } = require('../middleware/scope');
const { getPermissions, filterRowsByPermission } = require('../middleware/permissions');
const { logAudit } = require('../utils/audit');

const TYPES = ['Water', 'Electricity'];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const isAdmin = (u) => ['admin', 'super_admin'].includes(u.role);

// Can this user see the plot AND hold this permission on it? Sends the error itself.
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
const pid = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };

router.get('/rates', auth, async (req, res) => {
  try {
    const plotId = pid(req.query.plot_id);
    if (!(await guard(req, res, plotId, 'meters.view'))) return;
    const r = await pool.query('SELECT utility_type, rate, standing_charge, unit_label FROM plot_utility_rates WHERE plot_id = $1', [plotId]);
    res.json({ success: true, data: r.rows.map(x => ({ ...x, rate: parseFloat(x.rate), standing_charge: parseFloat(x.standing_charge) })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/rates', auth, async (req, res) => {
  try {
    const plotId = pid(req.body.plot_id);
    if (!(await guard(req, res, plotId, 'meters.rates'))) return;
    const type = req.body.utility_type;
    if (!TYPES.includes(type)) return res.status(400).json({ error: 'Utility must be Water or Electricity.' });
    const rate = Number(req.body.rate), standing = Number(req.body.standing_charge || 0);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1e6) return res.status(400).json({ error: 'Rate per unit is not valid.' });
    if (!Number.isFinite(standing) || standing < 0 || standing > 1e7) return res.status(400).json({ error: 'Standing charge is not valid.' });
    const label = String(req.body.unit_label || (type === 'Water' ? 'm³' : 'kWh')).replace(/[<>\u0000-\u001f]/g, '').slice(0, 10);
    await pool.query(
      `INSERT INTO plot_utility_rates (plot_id, utility_type, rate, standing_charge, unit_label) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (plot_id, utility_type) DO UPDATE SET rate = EXCLUDED.rate, standing_charge = EXCLUDED.standing_charge, unit_label = EXCLUDED.unit_label, updated_at = NOW()`,
      [plotId, type, rate, standing, label]);
    await logAudit({ user: req.user, action: 'meter.rate_set', entityType: 'plot', entityId: plotId, changes: { [type]: { to: `${rate}/unit + ${standing}` } } });
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.get('/sheet', auth, async (req, res) => {
  try {
    const plotId = pid(req.query.plot_id), type = req.query.type, month = req.query.month;
    if (!TYPES.includes(type) || !MONTH.test(month || '')) return res.status(400).json({ error: 'Choose a utility and a month.' });
    if (!(await guard(req, res, plotId, 'meters.view'))) return;
    const [rows, rate, perms] = await Promise.all([
      pool.query(
        `SELECT h.id AS house_id, h.unit_number, t.id AS tenant_id, t.full_name AS tenant_name,
                prev.reading AS previous_reading, prev.billing_month AS previous_month,
                cur.id AS reading_id, cur.reading, cur.units, cur.amount, cur.status
         FROM houses h
         LEFT JOIN tenants t ON t.house_id = h.id AND t.is_active = true
         LEFT JOIN LATERAL (SELECT reading, billing_month FROM meter_readings m
                            WHERE m.house_id = h.id AND m.utility_type = $2 AND m.billing_month < $3
                            ORDER BY billing_month DESC LIMIT 1) prev ON true
         LEFT JOIN meter_readings cur ON cur.house_id = h.id AND cur.utility_type = $2 AND cur.billing_month = $3
         WHERE h.plot_id = $1
         ORDER BY h.unit_number`, [plotId, type, month]),
      pool.query('SELECT rate, standing_charge, unit_label FROM plot_utility_rates WHERE plot_id = $1 AND utility_type = $2', [plotId, type]),
      getPermissions(req.user, plotId),
    ]);
    const num = (v) => (v == null ? null : parseFloat(v));
    const p = perms.permissions;
    res.json({
      success: true,
      rate: rate.rows[0] ? { rate: num(rate.rows[0].rate), standing_charge: num(rate.rows[0].standing_charge), unit_label: rate.rows[0].unit_label } : null,
      can_record: p.includes('*') || p.includes('meters.record'),
      can_set_rates: p.includes('*') || p.includes('meters.rates'),
      data: rows.rows.map(r => ({ ...r, previous_reading: num(r.previous_reading), reading: num(r.reading), units: num(r.units), amount: num(r.amount) })),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// Body: { plot_id, utility_type, billing_month, reading_date, readings: [{ house_id, reading }] }
router.post('/readings', auth, async (req, res) => {
  const b = req.body || {};
  const plotId = pid(b.plot_id), type = b.utility_type, month = b.billing_month;
  if (!TYPES.includes(type) || !MONTH.test(month || '')) return res.status(400).json({ error: 'Choose a utility and a month.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.reading_date || '')) return res.status(400).json({ error: 'Give the date the meters were read.' });
  if (!Array.isArray(b.readings) || !b.readings.length) return res.status(400).json({ error: 'Enter at least one reading.' });
  if (b.readings.length > 400) return res.status(400).json({ error: 'Too many readings at once.' });
  const client = await pool.connect();
  try {
    if (!(await guard(req, res, plotId, 'meters.record'))) return;
    const rateRow = (await client.query('SELECT rate, standing_charge FROM plot_utility_rates WHERE plot_id = $1 AND utility_type = $2', [plotId, type])).rows[0];
    await client.query('BEGIN');
    const errors = [], saved = [];
    for (const item of b.readings) {
      const houseId = pid(item.house_id), val = Number(item.reading);
      if (!houseId || item.reading === '' || item.reading == null || !Number.isFinite(val) || val < 0 || val > 1e9) { errors.push({ house_id: item.house_id, error: 'Reading is not a valid number.' }); continue; }
      const h = (await client.query(
        `SELECT h.id, h.unit_number, t.id AS tenant_id FROM houses h LEFT JOIN tenants t ON t.house_id = h.id AND t.is_active = true WHERE h.id = $1 AND h.plot_id = $2 LIMIT 1`, [houseId, plotId])).rows[0];
      if (!h) { errors.push({ house_id: houseId, error: 'That unit is not in this property.' }); continue; }
      const later = await client.query('SELECT 1 FROM meter_readings WHERE house_id = $1 AND utility_type = $2 AND billing_month > $3 LIMIT 1', [houseId, type, month]);
      if (later.rows[0]) { errors.push({ house_id: houseId, unit: h.unit_number, error: 'A later month already has a reading for this unit.' }); continue; }
      const existing = (await client.query('SELECT id, status FROM meter_readings WHERE house_id = $1 AND utility_type = $2 AND billing_month = $3', [houseId, type, month])).rows[0];
      if (existing && existing.status === 'paid') { errors.push({ house_id: houseId, unit: h.unit_number, error: 'This month is already paid and cannot be changed.' }); continue; }
      const prev = (await client.query('SELECT reading FROM meter_readings WHERE house_id = $1 AND utility_type = $2 AND billing_month < $3 ORDER BY billing_month DESC LIMIT 1', [houseId, type, month])).rows[0];
      const prevVal = prev ? parseFloat(prev.reading) : null;
      if (prevVal != null && val < prevVal) { errors.push({ house_id: houseId, unit: h.unit_number, error: `Reading ${val} is lower than last month (${prevVal}).` }); continue; }
      let units = 0, amount = 0, status = 'opening', rate = null, standing = 0;
      if (prevVal != null) {
        if (!rateRow) { errors.push({ house_id: houseId, unit: h.unit_number, error: `Set the ${type} rate for this property first.` }); continue; }
        rate = parseFloat(rateRow.rate); standing = parseFloat(rateRow.standing_charge);
        units = round2(val - prevVal); amount = round2(units * rate + standing);
        status = h.tenant_id ? 'billed' : 'no_tenant';
      }
      const r = await client.query(
        `INSERT INTO meter_readings (house_id, plot_id, tenant_id, utility_type, billing_month, reading_date, previous_reading, reading, units, rate, standing_charge, amount, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (house_id, utility_type, billing_month) DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id, reading_date = EXCLUDED.reading_date, previous_reading = EXCLUDED.previous_reading, reading = EXCLUDED.reading,
           units = EXCLUDED.units, rate = EXCLUDED.rate, standing_charge = EXCLUDED.standing_charge, amount = EXCLUDED.amount, status = EXCLUDED.status, created_by = EXCLUDED.created_by
         RETURNING id, status, units, amount`,
        [houseId, plotId, h.tenant_id, type, month, b.reading_date, prevVal, val, units, rate, standing, amount, status, req.user.id]);
      saved.push({ house_id: houseId, unit: h.unit_number, ...r.rows[0], units: parseFloat(r.rows[0].units), amount: parseFloat(r.rows[0].amount) });
    }
    if (errors.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Some readings need fixing. Nothing was saved.', rows: errors }); }
    await client.query('COMMIT');
    await logAudit({ user: req.user, action: 'meter.readings_saved', entityType: 'plot', entityId: plotId, changes: { readings: { to: `${saved.length} ${type} readings for ${month}` } } });
    res.json({ success: true, saved, billed_total: round2(saved.reduce((a, s) => a + (s.status === 'billed' ? s.amount : 0), 0)) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Meter readings failed:', err); if (!res.headersSent) res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

router.delete('/readings/:id', auth, async (req, res) => {
  try {
    const id = pid(req.params.id);
    const row = id ? (await pool.query('SELECT * FROM meter_readings WHERE id = $1', [id])).rows[0] : null;
    if (!row) return res.status(404).json({ error: 'Reading not found.' });
    if (!(await guard(req, res, row.plot_id, 'meters.record'))) return;
    if (row.status === 'paid') return res.status(400).json({ error: 'This bill is already paid.' });
    const later = await pool.query('SELECT 1 FROM meter_readings WHERE house_id = $1 AND utility_type = $2 AND billing_month > $3 LIMIT 1', [row.house_id, row.utility_type, row.billing_month]);
    if (later.rows[0]) return res.status(400).json({ error: 'Only the latest reading of a meter can be removed.' });
    await pool.query('DELETE FROM meter_readings WHERE id = $1', [id]);
    await logAudit({ user: req.user, action: 'meter.reading_deleted', entityType: 'plot', entityId: row.plot_id, changes: { reading: { from: `${row.utility_type} ${row.billing_month} ${row.reading}` } } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/bills', auth, async (req, res) => {
  try {
    const visible = isAdmin(req.user) ? 'ALL' : await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && !visible.length) return res.json({ success: true, data: [] });
    const where = [`m.status <> 'opening'`], vals = [];
    if (visible !== 'ALL') { vals.push(visible); where.push(`m.plot_id = ANY($${vals.length})`); }
    const plotId = pid(req.query.plot_id); if (plotId) { vals.push(plotId); where.push(`m.plot_id = $${vals.length}`); }
    if (MONTH.test(req.query.month || '')) { vals.push(req.query.month); where.push(`m.billing_month = $${vals.length}`); }
    if (['billed', 'paid', 'no_tenant'].includes(req.query.status)) { vals.push(req.query.status); where.push(`m.status = $${vals.length}`); }
    if (TYPES.includes(req.query.type)) { vals.push(req.query.type); where.push(`m.utility_type = $${vals.length}`); }
    const r = await pool.query(
      `SELECT m.id, m.plot_id, m.house_id, m.tenant_id, m.utility_type, m.billing_month, m.previous_reading, m.reading, m.units, m.rate, m.standing_charge, m.amount, m.status,
              t.full_name AS tenant_name, t.phone AS tenant_phone, h.unit_number, p.name AS plot_name
       FROM meter_readings m
       LEFT JOIN tenants t ON t.id = m.tenant_id LEFT JOIN houses h ON h.id = m.house_id LEFT JOIN plots p ON p.id = m.plot_id
       WHERE ${where.join(' AND ')} ORDER BY m.billing_month DESC, p.name, h.unit_number LIMIT 1000`, vals);
    const rows = await filterRowsByPermission(req.user, r.rows, 'meters.view', (x) => x.plot_id);
    const num = (v) => (v == null ? null : parseFloat(v));
    res.json({ success: true, data: rows.map(x => ({ ...x, previous_reading: num(x.previous_reading), reading: num(x.reading), units: num(x.units), rate: num(x.rate), standing_charge: num(x.standing_charge), amount: num(x.amount) })) });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.post('/bills/:id/pay', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const id = pid(req.params.id);
    const bill = id ? (await client.query('SELECT * FROM meter_readings WHERE id = $1', [id])).rows[0] : null;
    if (!bill) return res.status(404).json({ error: 'Bill not found.' });
    if (!(await guard(req, res, bill.plot_id, 'payments.record_manual'))) return;
    if (bill.status !== 'billed' || !bill.tenant_id) return res.status(400).json({ error: bill.status === 'paid' ? 'This bill is already paid.' : 'There is no bill to pay.' });
    if (parseFloat(bill.amount) <= 0) return res.status(400).json({ error: 'This bill is zero, nothing to collect.' });
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.payment_date || '') ? req.body.payment_date : new Date().toISOString().slice(0, 10);
    const t = (await client.query('SELECT full_name FROM tenants WHERE id = $1', [bill.tenant_id])).rows[0];
    const note = `${bill.utility_type} ${bill.billing_month}: ${parseFloat(bill.units)} units${bill.rate != null ? ` × ${parseFloat(bill.rate)}` : ''}${parseFloat(bill.standing_charge) ? ` + ${parseFloat(bill.standing_charge)} standing` : ''}`;
    await client.query('BEGIN');
    const up = (await client.query(
      `INSERT INTO utility_payments (tenant_id, house_id, plot_id, utility_type, amount, payment_date, method, reference, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [bill.tenant_id, bill.house_id, bill.plot_id, bill.utility_type, bill.amount, date,
       String(req.body.method || '').slice(0, 30) || null, String(req.body.reference || '').slice(0, 100) || null, note, req.user.id])).rows[0];
    await client.query(`UPDATE meter_readings SET status = 'paid', utility_payment_id = $1 WHERE id = $2`, [up.id, id]);
    await client.query('COMMIT');
    await logAudit({ user: req.user, action: 'meter.bill_paid', entityType: 'utility_payment', entityId: up.id, changes: { tenant: { to: t?.full_name }, bill: { to: note } } });
    res.json({ success: true, utility_payment_id: up.id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err); if (!res.headersSent) res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

module.exports = router;

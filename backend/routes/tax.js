// KRA Monthly Rental Income (MRI) helper: works out the figures, never files anything.
//   GET  /api/tax/landlords                       landlords the user may see
//   GET  /api/tax/settings    PUT /api/tax/settings            rate, thresholds, due day (admin)
//   GET  /api/tax/mri?landlord_id&month           the month's figures + year to date + units' classification
//   GET  /api/tax/mri/pdf?landlord_id&month       the same as a one-page PDF
//   POST /api/tax/mri/status                      record filed / paid (with KRA reference)
//   PUT  /api/tax/landlords/:id/pin               KRA PIN (admin or the landlord)
//   PUT  /api/tax/plots/:id/use   PUT /api/tax/houses/:id/use    residential / commercial (admin)
const express = require('express');
const router  = express.Router();
const PDFDocument = require('pdfkit');
const pool    = require('../database/db');
const { authMiddleware: auth } = require('../middleware/auth');
const { getVisiblePlotIds } = require('../middleware/scope');
const { getPermissions } = require('../middleware/permissions');
const { logAudit } = require('../utils/audit');
const { round2, classify, nextMonth, dueDate, penalties } = require('../utils/mriTax');

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE  = /^\d{4}-\d{2}-\d{2}$/;
const isAdmin = (u) => ['admin', 'super_admin'].includes(u.role);
const pid = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const todayStr = () => new Date().toISOString().slice(0, 10);
const missingTable = (err) => err.code === '42P01' || err.code === '42703';
const fail = (res, err) => {
  if (missingTable(err)) return res.json({ success: true, migration_needed: true });
  console.error(err); res.status(500).json({ error: err.message });
};

async function getSettings(db = pool) { return (await db.query('SELECT * FROM tax_settings WHERE id = 1')).rows[0]; }

// Plots of this landlord that the user may see AND hold tax.view on.
async function allowedPlots(user, landlordId) {
  const plots = (await pool.query('SELECT id, name, rental_use FROM plots WHERE user_id = $1 ORDER BY name', [landlordId])).rows;
  if (isAdmin(user)) return plots;
  const visible = await getVisiblePlotIds(user);
  const out = [];
  for (const p of plots) {
    if (visible !== 'ALL' && !visible.includes(p.id)) continue;
    const { permissions } = await getPermissions(user, p.id);
    if (permissions.includes('*') || permissions.includes('tax.view')) out.push(p);
  }
  return out;
}

router.get('/landlords', auth, async (req, res) => {
  try {
    const rows = (await pool.query(`SELECT u.id, u.name, u.kra_pin, array_agg(p.id) AS plot_ids FROM users u JOIN plots p ON p.user_id = u.id GROUP BY u.id ORDER BY u.name`)).rows;
    const out = [];
    for (const l of rows) {
      const ok = isAdmin(req.user) ? l.plot_ids : (await allowedPlots(req.user, l.id)).map(p => p.id);
      if (ok.length) out.push({ id: l.id, name: l.name, kra_pin: l.kra_pin, plot_count: ok.length });
    }
    res.json({ success: true, data: out, is_admin: isAdmin(req.user) });
  } catch (err) { fail(res, err); }
});

router.get('/settings', auth, async (req, res) => {
  try { res.json({ success: true, data: await getSettings(), can_edit: isAdmin(req.user) }); } catch (err) { fail(res, err); }
});
router.put('/settings', auth, async (req, res) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Only an admin can change tax settings.' });
    const b = req.body || {}; const old = await getSettings();
    const num = (k, min, max) => { const v = Number(b[k] ?? old[k]); if (!Number.isFinite(v) || v < min || v > max) throw new Error(`Invalid value for ${k}.`); return v; };
    let v;
    try {
      v = { mri_rate: num('mri_rate', 0, 100), lower_threshold: num('lower_threshold', 0, 1e9), upper_threshold: num('upper_threshold', 0, 1e10), due_day: Math.round(num('due_day', 1, 28)),
            late_filing_min: num('late_filing_min', 0, 1e7), late_filing_pct: num('late_filing_pct', 0, 100), late_payment_pct: num('late_payment_pct', 0, 100), late_interest_pct: num('late_interest_pct', 0, 100) };
    } catch (e) { return res.status(400).json({ error: e.message }); }
    if (v.upper_threshold <= v.lower_threshold) return res.status(400).json({ error: 'The upper limit must be above the lower limit.' });
    await pool.query(`UPDATE tax_settings SET mri_rate=$1, lower_threshold=$2, upper_threshold=$3, due_day=$4, late_filing_min=$5, late_filing_pct=$6, late_payment_pct=$7, late_interest_pct=$8, updated_by=$9, updated_at=NOW() WHERE id = 1`,
      [v.mri_rate, v.lower_threshold, v.upper_threshold, v.due_day, v.late_filing_min, v.late_filing_pct, v.late_payment_pct, v.late_interest_pct, req.user.id]);
    const changes = {}; for (const k of Object.keys(v)) if (Number(old[k]) !== v[k]) changes[k] = { from: String(Number(old[k])), to: String(v[k]) };
    await logAudit({ user: req.user, action: 'tax.settings_changed', entityType: 'tax_settings', entityId: 1, changes });
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

async function figures(user, landlordId, month) {
  const landlord = (await pool.query('SELECT id, name, kra_pin FROM users WHERE id = $1', [landlordId])).rows[0];
  if (!landlord) return { status: 404, error: 'Landlord not found.' };
  const plots = await allowedPlots(user, landlordId);
  if (!plots.length) return { status: 403, error: 'Access denied' };
  const s = await getSettings();
  const year = month.slice(0, 4), start = `${year}-01-01`, end = `${nextMonth(month)}-01`;
  const rows = (await pool.query(
    `SELECT to_char(p.payment_date, 'YYYY-MM') AS ym, p.amount, h.id AS house_id, h.unit_number, h.house_type, h.use_type, pl.id AS plot_id, pl.name AS plot_name, pl.rental_use
     FROM payments p JOIN houses h ON h.id = p.house_id JOIN plots pl ON pl.id = h.plot_id
     WHERE pl.id = ANY($1) AND p.payment_date >= $2::date AND p.payment_date < $3::date
       AND p.status NOT IN ('failed', 'pending') AND COALESCE(p.method, '') <> 'balance_charge'`,
    [plots.map(p => p.id), start, end])).rows;

  const byMonth = new Map();            // ym -> { residential, commercial }
  const byPlot = new Map(plots.map(p => [p.id, { plot_id: p.id, plot_name: p.name, rental_use: p.rental_use, residential: 0, commercial: 0 }]));
  for (const r of rows) {
    const use = classify(r, { rental_use: r.rental_use }).use, amt = parseFloat(r.amount);
    const m = byMonth.get(r.ym) || { residential: 0, commercial: 0 }; m[use] += amt; byMonth.set(r.ym, m);
    if (r.ym === month) byPlot.get(r.plot_id)[use] += amt;
  }
  const cur = byMonth.get(month) || { residential: 0, commercial: 0 };
  const gross = round2(cur.residential), tax = round2(gross * Number(s.mri_rate) / 100);
  const ytd = round2([...byMonth.values()].reduce((a, m) => a + m.residential, 0));
  const monthsElapsed = Number(month.slice(5, 7));
  const projected = round2(ytd / monthsElapsed * 12);
  const due = dueDate(month, s.due_day);
  const ret = (await pool.query('SELECT * FROM tax_returns WHERE landlord_id = $1 AND period = $2', [landlordId, month])).rows[0] || null;
  const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
  const status = { filed_on: fmtDate(ret?.filed_on), paid_on: fmtDate(ret?.paid_on), reference: ret?.reference || null, notes: ret?.notes || null };
  const pen = penalties({ tax, due, filedOn: status.filed_on, paidOn: status.paid_on, today: todayStr(), s });
  // Is MRI the right regime for this landlord's year? (estimate from year to date)
  let band = 'inside';
  if (projected < Number(s.lower_threshold)) band = 'below'; else if (projected > Number(s.upper_threshold)) band = 'above';

  // unit classification, so the landlord can see and correct what counts as residential
  const houses = (await pool.query(`SELECT h.id, h.unit_number, h.house_type, h.use_type, h.plot_id, pl.rental_use FROM houses h JOIN plots pl ON pl.id = h.plot_id WHERE pl.id = ANY($1) ORDER BY pl.name, h.unit_number`, [plots.map(p => p.id)])).rows;
  const units = houses.map(h => ({ id: h.id, plot_id: h.plot_id, unit_number: h.unit_number, house_type: h.house_type, use_type: h.use_type, ...classify(h, { rental_use: h.rental_use }) }));

  let unmatched = null;
  if (isAdmin(user)) {
    const u = (await pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0) AS total FROM payments WHERE house_id IS NULL AND status IN ('unmatched','review') AND payment_date >= $1::date AND payment_date < $2::date`, [`${month}-01`, end])).rows[0];
    if (u.n) unmatched = { count: u.n, total: parseFloat(u.total) };
  }
  return {
    landlord, settings: s, month, due_date: due, gross, tax, commercial_excluded: round2(cur.commercial),
    properties: [...byPlot.values()].map(p => ({ ...p, residential: round2(p.residential), commercial: round2(p.commercial) })),
    property_count: [...byPlot.values()].filter(p => p.residential > 0).length,
    year: { ytd, projected, band, months: [...byMonth.entries()].sort().map(([ym, m]) => ({ month: ym, residential: round2(m.residential), commercial: round2(m.commercial) })) },
    status, penalties: pen, unmatched, units,
    plots: plots.map(p => ({ id: p.id, name: p.name, rental_use: p.rental_use })),
  };
}

router.get('/mri', auth, async (req, res) => {
  try {
    const landlordId = pid(req.query.landlord_id);
    if (!landlordId || !MONTH.test(req.query.month || '')) return res.status(400).json({ error: 'Choose a landlord and a month.' });
    const f = await figures(req.user, landlordId, req.query.month);
    if (f.error) return res.status(f.status).json({ error: f.error });
    res.json({ success: true, can_edit: isAdmin(req.user), can_pin: isAdmin(req.user) || req.user.id === landlordId, ...f });
  } catch (err) { fail(res, err); }
});

router.post('/mri/status', auth, async (req, res) => {
  try {
    const b = req.body || {}; const landlordId = pid(b.landlord_id);
    if (!landlordId || !MONTH.test(b.month || '')) return res.status(400).json({ error: 'Choose a landlord and a month.' });
    for (const k of ['filed_on', 'paid_on']) if (b[k] && !DATE.test(b[k])) return res.status(400).json({ error: 'A date is not valid.' });
    const f = await figures(req.user, landlordId, b.month);
    if (f.error) return res.status(f.status).json({ error: f.error });
    await pool.query(
      `INSERT INTO tax_returns (landlord_id, period, gross, tax, filed_on, paid_on, reference, notes, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (landlord_id, period) DO UPDATE SET gross = EXCLUDED.gross, tax = EXCLUDED.tax, filed_on = EXCLUDED.filed_on, paid_on = EXCLUDED.paid_on,
         reference = EXCLUDED.reference, notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [landlordId, b.month, f.gross, f.tax, b.filed_on || null, b.paid_on || null, String(b.reference || '').slice(0, 60) || null, String(b.notes || '').slice(0, 500) || null, req.user.id]);
    await logAudit({ user: req.user, action: 'tax.return_status', entityType: 'user', entityId: landlordId, changes: { period: { to: b.month }, filed_on: { from: f.status.filed_on || '', to: b.filed_on || '' }, paid_on: { from: f.status.paid_on || '', to: b.paid_on || '' } } });
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

router.put('/landlords/:id/pin', auth, async (req, res) => {
  try {
    const id = pid(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found.' });
    if (!isAdmin(req.user) && req.user.id !== id) return res.status(403).json({ error: 'Only an admin or the landlord can change the KRA PIN.' });
    const pin = String(req.body?.kra_pin || '').trim().toUpperCase();
    if (pin && !/^[AP]\d{9}[A-Z]$/.test(pin)) return res.status(400).json({ error: 'A KRA PIN looks like A123456789B (a letter, 9 digits, a letter).' });
    const old = (await pool.query('SELECT kra_pin FROM users WHERE id = $1', [id])).rows[0];
    if (!old) return res.status(404).json({ error: 'Landlord not found.' });
    await pool.query('UPDATE users SET kra_pin = $1 WHERE id = $2', [pin || null, id]);
    await logAudit({ user: req.user, action: 'tax.pin_changed', entityType: 'user', entityId: id, changes: { kra_pin: { from: old.kra_pin || '', to: pin } } });
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

router.put('/plots/:id/use', auth, async (req, res) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Only an admin can change this.' });
    const id = pid(req.params.id), use = req.body?.rental_use;
    if (!id || !['residential', 'commercial', 'mixed'].includes(use)) return res.status(400).json({ error: 'Choose residential, commercial or mixed.' });
    const old = (await pool.query('SELECT name, rental_use FROM plots WHERE id = $1', [id])).rows[0];
    if (!old) return res.status(404).json({ error: 'Property not found.' });
    await pool.query('UPDATE plots SET rental_use = $1 WHERE id = $2', [use, id]);
    await logAudit({ user: req.user, action: 'tax.plot_use_changed', entityType: 'plot', entityId: id, changes: { rental_use: { from: old.rental_use, to: use } } });
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});
router.put('/houses/:id/use', auth, async (req, res) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Only an admin can change this.' });
    const id = pid(req.params.id), use = req.body?.use_type || null;
    if (!id || (use !== null && !['residential', 'commercial'].includes(use))) return res.status(400).json({ error: 'Choose residential, commercial, or automatic.' });
    const old = (await pool.query('SELECT unit_number, use_type, plot_id FROM houses WHERE id = $1', [id])).rows[0];
    if (!old) return res.status(404).json({ error: 'Unit not found.' });
    await pool.query('UPDATE houses SET use_type = $1 WHERE id = $2', [use, id]);
    await logAudit({ user: req.user, action: 'tax.unit_use_changed', entityType: 'plot', entityId: old.plot_id, changes: { [`unit ${old.unit_number}`]: { from: old.use_type || 'automatic', to: use || 'automatic' } } });
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

const kes = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
router.get('/mri/pdf', auth, async (req, res) => {
  try {
    const landlordId = pid(req.query.landlord_id);
    if (!landlordId || !MONTH.test(req.query.month || '')) return res.status(400).json({ error: 'Choose a landlord and a month.' });
    const f = await figures(req.user, landlordId, req.query.month);
    if (f.error) return res.status(f.status).json({ error: f.error });
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="MRI-${f.landlord.name.replace(/[^\w]+/g, '_')}-${f.month}.pdf"`);
    doc.pipe(res);
    doc.fontSize(18).text('Monthly Rental Income (MRI) figures', { align: 'left' });
    doc.moveDown(0.3).fontSize(10).fillColor('#555').text('Prepared from RentFlow records to help complete the return. Not filed with KRA. Check every figure before submitting.');
    doc.fillColor('#000').moveDown();
    const kv = (k, v) => { doc.fontSize(11).font('Helvetica-Bold').text(k, { continued: true }).font('Helvetica').text(`  ${v}`); };
    kv('Landlord:', f.landlord.name); kv('KRA PIN:', f.landlord.kra_pin || 'not recorded');
    kv('Rent month:', f.month); kv('Return and payment due:', f.due_date);
    doc.moveDown().fontSize(13).font('Helvetica-Bold').text('Residential rent collected, by property').font('Helvetica').fontSize(11).moveDown(0.3);
    for (const p of f.properties) doc.text(`${p.plot_name}: ${kes(p.residential)}${p.commercial ? `   (commercial, not included: ${kes(p.commercial)})` : ''}`);
    doc.moveDown().font('Helvetica-Bold').fontSize(13).text('Figures for the return').font('Helvetica').fontSize(12).moveDown(0.3);
    kv('Gross monthly rental income:', kes(f.gross));
    kv(`Tax at ${Number(f.settings.mri_rate)}%:`, kes(f.tax));
    kv('Number of properties with rent:', String(f.property_count));
    doc.moveDown().fontSize(10).fillColor('#555').text(`Rate ${Number(f.settings.mri_rate)}% of gross rent received, no deductions. Year to date residential rent: ${kes(f.year.ytd)}. Rates and limits are the values saved in RentFlow's tax settings; confirm they are current with KRA.`);
    doc.end();
  } catch (err) { if (!res.headersSent) fail(res, err); }
});

module.exports = router;

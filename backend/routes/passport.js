// Rent passport: a payment-record summary a landlord can hand to a tenant who asks for it
// (for a new landlord, a lender or a visa), issued as a PDF by staff.
//   GET  /api/passport/:tenantId?grace=3                       preview figures
//   POST /api/passport/:tenantId/pdf { grace, comment, tenant_requested: true }
// The tenant must have asked for it (staff confirm this); every PDF issued is audited.
const express = require('express');
const router  = express.Router();
const PDFDocument = require('pdfkit');
const crypto  = require('crypto');
const pool    = require('../database/db');
const { authMiddleware: auth } = require('../middleware/auth');
const { getVisiblePlotIds } = require('../middleware/scope');
const { getPermissions } = require('../middleware/permissions');
const { logAudit } = require('../utils/audit');
const { VALID_PAYMENT_SQL } = require('../utils/rentLedger');
const { buildPassport } = require('../utils/passport');

const kes = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const gr = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n >= 0 && n <= 14 ? n : 3; };

async function load(user, id, grace) {
  const t = (await pool.query(
    `SELECT t.id, t.full_name, t.national_id, t.move_in_date, t.rent_due_day, t.is_active, h.unit_number, h.rent_amount, h.plot_id,
            p.name AS plot_name, p.location AS plot_location, lu.name AS landlord_name
       FROM tenants t LEFT JOIN houses h ON h.id = t.house_id LEFT JOIN plots p ON p.id = h.plot_id LEFT JOIN users lu ON lu.id = p.user_id
      WHERE t.id = $1`, [id])).rows[0];
  if (!t) return { status: 404, error: 'Tenant not found' };
  const { permissions } = await getPermissions(user, t.plot_id);
  const has = (k) => permissions.includes('*') || permissions.includes(k);
  if (!has('tenants.view') || !has('payments.view')) return { status: 403, error: 'Missing permission: tenants.view and payments.view' };
  const visible = await getVisiblePlotIds(user);
  if (visible !== 'ALL' && !visible.includes(t.plot_id)) return { status: 403, error: 'Access denied' };
  const pays = (await pool.query(
    `SELECT COALESCE(amount_allocated, amount) AS amount, payment_date,
            COALESCE(for_year, EXTRACT(YEAR FROM payment_date)::int) AS year,
            COALESCE(for_month, EXTRACT(MONTH FROM payment_date)::int) AS month
       FROM payments WHERE tenant_id = $1 AND ${VALID_PAYMENT_SQL}`, [id])).rows;
  const pp = buildPassport({ rent: t.rent_amount, moveIn: t.move_in_date, dueDay: t.rent_due_day, grace, payments: pays });
  return { tenant: t, ...pp };
}

router.get('/:tenantId', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.tenantId, 10); if (!id) return res.status(400).json({ error: 'Bad id' });
    const r = await load(req.user, id, gr(req.query.grace));
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.json({ success: true, tenant: { id: r.tenant.id, full_name: r.tenant.full_name, unit_number: r.tenant.unit_number, plot_name: r.tenant.plot_name, move_in_date: r.tenant.move_in_date, is_active: r.tenant.is_active }, months: r.months, summary: r.summary });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

router.post('/:tenantId/pdf', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.tenantId, 10); if (!id) return res.status(400).json({ error: 'Bad id' });
    if (req.body.tenant_requested !== true) return res.status(400).json({ error: 'Confirm that the tenant asked for their rent passport.' });
    const grace = gr(req.body.grace);
    const r = await load(req.user, id, grace);
    if (r.error) return res.status(r.status).json({ error: r.error });
    if (!r.summary) return res.status(400).json({ error: 'No rent history yet: the tenant needs a move-in date and a rent amount.' });
    const t = r.tenant, s = r.summary;
    const comment = String(req.body.comment || '').trim().slice(0, 500);
    const ref = `RP-${t.id}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const idShown = t.national_id ? `****${String(t.national_id).slice(-3)}` : '—';

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = []; doc.on('data', c => chunks.push(c));
    doc.on('end', () => { res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="rent-passport-${t.id}.pdf"` }); res.send(Buffer.concat(chunks)); });

    doc.font('Helvetica-Bold').fontSize(20).text('Rent Passport', { align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor('#666').text(`Reference ${ref} · Issued ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, { align: 'center' });
    doc.moveDown(1).fillColor('#000').fontSize(11);
    const row = (a, b) => { const y = doc.y; doc.font('Helvetica-Bold').text(a, 50, y, { width: 150 }); doc.font('Helvetica').text(b, 200, y, { width: 340 }); };
    row('Tenant', t.full_name); row('ID number', idShown);
    row('Property', `${t.plot_name || '—'}${t.plot_location ? ', ' + t.plot_location : ''}, Unit ${t.unit_number || '—'}`);
    row('Landlord', t.landlord_name || '—');
    row('Tenancy started', new Date(t.move_in_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
    row('Monthly rent', kes(t.rent_amount));
    row('Status', t.is_active ? 'Current tenant' : 'Former tenant');
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(13).text('Payment record');
    doc.font('Helvetica').fontSize(11).moveDown(0.3);
    doc.text(`Months on record: ${s.months}`);
    doc.text(`Paid in full on time: ${s.on_time} of ${s.months} (${s.on_time_pct}%)`);
    doc.text(`Paid in full but late: ${s.late}${s.late ? ` (about ${s.avg_days_late} day${s.avg_days_late === 1 ? '' : 's'} late on average)` : ''}`);
    doc.text(`Partly paid: ${s.partial}    Not paid: ${s.unpaid}`);
    doc.text(`Longest run of on-time months: ${s.best_streak}    Current run: ${s.current_streak}`);
    doc.moveDown(0.3).fontSize(9).fillColor('#666').text(`"On time" means the full rent was received within ${grace} day${grace === 1 ? '' : 's'} after the rent due day of ${t.rent_due_day || 5}. The current month is not included until it ends.`).fillColor('#000');
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(13).text('Month by month'); doc.moveDown(0.3);
    const LAB = { on_time: 'On time', late: 'Late', partial: 'Part paid', unpaid: 'Not paid' };
    const hdr = () => { const y = doc.y; doc.font('Helvetica-Bold').fontSize(9).fillColor('#666'); doc.text('Month', 50, y, { width: 90 }); doc.text('Rent', 140, y, { width: 110 }); doc.text('Paid', 250, y, { width: 110 }); doc.text('Result', 360, y, { width: 180 }); doc.fillColor('#000'); doc.moveDown(0.3); };
    hdr();
    for (const m of r.months) {
      if (doc.y > 760) { doc.addPage(); hdr(); }
      const y = doc.y; doc.font('Helvetica').fontSize(9);
      doc.text(m.label, 50, y, { width: 90 }); doc.text(kes(m.rent), 140, y, { width: 110 }); doc.text(kes(m.paid), 250, y, { width: 110 });
      doc.text(LAB[m.status] + (m.status === 'late' ? ` (${m.days_late} day${m.days_late === 1 ? '' : 's'})` : ''), 360, y, { width: 180 });
    }
    if (comment) { doc.moveDown(1).font('Helvetica-Bold').fontSize(11).text('Landlord comment', 50); doc.font('Helvetica').fontSize(10).text(comment, 50, doc.y, { width: 490 }); }
    if (doc.y > 700) doc.addPage();
    doc.moveDown(2).font('Helvetica').fontSize(10).text('______________________', 50).text(`${req.user.name || 'Landlord / agent'}`, 50).text('Landlord or authorised agent', 50);
    doc.moveDown(1).fontSize(8).fillColor('#666').text('Prepared from rent records kept in RentFlow, at the tenant\'s request. It reflects recorded payments only and is not a credit report.', 50, doc.y, { width: 490 });
    doc.end();
    logAudit({ user: req.user, action: 'passport.issue', entityType: 'tenant', entityId: id, changes: { reference: { to: ref }, on_time_pct: { to: s.on_time_pct } } });
  } catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ error: e.message }); }
});

module.exports = router;

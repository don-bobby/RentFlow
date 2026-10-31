// Notice and lease documents.
//   GET  /api/documents/templates
//   GET  /api/documents/preview?tenant_id&template&<fields>   -> { title, body, params, defaults } to edit
//   POST /api/documents/pdf { tenant_id, template, title, body }  -> PDF of the (possibly edited) text
// Nothing is stored; each PDF made is recorded in the audit log.
const express = require('express');
const router  = express.Router();
const PDFDocument = require('pdfkit');
const pool    = require('../database/db');
const { authMiddleware: auth } = require('../middleware/auth');
const { getVisiblePlotIds } = require('../middleware/scope');
const { getPermissions } = require('../middleware/permissions');
const { logAudit } = require('../utils/audit');
const T = require('../utils/docTemplates');

const pid = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };

async function loadContext(user, tenantId) {
  const r = await pool.query(
    `SELECT t.*, h.unit_number, h.rent_amount, h.plot_id, p.name AS plot_name, p.location AS plot_location,
            lu.name AS landlord_name, lu.phone AS landlord_phone
       FROM tenants t
       LEFT JOIN houses h ON t.house_id = h.id
       LEFT JOIN plots p ON h.plot_id = p.id
       LEFT JOIN users lu ON lu.id = p.user_id
      WHERE t.id = $1`, [tenantId]);
  const t = r.rows[0];
  if (!t) return { status: 404, error: 'Tenant not found' };
  const { permissions } = await getPermissions(user, t.plot_id);
  const has = (k) => permissions.includes('*') || permissions.includes(k);
  if (!has('tenants.view')) return { status: 403, error: 'Missing permission: tenants.view' };
  const visible = await getVisiblePlotIds(user);
  if (visible !== 'ALL' && !visible.includes(t.plot_id)) return { status: 403, error: 'Access denied' };
  return {
    ctx: {
      tenant: t, unit: t.unit_number || '—', rent: t.rent_amount, plot_name: t.plot_name || '', plot_location: t.plot_location || '',
      landlord_name: t.landlord_name || user.name || 'Landlord', landlord_phone: t.landlord_phone || '',
      national_id: has('tenants.view_sensitive') ? t.national_id : null, today: T.today(),
    },
  };
}

router.get('/templates', auth, (req, res) => res.json({ success: true, data: T.list() }));

router.get('/preview', auth, async (req, res) => {
  try {
    const key = String(req.query.template || '');
    if (!T.TEMPLATES[key]) return res.status(400).json({ error: 'Unknown template' });
    const tid = pid(req.query.tenant_id); if (!tid) return res.status(400).json({ error: 'tenant_id required' });
    const l = await loadContext(req.user, tid);
    if (l.error) return res.status(l.status).json({ error: l.error });
    const defaults = T.TEMPLATES[key].defaults(l.ctx);
    const params = T.cleanParams(key, req.query, l.ctx);
    res.json({ success: true, ...T.TEMPLATES[key].build(l.ctx, params), params, defaults });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.post('/pdf', auth, async (req, res) => {
  try {
    const key = String(req.body.template || '');
    if (!T.TEMPLATES[key]) return res.status(400).json({ error: 'Unknown template' });
    const tid = pid(req.body.tenant_id); if (!tid) return res.status(400).json({ error: 'tenant_id required' });
    const l = await loadContext(req.user, tid);
    if (l.error) return res.status(l.status).json({ error: l.error });
    const title = String(req.body.title || T.TEMPLATES[key].label).slice(0, 120);
    const body = String(req.body.body || '').slice(0, 20000);
    if (!body.trim()) return res.status(400).json({ error: 'The document is empty' });

    const doc = new PDFDocument({ size: 'A4', margin: 60 });
    const chunks = []; doc.on('data', c => chunks.push(c));
    doc.on('end', () => {
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${key}-${tid}.pdf"` });
      res.send(Buffer.concat(chunks));
    });
    doc.font('Helvetica-Bold').fontSize(15).text(title, { align: 'center' });
    doc.moveTo(60, doc.y + 6).lineTo(535, doc.y + 6).strokeColor('#999').stroke(); doc.moveDown(1.2);
    for (const para of body.split(/\n{2,}/)) {
      for (const line of para.split('\n')) {
        if (line.startsWith('# ')) doc.font('Helvetica-Bold').fontSize(11).text(line.slice(2), { paragraphGap: 2 });
        else doc.font('Helvetica').fontSize(11).text(line, { lineGap: 2 });
      }
      doc.moveDown(0.6);
    }
    doc.end();
    logAudit({ user: req.user, action: 'document.generate', entityType: 'tenant', entityId: tid, changes: { document: { from: null, to: key } } });
  } catch (err) { console.error(err); if (!res.headersSent) res.status(500).json({ error: err.message }); }
});

module.exports = router;

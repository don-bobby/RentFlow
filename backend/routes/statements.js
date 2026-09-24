const express  = require('express');
const router   = express.Router();
const pool     = require('../database/db');
const jwt      = require('jsonwebtoken');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

async function loadStatementData(tenantId) {
  const tenantRes = await pool.query(
    `SELECT t.*, h.unit_number, h.rent_amount, p.name AS plot_name, p.location AS plot_location
     FROM tenants t
     LEFT JOIN houses h ON t.house_id = h.id
     LEFT JOIN plots  p ON h.plot_id  = p.id
     WHERE t.id = $1`,
    [tenantId]
  );
  const tenant = tenantRes.rows[0];
  if (!tenant) return null;

  const paymentsRes = await pool.query(
    `SELECT amount, payment_date, method, receipt_no, for_year, for_month
     FROM payments WHERE tenant_id = $1 AND status != 'pending' ORDER BY payment_date ASC`,
    [tenantId]
  );
  return { tenant, payments: paymentsRes.rows };
}

// Draws one tenant's statement onto an already-open PDFDocument.
// Pass startNewPage=false for the very first tenant in a bulk run.
function drawStatement(doc, { tenant, payments }, startNewPage = true) {
  if (startNewPage) doc.addPage();

  doc.fontSize(18).text('RentFlow — Tenant Statement', { align: 'left' });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#666').text(`Generated ${new Date().toLocaleDateString('en-KE')}`);
  doc.moveDown();

  doc.fillColor('#000').fontSize(12);
  doc.text(`Tenant: ${tenant.full_name}`);
  doc.text(`Phone: ${tenant.phone || '—'}`);
  doc.text(`Unit: ${tenant.unit_number ? `Unit ${tenant.unit_number}` : '—'}  |  Plot: ${tenant.plot_name || '—'}`);
  doc.text(`Move-in Date: ${tenant.move_in_date ? new Date(tenant.move_in_date).toLocaleDateString('en-KE') : '—'}`);
  doc.text(`Monthly Rent: KES ${parseFloat(tenant.rent_amount || 0).toLocaleString()}`);
  doc.text(`Current Balance: KES ${parseFloat(tenant.balance || 0).toLocaleString()}`, { continued: false });
  doc.moveDown();

  doc.fontSize(13).text('Payment History', { underline: true });
  doc.moveDown(0.3);

  if (payments.length === 0) {
    doc.fontSize(11).fillColor('#666').text('No payments on record.');
  } else {
    const colX = { date: 50, amount: 150, method: 250, ref: 350, for: 460 };
    doc.fontSize(9).fillColor('#666');
    doc.text('Date', colX.date, doc.y, { continued: true, width: 100 });
    doc.text('Amount (KES)', colX.amount, doc.y, { continued: true, width: 100 });
    doc.text('Method', colX.method, doc.y, { continued: true, width: 100 });
    doc.text('Receipt', colX.ref, doc.y, { continued: true, width: 100 });
    doc.text('For', colX.for, doc.y);
    doc.moveDown(0.2);
    doc.fillColor('#000').fontSize(9);
    payments.forEach(p => {
      const forLabel = p.for_month ? `${p.for_month}/${p.for_year}` : '—';
      const y = doc.y;
      doc.text(new Date(p.payment_date).toLocaleDateString('en-KE'), colX.date, y, { continued: true, width: 100 });
      doc.text(parseFloat(p.amount).toLocaleString(), colX.amount, y, { continued: true, width: 100 });
      doc.text(p.method || '—', colX.method, y, { continued: true, width: 100 });
      doc.text(p.receipt_no || '—', colX.ref, y, { continued: true, width: 100 });
      doc.text(forLabel, colX.for, y);
    });
  }
}

// GET /api/statements/:tenantId — single tenant statement PDF
router.get('/:tenantId', auth, async (req, res) => {
  try {
    const data = await loadStatementData(req.params.tenantId);
    if (!data) return res.status(404).json({ error: 'Tenant not found' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="statement_${data.tenant.full_name.replace(/\s+/g, '_')}.pdf"`);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);
    drawStatement(doc, data, false);
    doc.end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/statements/bulk/all.zip — admin/landlord only, one PDF per active tenant
router.get('/bulk/all.zip', auth, async (req, res) => {
  if (!['admin', 'landlord'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
  try {
    const isAdmin = req.user.role === 'admin';
    const query = isAdmin
      ? `SELECT t.id, t.full_name FROM tenants t WHERE t.is_active = true ORDER BY t.full_name`
      : `SELECT t.id, t.full_name FROM tenants t
         LEFT JOIN houses h ON t.house_id = h.id LEFT JOIN plots p ON h.plot_id = p.id
         WHERE t.is_active = true AND p.user_id = $1 ORDER BY t.full_name`;
    const params  = isAdmin ? [] : [req.user.id];
    const tenants = await pool.query(query, params);

    if (tenants.rows.length === 0) return res.status(404).json({ error: 'No active tenants found.' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="tenant_statements_${new Date().toISOString().split('T')[0]}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    for (const t of tenants.rows) {
      const data = await loadStatementData(t.id);
      if (!data) continue;
      const doc = new PDFDocument({ margin: 50 });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      const done = new Promise(resolve => doc.on('end', resolve));
      drawStatement(doc, data, false);
      doc.end();
      await done;
      archive.append(Buffer.concat(chunks), { name: `${t.full_name.replace(/\s+/g, '_')}.pdf` });
    }

    await archive.finalize();
  } catch (err) {
    // Headers may already be sent (streaming), so guard the error response
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

module.exports = router;

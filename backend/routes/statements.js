const express  = require('express');
const router   = express.Router();
const pool     = require('../database/db');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');
const { authMiddleware: auth } = require('../middleware/auth');
const { getVisiblePlotIds }    = require('../middleware/scope');
const { logStaffActivity }     = require('../utils/staffActivity');
const { filterRowsByPermission } = require('../middleware/permissions');
const { computeLedger, loadPaidMaps } = require('../utils/rentLedger');

// Previously this file used its own `auth()` helper, which only checked for
// a valid JWT — never which role it belonged to — and GET /:tenantId had no
// ownership/scope check at all. That meant any valid staff token, or a
// TENANT'S OWN LOGIN, could pull any other tenant's full financial
// statement (balance, full payment history, phone, unit) just by changing
// the id in the URL — a severe IDOR, trivially exploitable via sequential
// tenant ids. Switched to the shared authMiddleware (rejects tenant tokens
// outright, same as every other staff-only route in this project) and
// added the getVisiblePlotIds scope check below, same pattern used
// throughout payments.js/tenants.js/etc.

async function loadStatementData(tenantId) {
  const tenantRes = await pool.query(
    `SELECT t.*, h.unit_number, h.rent_amount, h.plot_id, p.name AS plot_name, p.location AS plot_location
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
  const utilRes = await pool.query(
    `SELECT utility_type, amount, payment_date, method, reference
     FROM utility_payments WHERE tenant_id = $1 ORDER BY payment_date ASC, id ASC`,
    [tenantId]
  );
  return { tenant, payments: paymentsRes.rows, utilities: utilRes.rows };
}

// Draws one tenant's statement onto an already-open PDFDocument.
// Pass startNewPage=false for the very first tenant in a bulk run.
function drawStatement(doc, { tenant, payments, utilities = [] }, startNewPage = true) {
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

  // Utilities are tracked apart from rent and never change the balance above.
  if (utilities.length > 0) {
    doc.moveDown();
    doc.fillColor('#000').fontSize(13).text('Utility Payments (separate from rent)', 50, doc.y, { underline: true });
    doc.moveDown(0.3);
    const ux = { date: 50, type: 150, amount: 280, method: 380, ref: 470 };
    doc.fontSize(9).fillColor('#666');
    const hy = doc.y;
    doc.text('Date', ux.date, hy, { continued: true, width: 100 });
    doc.text('Utility', ux.type, hy, { continued: true, width: 130 });
    doc.text('Amount (KES)', ux.amount, hy, { continued: true, width: 100 });
    doc.text('Method', ux.method, hy, { continued: true, width: 90 });
    doc.text('Reference', ux.ref, hy);
    doc.moveDown(0.2);
    doc.fillColor('#000').fontSize(9);
    let total = 0;
    utilities.forEach(u => {
      total += parseFloat(u.amount);
      const y = doc.y;
      doc.text(new Date(u.payment_date).toLocaleDateString('en-KE'), ux.date, y, { continued: true, width: 100 });
      doc.text(u.utility_type, ux.type, y, { continued: true, width: 130 });
      doc.text(parseFloat(u.amount).toLocaleString(), ux.amount, y, { continued: true, width: 100 });
      doc.text(u.method || '—', ux.method, y, { continued: true, width: 90 });
      doc.text(u.reference || '—', ux.ref, y);
    });
    doc.moveDown(0.3);
    doc.fontSize(10).text(`Total utilities paid: KES ${total.toLocaleString()}`, 50, doc.y);
  }
}

// GET /api/statements/landlord?month=YYYY-MM[&plot_id=N] — one-page-per-property
// monthly owner statement: rent collected, utilities recovered, expenses,
// net, collection rate, arrears and occupancy. MUST stay above /:tenantId.
router.get('/landlord', auth, async (req, res) => {
  try {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
    const [yy, mm] = month.split('-').map(Number);
    const start = `${month}-01`;
    const endDate = new Date(yy, mm, 1).toISOString().slice(0, 10); // first day of next month

    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && visible.length === 0) return res.status(403).json({ error: 'No properties available.' });
    const plotRes = await pool.query(
      `SELECT p.id, p.name, p.location, u.name AS owner_name FROM plots p LEFT JOIN users u ON p.user_id = u.id
       WHERE ${visible === 'ALL' ? 'true' : 'p.id = ANY($1)'} ${req.query.plot_id ? `AND p.id = ${parseInt(req.query.plot_id) || 0}` : ''}
       ORDER BY p.name`,
      visible === 'ALL' ? [] : [visible]
    );
    const plots = await filterRowsByPermission(req.user, plotRes.rows, 'reports.revenue_summary', (row) => row.id);
    if (!plots.length) return res.status(403).json({ error: 'You do not have access to financial statements for these properties.' });

    const monthLabel = new Date(yy, mm - 1, 1).toLocaleString('en-KE', { month: 'long', year: 'numeric' });
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="landlord_statement_${month}.pdf"`);
    doc.pipe(res);
    const kes = (n) => `KES ${Math.round(parseFloat(n || 0)).toLocaleString()}`;
    const line = (label, value, bold = false) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).fillColor('#000');
      doc.text(label, 60, y, { width: 300, continued: false });
      doc.text(value, 360, y, { width: 190, align: 'right' });
    };

    let first = true;
    for (const plot of plots) {
      if (!first) doc.addPage();
      first = false;
      const [coll, utils, exps, houses, tenantsRes] = await Promise.all([
        pool.query(`SELECT COALESCE(p.method,'other') AS method, SUM(COALESCE(p.amount_allocated, p.amount)) AS total
                    FROM payments p JOIN houses h ON p.house_id = h.id
                    WHERE h.plot_id = $1 AND p.payment_date >= $2 AND p.payment_date < $3 AND p.status NOT IN ('failed','pending') AND COALESCE(p.method,'') != 'balance_charge'
                    GROUP BY 1 ORDER BY 2 DESC`, [plot.id, start, endDate]),
        pool.query(`SELECT utility_type, SUM(amount) AS total FROM utility_payments
                    WHERE plot_id = $1 AND payment_date >= $2 AND payment_date < $3 GROUP BY 1 ORDER BY 2 DESC`, [plot.id, start, endDate]),
        pool.query(`SELECT COALESCE(category,'Uncategorised') AS category, SUM(amount) AS total FROM expenses
                    WHERE plot_id = $1 AND expense_date >= $2 AND expense_date < $3
                      AND COALESCE(status,'confirmed') != 'pending' GROUP BY 1 ORDER BY 2 DESC`, [plot.id, start, endDate]),
        pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'occupied') AS occupied FROM houses WHERE plot_id = $1`, [plot.id]),
        pool.query(`SELECT t.id, t.move_in_date, h.rent_amount FROM tenants t JOIN houses h ON t.house_id = h.id
                    WHERE h.plot_id = $1 AND t.is_active = true`, [plot.id]),
      ]);
      const collected = coll.rows.reduce((a, r) => a + parseFloat(r.total), 0);
      const utilIn    = utils.rows.reduce((a, r) => a + parseFloat(r.total), 0);
      const expenseTotal = exps.rows.reduce((a, r) => a + parseFloat(r.total), 0);
      const expected  = tenantsRes.rows.reduce((a, t) => a + parseFloat(t.rent_amount || 0), 0);
      const maps = await loadPaidMaps(pool, tenantsRes.rows.map(t => t.id));
      const arrears = tenantsRes.rows.reduce((a, t) => a + computeLedger({ rent: t.rent_amount, moveInDate: t.move_in_date, paidMap: maps[t.id] || {} }).totalOwed, 0);
      const utilBills = exps.rows.filter(r => ['Water', 'Electricity', 'Garbage Collection', 'Utilities'].includes(r.category)).reduce((a, r) => a + parseFloat(r.total), 0);

      doc.font('Helvetica-Bold').fontSize(18).fillColor('#000').text('RentFlow — Owner Statement', 50, 50);
      doc.font('Helvetica').fontSize(10).fillColor('#666').text(`${monthLabel}  ·  Generated ${new Date().toLocaleDateString('en-KE')}`);
      doc.moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#000').text(plot.name);
      doc.font('Helvetica').fontSize(10).fillColor('#666').text(`${plot.location || ''}${plot.owner_name ? `  ·  Owner: ${plot.owner_name}` : ''}`);
      doc.moveDown();

      doc.font('Helvetica-Bold').fontSize(12).fillColor('#000').text('Income', 50);
      doc.moveDown(0.3);
      coll.rows.forEach(r => line(`Rent — ${r.method}`, kes(r.total)));
      if (!coll.rows.length) line('No rent recorded this month', kes(0));
      line('Total rent collected', kes(collected), true);
      utils.rows.forEach(r => line(`Utilities recovered — ${r.utility_type}`, kes(r.total)));
      if (utilIn > 0) line('Total utilities recovered', kes(utilIn), true);
      doc.moveDown();

      doc.font('Helvetica-Bold').fontSize(12).fillColor('#000').text('Expenses', 50);
      doc.moveDown(0.3);
      exps.rows.forEach(r => line(r.category, kes(r.total)));
      if (!exps.rows.length) line('No expenses recorded this month', kes(0));
      line('Total expenses', kes(expenseTotal), true);
      doc.moveDown();

      doc.moveTo(60, doc.y).lineTo(550, doc.y).strokeColor('#bbb').stroke();
      doc.moveDown(0.5);
      line('Net for the month (rent + utilities recovered − expenses)', kes(collected + utilIn - expenseTotal), true);
      doc.moveDown();

      doc.font('Helvetica-Bold').fontSize(12).fillColor('#000').text('Property snapshot', 50);
      doc.moveDown(0.3);
      const h = houses.rows[0];
      line('Occupancy', `${h.occupied} of ${h.total} units${parseInt(h.total) ? ` (${Math.round((h.occupied / h.total) * 100)}%)` : ''}`);
      line('Monthly rent roll (active tenants)', kes(expected));
      line('Collection rate this month', expected ? `${Math.round((collected / expected) * 100)}%` : '—');
      line('Outstanding arrears today', kes(arrears));
      if (utilBills > 0 || utilIn > 0) line('Utility bills vs recovered', `${kes(utilBills)} / ${kes(utilIn)}`);
    }
    doc.end();
    await logStaffActivity({ userId: req.user.id, action: 'landlord_statement_viewed', detail: `${monthLabel} · ${plots.length} propert${plots.length === 1 ? 'y' : 'ies'}` });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: err.message }); else res.end();
  }
});

// GET /api/statements/:tenantId — single tenant statement PDF
router.get('/:tenantId', auth, async (req, res) => {
  try {
    const data = await loadStatementData(req.params.tenantId);
    if (!data) return res.status(404).json({ error: 'Tenant not found' });

    // Ownership check — a tenant with no house/plot (data.tenant.plot_id is
    // null) has nothing to scope against, so only admins can reach them
    // this way; everyone else must have this tenant's plot in their visible
    // set.
    const visible = await getVisiblePlotIds(req.user);
    const isAdmin = visible === 'ALL';
    if (!isAdmin && !(data.tenant.plot_id && visible.includes(data.tenant.plot_id))) {
      return res.status(403).json({ error: 'You do not have access to this tenant.' });
    }

    await logStaffActivity({ userId: req.user.id, action: 'statement_viewed', detail: data.tenant.full_name });

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

    await logStaffActivity({ userId: req.user.id, action: 'bulk_statements_downloaded', detail: `${tenants.rows.length} tenants` });

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

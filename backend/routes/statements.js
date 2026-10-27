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

// GET /api/statements/landlord?month=YYYY-MM[&plot_id=N] — monthly owner
// statement, one section per property: tenant-by-tenant payments, property
// expenses and miscellaneous expenses itemised, agent fee (if the property is
// agent-managed with an agreed %), and the net payable to the owner.
// MUST stay above /:tenantId.
const MISC_CATEGORIES = ['Other', 'Miscellaneous', 'Misc'];

router.get('/landlord', auth, async (req, res) => {
  try {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
    const [yy, mm] = month.split('-').map(Number);
    const start = `${month}-01`;
    const endDate = new Date(Date.UTC(yy, mm, 1)).toISOString().slice(0, 10); // first day of next month

    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && visible.length === 0) return res.status(403).json({ error: 'No properties available.' });
    const plotRes = await pool.query(
      `SELECT p.id, p.name, p.location, p.agent_id, p.agent_fee_percent, u.name AS owner_name, ag.name AS agent_name
       FROM plots p
       LEFT JOIN users u  ON p.user_id  = u.id
       LEFT JOIN users ag ON p.agent_id = ag.id
       WHERE ${visible === 'ALL' ? 'true' : 'p.id = ANY($1)'} ${req.query.plot_id ? `AND p.id = ${parseInt(req.query.plot_id) || 0}` : ''}
       ORDER BY p.name`,
      visible === 'ALL' ? [] : [visible]
    );
    const plots = await filterRowsByPermission(req.user, plotRes.rows, 'reports.revenue_summary', (row) => row.id);
    if (!plots.length) return res.status(403).json({ error: 'You do not have access to financial statements for these properties.' });

    const monthLabel = new Date(yy, mm - 1, 1).toLocaleString('en-KE', { month: 'long', year: 'numeric' });
    const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="owner_statement_${month}.pdf"`);
    doc.pipe(res);

    const L = 50, R = 545, PRIMARY = '#5b21b6', GREY = '#6b7280';
    const kes = (n) => `KES ${Math.round(parseFloat(n || 0)).toLocaleString()}`;
    const num = (n) => Math.round(parseFloat(n || 0)).toLocaleString();
    const fmtDate = (d) => new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' });
    const ensure = (h) => { if (doc.y + h > doc.page.height - 60) { doc.addPage(); doc.y = 50; } };

    const sectionTitle = (text) => {
      ensure(60);
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(12).fillColor(PRIMARY).text(text, L, doc.y);
      doc.moveTo(L, doc.y + 2).lineTo(R, doc.y + 2).strokeColor(PRIMARY).lineWidth(1).stroke();
      doc.moveDown(0.5);
    };
    // cols: [{ label, x, w, align }]
    const tableHead = (cols) => {
      ensure(40);
      const y = doc.y;
      doc.rect(L, y - 2, R - L, 16).fill('#f3f0fb');
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111');
      cols.forEach(c => doc.text(c.label, c.x, y + 1, { width: c.w, align: c.align || 'left', lineBreak: false }));
      doc.y = y + 18;
    };
    const tableRow = (cols, vals, opts = {}) => {
      ensure(18);
      const y = doc.y;
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor('#111');
      cols.forEach((c, i) => doc.text(String(vals[i] ?? ''), c.x, y, { width: c.w, align: c.align || 'left', lineBreak: false, ellipsis: true }));
      doc.y = y + 14;
      if (!opts.noRule) doc.moveTo(L, doc.y - 2).lineTo(R, doc.y - 2).strokeColor('#ececf1').lineWidth(0.5).stroke();
    };
    const kv = (label, value, opts = {}) => {
      ensure(18);
      const y = doc.y;
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 10).fillColor(opts.color || '#111');
      doc.text(label, L + 8, y, { width: 330, lineBreak: false });
      doc.text(value, 380, y, { width: R - 380, align: 'right', lineBreak: false });
      doc.y = y + (opts.size ? opts.size + 6 : 16);
    };

    let first = true;
    for (const plot of plots) {
      if (!first) doc.addPage();
      first = false;

      const [tenantRows, rentPays, utilRows, expRows, houseRes] = await Promise.all([
        pool.query(
          `SELECT t.id, t.full_name, t.move_in_date, t.is_active, h.unit_number, h.rent_amount
           FROM tenants t JOIN houses h ON t.house_id = h.id
           WHERE h.plot_id = $1
             AND (t.is_active = true OR EXISTS (SELECT 1 FROM payments py WHERE py.tenant_id = t.id AND py.payment_date >= $2 AND py.payment_date < $3))
           ORDER BY h.unit_number, t.full_name`, [plot.id, start, endDate]),
        pool.query(
          `SELECT p.tenant_id, p.payment_date, COALESCE(p.method,'other') AS method, SUM(COALESCE(p.amount_allocated, p.amount)) AS total
           FROM payments p JOIN houses h ON p.house_id = h.id
           WHERE h.plot_id = $1 AND p.payment_date >= $2 AND p.payment_date < $3
             AND p.status NOT IN ('failed','pending') AND COALESCE(p.method,'') != 'balance_charge'
           GROUP BY p.tenant_id, p.payment_date, 3 ORDER BY p.payment_date`, [plot.id, start, endDate]),
        pool.query(
          `SELECT tenant_id, utility_type, SUM(amount) AS total FROM utility_payments
           WHERE plot_id = $1 AND payment_date >= $2 AND payment_date < $3 GROUP BY 1, 2`, [plot.id, start, endDate]),
        pool.query(
          `SELECT e.expense_date, COALESCE(e.category,'Uncategorised') AS category, e.description, e.amount, h.unit_number
           FROM expenses e LEFT JOIN houses h ON e.house_id = h.id
           WHERE e.plot_id = $1 AND e.expense_date >= $2 AND e.expense_date < $3 AND COALESCE(e.status,'confirmed') != 'pending'
           ORDER BY e.category, e.expense_date`, [plot.id, start, endDate]),
        pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'occupied') AS occupied FROM houses WHERE plot_id = $1`, [plot.id]),
      ]);

      // Per-tenant figures
      const byTenant = {};
      tenantRows.rows.forEach(t => { byTenant[t.id] = { ...t, paid: 0, util: 0, dates: [], methods: new Set() }; });
      rentPays.rows.forEach(r => {
        const t = byTenant[r.tenant_id]; if (!t) return;
        t.paid += parseFloat(r.total); t.dates.push(fmtDate(r.payment_date)); t.methods.add(r.method);
      });
      utilRows.rows.forEach(u => { const t = byTenant[u.tenant_id]; if (t) t.util += parseFloat(u.total); });
      const activeIds = tenantRows.rows.filter(t => t.is_active).map(t => t.id);
      const maps = await loadPaidMaps(pool, activeIds);
      Object.values(byTenant).forEach(t => {
        t.balance = t.is_active ? computeLedger({ rent: t.rent_amount, moveInDate: t.move_in_date, paidMap: maps[t.id] || {} }).totalOwed : 0;
      });
      const tenants = Object.values(byTenant);

      const collected   = tenants.reduce((a, t) => a + t.paid, 0);
      const utilIn      = tenants.reduce((a, t) => a + t.util, 0);
      const isMisc      = (c) => MISC_CATEGORIES.includes(c) || c === 'Uncategorised';
      const propExp     = expRows.rows.filter(e => !isMisc(e.category));
      const miscExp     = expRows.rows.filter(e => isMisc(e.category));
      const propTotal   = propExp.reduce((a, e) => a + parseFloat(e.amount), 0);
      const miscTotal   = miscExp.reduce((a, e) => a + parseFloat(e.amount), 0);
      const feePct      = plot.agent_id && plot.agent_fee_percent != null ? parseFloat(plot.agent_fee_percent) : null;
      const agentFee    = feePct != null ? collected * feePct / 100 : 0;
      const net         = collected + utilIn - propTotal - miscTotal - agentFee;
      const expected    = tenants.filter(t => t.is_active).reduce((a, t) => a + parseFloat(t.rent_amount || 0), 0);
      const arrears     = tenants.reduce((a, t) => a + t.balance, 0);
      const h           = houseRes.rows[0];

      // ── Header band ──
      doc.rect(0, 0, doc.page.width, 78).fill(PRIMARY);
      doc.font('Helvetica-Bold').fontSize(19).fillColor('#fff').text('Owner Statement', L, 24, { lineBreak: false });
      doc.font('Helvetica').fontSize(10).text(monthLabel, L, 50, { lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(12).text('RentFlow', 380, 26, { width: R - 380, align: 'right', lineBreak: false });
      doc.font('Helvetica').fontSize(8.5).text(`Generated ${new Date().toLocaleDateString('en-KE')}`, 380, 46, { width: R - 380, align: 'right', lineBreak: false });
      doc.y = 96;

      doc.font('Helvetica-Bold').fontSize(15).fillColor('#111').text(plot.name, L, doc.y);
      doc.font('Helvetica').fontSize(9).fillColor(GREY).text(
        [plot.location, plot.owner_name ? `Owner: ${plot.owner_name}` : null,
         plot.agent_id ? `Managed by agent: ${plot.agent_name || '—'}${feePct != null ? ` (${feePct}% fee)` : ''}` : 'Self-managed'].filter(Boolean).join('   ·   '), L, doc.y + 2);
      doc.moveDown(0.8);

      // ── Summary boxes ──
      const boxes = [
        ['Rent collected', kes(collected), '#15803d'],
        ['Total expenses', kes(propTotal + miscTotal + agentFee), '#b91c1c'],
        ['Net to owner', kes(net), PRIMARY],
        ['Collection rate', expected ? `${Math.round((collected / expected) * 100)}%` : '—', '#111'],
      ];
      const bw = (R - L - 30) / 4, by = doc.y;
      boxes.forEach(([label, value, color], i) => {
        const x = L + i * (bw + 10);
        doc.roundedRect(x, by, bw, 42, 5).lineWidth(0.7).strokeColor('#dcdce4').stroke();
        doc.font('Helvetica').fontSize(7.5).fillColor(GREY).text(label, x + 8, by + 8, { width: bw - 16, lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(12.5).fillColor(color).text(value, x + 8, by + 22, { width: bw - 16, lineBreak: false });
      });
      doc.y = by + 52;

      // ── 1. Tenant payments ──
      sectionTitle('1. Tenant payments');
      const tc = [
        { label: 'Unit', x: L + 2, w: 40 }, { label: 'Tenant', x: L + 46, w: 140 },
        { label: 'Rent (KES)', x: 238, w: 55, align: 'right' }, { label: 'Paid (KES)', x: 298, w: 55, align: 'right' },
        { label: 'Utilities', x: 358, w: 50, align: 'right' }, { label: 'Paid on', x: 414, w: 70 }, { label: 'Balance', x: 488, w: 55, align: 'right' },
      ];
      tableHead(tc);
      if (!tenants.length) tableRow(tc, ['', 'No tenants for this property.', '', '', '', '', ''], { noRule: true });
      tenants.forEach(t => tableRow(tc, [
        t.unit_number || '—', t.full_name + (t.is_active ? '' : ' (moved out)'), num(t.rent_amount), t.paid ? num(t.paid) : '—',
        t.util ? num(t.util) : '—', t.dates.length ? [...new Set(t.dates)].slice(0, 2).join(', ') : '—', t.balance ? num(t.balance) : '0',
      ]));
      tableRow(tc, ['', 'Total', num(expected), num(collected), num(utilIn), '', num(arrears)], { bold: true, noRule: true });

      // ── 2. Property expenses ──
      sectionTitle('2. Property expenses paid');
      const ec = [
        { label: 'Date', x: L + 2, w: 45 }, { label: 'Category', x: L + 52, w: 95 },
        { label: 'Description', x: 202, w: 235 }, { label: 'Amount (KES)', x: 440, w: 100, align: 'right' },
      ];
      const expTable = (rows, emptyText) => {
        tableHead(ec);
        if (!rows.length) tableRow(ec, ['', '', emptyText, ''], { noRule: true });
        rows.forEach(e => tableRow(ec, [fmtDate(e.expense_date), e.category, `${e.description || '—'}${e.unit_number ? ` (Unit ${e.unit_number})` : ''}`, num(e.amount)]));
      };
      expTable(propExp, 'No property expenses this month.');
      tableRow(ec, ['', '', 'Subtotal — property expenses', num(propTotal)], { bold: true, noRule: true });

      // ── 3. Miscellaneous expenses ──
      sectionTitle('3. Miscellaneous expenses');
      expTable(miscExp, 'No miscellaneous expenses this month.');
      tableRow(ec, ['', '', 'Subtotal — miscellaneous', num(miscTotal)], { bold: true, noRule: true });

      // ── 4. Agent fee (agent-managed properties only) ──
      if (plot.agent_id) {
        sectionTitle('4. Agent fee');
        if (feePct != null) {
          kv(`${plot.agent_name || 'Agent'} — ${feePct}% of rent collected (${kes(collected)})`, kes(agentFee), { bold: true });
        } else {
          doc.font('Helvetica-Oblique').fontSize(9).fillColor(GREY).text('This property is agent-managed but no fee percentage has been set, so no agent fee is deducted. Set it under Properties > Edit.', L + 8, doc.y);
          doc.moveDown(0.5);
        }
      }

      // ── Settlement ──
      ensure(140);
      sectionTitle('Statement summary');
      kv('Rent collected', kes(collected));
      if (utilIn > 0) kv('Utilities recovered from tenants', kes(utilIn));
      kv('Less: property expenses', `- ${kes(propTotal)}`);
      kv('Less: miscellaneous expenses', `- ${kes(miscTotal)}`);
      if (plot.agent_id) kv(`Less: agent fee${feePct != null ? ` (${feePct}%)` : ''}`, `- ${kes(agentFee)}`);
      doc.moveTo(L + 8, doc.y).lineTo(R, doc.y).strokeColor('#999').lineWidth(0.8).stroke();
      doc.y += 4;
      kv('NET PAYABLE TO OWNER', kes(net), { bold: true, size: 12, color: net >= 0 ? '#15803d' : '#b91c1c' });
      doc.moveDown(0.4);
      doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text(
        `Occupancy: ${h.occupied} of ${h.total} units${parseInt(h.total) ? ` (${Math.round((h.occupied / h.total) * 100)}%)` : ''}   ·   Outstanding arrears today: ${kes(arrears)}`, L + 8, doc.y);
    }

    // Page footers
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.page.margins.bottom = 0; // otherwise writing in the footer zone makes pdfkit add a blank page
      doc.font('Helvetica').fontSize(8).fillColor('#9ca3af');
      doc.text(`RentFlow - Owner Statement - ${monthLabel}`, L, doc.page.height - 36, { width: 300, lineBreak: false });
      doc.text(`Page ${i + 1} of ${range.count}`, 380, doc.page.height - 36, { width: R - 380, align: 'right', lineBreak: false });
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

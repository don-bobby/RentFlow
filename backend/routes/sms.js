const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
// Previously this file used its own `auth()` helper, which only checked for
// a valid JWT — it never checked WHICH role the token belonged to. That let
// a tenant's own login send arbitrary SMS (at the landlord's cost), trigger
// a system-wide rent-reminder blast to every tenant (not just their own
// unit), and read the full SMS history of every landlord's tenants. Staff
// middleware/auth.js hard-rejects tenant tokens, same as every other
// staff-only route in this project — using it here closes that off.
const { authMiddleware: auth } = require('../middleware/auth');
const { getVisiblePlotIds } = require('../middleware/scope');

function requireAdmin(req, res, next) {
  if (!['admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  next();
}

// SMS is an admin/agent-only feature — landlords and caretakers no longer
// get any access to it (they previously could, since `auth` alone only
// checked for a valid staff token, not which staff role). The tenant portal
// never touches this file at all; tenant SMS (OTP delivery, PIN-reset codes)
// is sent directly from auth.js, not through here.
function requireAdminOrAgent(req, res, next) {
  if (!['admin', 'super_admin', 'agent'].includes(req.user.role)) {
    return res.status(403).json({ error: 'SMS access is limited to admin and agent accounts.' });
  }
  next();
}

function getAT() {
  const AT = require('africastalking')({ apiKey: process.env.AT_API_KEY, username: process.env.AT_USERNAME });
  return AT.SMS;
}

// `extra` is new and optional — {batch_id, tenant_id, landlord_id,
// recipient_type}, all used only by the bulk-send routes below to tag which
// batch and recipient a log row belongs to. The single free-form send and
// the arrears-reminder blast don't pass it, so their log rows keep getting
// NULL in those columns exactly as before — this is a pure addition, not a
// behavior change for either of those two existing routes.
async function sendSMS(to_phone, message, extra = {}) {
  const formatted = to_phone.startsWith('0') ? `+254${to_phone.slice(1)}` : to_phone.startsWith('254') ? `+${to_phone}` : to_phone;
  const sms = getAT();
  // Africa's Talking's SANDBOX environment rejects any custom alphanumeric
  // 'from' value (it only works with a registered sender ID on a LIVE app)
  // — sandbox requires 'from' to be omitted entirely so AT uses its own
  // shared test shortcode. Previously this always sent a 'from' (falling
  // back to 'RENTFLOW' even with no AT_SENDER_ID set), which the sandbox
  // always rejected as InvalidSenderId. Now 'from' is only included when
  // AT_SENDER_ID is actually configured (i.e. once you're on a live app
  // with an approved sender ID).
  const payload = { to: [formatted], message };
  if (process.env.AT_SENDER_ID) payload.from = process.env.AT_SENDER_ID;
  await sms.send(payload);
  await pool.query(
    `INSERT INTO sms_logs (to_phone, message, status, batch_id, tenant_id, landlord_id, recipient_type)
     VALUES ($1, $2, 'sent', $3, $4, $5, $6)`,
    [formatted, message, extra.batch_id || null, extra.tenant_id || null, extra.landlord_id || null, extra.recipient_type || null]
  );
}

// POST /api/sms/send — free-form message to any phone number (a tenant's or
// a landlord's). Admin/agent only.
router.post('/send', auth, requireAdminOrAgent, async (req, res) => {
  const { to_phone, message } = req.body;
  if (!to_phone || !message) return res.status(400).json({ error: 'to_phone and message are required.' });
  try {
    await sendSMS(to_phone, message);
    res.json({ success: true, message: 'SMS sent successfully.' });
  } catch (err) {
    await pool.query(`INSERT INTO sms_logs (to_phone, message, status) VALUES ($1, $2, 'failed')`, [to_phone, message]).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sms/send-reminders — send to all tenants with arrears.
// Admin/agent only, same as every other route in this file now. An agent's
// getVisiblePlotIds already limits this to their own landlords' tenants;
// admin's resolves to 'ALL'. Landlords and caretakers no longer reach this
// route at all.
router.post('/send-reminders', auth, requireAdminOrAgent, async (req, res) => {
  try {
    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && visible.length === 0) {
      return res.json({ success: true, results: { sent: 0, failed: 0, skipped: 0 } });
    }
    const scopeFilter = visible === 'ALL' ? '' : 'AND p.id = ANY($1)';
    const scopeParams = visible === 'ALL' ? [] : [visible];
    const tenants = await pool.query(
      `SELECT t.id, t.full_name, t.phone, t.move_in_date, h.rent_amount, h.unit_number, p.name AS plot_name
       FROM tenants t LEFT JOIN houses h ON t.house_id=h.id LEFT JOIN plots p ON h.plot_id=p.id
       WHERE t.is_active=true AND t.move_in_date IS NOT NULL AND t.phone IS NOT NULL ${scopeFilter}`,
      scopeParams
    );
    const payments = await pool.query(
      `SELECT tenant_id,
              COALESCE(for_year, EXTRACT(YEAR FROM payment_date)::int) AS year,
              COALESCE(for_month, EXTRACT(MONTH FROM payment_date)::int) AS month,
              COALESCE(SUM(amount_allocated), SUM(amount)) AS total_paid
       FROM payments WHERE status != 'pending' GROUP BY tenant_id, year, month`
    );
    const paidMap = {};
    for (const p of payments.rows) paidMap[`${p.tenant_id}-${p.year}-${p.month}`] = parseFloat(p.total_paid);

    const now = new Date();
    const results = { sent: 0, failed: 0, skipped: 0 };

    for (const tenant of tenants.rows) {
      if (!tenant.phone) { results.skipped++; continue; }
      const moveIn = new Date(tenant.move_in_date);
      let y = moveIn.getDate() === 1 ? moveIn.getFullYear() : (moveIn.getMonth() === 11 ? moveIn.getFullYear() + 1 : moveIn.getFullYear());
      let m = moveIn.getDate() === 1 ? moveIn.getMonth() + 1 : (moveIn.getMonth() === 11 ? 1 : moveIn.getMonth() + 2);
      const unpaid = [];
      while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
        const balance = parseFloat(tenant.rent_amount) - (paidMap[`${tenant.id}-${y}-${m}`] || 0);
        if (balance > 0) unpaid.push({ label: new Date(y, m - 1, 1).toLocaleString('en-KE', { month: 'long', year: 'numeric' }), balance });
        m++; if (m > 12) { m = 1; y++; }
      }
      if (unpaid.length === 0) { results.skipped++; continue; }
      const totalOwed  = unpaid.reduce((s, m) => s + m.balance, 0);
      const monthsList = unpaid.map(m => `${m.label} (KES ${m.balance.toLocaleString()})`).join(', ');
      const message    = `Dear ${tenant.full_name}, you have unpaid rent of KES ${totalOwed.toLocaleString()} for: ${monthsList}. Unit ${tenant.unit_number}, ${tenant.plot_name}. Please pay promptly. - RentFlow`;
      try {
        await sendSMS(tenant.phone, message);
        results.sent++;
        await new Promise(r => setTimeout(r, 200));
      } catch (e) { console.error(`SMS failed for ${tenant.full_name}:`, e.message); results.failed++; }
    }
    res.json({ success: true, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/sms/logs — admin-only for now. sms_logs has no plot_id or
// tenant_id column, so there's no way to scope these rows to "the
// requester's properties" the way every other list route does — without
// that link, any non-admin role would see every landlord's tenant phone
// numbers and message content. Restricting to admin/super_admin until the
// schema can tie a log row back to a tenant/plot.
router.get('/logs', auth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM sms_logs ORDER BY sent_at DESC LIMIT 100`);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────
// Bulk SMS — send one message to many recipients at once, with a per-batch
// delivered/undelivered report. Admin-only (stricter than the admin+agent
// gate on the rest of this file) since a bulk send can reach a lot of phone
// numbers — and cost — in one action.
// ─────────────────────────────────────────────────────────────────────────

const BULK_SCOPES = ['all_tenants', 'property', 'arrears', 'landlords', 'manual'];

// Fills in {tenant_name}, {balance}, {unit_number}, {plot_name} from a
// resolved recipient. {balance} has no meaning for a landlord/agent
// recipient (they don't have a rent balance), so it renders as an empty
// string rather than guessing a number.
function renderTemplate(template, r) {
  return template
    .replace(/\{tenant_name\}/g, r.name || '')
    .replace(/\{balance\}/g, r.balance != null ? `KES ${Math.round(r.balance).toLocaleString()}` : '')
    .replace(/\{unit_number\}/g, r.unit_number || '')
    .replace(/\{plot_name\}/g, r.plot_name || '');
}

// Computes each tenant's current rent balance the same way GET /unpaid-months
// (tenants.js) and send-reminders (above) already do — oldest-month-first,
// excluding 'failed' payments — so the {balance} placeholder always matches
// what the tenant sees elsewhere in the app. Takes the already-fetched tenant
// rows (with rent_amount/move_in_date) and does the two-query, in-memory
// calculation rather than one query per tenant.
async function attachBalances(tenantRows) {
  if (tenantRows.length === 0) return [];
  const ids = tenantRows.map(t => t.id);
  const payments = await pool.query(
    `SELECT tenant_id,
            COALESCE(for_year,  EXTRACT(YEAR  FROM payment_date)::int) AS year,
            COALESCE(for_month, EXTRACT(MONTH FROM payment_date)::int) AS month,
            SUM(COALESCE(amount_allocated, amount)) AS total_paid
     FROM payments
     WHERE tenant_id = ANY($1) AND status != 'failed' AND method != 'balance_charge'
     GROUP BY tenant_id, year, month`,
    [ids]
  );
  const paidMap = {};
  for (const p of payments.rows) paidMap[`${p.tenant_id}-${p.year}-${p.month}`] = parseFloat(p.total_paid || 0);

  const now = new Date();
  return tenantRows.map(t => {
    const rent = parseFloat(t.rent_amount || 0);
    if (!t.move_in_date || rent <= 0) return { ...t, balance: 0 };
    const moveIn = new Date(t.move_in_date);
    let y = moveIn.getDate() === 1 ? moveIn.getFullYear() : (moveIn.getMonth() === 11 ? moveIn.getFullYear() + 1 : moveIn.getFullYear());
    let m = moveIn.getDate() === 1 ? moveIn.getMonth() + 1 : (moveIn.getMonth() === 11 ? 1 : moveIn.getMonth() + 2);
    let balance = 0;
    while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
      balance += rent - (paidMap[`${t.id}-${y}-${m}`] || 0);
      m++; if (m > 12) { m = 1; y++; }
    }
    return { ...t, balance: Math.max(0, balance) };
  });
}

// Resolves a scope + options into the actual list of recipients, re-read
// fresh from the database every time (never trusting a client-cached list
// from a prior /bulk/preview call) — the manual scope's tenant_ids/user_ids
// are themselves the only client input that selects WHO, but their
// name/phone/balance are still always looked up here, never taken from the
// request body.
async function resolveRecipients(scope, { plot_id, tenant_ids, user_ids } = {}) {
  if (scope === 'manual') {
    const recipients = [];
    if (tenant_ids?.length) {
      const t = await pool.query(
        `SELECT t.id, t.full_name, t.phone, t.move_in_date, h.rent_amount, h.unit_number, p.name AS plot_name
         FROM tenants t LEFT JOIN houses h ON t.house_id=h.id LEFT JOIN plots p ON h.plot_id=p.id
         WHERE t.id = ANY($1) AND t.phone IS NOT NULL`,
        [tenant_ids]
      );
      const withBalance = await attachBalances(t.rows);
      for (const row of withBalance) {
        recipients.push({ id: row.id, type: 'tenant', name: row.full_name, phone: row.phone, balance: row.balance, unit_number: row.unit_number, plot_name: row.plot_name });
      }
    }
    if (user_ids?.length) {
      const u = await pool.query(
        `SELECT id, name, phone, role FROM users WHERE id = ANY($1) AND phone IS NOT NULL AND role IN ('landlord', 'agent')`,
        [user_ids]
      );
      for (const row of u.rows) recipients.push({ id: row.id, type: row.role, name: row.name, phone: row.phone, balance: null });
    }
    return recipients;
  }

  if (scope === 'landlords') {
    const u = await pool.query(
      `SELECT id, name, phone, role FROM users WHERE role IN ('landlord', 'agent') AND phone IS NOT NULL AND is_approved = true`
    );
    return u.rows.map(row => ({ id: row.id, type: row.role, name: row.name, phone: row.phone, balance: null }));
  }

  // all_tenants / property / arrears all start from the same tenant query
  const plotFilter = scope === 'property' ? 'AND p.id = $1' : '';
  const params = scope === 'property' ? [plot_id] : [];
  const t = await pool.query(
    `SELECT t.id, t.full_name, t.phone, t.move_in_date, h.rent_amount, h.unit_number, p.name AS plot_name
     FROM tenants t LEFT JOIN houses h ON t.house_id=h.id LEFT JOIN plots p ON h.plot_id=p.id
     WHERE t.is_active = true AND t.phone IS NOT NULL ${plotFilter}`,
    params
  );
  const withBalance = await attachBalances(t.rows);
  const filtered = scope === 'arrears' ? withBalance.filter(row => row.balance > 0) : withBalance;
  return filtered.map(row => ({ id: row.id, type: 'tenant', name: row.full_name, phone: row.phone, balance: row.balance, unit_number: row.unit_number, plot_name: row.plot_name }));
}

function validateBulkBody(body) {
  const { scope, plot_id, tenant_ids, user_ids } = body;
  if (!BULK_SCOPES.includes(scope)) return `scope must be one of: ${BULK_SCOPES.join(', ')}`;
  if (scope === 'property' && !plot_id) return 'plot_id is required for the "property" scope.';
  if (scope === 'manual' && !tenant_ids?.length && !user_ids?.length) return 'Pick at least one recipient for a manual send.';
  return null;
}

// POST /api/sms/bulk/preview — resolves recipients and shows a sample
// rendered message (using the first match), without sending anything or
// creating a batch row. Lets the admin see the real count and check the
// placeholders look right before committing.
router.post('/bulk/preview', auth, requireAdmin, async (req, res) => {
  const validationError = validateBulkBody(req.body);
  if (validationError) return res.status(400).json({ error: validationError });
  const { scope, plot_id, tenant_ids, user_ids, message_template } = req.body;
  try {
    const recipients = await resolveRecipients(scope, { plot_id, tenant_ids, user_ids });
    const sample = recipients.length > 0 && message_template ? renderTemplate(message_template, recipients[0]) : null;
    res.json({
      success: true,
      data: {
        count: recipients.length,
        sample_message: sample,
        recipients: recipients.slice(0, 50).map(r => ({ id: r.id, type: r.type, name: r.name, phone: r.phone, balance: r.balance })),
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/sms/bulk/send — re-resolves recipients fresh, creates the batch
// row, then sends one by one (same 200ms spacing as send-reminders), logging
// each attempt against the batch.
router.post('/bulk/send', auth, requireAdmin, async (req, res) => {
  const validationError = validateBulkBody(req.body);
  if (validationError) return res.status(400).json({ error: validationError });
  const { scope, plot_id, tenant_ids, user_ids, message_template } = req.body;
  if (!message_template || !message_template.trim()) return res.status(400).json({ error: 'message_template is required.' });

  try {
    const recipients = await resolveRecipients(scope, { plot_id, tenant_ids, user_ids });
    if (recipients.length === 0) return res.status(400).json({ error: 'No recipients matched this selection.' });

    const batch = await pool.query(
      `INSERT INTO sms_batches (created_by, message_template, scope, scope_plot_id, total_count)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.user.id, message_template, scope, scope === 'property' ? plot_id : null, recipients.length]
    );
    const batchId = batch.rows[0].id;

    let sent = 0, failed = 0;
    for (const r of recipients) {
      const rendered = renderTemplate(message_template, r);
      const isLandlord = r.type === 'landlord' || r.type === 'agent';
      try {
        await sendSMS(r.phone, rendered, {
          batch_id: batchId,
          tenant_id: r.type === 'tenant' ? r.id : null,
          landlord_id: isLandlord ? r.id : null,
          recipient_type: r.type,
        });
        sent++;
      } catch (e) {
        failed++;
        await pool.query(
          `INSERT INTO sms_logs (to_phone, message, status, batch_id, tenant_id, landlord_id, recipient_type)
           VALUES ($1, $2, 'failed', $3, $4, $5, $6)`,
          [r.phone, rendered, batchId, r.type === 'tenant' ? r.id : null, isLandlord ? r.id : null, r.type]
        ).catch(() => {});
        console.error(`Bulk SMS failed for ${r.name}:`, e.message);
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    await pool.query(`UPDATE sms_batches SET sent_count=$1, failed_count=$2 WHERE id=$3`, [sent, failed, batchId]);
    res.json({ success: true, data: { batchId, total: recipients.length, sent, failed } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/sms/bulk — list past batches, most recent first.
router.get('/bulk', auth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*, u.name AS created_by_name
       FROM sms_batches b LEFT JOIN users u ON b.created_by = u.id
       ORDER BY b.created_at DESC LIMIT 100`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/sms/bulk/:id — one batch's full delivered/undelivered report.
// "Delivered" here means Africa's Talking accepted the send request, not a
// confirmed handset delivery receipt — that would need a separate DLR
// webhook integration, which wasn't part of this round.
router.get('/bulk/:id', auth, requireAdmin, async (req, res) => {
  try {
    const batch = await pool.query('SELECT * FROM sms_batches WHERE id = $1', [req.params.id]);
    if (batch.rows.length === 0) return res.status(404).json({ error: 'Batch not found' });
    const logs = await pool.query(
      `SELECT l.id, l.to_phone, l.message, l.status, l.sent_at, l.recipient_type,
              COALESCE(t.full_name, u.name) AS recipient_name
       FROM sms_logs l
       LEFT JOIN tenants t ON l.tenant_id = t.id
       LEFT JOIN users u ON l.landlord_id = u.id
       WHERE l.batch_id = $1
       ORDER BY l.id`,
      [req.params.id]
    );
    res.json({ success: true, data: { batch: batch.rows[0], logs: logs.rows } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = { router, sendSMS };

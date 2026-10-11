const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const jwt     = require('jsonwebtoken');

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

function getAT() {
  const AT = require('africastalking')({ apiKey: process.env.AT_API_KEY, username: process.env.AT_USERNAME });
  return AT.SMS;
}

async function sendSMS(to_phone, message) {
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
  await pool.query(`INSERT INTO sms_logs (to_phone, message, status) VALUES ($1, $2, 'sent')`, [formatted, message]);
}

// POST /api/sms/send
router.post('/send', auth, async (req, res) => {
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

// POST /api/sms/send-reminders — send to all tenants with arrears
router.post('/send-reminders', auth, async (req, res) => {
  try {
    const tenants = await pool.query(
      `SELECT t.id, t.full_name, t.phone, t.move_in_date, h.rent_amount, h.unit_number, p.name AS plot_name
       FROM tenants t LEFT JOIN houses h ON t.house_id=h.id LEFT JOIN plots p ON h.plot_id=p.id
       WHERE t.is_active=true AND t.move_in_date IS NOT NULL AND t.phone IS NOT NULL`
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

// GET /api/sms/logs
router.get('/logs', auth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM sms_logs ORDER BY sent_at DESC LIMIT 100`);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = { router, sendSMS };

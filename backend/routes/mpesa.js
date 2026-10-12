const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const jwt     = require('jsonwebtoken');
const axios   = require('axios');
const { authMiddleware: staffAuth } = require('../middleware/auth');
const { getVisiblePlotIds } = require('../middleware/scope');
const { requirePermission } = require('../middleware/permissions');

// Shared by BOTH the tenant portal (paying their own rent) and staff
// (recording/checking a payment on a tenant's behalf), so this can't use
// the strict staff-only middleware/auth.js, which hard-rejects tenant
// tokens. This just proves "who is asking" — same as the old auth() did —
// and the route handlers below add the actual authorization on top of it.
function payerAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

async function getMpesaToken() {
  const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const res  = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', { headers: { Authorization: `Basic ${auth}` } });
  return res.data.access_token;
}

// POST /api/mpesa/stk-push — used by both the tenant portal (paying their
// own rent) and staff (recording a payment on a tenant's behalf)
router.post('/stk-push', payerAuth, async (req, res) => {
  let { tenant_id, phone, amount } = req.body;
  if (!phone || !amount) return res.status(400).json({ error: 'phone and amount are required.' });

  if (req.user.role === 'tenant') {
    // A tenant can only ever pay for themselves — ignore whatever tenant_id
    // the client sent and use their own token's id instead.
    tenant_id = req.user.id;
  } else if (req.user.role !== 'admin') {
    // Staff (agent/landlord/caretaker) initiating on a tenant's behalf must
    // be scoped to that tenant's plot.
    if (!tenant_id) return res.status(400).json({ error: 'tenant_id is required.' });
    const visible = await getVisiblePlotIds(req.user);
    const tenantRow = await pool.query(
      `SELECT h.plot_id FROM tenants t LEFT JOIN houses h ON t.house_id = h.id WHERE t.id = $1`,
      [tenant_id]
    );
    const plotId = tenantRow.rows[0]?.plot_id;
    const allowed = visible === 'ALL' || (plotId != null && visible.includes(plotId));
    if (!allowed) return res.status(403).json({ error: 'You are not authorized to initiate a payment for this tenant.' });
  }

  try {
    const token     = await getMpesaToken();
    const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
    const password  = Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');
    const formatted = phone.startsWith('0') ? `254${phone.slice(1)}` : phone.startsWith('+') ? phone.slice(1) : phone;

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password:          password,
        Timestamp:         timestamp,
        TransactionType:   'CustomerPayBillOnline',
        Amount:            Math.ceil(parseFloat(amount)),
        PartyA:            formatted,
        PartyB:            process.env.MPESA_SHORTCODE,
        PhoneNumber:       formatted,
        CallBackURL:       process.env.MPESA_CALLBACK_URL,
        AccountReference:  `RentFlow-${tenant_id || 'Tenant'}`,
        TransactionDesc:   'Rent Payment',
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    // Auto-expire any orphaned pending rows older than 3 minutes (missed callbacks)
    await pool.query(
      `UPDATE payments SET status='failed', notes='STK push timed out — no callback received'
       WHERE status='pending' AND payment_date < NOW() - INTERVAL '3 minutes'`
    ).catch(() => {});

    if (tenant_id && response.data.CheckoutRequestID) {
      await pool.query(
        `INSERT INTO payments (tenant_id, transaction_id, amount, phone, payment_date, method, status)
         VALUES ($1, $2, $3, $4, NOW(), 'mpesa', 'pending')
         ON CONFLICT (transaction_id) DO NOTHING`,
        [tenant_id, response.data.CheckoutRequestID, amount, formatted]
      );
    }

    res.json({ success: true, data: response.data });
  } catch (err) {
    // TEMPORARY DIAGNOSTIC — the plain console.error below can render as a
    // single collapsed line in Railway's log viewer when the second
    // argument is an object, hiding the actual Safaricom error payload.
    // JSON.stringify forces it into visible text. Remove once the STK
    // push 400 is diagnosed and fixed.
    console.log('[DIAG] STK Push failing URL:', err.config?.url);
    console.log('[DIAG] STK Push error status:', err.response?.status);
    console.log('[DIAG] STK Push error headers:', JSON.stringify(err.response?.headers));
    console.log('[DIAG] STK Push error data:', JSON.stringify(err.response?.data));
    console.log('[DIAG] STK Push error data type:', typeof err.response?.data, 'raw:', err.response?.data);
    console.log('[DIAG] STK Push error message:', err.message);
    console.log('[DIAG] MPESA_CONSUMER_KEY set:', !!process.env.MPESA_CONSUMER_KEY, 'length:', process.env.MPESA_CONSUMER_KEY?.length);
    console.log('[DIAG] MPESA_CONSUMER_SECRET set:', !!process.env.MPESA_CONSUMER_SECRET, 'length:', process.env.MPESA_CONSUMER_SECRET?.length);
    console.log('[DIAG] MPESA_SHORTCODE:', JSON.stringify(process.env.MPESA_SHORTCODE));
    console.log('[DIAG] MPESA_PASSKEY set:', !!process.env.MPESA_PASSKEY, 'length:', process.env.MPESA_PASSKEY?.length);
    console.error('STK Push error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.errorMessage || err.message });
  }
});

// POST /api/mpesa/callback
router.post('/callback', async (req, res) => {
  const callback = req.body?.Body?.stkCallback;
  if (!callback) return res.status(400).json({ success: false });
  const { ResultCode, ResultDesc, CallbackMetadata, CheckoutRequestID } = callback;

  if (ResultCode !== 0) {
    await pool.query(
      `UPDATE payments SET status='failed', notes=$2 WHERE transaction_id=$1 AND status='pending'`,
      [CheckoutRequestID, ResultDesc]
    ).catch(() => {});
    return res.status(200).json({ success: false, message: ResultDesc });
  }

  const meta = {};
  CallbackMetadata?.Item?.forEach(item => { meta[item.Name] = item.Value; });
  const transaction_id = meta['MpesaReceiptNumber'];
  const amount         = meta['Amount'];
  const phone          = String(meta['PhoneNumber'] || '');
  const payment_date   = meta['TransactionDate']
    ? new Date(String(meta['TransactionDate']).replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6'))
    : new Date();

  try {
    const tenantRes = await pool.query(
      `SELECT t.id, t.house_id, t.move_in_date, h.rent_amount
       FROM tenants t LEFT JOIN houses h ON t.house_id = h.id
       WHERE t.phone = $1 AND t.is_active = true LIMIT 1`,
      [phone]
    );
    const tenant  = tenantRes.rows[0];
    const matched = !!tenant;

    if (matched && tenant.rent_amount && tenant.move_in_date) {
      const paidRes = await pool.query(
        `SELECT COALESCE(for_year, EXTRACT(YEAR FROM payment_date)::int) AS year,
                COALESCE(for_month, EXTRACT(MONTH FROM payment_date)::int) AS month,
                COALESCE(SUM(amount_allocated), SUM(amount)) AS total_paid
         FROM payments WHERE tenant_id=$1 AND status != 'pending' GROUP BY year, month`,
        [tenant.id]
      );
      const paidMap = {};
      for (const p of paidRes.rows) paidMap[`${p.year}-${p.month}`] = parseFloat(p.total_paid);

      const moveIn = new Date(tenant.move_in_date);
      let y = moveIn.getDate() === 1 ? moveIn.getFullYear() : (moveIn.getMonth() === 11 ? moveIn.getFullYear() + 1 : moveIn.getFullYear());
      let m = moveIn.getDate() === 1 ? moveIn.getMonth() + 1 : (moveIn.getMonth() === 11 ? 1 : moveIn.getMonth() + 2);
      const now = new Date();
      const unpaid = [];
      while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
        const balance = parseFloat(tenant.rent_amount) - (paidMap[`${y}-${m}`] || 0);
        if (balance > 0) unpaid.push({ year: y, month: m, balance });
        m++; if (m > 12) { m = 1; y++; }
      }

      let remaining = parseFloat(amount);
      for (const month of unpaid) {
        if (remaining <= 0) break;
        const allocate = Math.min(remaining, month.balance);
        await pool.query(
          `INSERT INTO payments (tenant_id, house_id, transaction_id, amount, amount_allocated, phone, payment_date, method, status, match_score, receipt_no, for_year, for_month)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'mpesa','matched',90,$8,$9,$10)
           ON CONFLICT (transaction_id) DO UPDATE SET status='matched', amount_allocated=$5, for_year=$9, for_month=$10, receipt_no=$8`,
          [tenant.id, tenant.house_id, transaction_id, allocate, allocate, phone, payment_date, transaction_id, month.year, month.month]
        );
        remaining -= allocate;
      }
    } else {
      await pool.query(
        `INSERT INTO payments (transaction_id, amount, phone, payment_date, method, status, match_score, receipt_no)
         VALUES ($1,$2,$3,$4,'mpesa','unmatched',0,$5) ON CONFLICT (transaction_id) DO NOTHING`,
        [transaction_id, amount, phone, payment_date, transaction_id]
      );
    }

    // Remove the pending placeholder — the real matched rows above are the source of truth
    // The stk-status endpoint detects success by finding a matched row for this tenant+amount
    await pool.query(`DELETE FROM payments WHERE transaction_id=$1 AND status='pending'`, [CheckoutRequestID]).catch(() => {});
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Callback error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/mpesa/stk-status/:checkoutId
// Polled by both tenant portal and admin payments to check STK push result.
// Logic:
//   - pending row exists but < 3 min old     → still waiting
//   - pending row exists but >= 3 min old     → expired, mark failed
//   - failed row exists with this checkoutId  → payment failed
//   - row is gone (deleted on success)        → payment matched successfully
router.get('/stk-status/:checkoutId', payerAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT status, notes, payment_date FROM payments WHERE transaction_id = $1 LIMIT 1`,
      [req.params.checkoutId]
    );
    if (!result.rows[0]) {
      // Row was deleted — callback confirmed success
      return res.json({ status: 'matched' });
    }
    let { status, notes, payment_date } = result.rows[0];

    // Auto-expire pending rows older than 3 minutes (Safaricom STK times out in 120s)
    if (status === 'pending') {
      const ageMs = Date.now() - new Date(payment_date).getTime();
      if (ageMs > 3 * 60 * 1000) {
        await pool.query(
          `UPDATE payments SET status='failed', notes='STK push timed out — no callback received'
           WHERE transaction_id=$1 AND status='pending'`,
          [req.params.checkoutId]
        ).catch(() => {});
        status = 'failed';
        notes  = 'STK push timed out — no callback received';
      }
    }

    res.json({ status, reason: notes || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/mpesa/expire-pending
// Called on page load to auto-expire any pending STK rows older than 3 minutes
router.post('/expire-pending', staffAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE payments SET status='failed', notes='STK push timed out — no callback received'
       WHERE status='pending' AND payment_date < NOW() - INTERVAL '3 minutes'
       RETURNING id`
    );
    res.json({ expired: result.rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/mpesa/unmatched
router.get('/unmatched', staffAuth, requirePermission('payments.reconcile_mpesa'), async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM payments WHERE status IN ('unmatched','review') ORDER BY payment_date DESC`);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/mpesa/:id/match — scoped: you can only match a stray payment to
// a tenant/house that's actually yours (or your assigned landlords', for an
// agent). Previously this had no check at all.
router.patch('/:id/match', staffAuth, requirePermission('payments.reconcile_mpesa'), async (req, res) => {
  const { tenant_id, house_id } = req.body;
  if (!tenant_id || !house_id) return res.status(400).json({ error: 'tenant_id and house_id are required.' });
  try {
    if (req.user.role !== 'admin') {
      const visible = await getVisiblePlotIds(req.user);
      const houseRow = await pool.query('SELECT plot_id FROM houses WHERE id = $1', [house_id]);
      const plotId = houseRow.rows[0]?.plot_id;
      const allowed = visible === 'ALL' || (plotId != null && visible.includes(plotId));
      if (!allowed) return res.status(403).json({ error: 'You do not have access to this unit.' });
    }
    const result = await pool.query(
      `UPDATE payments SET tenant_id=$1, house_id=$2, status='matched', match_score=100 WHERE id=$3 RETURNING *`,
      [tenant_id, house_id, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Payment not found.' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

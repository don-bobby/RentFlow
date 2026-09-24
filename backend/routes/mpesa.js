const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const jwt     = require('jsonwebtoken');
const axios   = require('axios');

function auth(req, res, next) {
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

// POST /api/mpesa/stk-push
router.post('/stk-push', auth, async (req, res) => {
  const { tenant_id, phone, amount } = req.body;
  if (!phone || !amount) return res.status(400).json({ error: 'phone and amount are required.' });
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
router.get('/stk-status/:checkoutId', auth, async (req, res) => {
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
router.post('/expire-pending', auth, async (req, res) => {
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
router.get('/unmatched', auth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM payments WHERE status IN ('unmatched','review') ORDER BY payment_date DESC`);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/mpesa/:id/match
router.patch('/:id/match', auth, async (req, res) => {
  const { tenant_id, house_id } = req.body;
  if (!tenant_id || !house_id) return res.status(400).json({ error: 'tenant_id and house_id are required.' });
  try {
    const result = await pool.query(
      `UPDATE payments SET tenant_id=$1, house_id=$2, status='matched', match_score=100 WHERE id=$3 RETURNING *`,
      [tenant_id, house_id, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Payment not found.' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

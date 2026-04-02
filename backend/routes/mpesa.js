const express = require('express');
const router = express.Router();
const pool = require('../database/db');

/**
 * POST /api/mpesa/callback
 * Receives M-Pesa payment callback (from Safaricom Daraja API)
 * Stores the transaction and attempts to auto-match it to a tenant
 */
router.post('/callback', async (req, res) => {
  const callback = req.body?.Body?.stkCallback;

  if (!callback) {
    return res.status(400).json({ success: false, message: 'Invalid callback payload.' });
  }

  const { ResultCode, ResultDesc, CallbackMetadata } = callback;

  // Only process successful transactions (ResultCode 0 = success)
  if (ResultCode !== 0) {
    console.log(`M-Pesa callback failed: ${ResultDesc}`);
    return res.status(200).json({ success: false, message: ResultDesc });
  }

  // Extract metadata fields
  const meta = {};
  CallbackMetadata?.Item?.forEach(item => {
    meta[item.Name] = item.Value;
  });

  const transaction_id = meta['MpesaReceiptNumber'];
  const amount         = meta['Amount'];
  const phone          = String(meta['PhoneNumber'] || '');
  const payment_date   = meta['TransactionDate']
    ? new Date(String(meta['TransactionDate']).replace(
        /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/,
        '$1-$2-$3T$4:$5:$6'
      ))
    : new Date();

  try {
    // Try to find a matching tenant by phone number
    const tenantResult = await pool.query(
      `SELECT id, house_id FROM tenants WHERE phone = $1 AND is_active = true LIMIT 1`,
      [phone]
    );

    const matched    = tenantResult.rows.length > 0;
    const tenant     = tenantResult.rows[0];
    const status     = matched ? 'matched' : 'unmatched';
    const matchScore = matched ? 90 : 0;

    const insert = await pool.query(
      `INSERT INTO payments
         (tenant_id, transaction_id, amount, phone, payment_date, house_id, method, status, match_score, receipt_no)
       VALUES ($1, $2, $3, $4, $5, $6, 'mpesa', $7, $8, $9)
       RETURNING *`,
      [tenant?.id || null, transaction_id, amount, phone, payment_date,
       tenant?.house_id || null, status, matchScore, transaction_id]
    );

    return res.status(200).json({ success: true, data: insert.rows[0] });
  } catch (error) {
    console.error('M-Pesa callback error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.', error: error.message });
  }
});

/**
 * GET /api/mpesa/unmatched
 * Returns all unmatched/review transactions for manual reconciliation
 */
router.get('/unmatched', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM payments WHERE status IN ('unmatched', 'review') ORDER BY payment_date DESC`
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching unmatched payments:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * PATCH /api/mpesa/:id/match
 * Manually match an unmatched transaction to a tenant
 */
router.patch('/:id/match', async (req, res) => {
  const { id } = req.params;
  const { tenant_id, house_id } = req.body;

  if (!tenant_id || !house_id) {
    return res.status(400).json({ success: false, message: 'tenant_id and house_id are required.' });
  }

  try {
    const result = await pool.query(
      `UPDATE payments
       SET tenant_id = $1, house_id = $2, status = 'matched', match_score = 100
       WHERE id = $3
       RETURNING *`,
      [tenant_id, house_id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Payment not found.' });
    }

    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error matching payment:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;

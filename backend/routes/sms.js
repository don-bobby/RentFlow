const express = require('express');
const router = express.Router();
const pool = require('../database/db');

/**
 * POST /api/sms/send
 * Send an SMS to a phone number and log it.
 * Plug in your SMS provider (Africa's Talking, Twilio, etc.) where indicated below.
 */
router.post('/send', async (req, res) => {
  const { to_phone, message } = req.body;

  if (!to_phone || !message) {
    return res.status(400).json({ success: false, message: 'to_phone and message are required.' });
  }

  let status = 'failed';

  try {
    // ── Plug in your SMS provider here ──────────────────────────────────────
    // Africa's Talking example:
    //   const AT = require('africastalking')({ apiKey: process.env.AT_API_KEY, username: process.env.AT_USERNAME });
    //   await AT.SMS.send({ to: [to_phone], message, from: process.env.AT_SENDER_ID });
    //
    // Until a provider is wired up, we log to console and mark as sent.
    console.log(`[SMS] To: ${to_phone} | Message: ${message}`);
    status = 'sent';
    // ────────────────────────────────────────────────────────────────────────

    await pool.query(
      `INSERT INTO sms_logs (to_phone, message, status) VALUES ($1, $2, $3)`,
      [to_phone, message, status]
    );

    return res.status(200).json({ success: true, message: 'SMS sent successfully.' });
  } catch (error) {
    console.error('SMS send error:', error);
    await pool.query(
      `INSERT INTO sms_logs (to_phone, message, status) VALUES ($1, $2, 'failed')`,
      [to_phone, message]
    ).catch(() => {});
    return res.status(500).json({ success: false, message: 'Failed to send SMS.', error: error.message });
  }
});

/**
 * GET /api/sms/logs
 * Retrieve SMS history (most recent 100)
 */
router.get('/logs', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM sms_logs ORDER BY sent_at DESC LIMIT 100`
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching SMS logs:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;

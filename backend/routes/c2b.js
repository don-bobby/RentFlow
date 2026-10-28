// Paybill auto-matching. Every unit has its own account number; a tenant pays
// the Paybill with that account number and Safaricom tells us (C2B), so the
// payment lands on the right tenant by itself.
//
//  Public (called by Safaricom; the secret in the path is the only credential):
//   POST /api/pay/c2b/:secret/validation
//   POST /api/pay/c2b/:secret/confirmation
//  Staff:
//   GET  /api/pay/info                    paybill number + whether matching is on
//   GET  /api/pay/accounts?plot_id=       units with their account numbers
//   POST /api/pay/accounts/generate       fill in missing account numbers for a property
//   PUT  /api/pay/accounts/:houseId       set one unit's account number
//  Admin:
//   POST /api/pay/c2b/register            tell Safaricom our URLs (once)
//   GET  /api/pay/c2b/recent              the last notices received
const express = require('express');
const crypto  = require('crypto');
const axios   = require('axios');
const router  = express.Router();
const pool    = require('../database/db');
const { authMiddleware: auth } = require('../middleware/auth');
const { getVisiblePlotIds } = require('../middleware/scope');
const { getPermissions } = require('../middleware/permissions');
const { logAudit } = require('../utils/audit');
const { allocateRentPayment } = require('../utils/allocateRent');

const isAdmin = (u) => ['admin', 'super_admin'].includes(u.role);
const KEY_SQL = `regexp_replace(upper(account_no), '[^A-Z0-9]', '', 'g')`;
const keyOf = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function secretOk(given) {
  const want = process.env.C2B_SECRET;
  if (!want || want.length < 16) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const ACCEPT = { ResultCode: 0, ResultDesc: 'Accepted' };

async function findHouse(billRef) {
  const k = keyOf(billRef);
  if (!k) return null;
  return (await pool.query(`SELECT id, plot_id, unit_number FROM houses WHERE account_no IS NOT NULL AND ${KEY_SQL} = $1 LIMIT 1`, [k])).rows[0] || null;
}

// ── Safaricom: validation. Accepts everything unless C2B_REJECT_UNKNOWN=true, in
//    which case a payment to an account number we don't have is bounced back. ──
router.post('/c2b/:secret/validation', async (req, res) => {
  if (!secretOk(req.params.secret)) return res.status(404).end();
  try {
    if (process.env.C2B_REJECT_UNKNOWN === 'true') {
      const house = await findHouse(req.body?.BillRefNumber);
      if (!house) return res.json({ ResultCode: 'C2B00012', ResultDesc: 'Rejected' });
    }
  } catch (e) { console.error('C2B validation error:', e.message); }
  res.json(ACCEPT);
});

// ── Safaricom: confirmation. Always answers 200 so Safaricom is satisfied; what
//    happened is recorded in c2b_transactions / payments. ──
router.post('/c2b/:secret/confirmation', async (req, res) => {
  if (!secretOk(req.params.secret)) return res.status(404).end();
  const b = req.body || {};
  const transId = String(b.TransID || '').slice(0, 40);
  const amount = Number(b.TransAmount);
  if (!transId || !Number.isFinite(amount) || amount <= 0) return res.json(ACCEPT);
  if (process.env.MPESA_SHORTCODE && b.BusinessShortCode && String(b.BusinessShortCode) !== String(process.env.MPESA_SHORTCODE)) {
    console.warn('C2B notice for a different shortcode ignored:', b.BusinessShortCode);
    return res.json(ACCEPT);
  }
  const t = String(b.TransTime || '');
  const when = /^\d{14}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}+03:00` : new Date().toISOString();
  const payer = [b.FirstName, b.MiddleName, b.LastName].filter(Boolean).join(' ').slice(0, 120) || null;
  const msisdn = String(b.MSISDN || '').slice(0, 80) || null;
  const billRef = String(b.BillRefNumber || '').slice(0, 60) || null;

  const client = await pool.connect();
  try {
    const first = await client.query(
      `INSERT INTO c2b_transactions (trans_id, amount, bill_ref, msisdn, payer_name, trans_time) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (trans_id) DO NOTHING RETURNING trans_id`,
      [transId, amount, billRef, msisdn, payer, when]);
    if (!first.rows[0]) return res.json(ACCEPT);   // Safaricom repeated itself; already handled

    let house = await findHouse(billRef), how = 'account number';
    let tenant = null;
    if (house) tenant = (await client.query('SELECT id FROM tenants WHERE house_id = $1 AND is_active = true ORDER BY id DESC LIMIT 1', [house.id])).rows[0] || null;
    if (!tenant && /^2547\d{8}$|^2541\d{8}$/.test(msisdn || '')) {   // only when the number comes through unhashed
      const byPhone = (await client.query(
        `SELECT t.id, t.house_id, h.plot_id, h.unit_number FROM tenants t LEFT JOIN houses h ON h.id = t.house_id
         WHERE t.is_active = true AND regexp_replace(t.phone, '\\D', '', 'g') IN ($1, $2) LIMIT 1`, [msisdn, '0' + msisdn.slice(3)])).rows[0];
      if (byPhone) { tenant = { id: byPhone.id }; house = { id: byPhone.house_id, plot_id: byPhone.plot_id, unit_number: byPhone.unit_number }; how = 'phone number'; }
    }

    await client.query('BEGIN');
    if (tenant && house) {
      const note = `Paybill ${how} match${billRef ? ` (account "${billRef}")` : ''}.`;
      await allocateRentPayment(client, { tenantId: tenant.id, houseId: house.id, amount, paymentDate: when, method: 'mpesa', reference: transId, notes: note });
      await client.query(`UPDATE c2b_transactions SET status='matched', house_id=$2, tenant_id=$3, note=$4 WHERE trans_id=$1`, [transId, house.id, tenant.id, note]);
    } else {
      const why = house ? `Unit ${house.unit_number} has no active tenant.` : `No unit has the account number "${billRef || ''}".`;
      await client.query(
        `INSERT INTO payments (house_id, amount, payment_date, method, status, match_score, receipt_no, notes) VALUES ($1,$2,$3,'mpesa','unmatched',0,$4,$5)`,
        [house?.id || null, amount, when, transId, `Paybill payment from ${payer || 'unknown'} to account "${billRef || ''}". ${why}`]);
      await client.query(`UPDATE c2b_transactions SET status='unmatched', house_id=$2, note=$3 WHERE trans_id=$1`, [transId, house?.id || null, why]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('C2B confirmation failed:', err.message);
    await pool.query(`UPDATE c2b_transactions SET status='error', note=$2 WHERE trans_id=$1`, [transId, String(err.message).slice(0, 300)]).catch(() => {});
  } finally { client.release(); }
  res.json(ACCEPT);
});

// ── Staff ──
router.get('/info', auth, (req, res) => {
  res.json({ success: true, shortcode: process.env.MPESA_SHORTCODE || null, matching_on: !!(process.env.C2B_SECRET && process.env.C2B_SECRET.length >= 16) });
});

async function plotGuard(req, res, plotId, perm) {
  if (!plotId) { res.status(400).json({ error: 'Choose a property.' }); return false; }
  if (!isAdmin(req.user)) {
    const visible = await getVisiblePlotIds(req.user);
    if (!(visible === 'ALL' || visible.includes(plotId))) { res.status(403).json({ error: 'Access denied' }); return false; }
  }
  const { permissions } = await getPermissions(req.user, plotId);
  if (!permissions.includes('*') && !permissions.includes(perm)) { res.status(403).json({ error: `Missing permission: ${perm}` }); return false; }
  return true;
}
const pid = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };

router.get('/accounts', auth, async (req, res) => {
  try {
    const plotId = pid(req.query.plot_id);
    if (!(await plotGuard(req, res, plotId, 'houses.view'))) return;
    const p = await getPermissions(req.user, plotId);
    const r = await pool.query(
      `SELECT h.id AS house_id, h.unit_number, h.account_no, t.full_name AS tenant_name
       FROM houses h LEFT JOIN tenants t ON t.house_id = h.id AND t.is_active = true WHERE h.plot_id = $1 ORDER BY h.unit_number`, [plotId]);
    res.json({ success: true, data: r.rows, can_edit: p.permissions.includes('*') || p.permissions.includes('houses.edit') });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const clean = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
router.post('/accounts/generate', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const plotId = pid(req.body.plot_id);
    if (!(await plotGuard(req, res, plotId, 'houses.edit'))) return;
    const plot = (await client.query('SELECT name FROM plots WHERE id = $1', [plotId])).rows[0];
    if (!plot) return res.status(404).json({ error: 'Property not found.' });
    const prefix = (clean(plot.name).slice(0, 3) || 'RF').padEnd(2, 'X');
    const houses = (await client.query('SELECT id, unit_number FROM houses WHERE plot_id = $1 AND account_no IS NULL ORDER BY unit_number', [plotId])).rows;
    let made = 0;
    await client.query('BEGIN');
    for (const h of houses) {
      const base = `${prefix}-${clean(h.unit_number) || h.id}`.slice(0, 26);
      for (const cand of [base, `${base}-${h.id}`.slice(0, 30), `RF${h.id}`]) {
        const r = await client.query(
          `UPDATE houses SET account_no = $1 WHERE id = $2 AND NOT EXISTS (SELECT 1 FROM houses o WHERE o.account_no IS NOT NULL AND regexp_replace(upper(o.account_no), '[^A-Z0-9]', '', 'g') = $3) RETURNING id`,
          [cand, h.id, clean(cand)]);
        if (r.rows[0]) { made++; break; }
      }
    }
    await client.query('COMMIT');
    await logAudit({ user: req.user, action: 'paybill.accounts_generated', entityType: 'plot', entityId: plotId, changes: { accounts: { to: `${made} created` } } });
    res.json({ success: true, created: made });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

router.put('/accounts/:houseId', auth, async (req, res) => {
  try {
    const houseId = pid(req.params.houseId);
    const h = houseId ? (await pool.query('SELECT id, plot_id, account_no FROM houses WHERE id = $1', [houseId])).rows[0] : null;
    if (!h) return res.status(404).json({ error: 'Unit not found.' });
    if (!(await plotGuard(req, res, h.plot_id, 'houses.edit'))) return;
    const raw = String(req.body.account_no ?? '').trim();
    if (raw && !/^[A-Za-z0-9 -]{3,30}$/.test(raw)) return res.status(400).json({ error: 'Use 3 to 30 letters, numbers, spaces or dashes.' });
    if (raw) {
      const dup = await pool.query(`SELECT 1 FROM houses WHERE id <> $1 AND account_no IS NOT NULL AND ${KEY_SQL} = $2`, [houseId, keyOf(raw)]);
      if (dup.rows[0]) return res.status(409).json({ error: 'Another unit already uses that account number.' });
    }
    await pool.query('UPDATE houses SET account_no = $1 WHERE id = $2', [raw || null, houseId]);
    await logAudit({ user: req.user, action: 'paybill.account_set', entityType: 'house', entityId: houseId, changes: { account_no: { from: h.account_no, to: raw || null } } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Admin ──
router.post('/c2b/register', auth, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only.' });
  try {
    const need = ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE', 'C2B_SECRET'].filter(k => !process.env[k]);
    if (need.length) return res.status(400).json({ error: `Set these on the server first: ${need.join(', ')}.` });
    if (process.env.C2B_SECRET.length < 16) return res.status(400).json({ error: 'C2B_SECRET must be at least 16 random characters.' });
    const origin = (process.env.PUBLIC_BASE_URL || (process.env.MPESA_CALLBACK_URL ? new URL(process.env.MPESA_CALLBACK_URL).origin : '')).replace(/\/$/, '');
    if (!origin.startsWith('https://')) return res.status(400).json({ error: 'Set PUBLIC_BASE_URL to your backend\'s https address.' });
    const host = process.env.MPESA_ENV === 'live' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
    const basic = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
    const tok = (await axios.get(`${host}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${basic}` } })).data.access_token;
    const base = `${origin}/api/pay/c2b/${process.env.C2B_SECRET}`;
    const r = await axios.post(`${host}/mpesa/c2b/v1/registerurl`, {
      ShortCode: process.env.MPESA_SHORTCODE, ResponseType: 'Completed', ConfirmationURL: `${base}/confirmation`, ValidationURL: `${base}/validation`,
    }, { headers: { Authorization: `Bearer ${tok}` } });
    await logAudit({ user: req.user, action: 'paybill.urls_registered', entityType: 'system', entityId: null, changes: { environment: { to: process.env.MPESA_ENV === 'live' ? 'live' : 'sandbox' } } });
    res.json({ success: true, safaricom: r.data });
  } catch (err) { res.status(502).json({ error: err.response?.data?.errorMessage || err.response?.data?.ResponseDescription || err.message }); }
});

router.get('/c2b/recent', auth, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only.' });
  try {
    const r = await pool.query(
      `SELECT c.trans_id, c.amount, c.bill_ref, c.payer_name, c.trans_time, c.status, c.note, h.unit_number, p.name AS plot_name, t.full_name AS tenant_name
       FROM c2b_transactions c LEFT JOIN houses h ON h.id = c.house_id LEFT JOIN plots p ON p.id = h.plot_id LEFT JOIN tenants t ON t.id = c.tenant_id
       ORDER BY c.received_at DESC LIMIT 100`);
    res.json({ success: true, data: r.rows.map(x => ({ ...x, amount: parseFloat(x.amount) })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

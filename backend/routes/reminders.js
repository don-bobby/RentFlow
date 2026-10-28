// WhatsApp rent reminders. WhatsApp can't be sent from here without a paid
// Business API account, so this builds the list of who to remind and the staff
// member taps through it (each tap opens WhatsApp with the message ready).
//   GET  /api/reminders?plot_id=      tenants who owe or are about to owe, with how late
//   POST /api/reminders/:tenantId/sent  note that a reminder was sent
const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const { authMiddleware: auth } = require('../middleware/auth');
const { getVisiblePlotIds } = require('../middleware/scope');
const { getPermissions, filterRowsByPermission } = require('../middleware/permissions');
const { computeLedger, loadPaidMaps } = require('../utils/rentLedger');
const { logAudit } = require('../utils/audit');

const isAdmin = (u) => ['admin', 'super_admin'].includes(u.role);

// 'overdue' = an older month is still unpaid; 'due' = this month's rent is past its due day;
// 'upcoming' = due within 3 days. Anything else needs no reminder.
function levelFor(unpaid, dueDay, now) {
  if (!unpaid.length) return null;
  const cy = now.getFullYear(), cm = now.getMonth() + 1;
  if (unpaid.some(u => u.year < cy || (u.year === cy && u.month < cm))) return 'overdue';
  const day = now.getDate(), due = Math.min(Math.max(parseInt(dueDay, 10) || 5, 1), 28);
  if (day > due) return 'due';
  return due - day <= 3 ? 'upcoming' : null;
}

router.get('/', auth, async (req, res) => {
  try {
    const visible = isAdmin(req.user) ? 'ALL' : await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && !visible.length) return res.json({ success: true, data: [], paybill: null });
    const vals = [], where = [`t.is_active = true`, `t.move_in_date IS NOT NULL`, `t.phone IS NOT NULL`, `h.rent_amount > 0`];
    if (visible !== 'ALL') { vals.push(visible); where.push(`h.plot_id = ANY($${vals.length})`); }
    const plotId = parseInt(req.query.plot_id, 10);
    if (plotId) { vals.push(plotId); where.push(`h.plot_id = $${vals.length}`); }
    const r = await pool.query(
      `SELECT t.id AS tenant_id, t.full_name, t.phone, t.move_in_date, t.rent_due_day, h.unit_number, h.rent_amount, h.account_no, h.plot_id, p.name AS plot_name,
              (SELECT MAX(created_at) FROM reminder_log l WHERE l.tenant_id = t.id) AS last_reminded_at
       FROM tenants t JOIN houses h ON h.id = t.house_id JOIN plots p ON p.id = h.plot_id
       WHERE ${where.join(' AND ')} ORDER BY p.name, h.unit_number`, vals);
    const rows = await filterRowsByPermission(req.user, r.rows, 'reminders.send', (x) => x.plot_id);
    const maps = await loadPaidMaps(pool, rows.map(x => x.tenant_id));
    const now = new Date(), out = [];
    for (const t of rows) {
      const { unpaidMonths, totalOwed } = computeLedger({ rent: t.rent_amount, moveInDate: t.move_in_date, paidMap: maps[t.tenant_id] || {}, now });
      const level = levelFor(unpaidMonths, t.rent_due_day, now);
      if (!level) continue;
      out.push({
        tenant_id: t.tenant_id, full_name: t.full_name, phone: t.phone, unit_number: t.unit_number, plot_id: t.plot_id, plot_name: t.plot_name,
        account_no: t.account_no, due_day: Math.min(Math.max(parseInt(t.rent_due_day, 10) || 5, 1), 28), level, owed: totalOwed,
        months: unpaidMonths.map(u => u.label), months_behind: unpaidMonths.length, last_reminded_at: t.last_reminded_at,
      });
    }
    const rank = { overdue: 0, due: 1, upcoming: 2 };
    out.sort((a, b) => rank[a.level] - rank[b.level] || b.owed - a.owed);
    res.json({ success: true, data: out, paybill: process.env.MPESA_SHORTCODE || null });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.post('/:tenantId/sent', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.tenantId, 10);
    const t = id ? (await pool.query(`SELECT t.id, t.full_name, h.plot_id FROM tenants t JOIN houses h ON h.id = t.house_id WHERE t.id = $1`, [id])).rows[0] : null;
    if (!t) return res.status(404).json({ error: 'Tenant not found.' });
    if (!isAdmin(req.user)) {
      const visible = await getVisiblePlotIds(req.user);
      if (!(visible === 'ALL' || visible.includes(t.plot_id))) return res.status(403).json({ error: 'Access denied' });
    }
    const { permissions } = await getPermissions(req.user, t.plot_id);
    if (!permissions.includes('*') && !permissions.includes('reminders.send')) return res.status(403).json({ error: 'Missing permission: reminders.send' });
    const level = ['upcoming', 'due', 'overdue'].includes(req.body.level) ? req.body.level : 'due';
    const owed = Number(req.body.owed); 
    await pool.query('INSERT INTO reminder_log (tenant_id, plot_id, level, amount_owed, sent_by) VALUES ($1,$2,$3,$4,$5)', [id, t.plot_id, level, Number.isFinite(owed) ? owed : null, req.user.id]);
    await logAudit({ user: req.user, action: 'reminder.sent', entityType: 'tenant', entityId: id, changes: { whatsapp: { to: `${level} reminder to ${t.full_name}` } } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

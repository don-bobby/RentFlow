// Owner portal: a read-only live view for landlords whose properties are run by
// an agent. Only the landlord's own agent-managed properties, only their own
// numbers. Tenant names, phones and per-tenant lines are left out unless an
// admin has granted the 'portal.tenant_details' permission (per landlord or per
// property, through Permission Overrides).
//   GET /api/portal/overview?month=YYYY-MM     one card per property + totals
//   GET /api/portal/plots/:id?month=YYYY-MM    arrears, vacancies, maintenance, expenses, payments
const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const { authMiddleware: auth } = require('../middleware/auth');
const { getPermissions } = require('../middleware/permissions');
const { computeLedger, loadPaidMaps } = require('../utils/rentLedger');

const landlordOnly = (req, res, next) =>
  req.user.role === 'landlord' ? next() : res.status(403).json({ error: 'The owner portal is for landlords.' });

const monthRange = (q) => {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(q || '') ? q : new Date().toISOString().slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  return { month, start: `${month}-01`, end: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10) };
};
const n = (v) => Math.round(parseFloat(v || 0) * 100) / 100;

async function ownedManagedPlots(user, onlyId) {
  const vals = [user.id];
  let extra = '';
  if (onlyId) { vals.push(onlyId); extra = 'AND p.id = $2'; }
  return (await pool.query(
    `SELECT p.id, p.name, p.location, p.agent_id, p.agent_fee_percent, ag.name AS agent_name
     FROM plots p LEFT JOIN users ag ON ag.id = p.agent_id
     WHERE p.user_id = $1 AND p.agent_id IS NOT NULL ${extra} ORDER BY p.name`, vals)).rows;
}

async function figures(plot, { start, end }) {
  const [houses, tenants, paid, util, exp, maint] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'occupied')::int AS occupied FROM houses WHERE plot_id = $1`, [plot.id]),
    pool.query(`SELECT t.id, t.move_in_date, h.rent_amount, h.unit_number, t.full_name, t.phone FROM tenants t JOIN houses h ON h.id = t.house_id WHERE h.plot_id = $1 AND t.is_active = true`, [plot.id]),
    pool.query(
      `SELECT COALESCE(SUM(COALESCE(p.amount_allocated, p.amount)), 0) AS total FROM payments p JOIN houses h ON p.house_id = h.id
       WHERE h.plot_id = $1 AND p.payment_date >= $2 AND p.payment_date < $3
         AND p.status NOT IN ('failed','pending') AND COALESCE(p.method,'') != 'balance_charge'`, [plot.id, start, end]),
    pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM utility_payments WHERE plot_id = $1 AND payment_date >= $2 AND payment_date < $3`, [plot.id, start, end]),
    pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE plot_id = $1 AND expense_date >= $2 AND expense_date < $3 AND COALESCE(status, 'confirmed') != 'pending'`, [plot.id, start, end]),
    pool.query(`SELECT COUNT(*)::int AS open FROM maintenance_requests m JOIN houses h ON h.id = m.house_id WHERE h.plot_id = $1 AND m.status != 'completed'`, [plot.id]),
  ]);
  const maps = await loadPaidMaps(pool, tenants.rows.map(t => t.id));
  let expected = 0, arrears = 0, behind = 0;
  const arrearsRows = [];
  for (const t of tenants.rows) {
    expected += parseFloat(t.rent_amount || 0);
    const { totalOwed, unpaidMonths } = computeLedger({ rent: t.rent_amount, moveInDate: t.move_in_date, paidMap: maps[t.id] || {} });
    if (totalOwed > 0) { arrears += totalOwed; behind++; arrearsRows.push({ unit_number: t.unit_number, owed: n(totalOwed), months_behind: unpaidMonths.length, full_name: t.full_name, phone: t.phone }); }
  }
  const collected = n(paid.rows[0].total), utilities = n(util.rows[0].total), expenses = n(exp.rows[0].total);
  const feePct = plot.agent_fee_percent != null ? parseFloat(plot.agent_fee_percent) : null;
  const agentFee = feePct != null ? n(collected * feePct / 100) : 0;
  const h = houses.rows[0];
  return {
    units: { total: h.total, occupied: h.occupied, vacant: h.total - h.occupied },
    occupancy: h.total ? Math.round((h.occupied / h.total) * 100) : 0,
    expected: n(expected), collected, utilities, expenses, agent_fee: agentFee, agent_fee_percent: feePct,
    net: n(collected + utilities - expenses - agentFee),
    collection_rate: expected ? Math.round((collected / expected) * 100) : null,
    arrears_total: n(arrears), arrears_count: behind, open_maintenance: maint.rows[0].open, arrearsRows,
  };
}

router.get('/overview', auth, landlordOnly, async (req, res) => {
  try {
    const range = monthRange(req.query.month);
    const plots = await ownedManagedPlots(req.user);
    const out = [];
    for (const p of plots) {
      const f = await figures(p, range);
      delete f.arrearsRows;
      out.push({ id: p.id, name: p.name, location: p.location, agent: { id: p.agent_id, name: p.agent_name }, ...f });
    }
    const sum = (k) => n(out.reduce((a, x) => a + x[k], 0));
    res.json({
      success: true, month: range.month, plots: out,
      totals: { collected: sum('collected'), expected: sum('expected'), expenses: sum('expenses'), agent_fee: sum('agent_fee'), net: sum('net'), arrears_total: sum('arrears_total'), open_maintenance: out.reduce((a, x) => a + x.open_maintenance, 0) },
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.get('/plots/:id', auth, landlordOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const plot = id ? (await ownedManagedPlots(req.user, id))[0] : null;
    if (!plot) return res.status(404).json({ error: 'Property not found.' });
    const range = monthRange(req.query.month);
    const { permissions } = await getPermissions(req.user, plot.id);
    const showTenants = permissions.includes('*') || permissions.includes('portal.tenant_details');
    const f = await figures(plot, range);
    const [vacant, maint, exp, pays] = await Promise.all([
      pool.query(`SELECT unit_number, house_type, rent_amount FROM houses WHERE plot_id = $1 AND status != 'occupied' ORDER BY unit_number`, [plot.id]),
      pool.query(
        `SELECT m.id, m.issue, m.priority, m.status, m.reported_at, h.unit_number FROM maintenance_requests m JOIN houses h ON h.id = m.house_id
         WHERE h.plot_id = $1 AND m.status != 'completed' ORDER BY m.reported_at DESC LIMIT 50`, [plot.id]),
      pool.query(
        `SELECT e.expense_date, COALESCE(e.category, 'Uncategorised') AS category, e.description, e.amount FROM expenses e
         WHERE e.plot_id = $1 AND e.expense_date >= $2 AND e.expense_date < $3 AND COALESCE(e.status, 'confirmed') != 'pending' ORDER BY e.expense_date DESC`, [plot.id, range.start, range.end]),
      pool.query(
        `SELECT p.payment_date, COALESCE(p.method, 'other') AS method, SUM(COALESCE(p.amount_allocated, p.amount)) AS amount, h.unit_number, t.full_name
         FROM payments p JOIN houses h ON p.house_id = h.id LEFT JOIN tenants t ON t.id = p.tenant_id
         WHERE h.plot_id = $1 AND p.payment_date >= $2 AND p.payment_date < $3 AND p.status NOT IN ('failed','pending') AND COALESCE(p.method,'') != 'balance_charge'
         GROUP BY p.payment_date, 2, h.unit_number, t.full_name ORDER BY p.payment_date DESC LIMIT 200`, [plot.id, range.start, range.end]),
    ]);
    const arrears = f.arrearsRows.sort((a, b) => b.owed - a.owed).map(r => showTenants ? r : { unit_number: r.unit_number, owed: r.owed, months_behind: r.months_behind });
    delete f.arrearsRows;
    res.json({
      success: true, month: range.month, show_tenants: showTenants,
      plot: { id: plot.id, name: plot.name, location: plot.location, agent: { id: plot.agent_id, name: plot.agent_name } }, ...f,
      arrears, vacant: vacant.rows.map(v => ({ ...v, rent_amount: n(v.rent_amount) })),
      maintenance: maint.rows, expenses_list: exp.rows.map(e => ({ ...e, amount: n(e.amount) })),
      payments: pays.rows.map(p => ({ payment_date: p.payment_date, method: p.method, amount: n(p.amount), unit_number: p.unit_number, ...(showTenants ? { full_name: p.full_name } : {}) })),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

module.exports = router;

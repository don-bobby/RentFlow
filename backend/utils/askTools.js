// Read-only questions the "Ask your data" assistant can run. The AI never writes SQL:
// it can only pick one of these tools. Every tool is limited to the properties the user
// can see AND holds the matching permission on. Tools return no phone numbers or ID numbers.
const pool = require('../database/db');
const { getVisiblePlotIds } = require('../middleware/scope');
const { getPermissionsForPlots } = require('../middleware/permissions');
const { VALID_PAYMENT_SQL } = require('./rentLedger');
const { computeMeter } = require('./sharedMeters');

const isAdmin = (u) => ['admin', 'super_admin'].includes(u.role);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const curMonth = () => new Date().toISOString().slice(0, 7);
const money = (n) => Math.round(Number(n || 0) * 100) / 100;

async function plotIds(user, perm, nameLike) {
  const visible = await getVisiblePlotIds(user);
  const rows = (await pool.query('SELECT id, name FROM plots ORDER BY name')).rows
    .filter(p => visible === 'ALL' || visible.includes(p.id))
    .filter(p => !nameLike || p.name.toLowerCase().includes(String(nameLike).toLowerCase().trim()));
  if (isAdmin(user)) return rows.map(p => p.id);
  const map = await getPermissionsForPlots(user, rows.map(p => p.id));
  return rows.filter(p => { const x = map.get(p.id) || []; return x.includes('*') || x.includes(perm); }).map(p => p.id);
}
const none = (title) => ({ title, columns: [], rows: [], note: 'No properties match, or you do not have access to this information.' });

const TOOLS = {
  unpaid_rent: {
    description: 'Tenants who currently owe rent, largest balance first. Optional: plot (part of a property name).',
    props: { plot: 'Part of a property name' },
    perm: 'payments.view',
    async run(user, a) {
      const ids = await plotIds(user, 'payments.view', a.plot); if (!ids.length) return none('Unpaid rent');
      const r = (await pool.query(
        `SELECT t.full_name, h.unit_number, p.name AS plot, t.balance FROM tenants t JOIN houses h ON h.id = t.house_id JOIN plots p ON p.id = h.plot_id
          WHERE t.is_active = true AND t.balance > 0 AND p.id = ANY($1) ORDER BY t.balance DESC LIMIT 100`, [ids])).rows;
      const total = r.reduce((s, x) => s + Number(x.balance), 0);
      return { title: 'Unpaid rent', columns: ['Tenant', 'Unit', 'Property', 'Owes (KES)'], rows: r.map(x => [x.full_name, x.unit_number, x.plot, money(x.balance)]), note: `${r.length} tenants owe a total of KES ${money(total)}` };
    },
  },
  payments_received: {
    description: 'Rent received in a month, per property and in total. Optional: month (YYYY-MM, default this month), plot.',
    props: { month: 'YYYY-MM', plot: 'Part of a property name' },
    perm: 'payments.view',
    async run(user, a) {
      const m = MONTH.test(a.month || '') ? a.month : curMonth();
      const ids = await plotIds(user, 'payments.view', a.plot); if (!ids.length) return none('Rent received');
      const r = (await pool.query(
        `SELECT p.name AS plot, COUNT(*)::int AS n, SUM(py.amount) AS total FROM payments py JOIN houses h ON h.id = py.house_id JOIN plots p ON p.id = h.plot_id
          WHERE p.id = ANY($1) AND ${VALID_PAYMENT_SQL.replace(/status/g, 'py.status').replace(/method/g, 'py.method')} AND to_char(py.payment_date, 'YYYY-MM') = $2 GROUP BY p.name ORDER BY total DESC`, [ids, m])).rows;
      const total = r.reduce((s, x) => s + Number(x.total), 0);
      return { title: `Rent received in ${m}`, columns: ['Property', 'Payments', 'Received (KES)'], rows: r.map(x => [x.plot, x.n, money(x.total)]), note: `Total KES ${money(total)}` };
    },
  },
  vacant_units: {
    description: 'Vacant units with their rent. Optional: plot.',
    props: { plot: 'Part of a property name' },
    perm: 'houses.view',
    async run(user, a) {
      const ids = await plotIds(user, 'houses.view', a.plot); if (!ids.length) return none('Vacant units');
      const r = (await pool.query(`SELECT p.name AS plot, h.unit_number, h.house_type, h.rent_amount FROM houses h JOIN plots p ON p.id = h.plot_id WHERE h.status = 'vacant' AND p.id = ANY($1) ORDER BY p.name, h.unit_number LIMIT 200`, [ids])).rows;
      return { title: 'Vacant units', columns: ['Property', 'Unit', 'Type', 'Rent (KES)'], rows: r.map(x => [x.plot, x.unit_number, x.house_type || '', money(x.rent_amount)]), note: `${r.length} vacant units` };
    },
  },
  occupancy: {
    description: 'Units, occupied and vacant counts and occupancy rate per property.',
    props: {},
    perm: 'houses.view',
    async run(user) {
      const ids = await plotIds(user, 'houses.view'); if (!ids.length) return none('Occupancy');
      const r = (await pool.query(`SELECT p.name AS plot, COUNT(*)::int AS units, COUNT(*) FILTER (WHERE h.status = 'occupied')::int AS occupied FROM houses h JOIN plots p ON p.id = h.plot_id WHERE p.id = ANY($1) GROUP BY p.name ORDER BY p.name`, [ids])).rows;
      return { title: 'Occupancy', columns: ['Property', 'Units', 'Occupied', 'Vacant', 'Rate'], rows: r.map(x => [x.plot, x.units, x.occupied, x.units - x.occupied, x.units ? `${Math.round(100 * x.occupied / x.units)}%` : '0%']) };
    },
  },
  open_maintenance: {
    description: 'Maintenance requests not yet completed, newest first. Optional: plot.',
    props: { plot: 'Part of a property name' },
    perm: 'maintenance.view',
    async run(user, a) {
      const ids = await plotIds(user, 'maintenance.view', a.plot); if (!ids.length) return none('Open maintenance');
      const r = (await pool.query(`SELECT p.name AS plot, h.unit_number, m.issue, m.priority, m.status, m.reported_at FROM maintenance_requests m JOIN houses h ON h.id = m.house_id JOIN plots p ON p.id = h.plot_id WHERE m.status <> 'completed' AND p.id = ANY($1) ORDER BY m.reported_at DESC LIMIT 100`, [ids])).rows;
      return { title: 'Open maintenance requests', columns: ['Property', 'Unit', 'Issue', 'Priority', 'Status', 'Reported'], rows: r.map(x => [x.plot, x.unit_number, String(x.issue).slice(0, 120), x.priority, x.status, new Date(x.reported_at).toISOString().slice(0, 10)]), note: `${r.length} open` };
    },
  },
  expenses_summary: {
    description: 'Expenses in a month by category. Optional: month (YYYY-MM, default this month), plot.',
    props: { month: 'YYYY-MM', plot: 'Part of a property name' },
    perm: 'expenses.view',
    async run(user, a) {
      const m = MONTH.test(a.month || '') ? a.month : curMonth();
      const ids = await plotIds(user, 'expenses.view', a.plot); if (!ids.length) return none('Expenses');
      const r = (await pool.query(`SELECT COALESCE(e.category, 'Other') AS category, SUM(e.amount) AS total FROM expenses e WHERE e.plot_id = ANY($1) AND to_char(e.expense_date, 'YYYY-MM') = $2 GROUP BY 1 ORDER BY total DESC`, [ids, m])).rows;
      const total = r.reduce((s, x) => s + Number(x.total), 0);
      return { title: `Expenses in ${m}`, columns: ['Category', 'Amount (KES)'], rows: r.map(x => [x.category, money(x.total)]), note: `Total KES ${money(total)}` };
    },
  },
  find_tenant: {
    description: 'Look up an active tenant by name: unit, property, rent, balance and move-in date.',
    props: { name: 'Part of the tenant name' },
    required: ['name'],
    perm: 'tenants.view',
    async run(user, a) {
      const nm = String(a.name || '').trim().slice(0, 60); if (nm.length < 2) return { title: 'Tenant', columns: [], rows: [], note: 'Give at least two letters of the name.' };
      const ids = await plotIds(user, 'tenants.view'); if (!ids.length) return none('Tenant');
      const r = (await pool.query(`SELECT t.full_name, h.unit_number, p.name AS plot, h.rent_amount, t.balance, t.move_in_date FROM tenants t JOIN houses h ON h.id = t.house_id JOIN plots p ON p.id = h.plot_id WHERE t.is_active = true AND p.id = ANY($1) AND t.full_name ILIKE '%' || $2 || '%' ORDER BY t.full_name LIMIT 20`, [ids, nm])).rows;
      return { title: 'Tenant lookup', columns: ['Tenant', 'Unit', 'Property', 'Rent (KES)', 'Owes (KES)', 'Moved in'], rows: r.map(x => [x.full_name, x.unit_number, x.plot, money(x.rent_amount), money(x.balance), x.move_in_date ? new Date(x.move_in_date).toISOString().slice(0, 10) : '']) };
    },
  },
  not_paid_this_month: {
    description: 'Active tenants who have not made any rent payment in a month. Optional: month (YYYY-MM, default this month), plot.',
    props: { month: 'YYYY-MM', plot: 'Part of a property name' },
    perm: 'payments.view',
    async run(user, a) {
      const m = MONTH.test(a.month || '') ? a.month : curMonth();
      const ids = await plotIds(user, 'payments.view', a.plot); if (!ids.length) return none('Not paid');
      const r = (await pool.query(
        `SELECT t.full_name, h.unit_number, p.name AS plot, h.rent_amount, t.balance FROM tenants t JOIN houses h ON h.id = t.house_id JOIN plots p ON p.id = h.plot_id
          WHERE t.is_active = true AND p.id = ANY($1)
            AND NOT EXISTS (SELECT 1 FROM payments py WHERE py.tenant_id = t.id AND ${VALID_PAYMENT_SQL.replace(/status/g, 'py.status').replace(/method/g, 'py.method')} AND to_char(py.payment_date, 'YYYY-MM') = $2)
          ORDER BY p.name, h.unit_number LIMIT 300`, [ids, m])).rows;
      return { title: `No rent payment in ${m}`, columns: ['Tenant', 'Unit', 'Property', 'Rent (KES)', 'Owes (KES)'], rows: r.map(x => [x.full_name, x.unit_number, x.plot, money(x.rent_amount), money(x.balance)]), note: `${r.length} tenants have not paid in ${m}` };
    },
  },
  recent_payments: {
    description: 'The 25 most recent rent payments.',
    props: { plot: 'Part of a property name' },
    perm: 'payments.view',
    async run(user, a) {
      const ids = await plotIds(user, 'payments.view', a.plot); if (!ids.length) return none('Recent payments');
      const r = (await pool.query(
        `SELECT py.payment_date, t.full_name, h.unit_number, p.name AS plot, py.amount, py.method FROM payments py JOIN houses h ON h.id = py.house_id JOIN plots p ON p.id = h.plot_id LEFT JOIN tenants t ON t.id = py.tenant_id
          WHERE p.id = ANY($1) AND ${VALID_PAYMENT_SQL.replace(/status/g, 'py.status').replace(/method/g, 'py.method')} ORDER BY py.payment_date DESC, py.id DESC LIMIT 25`, [ids])).rows;
      return { title: 'Recent payments', columns: ['Date', 'Tenant', 'Unit', 'Property', 'Amount (KES)', 'Method'], rows: r.map(x => [new Date(x.payment_date).toISOString().slice(0, 10), x.full_name || '', x.unit_number, x.plot, money(x.amount), x.method || '']) };
    },
  },
  revenue_by_month: {
    description: 'Rent received in each month of a year. Optional: year (YYYY, default this year), plot.',
    props: { year: 'YYYY', plot: 'Part of a property name' },
    perm: 'payments.view',
    async run(user, a) {
      const y = /^\d{4}$/.test(a.year || '') ? a.year : String(new Date().getFullYear());
      const ids = await plotIds(user, 'payments.view', a.plot); if (!ids.length) return none('Revenue by month');
      const r = (await pool.query(
        `SELECT to_char(py.payment_date, 'YYYY-MM') AS month, SUM(py.amount) AS total FROM payments py JOIN houses h ON h.id = py.house_id
          WHERE h.plot_id = ANY($1) AND ${VALID_PAYMENT_SQL.replace(/status/g, 'py.status').replace(/method/g, 'py.method')} AND to_char(py.payment_date, 'YYYY') = $2 GROUP BY 1 ORDER BY 1`, [ids, y])).rows;
      const total = r.reduce((s, x) => s + Number(x.total), 0);
      return { title: `Rent received by month, ${y}`, columns: ['Month', 'Received (KES)'], rows: r.map(x => [x.month, money(x.total)]), note: `Total KES ${money(total)}` };
    },
  },
  expiring_leases: {
    description: 'Active tenants who have been in their unit 11 months or more (lease renewal due).',
    props: { plot: 'Part of a property name' },
    perm: 'tenants.view',
    async run(user, a) {
      const ids = await plotIds(user, 'tenants.view', a.plot); if (!ids.length) return none('Leases');
      const r = (await pool.query(
        `SELECT t.full_name, h.unit_number, p.name AS plot, t.move_in_date, (EXTRACT(YEAR FROM age(CURRENT_DATE, t.move_in_date)) * 12 + EXTRACT(MONTH FROM age(CURRENT_DATE, t.move_in_date)))::int AS months
           FROM tenants t JOIN houses h ON h.id = t.house_id JOIN plots p ON p.id = h.plot_id
          WHERE t.is_active = true AND p.id = ANY($1) AND t.move_in_date <= CURRENT_DATE - INTERVAL '11 months' ORDER BY t.move_in_date LIMIT 200`, [ids])).rows;
      return { title: 'Tenancies of 11 months or more', columns: ['Tenant', 'Unit', 'Property', 'Moved in', 'Months'], rows: r.map(x => [x.full_name, x.unit_number, x.plot, new Date(x.move_in_date).toISOString().slice(0, 10), x.months]), note: `${r.length} tenancies` };
    },
  },
  recent_move_ins: {
    description: 'Tenants who moved in during the last 90 days.',
    props: { plot: 'Part of a property name' },
    perm: 'tenants.view',
    async run(user, a) {
      const ids = await plotIds(user, 'tenants.view', a.plot); if (!ids.length) return none('Move-ins');
      const r = (await pool.query(
        `SELECT t.full_name, h.unit_number, p.name AS plot, t.move_in_date, h.rent_amount FROM tenants t JOIN houses h ON h.id = t.house_id JOIN plots p ON p.id = h.plot_id
          WHERE t.is_active = true AND p.id = ANY($1) AND t.move_in_date >= CURRENT_DATE - INTERVAL '90 days' ORDER BY t.move_in_date DESC LIMIT 200`, [ids])).rows;
      return { title: 'Moved in during the last 90 days', columns: ['Tenant', 'Unit', 'Property', 'Moved in', 'Rent (KES)'], rows: r.map(x => [x.full_name, x.unit_number, x.plot, new Date(x.move_in_date).toISOString().slice(0, 10), money(x.rent_amount)]), note: `${r.length} new tenants` };
    },
  },
  collection_by_property: {
    description: 'For a month, per property: rent expected from occupied units, rent collected, still to collect and percent collected. Optional: month (YYYY-MM, default this month), plot.',
    props: { month: 'YYYY-MM', plot: 'Part of a property name' },
    perm: 'payments.view',
    async run(user, a) {
      const m = MONTH.test(a.month || '') ? a.month : curMonth();
      const ids = await plotIds(user, 'payments.view', a.plot); if (!ids.length) return none('Collection by property');
      const r = (await pool.query(
        `SELECT p.name AS plot,
                COALESCE((SELECT SUM(h.rent_amount) FROM houses h WHERE h.plot_id = p.id AND h.status = 'occupied'), 0) AS expected,
                COALESCE((SELECT SUM(py.amount) FROM payments py JOIN houses h ON h.id = py.house_id WHERE h.plot_id = p.id
                           AND ${VALID_PAYMENT_SQL.replace(/status/g, 'py.status').replace(/method/g, 'py.method')} AND to_char(py.payment_date, 'YYYY-MM') = $2), 0) AS collected
           FROM plots p WHERE p.id = ANY($1) ORDER BY p.name`, [ids, m])).rows;
      const exp = r.reduce((s, x) => s + Number(x.expected), 0), col = r.reduce((s, x) => s + Number(x.collected), 0);
      return { title: `Rent collected per property, ${m}`, columns: ['Property', 'Expected (KES)', 'Collected (KES)', 'Still to collect (KES)', 'Collected'],
        rows: r.map(x => [x.plot, money(x.expected), money(x.collected), money(Math.max(0, x.expected - x.collected)), Number(x.expected) > 0 ? `${Math.round(100 * x.collected / x.expected)}%` : '-']),
        note: `All properties: KES ${money(col)} of KES ${money(exp)} expected. Expected is the rent of occupied units; paying ahead or arrears can make a month differ.` };
    },
  },
  unpaid_utility_bills: {
    description: 'Tenants (and businesses sharing a unit) who have not paid their water or electricity bill, per property: own-meter bills and shared-meter shares. Optional: utility (Water or Electricity, default Water), plot.',
    props: { utility: 'Water or Electricity', plot: 'Part of a property name' },
    perm: 'meters.view',
    async run(user, a) {
      const util = /^elec/i.test(a.utility || '') ? 'Electricity' : 'Water';
      const ids = await plotIds(user, 'meters.view', a.plot); if (!ids.length) return none(`Unpaid ${util.toLowerCase()} bills`);
      const names = new Map((await pool.query('SELECT id, name FROM plots WHERE id = ANY($1)', [ids])).rows.map(p => [p.id, p.name]));
      const out = [];
      if ((await pool.query(`SELECT to_regclass('meter_readings') AS t`)).rows[0].t) {
        const r = (await pool.query(
          `SELECT mr.plot_id, h.unit_number, t.full_name, SUM(mr.amount) AS owed, string_agg(mr.billing_month, ', ' ORDER BY mr.billing_month) AS months
             FROM meter_readings mr JOIN houses h ON h.id = mr.house_id LEFT JOIN tenants t ON t.id = mr.tenant_id
            WHERE mr.plot_id = ANY($1) AND mr.utility_type = $2 AND mr.status = 'billed' AND mr.amount > 0
            GROUP BY mr.plot_id, h.unit_number, t.full_name`, [ids, util])).rows;
        for (const x of r) out.push({ plot: names.get(x.plot_id), unit: x.unit_number, who: x.full_name || '(no tenant)', kind: 'Own meter', months: x.months, owed: Number(x.owed) });
      }
      if ((await pool.query(`SELECT to_regclass('shared_meters') AS t`)).rows[0].t) {
        const ms = (await pool.query(`SELECT id, plot_id FROM shared_meters WHERE plot_id = ANY($1) AND utility_type = $2 AND active = true`, [ids, util])).rows;
        for (const sm of ms) {
          const c = await computeMeter(pool, sm.id); if (!c) continue;
          const agg = new Map();
          for (const b of c.bills) for (const row of b.rows) {
            if (row.balance <= 0) continue;
            const k = `${row.house_id}:${row.payer_id || ''}`;
            const e = agg.get(k) || { unit: row.unit_number, who: row.tenant_name || '(no tenant)', months: [], owed: 0 };
            e.months.push(b.billing_month); e.owed += row.balance; agg.set(k, e);
          }
          for (const e of agg.values()) out.push({ plot: names.get(sm.plot_id), unit: e.unit, who: e.who, kind: 'Shared meter', months: e.months.sort().join(', '), owed: e.owed });
        }
      }
      out.sort((x, y) => String(x.plot).localeCompare(String(y.plot)) || String(x.unit).localeCompare(String(y.unit), undefined, { numeric: true }));
      const total = out.reduce((s, x) => s + x.owed, 0);
      return { title: `Unpaid ${util.toLowerCase()} bills`, columns: ['Property', 'Unit', 'Tenant / business', 'Meter', 'Months unpaid', 'Owes (KES)'],
        rows: out.map(x => [x.plot, x.unit, x.who, x.kind, x.months, money(x.owed)]), note: `${out.length} unpaid, KES ${money(total)} in total` };
    },
  },
};

// Questions shown as buttons; these run directly without the AI.
const MENU = [
  { id: 'unpaid', label: 'Who owes rent?', tool: 'unpaid_rent', args: {} },
  { id: 'collection', label: 'Rent collected this month, per property', tool: 'collection_by_property', args: {} },
  { id: 'water', label: 'Who has not paid their water bill?', tool: 'unpaid_utility_bills', args: { utility: 'Water' } },
  { id: 'received', label: 'Rent received this month', tool: 'payments_received', args: {} },
  { id: 'received_last', label: 'Rent received last month', tool: 'payments_received', args: { month: 'LAST' } },
  { id: 'vacant', label: 'Vacant units', tool: 'vacant_units', args: {} },
  { id: 'occupancy', label: 'Occupancy by property', tool: 'occupancy', args: {} },
  { id: 'maint', label: 'Open maintenance requests', tool: 'open_maintenance', args: {} },
  { id: 'exp', label: 'Expenses this month', tool: 'expenses_summary', args: {} },
  { id: 'exp_last', label: 'Expenses last month', tool: 'expenses_summary', args: { month: 'LAST' } },
  { id: 'notpaid', label: 'Who has not paid this month?', tool: 'not_paid_this_month', args: {} },
  { id: 'recent', label: 'Latest 25 payments', tool: 'recent_payments', args: {} },
  { id: 'revyear', label: 'Rent received by month this year', tool: 'revenue_by_month', args: {} },
  { id: 'leases', label: 'Tenancies of 11+ months', tool: 'expiring_leases', args: {} },
  { id: 'movein', label: 'Recent move-ins', tool: 'recent_move_ins', args: {} },
];

function lastMonth() { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); }

async function runTool(user, name, args) {
  const t = TOOLS[name]; if (!t) return { title: 'Unknown', columns: [], rows: [], note: 'Unknown question.' };
  const a = { ...(args || {}) }; if (a.month === 'LAST') a.month = lastMonth();
  return t.run(user, a);
}

const toolDefs = () => Object.entries(TOOLS).map(([name, t]) => ({
  name, description: t.description,
  input_schema: { type: 'object', properties: Object.fromEntries(Object.entries(t.props).map(([k, d]) => [k, { type: 'string', description: d }])), required: t.required || [] },
}));

module.exports = { TOOLS, MENU, runTool, toolDefs };

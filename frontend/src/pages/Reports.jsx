import { useState, useEffect } from 'react';
import API from '../services/api';

// ── Report definitions ────────────────────────────────────────────────────────
const REPORTS = [
  { id: 'payments',       icon: '💳', label: 'Payment Collection',    desc: 'All rent payments received',           color: 'var(--green)',   light: 'var(--green-light)'   },
  { id: 'unpaid',         icon: '⚠️', label: 'Unpaid Rent',           desc: 'Outstanding balances, with aging',     color: 'var(--red)',     light: 'var(--red-light)'     },
  { id: 'tenants',        icon: '👥', label: 'Tenant List',           desc: 'All active and inactive tenants',      color: 'var(--primary)', light: 'var(--primary-light)' },
  { id: 'maintenance',    icon: '🔧', label: 'Maintenance Records',   desc: 'All maintenance requests by status',   color: 'var(--amber)',   light: 'var(--amber-light)'   },
  { id: 'properties',     icon: '🏢', label: 'Property Summary',      desc: 'Plots, units, occupancy overview',     color: 'var(--blue)',    light: 'var(--blue-light)'    },
  { id: 'occupancy',      icon: '📊', label: 'Occupancy Report',      desc: 'Vacant vs occupied units over time',   color: '#8b5cf6',       light: '#ede9fe'              },
  { id: 'expenses',       icon: '💸', label: 'Expenses Report',       desc: 'All property expenses by category',   color: '#f97316',       light: '#fff7ed'              },
  { id: 'revenue',        icon: '📈', label: 'Revenue Summary',       desc: 'Monthly and yearly revenue totals',    color: 'var(--green)',   light: 'var(--green-light)'   },
  { id: 'moveins',        icon: '🏠', label: 'Move-in / Move-out',    desc: 'Tenant movement history',              color: 'var(--primary)', light: 'var(--primary-light)' },
  { id: 'expiring',       icon: '📅', label: 'Expiring Leases',       desc: 'Tenants with leases 11+ months old',   color: 'var(--amber)',   light: 'var(--amber-light)'   },
  { id: 'rentroll',       icon: '📋', label: 'Rent Roll',             desc: 'Snapshot of every occupied unit',      color: 'var(--blue)',    light: 'var(--blue-light)'    },
  { id: 'paymentmethods', icon: '🏦', label: 'Payment Methods',       desc: 'Collections by mpesa / bank / cash',   color: '#8b5cf6',        light: '#ede9fe'              },
  { id: 'performance',    icon: '🏆', label: 'Property Performance', desc: 'Plots ranked by occupancy & revenue',  color: 'var(--blue)',    light: 'var(--blue-light)'    },
  { id: 'tenure',         icon: '⏳', label: 'Tenant Tenure',         desc: 'How long each active tenant has stayed', color: 'var(--primary)', light: 'var(--primary-light)' },
  { id: 'caretakerload',  icon: '🧑‍🔧', label: 'Caretaker Workload',   desc: 'Maintenance requests per caretaker',   color: 'var(--amber)',   light: 'var(--amber-light)'   },
  { id: 'comparison',     icon: '🔁', label: 'Period Comparison',     desc: 'This month vs last, or year vs year',  color: 'var(--green)',   light: 'var(--green-light)'   },
  { id: 'depositledger',  icon: '🔐', label: 'Deposit Ledger',        desc: 'Deposits collected, refunded, forfeited', color: 'var(--blue)',  light: 'var(--blue-light)'    },
  { id: 'audittrail',     icon: '🕵️', label: 'Audit Trail',           desc: 'Who changed what, and when (admin only)', color: '#8b5cf6',      light: '#ede9fe'              },
];

function getThisYear()  { return new Date().getFullYear(); }
function getThisMonth() { return new Date().getMonth() + 1; }

// Reports that don't use the period/month selectors at all — they're either
// current-state snapshots (rentroll, performance, tenure) or have their own
// dedicated month/year controls (comparison).
const NO_PERIOD_FILTER = ['properties', 'occupancy', 'expiring', 'revenue', 'rentroll', 'performance', 'tenure', 'comparison', 'depositledger', 'audittrail'];

function daysBetween(a, b) { return Math.floor((a - b) / (1000 * 60 * 60 * 24)); }

function agingBucket(days) {
  if (days <= 30) return '0–30 days';
  if (days <= 60) return '31–60 days';
  if (days <= 90) return '61–90 days';
  return '90+ days';
}

function pctChange(current, previous) {
  if (!previous) return current > 0 ? '+100%' : '0%';
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

// Turns a formatted cell value ("KES 12,000", "Jan 2026", "Alice") into
// something comparable for sorting — numeric where possible, else lowercase text.
function sortableValue(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  const numeric = s.replace(/[^0-9.\-]/g, '');
  if (numeric && /\d/.test(numeric) && !/[a-zA-Z]{2,}/.test(s.replace(/KES|%/g, ''))) {
    const n = parseFloat(numeric);
    if (!isNaN(n)) return n;
  }
  return s.toLowerCase();
}

// Small dependency-free bar chart — used for the Revenue trend and the
// Period Comparison view. Avoids pulling in a charting library.
function MiniBarChart({ data, color = 'var(--primary, #7c3aed)' }) {
  const max = Math.max(1, ...data.map(d => d.value));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 90, marginBottom: 4 }}>
      {data.map((d, i) => (
        <div key={i} title={`${d.label}: ${d.value.toLocaleString()}`}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{ width: '100%', maxWidth: 36, background: color, borderRadius: '4px 4px 0 0', height: `${Math.max(3, (d.value / max) * 70)}px` }} />
          <div style={{ fontSize: 9, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{d.label}</div>
        </div>
      ))}
    </div>
  );
}

export default function Reports() {
  const [active,   setActive]   = useState('payments');
  const [data,     setData]     = useState({});
  const [loading,  setLoading]  = useState(false);
  const [filters,  setFilters]  = useState({
    period: 'month', month: getThisMonth(), year: getThisYear(), status: 'all',
    propertyName: 'all', location: 'all', fromDate: '', toDate: '', comparisonMode: 'mom', landlord: 'all',
  });
  const [tableSearch, setTableSearch] = useState('');
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [pinned, setPinned] = useState(() => {
    try { return JSON.parse(localStorage.getItem('report_pins') || '[]'); } catch { return []; }
  });

  const report = REPORTS.find(r => r.id === active);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadReport(); }, [active, filters]);

  function togglePin(id) {
    setPinned(p => {
      const next = p.includes(id) ? p.filter(x => x !== id) : [...p, id];
      try { localStorage.setItem('report_pins', JSON.stringify(next)); } catch {}
      return next;
    });
  }

  async function loadReport() {
    setLoading(true);
    try {
      const [tr, pr, hr, mr, plr, er] = await Promise.all([
        API.get('/tenants'),
        API.get('/payments'),
        API.get('/houses'),
        API.get('/maintenance'),
        API.get('/plots'),
        API.get('/expenses'),
      ]);
      // Caretaker workload needs the user list (for plot assignment); fetched
      // separately and swallowed on failure so it never breaks other reports
      // for users without permission to list all users.
      let users = [];
      try {
        const ur = await API.get('/auth/users');
        users = arr(ur.data);
      } catch { users = []; }

      // Real multi-plot assignment per caretaker, via the caretaker_plots
      // junction table your backend already exposes at /auth/users/:id/plots —
      // the plain /auth/users list only carries the single legacy plot_id.
      let caretakerPlots = {};
      try {
        const caretakers = users.filter(u => u.role === 'caretaker');
        const plotLists = await Promise.all(caretakers.map(c => API.get(`/auth/users/${c.id}/plots`).then(r => arr(r.data)).catch(() => [])));
        caretakers.forEach((c, i) => { caretakerPlots[c.id] = plotLists[i]; });
      } catch { caretakerPlots = {}; }

      let deposits = [];
      try {
        const dr = await API.get('/deposits');
        deposits = arr(dr.data);
      } catch { deposits = []; }

      let auditLog = [];
      try {
        const ar = await API.get('/audit-log');
        auditLog = arr(ar.data);
      } catch { auditLog = []; } // 403 for non-admins — expected, not an error

      setData({
        tenants: arr(tr.data), payments: arr(pr.data), houses: arr(hr.data),
        requests: arr(mr.data), plots: arr(plr.data), expenses: arr(er.data), users, deposits, auditLog, caretakerPlots,
      });
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  function arr(d) { return Array.isArray(d) ? d : (d?.data || []); }

  function filterByPeriod(items, dateField) {
    return items.filter(item => {
      if (!item[dateField]) return true;
      const d = new Date(item[dateField]);
      if (filters.period === 'month') return d.getMonth() + 1 === filters.month && d.getFullYear() === filters.year;
      if (filters.period === 'year')  return d.getFullYear() === filters.year;
      if (filters.period === 'range') {
        if (filters.fromDate && d < new Date(filters.fromDate)) return false;
        if (filters.toDate   && d > new Date(`${filters.toDate}T23:59:59`)) return false;
        return true;
      }
      return true; // 'all'
    });
  }

  function downloadCSV(rows, filename) {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]).filter(h => !h.startsWith('_'));
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadStatement(tenantId, name) {
    if (!tenantId) return;
    try {
      const res = await API.get(`/statements/${tenantId}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `statement_${String(name || 'tenant').replace(/\s+/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error(e); alert('Could not generate statement.'); }
  }

  async function downloadAllStatements() {
    try {
      const res = await API.get('/statements/bulk/all.zip', { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `tenant_statements_${new Date().toISOString().split('T')[0]}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error(e); alert('Could not generate statements.'); }
  }

  const years  = Array.from({ length: 5 }, (_, i) => getThisYear() - i);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // ── Compute report rows ────────────────────────────────────────────────────
  let rows = [], columns = [], title = '', summary = null, chart = null;

  if (data.payments) {
    const { tenants, payments, houses, requests, plots, expenses, users, deposits, auditLog, caretakerPlots } = data;

    if (active === 'payments') {
      const filtered = filterByPeriod(payments, 'payment_date');
      const total    = filtered.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
      columns = ['Tenant', 'Amount (KES)', 'Method', 'Reference', 'Status', 'Date'];
      rows    = filtered.map(p => ({
        Tenant: p.tenant_name || '—',
        'Amount (KES)': parseFloat(p.amount || 0).toLocaleString(),
        Method: p.method || 'mpesa',
        Reference: p.receipt_no || '—',
        Status: p.status,
        Date: new Date(p.payment_date).toLocaleDateString('en-KE'),
      }));
      summary = [{ label: 'Total Collected', value: `KES ${total.toLocaleString()}`, color: 'var(--green)' }, { label: 'Transactions', value: filtered.length, color: 'var(--blue)' }];
      title = `Payment Collection Report`;
    }

    if (active === 'unpaid') {
      // Aging is approximate: it's based on each tenant's most recent recorded
      // payment (matched by name), or their move-in date if they have never
      // paid. There's no monthly rent-charge history table, so this can't
      // reflect exactly which month(s) are unpaid — only how long it's been
      // since money was last seen from them.
      const lastPaymentByTenant = {};
      payments.forEach(p => {
        if (!p.tenant_name) return;
        const d = new Date(p.payment_date);
        if (!lastPaymentByTenant[p.tenant_name] || d > lastPaymentByTenant[p.tenant_name]) lastPaymentByTenant[p.tenant_name] = d;
      });
      const unpaid = filterByPeriod(tenants.filter(t => t.is_active && parseFloat(t.balance || 0) > 0), 'move_in_date');
      const total  = unpaid.reduce((s, t) => s + parseFloat(t.balance || 0), 0);
      const now = new Date();
      const withAging = unpaid.map(t => {
        const baseline = lastPaymentByTenant[t.full_name] || (t.move_in_date ? new Date(t.move_in_date) : now);
        const days = Math.max(0, daysBetween(now, baseline));
        return { t, days, bucket: agingBucket(days) };
      });
      columns = ['Tenant', 'Phone', 'Unit', 'Plot', 'Balance (KES)', 'Days Overdue', 'Aging Bucket', 'Move-in', 'Due Day'];
      rows    = withAging.map(({ t, days, bucket }) => ({
        Tenant: t.full_name,
        Phone: t.phone || '—',
        Unit: t.unit_number || `#${t.house_id}`,
        Plot: t.plot_name || '—',
        'Balance (KES)': parseFloat(t.balance).toLocaleString(),
        'Days Overdue': days,
        'Aging Bucket': bucket,
        'Move-in': t.move_in_date ? new Date(t.move_in_date).toLocaleDateString('en-KE') : '—',
        'Due Day': t.rent_due_day || '—',
      }));
      const bucketCount = b => withAging.filter(x => x.bucket === b).length;
      summary = [
        { label: 'Tenants Owing', value: unpaid.length, color: 'var(--red)' },
        { label: 'Total Unpaid', value: `KES ${total.toLocaleString()}`, color: 'var(--red)' },
        { label: '0–30 days', value: bucketCount('0–30 days'), color: 'var(--green)' },
        { label: '31–60 days', value: bucketCount('31–60 days'), color: 'var(--amber)' },
        { label: '61–90 days', value: bucketCount('61–90 days'), color: '#f97316' },
        { label: '90+ days', value: bucketCount('90+ days'), color: 'var(--red)' },
      ];
      title = 'Unpaid Rent Report';
    }

    if (active === 'tenants') {
      const filtered = tenants
        .filter(t => filters.status === 'all' || (filters.status === 'active' ? t.is_active : !t.is_active))
        .filter(t => filters.landlord === 'all' || t.owner_name === filters.landlord);
      columns = ['Name', 'Phone', 'Email', 'Unit', 'Plot', 'Move-in', 'Balance (KES)', 'Status'];
      rows    = filtered.map(t => ({
        Name: t.full_name,
        Phone: t.phone || '—',
        Email: t.email || '—',
        Unit: t.unit_number || `#${t.house_id}`,
        Plot: t.plot_name || '—',
        'Move-in': t.move_in_date ? new Date(t.move_in_date).toLocaleDateString('en-KE') : '—',
        'Balance (KES)': parseFloat(t.balance || 0).toLocaleString(),
        Status: t.is_active ? 'Active' : 'Inactive',
      }));
      summary = [{ label: 'Total Tenants', value: filtered.length, color: 'var(--primary)' }, { label: 'Active', value: filtered.filter(t=>t.is_active).length, color: 'var(--green)' }];
      title = 'Tenant List Report';
    }

    if (active === 'maintenance') {
      const filtered = filterByPeriod(requests, 'reported_at').filter(r => filters.status === 'all' || r.status === filters.status);
      columns = ['#', 'Issue', 'Priority', 'Status', 'Unit', 'Reported', 'Resolved'];
      rows    = filtered.map(r => ({
        '#': r.id,
        Issue: r.issue,
        Priority: r.priority,
        Status: r.status,
        Unit: r.unit_number || `#${r.house_id}`,
        Reported: new Date(r.reported_at).toLocaleDateString('en-KE'),
        Resolved: r.resolved_at ? new Date(r.resolved_at).toLocaleDateString('en-KE') : '—',
      }));
      summary = [{ label: 'Total', value: filtered.length, color: 'var(--amber)' }, { label: 'Pending', value: filtered.filter(r=>r.status==='pending').length, color: 'var(--red)' }, { label: 'Completed', value: filtered.filter(r=>r.status==='completed').length, color: 'var(--green)' }];
      title = 'Maintenance Records Report';
    }

    if (active === 'properties') {
      const filteredPlots = plots.filter(p =>
        (filters.propertyName === 'all' || p.name === filters.propertyName) &&
        (filters.location === 'all' || p.location === filters.location) &&
        (filters.landlord === 'all' || p.owner_name === filters.landlord)
      );
      columns = ['Plot', 'Location', 'Total Units', 'Occupied', 'Vacant', 'Monthly Revenue (KES)'];
      rows    = filteredPlots.map(p => {
        const units    = houses.filter(h => h.plot_id === p.id);
        const occupied = units.filter(h => h.status === 'occupied');
        const vacant   = units.filter(h => h.status === 'vacant');
        const revenue  = occupied.reduce((s, h) => s + parseFloat(h.rent_amount || 0), 0);
        return {
          Plot: p.name,
          Location: p.location || '—',
          'Total Units': units.length,
          Occupied: occupied.length,
          Vacant: vacant.length,
          'Monthly Revenue (KES)': revenue.toLocaleString(),
        };
      });
      summary = [{ label: 'Total Plots', value: filteredPlots.length, color: 'var(--blue)' }, { label: 'Total Units', value: filteredPlots.reduce((s, p) => s + houses.filter(h => h.plot_id === p.id).length, 0), color: 'var(--primary)' }];
      title = 'Property Summary Report';
    }

    if (active === 'occupancy') {
      const occupied = houses.filter(h => h.status === 'occupied');
      const vacant   = houses.filter(h => h.status === 'vacant');
      const rate     = houses.length > 0 ? Math.round((occupied.length / houses.length) * 100) : 0;
      const now = new Date();
      columns = ['Unit', 'Type', 'Plot', 'Rent (KES)', 'Status', 'Days Vacant'];
      rows    = houses.map(h => ({
        Unit: `Unit ${h.unit_number}`,
        Type: h.house_type,
        Plot: h.plot_name || '—',
        'Rent (KES)': parseFloat(h.rent_amount || 0).toLocaleString(),
        Status: h.status,
        'Days Vacant': h.status === 'vacant' && h.status_changed_at ? Math.max(0, daysBetween(now, new Date(h.status_changed_at))) : '—',
      }));
      const vacantWithDays = vacant.filter(h => h.status_changed_at);
      const avgDaysVacant  = vacantWithDays.length
        ? Math.round(vacantWithDays.reduce((s, h) => s + Math.max(0, daysBetween(now, new Date(h.status_changed_at))), 0) / vacantWithDays.length)
        : null;
      summary = [
        { label: 'Occupancy Rate', value: `${rate}%`, color: 'var(--green)' },
        { label: 'Occupied', value: occupied.length, color: 'var(--amber)' },
        { label: 'Vacant', value: vacant.length, color: 'var(--blue)' },
        ...(avgDaysVacant !== null ? [{ label: 'Avg Days Vacant', value: avgDaysVacant, color: 'var(--red)' }] : []),
      ];
      title = 'Occupancy Report';
    }

    if (active === 'expenses') {
      const filtered = filterByPeriod(expenses, 'expense_date');
      const total    = filtered.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
      columns = ['Plot', 'Category', 'Description', 'Amount (KES)', 'Date'];
      rows    = filtered.map(e => ({
        Plot: e.plot_name || '—',
        Category: e.category || '—',
        Description: e.description || '—',
        'Amount (KES)': parseFloat(e.amount || 0).toLocaleString(),
        Date: e.expense_date ? new Date(e.expense_date).toLocaleDateString('en-KE') : '—',
      }));
      summary = [{ label: 'Total Expenses', value: `KES ${total.toLocaleString()}`, color: 'var(--red)' }, { label: 'Records', value: filtered.length, color: 'var(--muted)' }];
      title = 'Expenses Report';
    }

    if (active === 'revenue') {
      const byMonth = {};
      payments.filter(p => new Date(p.payment_date).getFullYear() === filters.year).forEach(p => {
        const m = new Date(p.payment_date).getMonth();
        if (!byMonth[m]) byMonth[m] = 0;
        byMonth[m] += parseFloat(p.amount || 0);
      });
      columns = ['Month', 'Revenue (KES)', 'Transactions'];
      rows    = months.map((m, i) => ({
        Month: `${m} ${filters.year}`,
        'Revenue (KES)': (byMonth[i] || 0).toLocaleString(),
        Transactions: payments.filter(p => new Date(p.payment_date).getMonth() === i && new Date(p.payment_date).getFullYear() === filters.year).length,
      }));
      const total = Object.values(byMonth).reduce((s, v) => s + v, 0);
      summary = [{ label: `Total ${filters.year}`, value: `KES ${total.toLocaleString()}`, color: 'var(--green)' }];
      title = `Revenue Summary ${filters.year}`;
      chart = <MiniBarChart data={months.map((m, i) => ({ label: m, value: byMonth[i] || 0 }))} color="var(--green, #16a34a)" />;
    }

    if (active === 'moveins') {
      const filtered = filterByPeriod(tenants.filter(t => t.move_in_date), 'move_in_date');
      columns = ['Tenant', 'Phone', 'Unit', 'Plot', 'Move-in Date', 'Status'];
      rows    = filtered.map(t => ({
        Tenant: t.full_name,
        Phone: t.phone || '—',
        Unit: t.unit_number || `#${t.house_id}`,
        Plot: t.plot_name || '—',
        'Move-in Date': new Date(t.move_in_date).toLocaleDateString('en-KE'),
        Status: t.is_active ? 'Active' : 'Moved Out',
      }));
      summary = [{ label: 'Records', value: filtered.length, color: 'var(--primary)' }];
      title = 'Move-in / Move-out Report';
    }

    if (active === 'expiring') {
      const elevenMonthsAgo = new Date(); elevenMonthsAgo.setMonth(elevenMonthsAgo.getMonth() - 11);
      const expiring = tenants.filter(t => t.is_active && t.move_in_date && new Date(t.move_in_date) <= elevenMonthsAgo);
      columns = ['Tenant', 'Phone', 'Unit', 'Plot', 'Move-in Date', 'Tenancy'];
      rows    = expiring.map(t => {
        const tenureMonths = Math.floor((new Date() - new Date(t.move_in_date)) / (1000 * 60 * 60 * 24 * 30));
        return {
          Tenant: t.full_name, Phone: t.phone || '—',
          Unit: t.unit_number || `#${t.house_id}`, Plot: t.plot_name || '—',
          'Move-in Date': new Date(t.move_in_date).toLocaleDateString('en-KE'),
          Tenancy: `${tenureMonths}m`,
        };
      });
      summary = [{ label: 'Expiring', value: expiring.length, color: 'var(--amber)' }];
      title = 'Expiring Leases Report';
    }

    if (active === 'rentroll') {
      const occupied = houses.filter(h => h.status === 'occupied' && (filters.landlord === 'all' || h.owner_name === filters.landlord));
      columns = ['Unit', 'Tenant', 'Plot', 'Rent (KES)', 'Balance (KES)', 'Status'];
      rows = occupied.map(h => {
        const t = tenants.find(t => t.house_id === h.id);
        return {
          Unit: `Unit ${h.unit_number}`,
          Tenant: t?.full_name || '—',
          Plot: h.plot_name || '—',
          'Rent (KES)': parseFloat(h.rent_amount || 0).toLocaleString(),
          'Balance (KES)': t ? parseFloat(t.balance || 0).toLocaleString() : '—',
          Status: t ? (parseFloat(t.balance || 0) > 0 ? 'Owing' : 'Paid Up') : 'No Tenant Record',
          _tenantId: t?.id || null,
        };
      });
      const totalRent = occupied.reduce((s, h) => s + parseFloat(h.rent_amount || 0), 0);
      const totalOwed = rows.reduce((s, r) => s + (parseFloat(String(r['Balance (KES)']).replace(/,/g, '')) || 0), 0);
      summary = [{ label: 'Occupied Units', value: occupied.length, color: 'var(--blue)' }, { label: 'Monthly Rent Roll', value: `KES ${totalRent.toLocaleString()}`, color: 'var(--green)' }, { label: 'Outstanding', value: `KES ${totalOwed.toLocaleString()}`, color: 'var(--red)' }];
      title = 'Rent Roll';
    }

    if (active === 'paymentmethods') {
      const filtered = filterByPeriod(payments, 'payment_date');
      const byMethod = {};
      filtered.forEach(p => {
        const m = p.method || 'mpesa';
        if (!byMethod[m]) byMethod[m] = { count: 0, total: 0 };
        byMethod[m].count += 1;
        byMethod[m].total += parseFloat(p.amount || 0);
      });
      const grandTotal = filtered.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
      columns = ['Method', 'Transactions', 'Total (KES)', '% of Total'];
      rows = Object.entries(byMethod).map(([method, v]) => ({
        Method: method,
        Transactions: v.count,
        'Total (KES)': v.total.toLocaleString(),
        '% of Total': grandTotal ? `${((v.total / grandTotal) * 100).toFixed(1)}%` : '0%',
      }));
      summary = [{ label: 'Total Collected', value: `KES ${grandTotal.toLocaleString()}`, color: 'var(--green)' }, { label: 'Transactions', value: filtered.length, color: 'var(--blue)' }];
      title = 'Payment Method Breakdown';
    }

    if (active === 'performance') {
      const ranked = plots.filter(p => filters.landlord === 'all' || p.owner_name === filters.landlord).map(p => {
        const units    = houses.filter(h => h.plot_id === p.id);
        const occupied = units.filter(h => h.status === 'occupied');
        const revenue   = occupied.reduce((s, h) => s + parseFloat(h.rent_amount || 0), 0);
        const rate      = units.length ? Math.round((occupied.length / units.length) * 100) : 0;
        return { plot: p, units: units.length, revenue, rate };
      }).sort((a, b) => b.rate - a.rate || b.revenue - a.revenue);
      columns = ['Rank', 'Plot', 'Location', 'Occupancy Rate', 'Units', 'Monthly Revenue (KES)'];
      rows = ranked.map((r, i) => ({
        Rank: i + 1,
        Plot: r.plot.name,
        Location: r.plot.location || '—',
        'Occupancy Rate': `${r.rate}%`,
        Units: r.units,
        'Monthly Revenue (KES)': r.revenue.toLocaleString(),
      }));
      summary = ranked.length ? [
        { label: 'Best Performing', value: ranked[0].plot.name, color: 'var(--green)' },
        { label: 'Needs Attention', value: ranked[ranked.length - 1].plot.name, color: 'var(--red)' },
      ] : null;
      title = 'Property Performance — Ranked by Occupancy';
    }

    if (active === 'tenure') {
      const active_tenants = tenants.filter(t => t.is_active && t.move_in_date);
      const withTenure = active_tenants.map(t => ({
        t, months: Math.floor((new Date() - new Date(t.move_in_date)) / (1000 * 60 * 60 * 24 * 30)),
      })).sort((a, b) => b.months - a.months);
      columns = ['Tenant', 'Unit', 'Plot', 'Move-in Date', 'Tenure (months)'];
      rows = withTenure.map(({ t, months }) => ({
        Tenant: t.full_name,
        Unit: t.unit_number || `#${t.house_id}`,
        Plot: t.plot_name || '—',
        'Move-in Date': new Date(t.move_in_date).toLocaleDateString('en-KE'),
        'Tenure (months)': months,
      }));
      const avg = withTenure.length ? Math.round(withTenure.reduce((s, x) => s + x.months, 0) / withTenure.length) : 0;
      summary = withTenure.length ? [
        { label: 'Average Tenure', value: `${avg} months`, color: 'var(--primary)' },
        { label: 'Longest-Staying', value: withTenure[0].t.full_name, color: 'var(--green)' },
      ] : null;
      title = 'Tenant Tenure Report';
    }

    if (active === 'caretakerload') {
      // Uses the real caretaker_plots junction data (fetched per caretaker via
      // /auth/users/:id/plots), so a caretaker assigned to several properties
      // shows all of them, not just the single legacy plot_id.
      const caretakers = users.filter(u => u.role === 'caretaker');
      const filteredRequests = filterByPeriod(requests, 'reported_at');
      columns = ['Caretaker', 'Assigned Plots', 'Total Requests', 'Pending', 'Completed'];
      rows = caretakers.map(c => {
        const assignedPlots = (caretakerPlots && caretakerPlots[c.id]) || [];
        const plotIds       = assignedPlots.length ? assignedPlots.map(p => p.id) : (c.plot_id ? [c.plot_id] : []);
        const plotHouseIds  = houses.filter(h => plotIds.includes(h.plot_id)).map(h => h.id);
        const myRequests    = filteredRequests.filter(r => plotHouseIds.includes(r.house_id));
        const plotNames     = assignedPlots.length ? assignedPlots.map(p => p.name).join(', ') : (c.plot_name || '— unassigned —');
        return {
          Caretaker: c.name || c.full_name || '—',
          'Assigned Plots': plotNames,
          'Total Requests': myRequests.length,
          Pending: myRequests.filter(r => r.status === 'pending').length,
          Completed: myRequests.filter(r => r.status === 'completed').length,
        };
      });
      summary = [{ label: 'Caretakers', value: caretakers.length, color: 'var(--amber)' }, { label: 'Total Requests', value: filteredRequests.length, color: 'var(--muted)' }];
      title = 'Caretaker Workload';
    }

    if (active === 'depositledger') {
      columns = ['Tenant', 'Unit', 'Plot', 'Type', 'Amount (KES)', 'Date', 'Notes'];
      rows = (deposits || []).map(d => ({
        Tenant: d.tenant_name || '—',
        Unit: d.unit_number ? `Unit ${d.unit_number}` : '—',
        Plot: d.plot_name || '—',
        Type: d.type,
        'Amount (KES)': parseFloat(d.amount || 0).toLocaleString(),
        Date: new Date(d.created_at).toLocaleDateString('en-KE'),
        Notes: d.notes || '—',
      }));
      const collected = (deposits || []).filter(d => d.type === 'collected').reduce((s, d) => s + parseFloat(d.amount || 0), 0);
      const refunded  = (deposits || []).filter(d => d.type === 'refunded').reduce((s, d) => s + parseFloat(d.amount || 0), 0);
      const forfeited = (deposits || []).filter(d => d.type === 'forfeited').reduce((s, d) => s + parseFloat(d.amount || 0), 0);
      summary = [
        { label: 'Collected', value: `KES ${collected.toLocaleString()}`, color: 'var(--green)' },
        { label: 'Refunded', value: `KES ${refunded.toLocaleString()}`, color: 'var(--blue)' },
        { label: 'Forfeited', value: `KES ${forfeited.toLocaleString()}`, color: 'var(--red)' },
        { label: 'Held (Net)', value: `KES ${(collected - refunded - forfeited).toLocaleString()}`, color: 'var(--primary)' },
      ];
      title = 'Deposit Ledger';
    }

    if (active === 'audittrail') {
      columns = ['When', 'User', 'Action', 'Entity', 'Changes'];
      rows = (auditLog || []).map(a => ({
        When: new Date(a.created_at).toLocaleString('en-KE'),
        User: a.user_name || `User #${a.user_id}` || '—',
        Action: a.action,
        Entity: `${a.entity_type}${a.entity_id ? ' #' + a.entity_id : ''}`,
        Changes: a.changes ? Object.entries(a.changes).map(([f, v]) => `${f}: ${v.from ?? '—'} → ${v.to ?? '—'}`).join('; ') : '—',
      }));
      summary = [{ label: 'Logged Actions', value: (auditLog || []).length, color: 'var(--primary)' }];
      title = 'Audit Trail';
    }

    if (active === 'comparison') {
      const periodTotal = (year, month, arrData, dateField) => arrData.filter(x => {
        if (!x[dateField]) return false;
        const d = new Date(x[dateField]);
        return d.getFullYear() === year && (month == null || d.getMonth() + 1 === month);
      }).reduce((s, x) => s + parseFloat(x.amount || 0), 0);

      const periodCount = (year, month, arrData, dateField) => arrData.filter(x => {
        if (!x[dateField]) return false;
        const d = new Date(x[dateField]);
        return d.getFullYear() === year && (month == null || d.getMonth() + 1 === month);
      }).length;

      let currentLabel, previousLabel, curYear, curMonth, prevYear, prevMonth;
      if (filters.comparisonMode === 'mom') {
        curYear = filters.year; curMonth = filters.month;
        prevMonth = curMonth - 1; prevYear = curYear;
        if (prevMonth < 1) { prevMonth = 12; prevYear -= 1; }
        currentLabel  = `${months[curMonth - 1]} ${curYear}`;
        previousLabel = `${months[prevMonth - 1]} ${prevYear}`;
      } else {
        curYear = filters.year; curMonth = null;
        prevYear = filters.year - 1; prevMonth = null;
        currentLabel = `${curYear}`;
        previousLabel = `${prevYear}`;
      }

      const curRevenue  = periodTotal(curYear, curMonth, payments, 'payment_date');
      const prevRevenue = periodTotal(prevYear, prevMonth, payments, 'payment_date');
      const curTx  = periodCount(curYear, curMonth, payments, 'payment_date');
      const prevTx = periodCount(prevYear, prevMonth, payments, 'payment_date');
      const curExp  = periodTotal(curYear, curMonth, expenses, 'expense_date');
      const prevExp = periodTotal(prevYear, prevMonth, expenses, 'expense_date');

      columns = ['Metric', currentLabel, previousLabel, 'Change'];
      rows = [
        { Metric: 'Revenue (KES)',     [currentLabel]: curRevenue.toLocaleString(), [previousLabel]: prevRevenue.toLocaleString(), Change: pctChange(curRevenue, prevRevenue) },
        { Metric: 'Transactions',      [currentLabel]: curTx,                       [previousLabel]: prevTx,                       Change: pctChange(curTx, prevTx) },
        { Metric: 'Expenses (KES)',    [currentLabel]: curExp.toLocaleString(),     [previousLabel]: prevExp.toLocaleString(),     Change: pctChange(curExp, prevExp) },
      ];
      summary = [
        { label: currentLabel, value: `KES ${curRevenue.toLocaleString()}`, color: 'var(--blue)' },
        { label: previousLabel, value: `KES ${prevRevenue.toLocaleString()}`, color: 'var(--muted)' },
        { label: 'Revenue Change', value: pctChange(curRevenue, prevRevenue), color: curRevenue >= prevRevenue ? 'var(--green)' : 'var(--red)' },
      ];
      title = `Revenue Comparison — ${filters.comparisonMode === 'mom' ? 'Month over Month' : 'Year over Year'}`;
      chart = <MiniBarChart data={[{ label: previousLabel, value: prevRevenue }, { label: currentLabel, value: curRevenue }]} color="var(--blue, #2563eb)" />;
    }
  }

  // ── Generic search + sort, applied to whichever report is active ──────────
  let visibleRows = tableSearch
    ? rows.filter(r => columns.some(c => String(r[c] ?? '').toLowerCase().includes(tableSearch.toLowerCase())))
    : rows;
  if (sortCol) {
    visibleRows = [...visibleRows].sort((a, b) => {
      const av = sortableValue(a[sortCol]), bv = sortableValue(b[sortCol]);
      const cmp = (typeof av === 'number' && typeof bv === 'number') ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  }

  const pinnedReports = REPORTS.filter(r => pinned.includes(r.id));
  const otherReports   = REPORTS.filter(r => !pinned.includes(r.id));

  function ReportButton({ r }) {
    return (
      <button key={r.id} onClick={() => setActive(r.id)} style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        borderRadius: 10, border: active === r.id ? `1.5px solid ${r.color}` : '1px solid var(--border)',
        background: active === r.id ? r.light : 'var(--surface)',
        cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', width: '100%',
      }}>
        <span style={{ fontSize: 18 }}>{r.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: active === r.id ? r.color : 'var(--text)' }}>{r.label}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{r.desc}</div>
        </div>
        <span onClick={e => { e.stopPropagation(); togglePin(r.id); }} title={pinned.includes(r.id) ? 'Unpin' : 'Pin to top'}
          style={{ fontSize: 14, cursor: 'pointer', color: pinned.includes(r.id) ? 'var(--amber, #d97706)' : 'var(--border)' }}>
          {pinned.includes(r.id) ? '★' : '☆'}
        </span>
      </button>
    );
  }

  return (
    <div>
      <style>{`@media print { .no-print { display: none !important; } }`}</style>
      <div style={{ marginBottom: 28 }} className="no-print">
        <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Reports</h1>
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>Generate, filter and download reports</p>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

        {/* ── Left: Report List ── */}
        <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }} className="no-print">
          {pinnedReports.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '2px 0' }}>Pinned</div>
              {pinnedReports.map(r => <ReportButton key={r.id} r={r} />)}
              <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
            </>
          )}
          {otherReports.map(r => <ReportButton key={r.id} r={r} />)}
        </div>

        {/* ── Right: Report Content ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Header */}
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '18px 22px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 17 }}>{report?.icon} {title || report?.label}</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }} className="no-print">

              {/* Period filter */}
              {!NO_PERIOD_FILTER.includes(active) && (
                <select value={filters.period} onChange={e => setFilters(f => ({ ...f, period: e.target.value }))} style={selectStyle}>
                  <option value="all">All Time</option>
                  <option value="month">By Month</option>
                  <option value="year">By Year</option>
                  <option value="range">Custom Range</option>
                </select>
              )}

              {/* Custom date range */}
              {filters.period === 'range' && !NO_PERIOD_FILTER.includes(active) && (
                <>
                  <input type="date" value={filters.fromDate} onChange={e => setFilters(f => ({ ...f, fromDate: e.target.value }))} style={selectStyle} />
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>to</span>
                  <input type="date" value={filters.toDate} onChange={e => setFilters(f => ({ ...f, toDate: e.target.value }))} style={selectStyle} />
                </>
              )}

              {/* Month picker */}
              {((filters.period === 'month' && !NO_PERIOD_FILTER.includes(active)) || active === 'comparison') && (
                <select value={filters.month} onChange={e => setFilters(f => ({ ...f, month: parseInt(e.target.value) }))} style={selectStyle}>
                  {months.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              )}

              {/* Year picker */}
              {(filters.period !== 'all' || active === 'revenue' || active === 'comparison') && (
                <select value={filters.year} onChange={e => setFilters(f => ({ ...f, year: parseInt(e.target.value) }))} style={selectStyle}>
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              )}

              {/* Comparison mode */}
              {active === 'comparison' && (
                <select value={filters.comparisonMode} onChange={e => setFilters(f => ({ ...f, comparisonMode: e.target.value }))} style={selectStyle}>
                  <option value="mom">Month over Month</option>
                  <option value="yoy">Year over Year</option>
                </select>
              )}

              {/* Property + Location filters for Property Summary */}
              {active === 'properties' && (
                <>
                  <select value={filters.propertyName} onChange={e => setFilters(f => ({ ...f, propertyName: e.target.value }))} style={selectStyle}>
                    <option value="all">All Properties</option>
                    {[...new Set((data.plots || []).map(p => p.name))].sort().map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                  <select value={filters.location} onChange={e => setFilters(f => ({ ...f, location: e.target.value }))} style={selectStyle}>
                    <option value="all">All Locations</option>
                    {[...new Set((data.plots || []).map(p => p.location).filter(Boolean))].sort().map(loc => (
                      <option key={loc} value={loc}>{loc}</option>
                    ))}
                  </select>
                </>
              )}

              {/* Landlord filter — only meaningful when more than one landlord's data is visible (admin view) */}
              {['properties', 'tenants', 'performance', 'rentroll'].includes(active) && [...new Set((data.plots || []).map(p => p.owner_name).filter(Boolean))].length > 1 && (
                <select value={filters.landlord} onChange={e => setFilters(f => ({ ...f, landlord: e.target.value }))} style={selectStyle}>
                  <option value="all">All Landlords</option>
                  {[...new Set((data.plots || []).map(p => p.owner_name).filter(Boolean))].sort().map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              )}

              {/* Status filter for tenants and maintenance */}
              {active === 'tenants' && (
                <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} style={selectStyle}>
                  <option value="all">All Tenants</option>
                  <option value="active">Active Only</option>
                  <option value="inactive">Inactive Only</option>
                </select>
              )}
              {active === 'maintenance' && (
                <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} style={selectStyle}>
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                </select>
              )}

              {/* Bulk tenant statements — only where it's meaningful */}
              {active === 'rentroll' && (
                <button onClick={downloadAllStatements} style={{
                  padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)',
                  color: 'var(--text)', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  📄 All Statements (ZIP)
                </button>
              )}

              {/* Print / Save as PDF — browsers' print dialog offers "Save as PDF" */}
              <button onClick={() => window.print()} style={{
                padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)',
                color: 'var(--text)', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                🖨️ Print / Save PDF
              </button>

              {/* Download button */}
              <button onClick={() => downloadCSV(visibleRows, active)} disabled={!visibleRows.length} style={{
                padding: '8px 16px', borderRadius: 8, border: 'none',
                background: visibleRows.length ? 'var(--primary)' : 'var(--border)',
                color: visibleRows.length ? '#fff' : 'var(--muted)',
                fontWeight: 600, fontSize: 13, cursor: visibleRows.length ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                ⬇ Download CSV
              </button>
            </div>
          </div>

          {/* Summary cards */}
          {summary && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              {summary.map(s => (
                <div key={s.label} style={{ background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', padding: '12px 20px' }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 20, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Trend / comparison chart */}
          {chart && (
            <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '16px 20px', marginBottom: 16 }}>
              {chart}
            </div>
          )}

          {/* Table search */}
          {rows.length > 0 && (
            <div style={{ marginBottom: 10 }} className="no-print">
              <input value={tableSearch} onChange={e => setTableSearch(e.target.value)} placeholder="Search this report..."
                style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13, width: '100%', maxWidth: 280, outline: 'none', color: 'var(--text)' }} />
            </div>
          )}

          {/* Table */}
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', overflow: 'hidden' }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading report...</div>
            ) : visibleRows.length === 0 ? (
              <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>No data found for the selected filters.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface2)' }}>
                      {columns.map(c => (
                        <th key={c} onClick={() => handleSort(c)} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}>
                          {c}{sortCol === c ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </th>
                      ))}
                      {active === 'rentroll' && (
                        <th className="no-print" style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>Statement</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
                        {columns.map(c => (
                          <td key={c} style={{ padding: '11px 16px', fontSize: 13, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                            {c === 'Status' ? (
                              <span style={{
                                background: row[c] === 'Active' || row[c] === 'matched' || row[c] === 'completed' || row[c] === 'Paid Up' ? 'var(--green-light)' :
                                            row[c] === 'Inactive' || row[c] === 'Moved Out' || row[c] === 'Owing' ? 'var(--red-light)' : 'var(--amber-light)',
                                color: row[c] === 'Active' || row[c] === 'matched' || row[c] === 'completed' || row[c] === 'Paid Up' ? 'var(--green)' :
                                       row[c] === 'Inactive' || row[c] === 'Moved Out' || row[c] === 'Owing' ? 'var(--red)' : 'var(--amber)',
                                padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600,
                              }}>{row[c]}</span>
                            ) : c.includes('KES') || c === 'Balance (KES)' ? (
                              <span style={{ fontWeight: 700, color: 'var(--green)' }}>{row[c]}</span>
                            ) : row[c]}
                          </td>
                        ))}
                        {active === 'rentroll' && (
                          <td className="no-print" style={{ padding: '11px 16px', fontSize: 13 }}>
                            {row._tenantId ? (
                              <button onClick={() => downloadStatement(row._tenantId, row.Tenant)} style={{
                                padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)',
                                color: 'var(--primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                              }}>
                                📄 PDF
                              </button>
                            ) : '—'}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)', textAlign: 'right' }}>
            {visibleRows.length} record{visibleRows.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
    </div>
  );
}

const selectStyle = { padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 13, color: 'var(--text)', outline: 'none', cursor: 'pointer' };

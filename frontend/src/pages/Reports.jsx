import { useState, useEffect } from 'react';
import API from '../services/api';

// ── Report definitions ────────────────────────────────────────────────────────
const REPORTS = [
  { id: 'payments',      icon: '💳', label: 'Payment Collection',    desc: 'All rent payments received',           color: 'var(--green)',   light: 'var(--green-light)'   },
  { id: 'unpaid',        icon: '⚠️', label: 'Unpaid Rent',           desc: 'Tenants with outstanding balances',    color: 'var(--red)',     light: 'var(--red-light)'     },
  { id: 'tenants',       icon: '👥', label: 'Tenant List',           desc: 'All active and inactive tenants',      color: 'var(--primary)', light: 'var(--primary-light)' },
  { id: 'maintenance',   icon: '🔧', label: 'Maintenance Records',   desc: 'All maintenance requests by status',   color: 'var(--amber)',   light: 'var(--amber-light)'   },
  { id: 'properties',    icon: '🏢', label: 'Property Summary',      desc: 'Plots, units, occupancy overview',     color: 'var(--blue)',    light: 'var(--blue-light)'    },
  { id: 'occupancy',     icon: '📊', label: 'Occupancy Report',      desc: 'Vacant vs occupied units over time',   color: '#8b5cf6',       light: '#ede9fe'              },
  { id: 'expenses',      icon: '💸', label: 'Expenses Report',       desc: 'All property expenses by category',   color: '#f97316',       light: '#fff7ed'              },
  { id: 'revenue',       icon: '📈', label: 'Revenue Summary',       desc: 'Monthly and yearly revenue totals',    color: 'var(--green)',   light: 'var(--green-light)'   },
  { id: 'moveins',       icon: '🏠', label: 'Move-in / Move-out',    desc: 'Tenant movement history',              color: 'var(--primary)', light: 'var(--primary-light)' },
  { id: 'expiring',      icon: '📅', label: 'Expiring Leases',       desc: 'Tenants with leases 11+ months old',   color: 'var(--amber)',   light: 'var(--amber-light)'   },
];

function getThisYear()  { return new Date().getFullYear(); }
function getThisMonth() { return new Date().getMonth() + 1; }

export default function Reports() {
  const [active,   setActive]   = useState('payments');
  const [data,     setData]     = useState({});
  const [loading,  setLoading]  = useState(false);
  const [filters,  setFilters]  = useState({ period: 'month', month: getThisMonth(), year: getThisYear(), status: 'all' });

  const report = REPORTS.find(r => r.id === active);

  useEffect(() => { loadReport(); }, [active, filters]);

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
      const tenants  = arr(tr.data);
      const payments = arr(pr.data);
      const houses   = arr(hr.data);
      const requests = arr(mr.data);
      const plots    = arr(plr.data);
      const expenses = arr(er.data);

      setData({ tenants, payments, houses, requests, plots, expenses });
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
      return true; // 'all'
    });
  }

  function downloadCSV(rows, filename) {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    const blob = new URL(`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`);
    const a = document.createElement('a');
    a.href = blob;
    a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  }

  const years  = Array.from({ length: 5 }, (_, i) => getThisYear() - i);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // ── Compute report rows ────────────────────────────────────────────────────
  let rows = [], columns = [], title = '', summary = null;

  if (data.payments) {
    const { tenants, payments, houses, requests, plots, expenses } = data;

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
      const unpaid = tenants.filter(t => t.is_active && parseFloat(t.balance || 0) > 0);
      const total  = unpaid.reduce((s, t) => s + parseFloat(t.balance || 0), 0);
      columns = ['Tenant', 'Phone', 'Unit', 'Plot', 'Balance (KES)', 'Move-in', 'Due Day'];
      rows    = unpaid.map(t => ({
        Tenant: t.full_name,
        Phone: t.phone || '—',
        Unit: t.unit_number || `#${t.house_id}`,
        Plot: t.plot_name || '—',
        'Balance (KES)': parseFloat(t.balance).toLocaleString(),
        'Move-in': t.move_in_date ? new Date(t.move_in_date).toLocaleDateString('en-KE') : '—',
        'Due Day': t.rent_due_day || '—',
      }));
      summary = [{ label: 'Tenants Owing', value: unpaid.length, color: 'var(--red)' }, { label: 'Total Unpaid', value: `KES ${total.toLocaleString()}`, color: 'var(--red)' }];
      title = 'Unpaid Rent Report';
    }

    if (active === 'tenants') {
      const filtered = filters.status === 'all' ? tenants : tenants.filter(t => filters.status === 'active' ? t.is_active : !t.is_active);
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
      columns = ['Plot', 'Location', 'Total Units', 'Occupied', 'Vacant', 'Monthly Revenue (KES)'];
      rows    = plots.map(p => {
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
      summary = [{ label: 'Total Plots', value: plots.length, color: 'var(--blue)' }, { label: 'Total Units', value: houses.length, color: 'var(--primary)' }];
      title = 'Property Summary Report';
    }

    if (active === 'occupancy') {
      const occupied = houses.filter(h => h.status === 'occupied');
      const vacant   = houses.filter(h => h.status === 'vacant');
      const rate     = houses.length > 0 ? Math.round((occupied.length / houses.length) * 100) : 0;
      columns = ['Unit', 'Type', 'Plot', 'Rent (KES)', 'Status'];
      rows    = houses.map(h => ({
        Unit: `Unit ${h.unit_number}`,
        Type: h.house_type,
        Plot: h.plot_name || '—',
        'Rent (KES)': parseFloat(h.rent_amount || 0).toLocaleString(),
        Status: h.status,
      }));
      summary = [{ label: 'Occupancy Rate', value: `${rate}%`, color: 'var(--green)' }, { label: 'Occupied', value: occupied.length, color: 'var(--amber)' }, { label: 'Vacant', value: vacant.length, color: 'var(--blue)' }];
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
      // Group payments by month
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
        const months = Math.floor((new Date() - new Date(t.move_in_date)) / (1000 * 60 * 60 * 24 * 30));
        return {
          Tenant: t.full_name, Phone: t.phone || '—',
          Unit: t.unit_number || `#${t.house_id}`, Plot: t.plot_name || '—',
          'Move-in Date': new Date(t.move_in_date).toLocaleDateString('en-KE'),
          Tenancy: `${months}m`,
        };
      });
      summary = [{ label: 'Expiring', value: expiring.length, color: 'var(--amber)' }];
      title = 'Expiring Leases Report';
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Reports</h1>
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>Generate, filter and download reports</p>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

        {/* ── Left: Report List ── */}
        <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {REPORTS.map(r => (
            <button key={r.id} onClick={() => setActive(r.id)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              borderRadius: 10, border: active === r.id ? `1.5px solid ${r.color}` : '1px solid var(--border)',
              background: active === r.id ? r.light : 'var(--surface)',
              cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
            }}>
              <span style={{ fontSize: 18 }}>{r.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: active === r.id ? r.color : 'var(--text)' }}>{r.label}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{r.desc}</div>
              </div>
            </button>
          ))}
        </div>

        {/* ── Right: Report Content ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Header */}
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '18px 22px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 17 }}>{report?.icon} {title || report?.label}</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>

              {/* Period filter */}
              {!['properties', 'occupancy', 'expiring', 'unpaid', 'revenue'].includes(active) && (
                <select value={filters.period} onChange={e => setFilters(f => ({ ...f, period: e.target.value }))} style={selectStyle}>
                  <option value="all">All Time</option>
                  <option value="month">By Month</option>
                  <option value="year">By Year</option>
                </select>
              )}

              {/* Month picker */}
              {filters.period === 'month' && !['properties', 'occupancy', 'expiring', 'unpaid', 'revenue'].includes(active) && (
                <select value={filters.month} onChange={e => setFilters(f => ({ ...f, month: parseInt(e.target.value) }))} style={selectStyle}>
                  {months.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              )}

              {/* Year picker */}
              {(filters.period !== 'all' || active === 'revenue') && (
                <select value={filters.year} onChange={e => setFilters(f => ({ ...f, year: parseInt(e.target.value) }))} style={selectStyle}>
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
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

              {/* Download button */}
              <button onClick={() => downloadCSV(rows, active)} disabled={!rows.length} style={{
                padding: '8px 16px', borderRadius: 8, border: 'none',
                background: rows.length ? 'var(--primary)' : 'var(--border)',
                color: rows.length ? '#fff' : 'var(--muted)',
                fontWeight: 600, fontSize: 13, cursor: rows.length ? 'pointer' : 'default',
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

          {/* Table */}
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', overflow: 'hidden' }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading report...</div>
            ) : rows.length === 0 ? (
              <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>No data found for the selected filters.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface2)' }}>
                      {columns.map(c => (
                        <th key={c} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
                        {columns.map(c => (
                          <td key={c} style={{ padding: '11px 16px', fontSize: 13, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                            {c === 'Status' ? (
                              <span style={{
                                background: row[c] === 'Active' || row[c] === 'matched' || row[c] === 'completed' ? 'var(--green-light)' :
                                            row[c] === 'Inactive' || row[c] === 'Moved Out' ? 'var(--red-light)' : 'var(--amber-light)',
                                color: row[c] === 'Active' || row[c] === 'matched' || row[c] === 'completed' ? 'var(--green)' :
                                       row[c] === 'Inactive' || row[c] === 'Moved Out' ? 'var(--red)' : 'var(--amber)',
                                padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600,
                              }}>{row[c]}</span>
                            ) : c.includes('KES') || c === 'Balance (KES)' ? (
                              <span style={{ fontWeight: 700, color: 'var(--green)' }}>{row[c]}</span>
                            ) : row[c]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)', textAlign: 'right' }}>
            {rows.length} record{rows.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
    </div>
  );
}

const selectStyle = { padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 13, color: 'var(--text)', outline: 'none', cursor: 'pointer' };

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../services/api';

// Central palette: every semantic color used across the dashboard, each with
// a CSS-variable reference (so it stays in sync with the rest of the app if
// index.css defines it) plus a guaranteed hex fallback (so it never renders
// invisible/flat if the variable is missing).
const PALETTE = {
  primary: { c: 'var(--primary, #7c3aed)', l: 'var(--primary-light, #ede9fe)', hex: '#7c3aed' },
  green:   { c: 'var(--green, #16a34a)',   l: 'var(--green-light, #dcfce7)',   hex: '#16a34a' },
  amber:   { c: 'var(--amber, #d97706)',   l: 'var(--amber-light, #fef3c7)',   hex: '#d97706' },
  blue:    { c: 'var(--blue, #2563eb)',    l: 'var(--blue-light, #dbeafe)',    hex: '#2563eb' },
  red:     { c: 'var(--red, #dc2626)',     l: 'var(--red-light, #fee2e2)',     hex: '#dc2626' },
};

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Tracks the light/dark theme Layout.jsx sets via document.documentElement's
// data-theme attribute, so cards can render an appropriate tint in each mode
// without touching Layout.jsx.
function useIsDarkMode() {
  const [isDark, setIsDark] = useState(document.documentElement.getAttribute('data-theme') === 'dark');
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setIsDark(el.getAttribute('data-theme') === 'dark'));
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

function StatCard({ label, value, icon, colorKey, onClick, sub }) {
  const { c: color, l: light, hex } = PALETTE[colorKey];
  const isDark = useIsDarkMode();
  // Light mode: soft pastel tint (unchanged). Dark mode: a translucent wash
  // of the accent color instead — the pastel swatch read as a washed-out
  // bright smudge against a dark surface, so this keeps the same "colorful
  // corner" effect without looking muddy.
  const tint = isDark ? hexToRgba(hex, 0.22) : light;
  const labelColor = isDark ? 'rgba(255,255,255,0.62)' : 'var(--muted)';
  return (
    <div onClick={onClick} style={{
      background: `linear-gradient(135deg, ${tint} 0%, var(--surface) 65%)`, borderRadius: 'var(--radius)',
      padding: '20px 22px', boxShadow: 'var(--shadow)',
      border: '1px solid var(--border)', borderLeft: `4px solid ${color}`,
      display: 'flex', alignItems: 'center', gap: 14,
      cursor: 'pointer', transition: 'all 0.18s',
    }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-lg)'; e.currentTarget.style.transform = 'translateY(-3px)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--shadow)'; e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      <div style={{ width: 48, height: 48, borderRadius: 12, flexShrink: 0, background: color, boxShadow: `0 4px 10px ${hex}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: labelColor, fontWeight: 600, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'Space Grotesk', color, lineHeight: 1.2 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: labelColor, marginTop: 2 }}>{sub}</div>}
      </div>
      <span style={{ color, fontSize: 18, fontWeight: 700, flexShrink: 0 }}>›</span>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  const isDark = useIsDarkMode();
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
      <div style={{ background: isDark ? '#242a3d' : 'var(--surface)', borderRadius: 16, width: '100%', maxWidth: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)', border: isDark ? '1px solid #383f57' : 'none' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>{title}</h2>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: isDark ? '#383f57' : 'var(--surface2)', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

function SeeMoreFooter({ onClick, label = 'See More →' }) {
  return (
    <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'center', borderTop: '1px solid var(--border)' }}>
      <button onClick={onClick} style={{
        padding: '9px 20px', borderRadius: 8, border: 'none', background: 'var(--primary, #7c3aed)',
        color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
      }}>
        {label}
      </button>
    </div>
  );
}

function Table({ headers, rows }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: 'var(--surface2)' }}>
          {headers.map(h => <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>)}
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

function TR({ cells, i, failed, pending }) {
  const rowBg = i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)';
  return (
    <tr style={{
      borderTop: '1px solid var(--border)',
      background: rowBg,
      opacity: failed ? 0.75 : 1,
    }}>
      {cells.map((c, j) => <td key={j} style={{ padding: '12px 20px', fontSize: 14, ...c.style }}>{c.value}</td>)}
    </tr>
  );
}

export default function Dashboard() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(null);
  const [unpaidMonths,  setUnpaidMonths]  = useState([]);
  const [unpaidLoading, setUnpaidLoading] = useState(false);
  const [rejectTarget,  setRejectTarget]  = useState(null); // house being rejected
  const [rejectReason,  setRejectReason]  = useState('');
  const isDark = useIsDarkMode();
  const navigate = useNavigate();

  useEffect(() => {
    async function load() {
      try {
        // Expire any stale pending STK rows before loading
        await API.post('/mpesa/expire-pending').catch(() => {});

        const [tr, pr, hr, mr, plr, ur] = await Promise.all([
          API.get('/tenants'),
          API.get('/payments'),
          API.get('/houses'),
          API.get('/maintenance'),
          API.get('/plots'),
          API.get('/auth/users').catch(() => ({ data: { data: [] } })),
        ]);
        const tenants  = Array.isArray(tr.data)  ? tr.data  : (tr.data.data  || []);
        const payments = Array.isArray(pr.data)  ? pr.data  : (pr.data.data  || []);
        const houses   = Array.isArray(hr.data)  ? hr.data  : (hr.data.data  || []);
        const requests = Array.isArray(mr.data)  ? mr.data  : (mr.data.data  || []);
        const plots    = Array.isArray(plr.data) ? plr.data : (plr.data.data || []);
        const users    = Array.isArray(ur.data)  ? ur.data  : (ur.data.data  || []);

        const now       = new Date();
        const thisMonth = payments.filter(p => {
          const d = new Date(p.payment_date);
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        });

        const elevenMonthsAgo = new Date();
        elevenMonthsAgo.setMonth(elevenMonthsAgo.getMonth() - 11);

        // Exclude failed/pending from revenue totals
        const validPayments = payments.filter(p => p.status !== 'failed' && p.status !== 'pending');
        const validThisMonth = thisMonth.filter(p => p.status !== 'failed' && p.status !== 'pending');

        const caretakers = users.filter(u => u.role === 'caretaker');

        setData({
          tenants, payments, houses, requests, plots, users, caretakers,
          activeTenants:   tenants.filter(t => t.is_active),
          unpaidTenants:   tenants.filter(t => t.is_active && parseFloat(t.balance || 0) > 0),
          occupiedHouses:  houses.filter(h => h.status === 'occupied'),
          vacantHouses:    houses.filter(h => h.status === 'vacant'),
          pendingRequests: requests.filter(r => r.status === 'pending'),
          pendingUnits:    houses.filter(h => h.is_approved !== true),
          expiringLeases:  tenants.filter(t => t.is_active && t.move_in_date && new Date(t.move_in_date) <= elevenMonthsAgo),
          monthRevenue:    validThisMonth.reduce((s, p) => s + parseFloat(p.amount || 0), 0),
          totalRevenue:    validPayments.reduce((s, p) => s + parseFloat(p.amount || 0), 0),
          thisMonth,
        });
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'var(--muted)' }}>
      Loading dashboard...
    </div>
  );

  if (!data) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'var(--red)' }}>
      Failed to load dashboard data. Please refresh the page.
    </div>
  );

  const { payments, houses, plots, caretakers,
    activeTenants, unpaidTenants, occupiedHouses, vacantHouses,
    pendingRequests, pendingUnits, expiringLeases, monthRevenue, totalRevenue, thisMonth } = data;

  const occupancyRate = houses.length > 0 ? Math.round((occupiedHouses.length / houses.length) * 100) : 0;
  const totalUnpaid   = unpaidTenants.reduce((s, t) => s + parseFloat(t.balance || 0), 0);

  // Helper to render a payment row with failed/pending styling
  function PaymentRow(p, i) {
    const isFailed  = p.status === 'failed';
    const isPending = p.status === 'pending';
    // Explicit hex fallbacks baked in via CSS var(--x, fallback) syntax, so the
    // colors show correctly even if --red/--green/--amber aren't defined (or are
    // misdefined) in index.css.
    const RED = 'var(--red, #dc2626)', RED_L = 'var(--red-light, #fee2e2)';
    const GREEN = 'var(--green, #16a34a)', GREEN_L = 'var(--green-light, #dcfce7)';
    const AMBER = 'var(--amber, #d97706)', AMBER_L = 'var(--amber-light, #fef3c7)';
    const BLUE = 'var(--blue, #2563eb)', BLUE_L = 'var(--blue-light, #dbeafe)';
    const PRIMARY = 'var(--primary, #7c3aed)', PRIMARY_L = 'var(--primary-light, #ede9fe)';
    const GREY = 'var(--muted, #6b7280)', GREY_L = 'var(--surface2, #f3f4f6)';

    const statusColor = isFailed ? RED : isPending ? AMBER : GREEN;
    const statusLight = isFailed ? RED_L : isPending ? AMBER_L : GREEN_L;
    const method = (p.method || 'mpesa').toLowerCase();
    const methodColor = method === 'mpesa' ? GREEN : method === 'bank' ? BLUE : method === 'cash' ? PRIMARY : GREY;
    const methodLight  = method === 'mpesa' ? GREEN_L : method === 'bank_transfer' ? BLUE_L : method === 'cash' ? PRIMARY_L : GREY_L;
    return (
      <TR key={p.id} i={i} failed={isFailed} pending={isPending} cells={[
        { value: p.tenant_name || '—', style: { fontWeight: 600, color: isDark ? 'var(--blue, #2563eb)' : 'var(--text)' } },
        { value: `KES ${parseFloat(p.amount).toLocaleString()}`, style: { fontWeight: 700, color: isFailed ? RED : isPending ? AMBER : GREEN, textDecoration: isFailed ? 'line-through' : 'none' } },
        { value: <span style={{ background: methodLight, color: methodColor, padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{p.method || 'mpesa'}</span> },
        { value: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: statusLight, color: statusColor, padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700, textTransform: 'capitalize' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
            {p.status}
          </span>
        ) },
        { value: new Date(p.payment_date).toLocaleDateString('en-KE'), style: { color: isDark ? '#2dd4bf' : 'var(--muted)', fontWeight: 700 } },
      ]} />
    );
  }

  return (
    <div style={{ marginTop: -24 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{
          fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 800, marginBottom: 6,
          color: 'var(--primary, #7c3aed)', display: 'inline-flex', alignItems: 'center', gap: 10,
        }}>
          Dashboard
          <span style={{ display: 'inline-block', width: 34, height: 5, borderRadius: 99, background: 'linear-gradient(90deg, var(--primary, #7c3aed), var(--blue, #2563eb))' }} />
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>Welcome back. Here's what's happening today.</p>
      </div>

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, marginBottom: 28 }}>
        <StatCard label="Active Tenants"    value={activeTenants.length}   icon="👥" colorKey="primary" onClick={() => setModal('tenants')} />
        <StatCard label="Occupied Units"    value={occupiedHouses.length}  icon="🏠" colorKey="green"   onClick={() => setModal('occupied')} />
        <StatCard label="Vacant Units"      value={vacantHouses.length}    icon="🔑" colorKey="amber"   onClick={() => setModal('vacant')} />
        <StatCard label="Revenue (Month)"   value={`KES ${monthRevenue.toLocaleString()}`}  icon="💰" colorKey="blue"    onClick={() => setModal('revenue')} />
        <StatCard label="Unpaid Rent"       value={`KES ${totalUnpaid.toLocaleString()}`}   icon="⚠️" colorKey="red"     onClick={() => setModal('unpaid')}  sub={`${unpaidTenants.length} tenant${unpaidTenants.length !== 1 ? 's' : ''}`} />
        <StatCard label="Total Revenue"     value={`KES ${totalRevenue.toLocaleString()}`}  icon="📈" colorKey="blue"    onClick={() => setModal('allrevenue')} />
        <StatCard label="Maintenance"       value={pendingRequests.length} icon="🔧" colorKey="primary" onClick={() => setModal('maintenance')} sub="pending requests" />
        {pendingUnits?.filter(h => !h.rejection_reason).length > 0 && (
          <StatCard label="Pending Units" value={pendingUnits.filter(h => !h.rejection_reason).length} icon="⏳" colorKey="red" onClick={() => setModal('pending_units')} sub="awaiting approval" />
        )}
        <StatCard label="Occupancy Rate"    value={`${occupancyRate}%`}    icon="📊" colorKey="green"   onClick={() => setModal('occupancy')} sub={`${occupiedHouses.length} of ${houses.length} units`} />
        <StatCard label="Total Properties"  value={plots.length}           icon="🏢" colorKey="primary" onClick={() => setModal('plots')} sub={`${houses.length} total units`} />
        <StatCard label="Expiring Leases"   value={expiringLeases.length}  icon="📅" colorKey="amber"   onClick={() => setModal('expiring')} sub="11+ months tenancy" />
        {caretakers.length > 0 && (
          <StatCard label="Caretaker Workload" value={caretakers.length} icon="🧑‍🔧" colorKey="green" onClick={() => setModal('caretakers')} sub={`across ${plots.length} plot${plots.length !== 1 ? 's' : ''}`} />
        )}
      </div>

      {/* Recent Payments */}
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', borderTop: '3px solid var(--primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 16, color: isDark ? 'var(--blue, #2563eb)' : 'var(--text)' }}>Recent Payments</h2>
          {payments.length > 0 && (
            <span style={{ background: isDark ? 'rgba(37,99,235,0.18)' : 'var(--primary-light)', color: isDark ? 'var(--blue, #2563eb)' : 'var(--primary)', fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 99 }}>{payments.length}</span>
          )}
        </div>
        {payments.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>No payments recorded yet.</div>
        ) : (
          <Table
            headers={['Tenant', 'Amount', 'Method', 'Status', 'Date']}
            rows={payments.slice(0, 6).map((p, i) => PaymentRow(p, i))}
          />
        )}
      </div>

      {/* ── Modals ── */}

      {modal === 'tenants' && (
        <Modal title={`Active Tenants (${activeTenants.length})`} onClose={() => setModal(null)}>
          <Table headers={['Name', 'Phone', 'Email', 'Unit', 'Move-in', 'Balance']} rows={activeTenants.map((t, i) => (
            <TR key={t.id} i={i} cells={[
              { value: t.full_name, style: { fontWeight: 600, color: 'var(--text)' } },
              { value: t.phone || '—', style: { color: 'var(--muted)' } },
              { value: t.email || '—', style: { color: 'var(--muted)', fontSize: 12 } },
              { value: t.unit_number || `#${t.house_id}`, style: { fontWeight: 600, color: 'var(--text)' } },
              { value: t.move_in_date ? new Date(t.move_in_date).toLocaleDateString('en-KE') : '—', style: { color: 'var(--muted)' } },
              { value: `KES ${parseFloat(t.balance || 0).toLocaleString()}`, style: { fontWeight: 700, color: 'var(--red, #dc2626)' } },
            ]} />
          ))} />
          <SeeMoreFooter onClick={() => navigate('/tenants')} />
        </Modal>
      )}

      {modal === 'pending_units' && (
        <Modal title="Units Pending Approval" onClose={() => { setModal(null); setRejectTarget(null); setRejectReason(''); }}>
          {houses.filter(h => h.is_approved !== true && !h.rejection_reason).length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>No units pending approval.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {houses.filter(h => h.is_approved !== true && !h.rejection_reason).map((h, i) => (
                <div key={h.id} style={{ background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)', borderRadius: 10, padding: '12px 16px', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>Unit {h.unit_number} — {h.house_type}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{h.plot_name} · KES {parseFloat(h.rent_amount).toLocaleString()}/mo</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button onClick={async () => {
                        await API.patch(`/houses/${h.id}/approve`);
                        setData(d => ({ ...d, houses: d.houses.map(x => x.id === h.id ? { ...x, is_approved: true } : x) }));
                      }} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: 'var(--green)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        ✓ Approve
                      </button>
                      <button onClick={() => { setRejectTarget(h); setRejectReason(''); }}
                        style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: 'var(--red-light)', color: 'var(--red)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        ✗ Reject
                      </button>
                    </div>
                  </div>
                  {/* Inline reject reason input */}
                  {rejectTarget?.id === h.id && (
                    <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                      <input
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="Reason for rejection (optional)..."
                        style={{ flex: 1, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13, color: 'var(--text)', outline: 'none' }}
                      />
                      <button onClick={async () => {
                        await API.patch(`/houses/${h.id}/reject`, { reason: rejectReason });
                        setData(d => ({ ...d, houses: d.houses.map(x => x.id === h.id ? { ...x, is_approved: false, rejection_reason: rejectReason || 'Rejected' } : x) }));
                        setRejectTarget(null); setRejectReason('');
                      }} style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: 'var(--red)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        Confirm
                      </button>
                      <button onClick={() => setRejectTarget(null)}
                        style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, cursor: 'pointer', color: 'var(--muted)' }}>
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <SeeMoreFooter onClick={() => navigate('/properties')} />
        </Modal>
      )}

      {modal === 'unpaid' && (() => {
        // Fetch breakdown on first open
        if (unpaidMonths.length === 0 && !unpaidLoading) {
          setUnpaidLoading(true);
          API.get('/tenants/unpaid-months')
            .then(r => setUnpaidMonths(r.data.data || []))
            .catch(() => {})
            .finally(() => setUnpaidLoading(false));
        }
        return null;
      })()}

      {modal === 'unpaid' && (
        <Modal title={`Unpaid Rent — KES ${totalUnpaid.toLocaleString()}`} onClose={() => { setModal(null); setUnpaidMonths([]); }}>
          {unpaidLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading breakdown...</div>
          ) : unpaidMonths.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>All tenants are up to date! 🎉</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0' }}>
              {unpaidMonths.map((t, i) => (
                <div key={t.tenant_id} style={{ background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)', borderRadius: 10, padding: '12px 16px', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{t.full_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Unit {t.unit_number || t.house_id} · {t.phone}</div>
                    </div>
                    <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--red, #dc2626)' }}>
                      KES {t.unpaid_months?.reduce((s, m) => s + (m.balance ?? m.rent ?? 0), 0).toLocaleString()} owed
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(t.unpaid_months || []).map(m => {
                      const isPartial = m.partial;
                      const monthLabel = new Date(m.year, m.month - 1, 1).toLocaleString('en-KE', { month: 'short', year: 'numeric' });
                      return (
                        <span key={`${m.year}-${m.month}`} style={{
                          padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600,
                          background: isPartial ? 'var(--amber-light, #fef3c7)' : 'var(--red-light, #fee2e2)',
                          color:      isPartial ? 'var(--amber, #d97706)'       : 'var(--red, #dc2626)',
                          border: `1px solid ${isPartial ? 'var(--amber, #d97706)' : 'var(--red, #dc2626)'}`,
                        }}>
                          {monthLabel}
                          {isPartial ? ` · partial · KES ${(m.balance ?? 0).toLocaleString()} left` : ` · KES ${(m.balance ?? m.rent ?? 0).toLocaleString()}`}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          <SeeMoreFooter onClick={() => navigate('/tenants')} />
        </Modal>
      )}

      {modal === 'occupied' && (
        <Modal title={`Occupied Units (${occupiedHouses.length})`} onClose={() => setModal(null)}>
          <Table headers={['Unit', 'Type', 'Rent/mo', 'Plot']} rows={occupiedHouses.map((h, i) => (
            <TR key={h.id} i={i} cells={[
              { value: `Unit ${h.unit_number}`, style: { fontWeight: 700, color: 'var(--text)' } },
              { value: h.house_type, style: { fontWeight: 600, color: 'var(--blue, #2563eb)' } },
              { value: `KES ${parseFloat(h.rent_amount).toLocaleString()}`, style: { fontWeight: 700, color: 'var(--red, #dc2626)' } },
              { value: h.plot_name || '—', style: { fontWeight: 600, color: 'var(--blue, #2563eb)' } },
            ]} />
          ))} />
          <SeeMoreFooter onClick={() => navigate('/properties')} />
        </Modal>
      )}

      {modal === 'vacant' && (
        <Modal title={`Vacant Units (${vacantHouses.length})`} onClose={() => setModal(null)}>
          <Table headers={['Unit', 'Type', 'Rent/mo', 'Deposit', 'Plot']} rows={vacantHouses.map((h, i) => (
            <TR key={h.id} i={i} cells={[
              { value: `Unit ${h.unit_number}`, style: { fontWeight: 700, color: 'var(--text)' } },
              { value: h.house_type, style: { fontWeight: 600, color: 'var(--blue, #2563eb)' } },
              { value: `KES ${parseFloat(h.rent_amount).toLocaleString()}`, style: { fontWeight: 700, color: 'var(--red, #dc2626)' } },
              { value: `KES ${parseFloat(h.deposit || 0).toLocaleString()}`, style: { fontWeight: 600, color: 'var(--green, #16a34a)' } },
              { value: h.plot_name || '—', style: { fontWeight: 600, color: 'var(--blue, #2563eb)' } },
            ]} />
          ))} />
          <SeeMoreFooter onClick={() => navigate('/properties')} />
        </Modal>
      )}

      {modal === 'revenue' && (
        <Modal title={`This Month's Payments (${thisMonth.length})`} onClose={() => setModal(null)}>
          <div style={{ padding: '14px 24px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 32 }}>
            <div><div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>TOTAL</div><div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 20, color: 'var(--green)' }}>KES {monthRevenue.toLocaleString()}</div></div>
            <div><div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>TRANSACTIONS</div><div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 20, color: 'var(--blue)' }}>{thisMonth.length}</div></div>
          </div>
          <Table headers={['Tenant', 'Amount', 'Method', 'Status', 'Date']} rows={thisMonth.map((p, i) => PaymentRow(p, i))} />
          <SeeMoreFooter onClick={() => navigate('/payments')} />
        </Modal>
      )}

      {modal === 'allrevenue' && (
        <Modal title={`All Time Revenue — KES ${totalRevenue.toLocaleString()}`} onClose={() => setModal(null)}>
          <div style={{ padding: '14px 24px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 32 }}>
            <div><div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>TOTAL COLLECTED</div><div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 20, color: 'var(--red, #dc2626)' }}>KES {totalRevenue.toLocaleString()}</div></div>
            <div><div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>TOTAL TRANSACTIONS</div><div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 20, color: 'var(--red, #dc2626)' }}>{payments.length}</div></div>
          </div>
          <Table headers={['Tenant', 'Amount', 'Method', 'Status', 'Date']} rows={payments.map((p, i) => PaymentRow(p, i))} />
          <SeeMoreFooter onClick={() => navigate('/payments')} />
        </Modal>
      )}

      {modal === 'maintenance' && (
        <Modal title={`Pending Maintenance (${pendingRequests.length})`} onClose={() => setModal(null)}>
          <Table headers={['#', 'Issue', 'Priority', 'Reported']} rows={pendingRequests.map((r, i) => (
            <TR key={r.id} i={i} cells={[
              { value: `#${r.id}`, style: { color: 'var(--muted)', fontSize: 12 } },
              { value: r.issue, style: { fontWeight: 600, color: 'var(--text)' } },
              { value: <span style={{ background: r.priority === 'high' ? 'var(--red-light)' : r.priority === 'medium' ? 'var(--amber-light)' : 'var(--blue-light)', color: r.priority === 'high' ? 'var(--red)' : r.priority === 'medium' ? 'var(--amber)' : 'var(--blue)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>{r.priority}</span> },
              { value: new Date(r.reported_at).toLocaleDateString('en-KE'), style: { color: 'var(--muted)' } },
            ]} />
          ))} />
          <SeeMoreFooter onClick={() => navigate('/maintenance')} />
        </Modal>
      )}

      {modal === 'occupancy' && (
        <Modal title={`Occupancy Rate — ${occupancyRate}%`} onClose={() => setModal(null)}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
            <div style={{ display: 'flex', gap: 32, marginBottom: 16 }}>
              <div><div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>OCCUPIED</div><div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 20, color: 'var(--green)' }}>{occupiedHouses.length}</div></div>
              <div><div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>VACANT</div><div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 20, color: 'var(--amber)' }}>{vacantHouses.length}</div></div>
              <div><div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>TOTAL</div><div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 20, color: 'var(--blue)' }}>{houses.length}</div></div>
            </div>
            <div style={{ height: 12, borderRadius: 99, background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${occupancyRate}%`, background: 'linear-gradient(90deg, var(--green), #34d399)', borderRadius: 99, transition: 'width 0.5s' }} />
            </div>
          </div>
          <Table headers={['Unit', 'Type', 'Rent/mo', 'Plot', 'Status']} rows={houses.map((h, i) => (
            <TR key={h.id} i={i} cells={[
              { value: `Unit ${h.unit_number}`, style: { fontWeight: 700, color: 'var(--text)' } },
              { value: h.house_type, style: { fontWeight: 600, color: 'var(--blue, #2563eb)' } },
              { value: `KES ${parseFloat(h.rent_amount).toLocaleString()}`, style: { fontWeight: 700, color: 'var(--red, #dc2626)' } },
              { value: h.plot_name || '—', style: { fontWeight: 600, color: 'var(--blue, #2563eb)' } },
              { value: <span style={{ background: h.status === 'vacant' ? 'var(--green-light)' : 'var(--amber-light)', color: h.status === 'vacant' ? 'var(--green)' : 'var(--amber)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{h.status}</span> },
            ]} />
          ))} />
          <SeeMoreFooter onClick={() => navigate('/properties')} />
        </Modal>
      )}

      {modal === 'plots' && (
        <Modal title={`Properties (${plots.length} plots · ${houses.length} units)`} onClose={() => setModal(null)}>
          <Table headers={['Plot Name', 'Location', 'Units']} rows={plots.map((p, i) => (
            <TR key={p.id} i={i} cells={[
              { value: p.name, style: { fontWeight: 700, color: 'var(--text)' } },
              { value: p.location || '—', style: { color: 'var(--muted)' } },
              { value: houses.filter(h => h.plot_id === p.id).length, style: { fontWeight: 600, color: 'var(--primary)' } },
            ]} />
          ))} />
          <SeeMoreFooter onClick={() => navigate('/properties')} />
        </Modal>
      )}

      {modal === 'caretakers' && (
        <Modal title={`Caretaker Workload (${caretakers.length})`} onClose={() => setModal(null)}>
          {caretakers.length === 0 ? (
            <div style={{ padding:48, textAlign:'center' }}>
              <div style={{ fontSize:36, marginBottom:12 }}>🧑‍🔧</div>
              <div style={{ fontWeight:700, fontSize:15, color: isDark?'#f1f5f9':'#0f172a', marginBottom:6 }}>No Caretakers Yet</div>
              <div style={{ fontSize:13, color: isDark?'rgba(255,255,255,0.4)':'#94a3b8' }}>Add caretakers from the Users page.</div>
            </div>
          ) : (
            <>
              {/* Summary bar */}
              <div style={{ display:'flex', borderBottom: isDark?'1px solid rgba(255,255,255,0.07)':'1px solid #e2e8f0', background: isDark?'rgba(255,255,255,0.03)':'#f8fafc' }}>
                {[
                  { label:'Caretakers',       value: caretakers.length,                                                                         color:'#34d399' },
                  { label:'Plots Covered',    value: caretakers.filter(c => c.plot_id).length,                                                  color:'#60a5fa' },
                  { label:'Unassigned',       value: caretakers.filter(c => !c.plot_id).length,                                                 color:'#f87171' },
                  { label:'Total Pending MR', value: pendingRequests.length,                                                                    color:'#fbbf24' },
                ].map((s,i) => (
                  <div key={s.label} style={{ flex:1, padding:'13px 16px', borderRight: i<3?(isDark?'1px solid rgba(255,255,255,0.07)':'1px solid #e2e8f0'):'none' }}>
                    <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', color: isDark?'rgba(255,255,255,0.38)':'#94a3b8', marginBottom:3 }}>{s.label}</div>
                    <div style={{ fontFamily:'Space Grotesk', fontWeight:800, fontSize:17, color:s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* One card per caretaker */}
              <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
                {caretakers.map((c, i) => {
                  // All data scoped to this caretaker's assigned plot
                  const plotHouses  = houses.filter(h => h.plot_id === c.plot_id);
                  const plotTenants = activeTenants.filter(t => plotHouses.some(h => h.id === t.house_id));
                  const plotOccupied = plotHouses.filter(h => h.status === 'occupied').length;
                  const plotVacant   = plotHouses.filter(h => h.status === 'vacant').length;
                  const plotMR       = pendingRequests.filter(r => plotHouses.some(h => h.id === r.house_id));
                  const plotArrears  = plotTenants.reduce((s,t) => s + parseFloat(t.balance||0), 0);
                  const plotMRHigh   = plotMR.filter(r => r.priority === 'high').length;
                  const initials     = c.name?.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase() || '?';
                  const hasPlot      = !!c.plot_id;
                  const rowBg        = isDark ? (i%2===0 ? 'transparent' : 'rgba(255,255,255,0.02)') : (i%2===0 ? '#fff' : '#f8fafc');

                  return (
                    <div key={c.id} style={{ padding:'16px 20px', borderBottom: isDark?'1px solid rgba(255,255,255,0.06)':'1px solid #f1f5f9', background: rowBg, transition:'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = isDark?'rgba(52,211,153,0.07)':'#f0fdf4'}
                      onMouseLeave={e => e.currentTarget.style.background = rowBg}
                    >
                      {/* Header row: avatar + name + plot badge */}
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: hasPlot ? 14 : 0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:11 }}>
                          <div style={{ width:40, height:40, borderRadius:'50%', flexShrink:0, background: isDark?'rgba(52,211,153,0.2)':'#dcfce7', border: isDark?'1.5px solid rgba(52,211,153,0.4)':'1.5px solid #86efac', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:800, color: isDark?'#34d399':'#16a34a' }}>
                            {initials}
                          </div>
                          <div>
                            <div style={{ fontWeight:800, fontSize:14, color: isDark?'#f1f5f9':'#0f172a' }}>{c.name}</div>
                            <div style={{ fontSize:11, fontWeight:600, color: isDark?'#60a5fa':'#2563eb', marginTop:1 }}>{c.phone || c.email}</div>
                          </div>
                        </div>
                        {/* Plot assignment badge */}
                        {hasPlot ? (
                          <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 12px', borderRadius:99, fontSize:11, fontWeight:700, background: isDark?'rgba(52,211,153,0.15)':'#dcfce7', color: isDark?'#34d399':'#16a34a', border: isDark?'1px solid rgba(52,211,153,0.3)':'1px solid #86efac' }}>
                            🏢 {c.plot_name || `Plot #${c.plot_id}`}
                          </span>
                        ) : (
                          <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 12px', borderRadius:99, fontSize:11, fontWeight:700, background: isDark?'rgba(248,113,113,0.15)':'#fee2e2', color: isDark?'#f87171':'#dc2626', border: isDark?'1px solid rgba(248,113,113,0.3)':'1px solid #fca5a5' }}>
                            ⚠️ Unassigned
                          </span>
                        )}
                      </div>

                      {/* Workload metrics grid — only shown when assigned to a plot */}
                      {hasPlot && (
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:8 }}>
                          {[
                            { label:'Tenants',    value: plotTenants.length,          color:'#a78bfa', icon:'👥' },
                            { label:'Occupied',   value: plotOccupied,                color:'#34d399', icon:'🏠' },
                            { label:'Vacant',     value: plotVacant,                  color: plotVacant>0?'#fb923c':'rgba(255,255,255,0.3)', icon:'🔑' },
                            { label:'Pending MR', value: plotMR.length,               color: plotMR.length>0?(plotMRHigh>0?'#f87171':'#fbbf24'):'#34d399', icon:'🔧' },
                            { label:'Arrears',    value: `KES ${plotArrears > 0 ? (plotArrears/1000).toFixed(0)+'K' : '0'}`, color: plotArrears>0?'#f87171':'#34d399', icon:'💰' },
                          ].map(m => (
                            <div key={m.label} style={{ background: isDark?'rgba(255,255,255,0.04)':'#f8fafc', borderRadius:9, padding:'10px 12px', border: isDark?'1px solid rgba(255,255,255,0.07)':'1px solid #e2e8f0', textAlign:'center' }}>
                              <div style={{ fontSize:14, marginBottom:4 }}>{m.icon}</div>
                              <div style={{ fontFamily:'Space Grotesk', fontWeight:800, fontSize:15, color:m.color, lineHeight:1 }}>{m.value}</div>
                              <div style={{ fontSize:9, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase', color: isDark?'rgba(255,255,255,0.35)':'#94a3b8', marginTop:3 }}>{m.label}</div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* High priority maintenance alert */}
                      {plotMRHigh > 0 && (
                        <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:10, padding:'7px 12px', borderRadius:8, background: isDark?'rgba(248,113,113,0.1)':'#fff1f2', border: isDark?'1px solid rgba(248,113,113,0.25)':'1px solid #fecdd3' }}>
                          <span style={{ fontSize:12 }}>🔴</span>
                          <span style={{ fontSize:11, fontWeight:700, color: isDark?'#f87171':'#dc2626' }}>
                            {plotMRHigh} high-priority maintenance request{plotMRHigh !== 1 ? 's' : ''} pending on this plot
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Modal>
      )}

      {modal === 'expiring' && (
        <Modal title={`Expiring Leases (${expiringLeases.length})`} onClose={() => setModal(null)}>
          <div style={{ padding: '12px 24px', background: 'var(--amber-light)', borderBottom: '1px solid var(--border)' }}>
            <p style={{ fontSize: 13, color: 'var(--amber)', fontWeight: 600 }}>⚠️ These tenants have been here 11+ months. Consider renewing their lease agreements.</p>
          </div>
          {expiringLeases.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>No expiring leases at this time.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  {['Tenant', 'Phone', 'Unit', 'Property', 'Move-in Date', 'Tenancy', 'Action'].map(h => (
                    <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {expiringLeases.map((t, i) => {
                  const months = Math.floor((new Date() - new Date(t.move_in_date)) / (1000 * 60 * 60 * 24 * 30));
                  return (
                    <RenewRow key={t.id} t={t} i={i} months={months} onRenewed={() => {
                      setModal(null);
                      setData(null);
                      setLoading(true);
                    }} />
                  );
                })}
              </tbody>
            </table>
          )}
          <SeeMoreFooter onClick={() => navigate('/tenants')} />
        </Modal>
      )}
    </div>
  );
}

function RenewRow({ t, i, months, onRenewed }) {
  const [renewing, setRenewing] = useState(false);
  const [renewed,  setRenewed]  = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newDate,  setNewDate]  = useState(new Date().toISOString().split('T')[0]);
  const [error,    setError]    = useState('');

  async function handleRenew() {
    setRenewing(true); setError('');
    try {
      await API.put(`/tenants/${t.id}`, { ...t, move_in_date: newDate });
      setRenewed(true);
      setShowForm(false);
      setTimeout(() => onRenewed(), 1200);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to renew lease');
    } finally { setRenewing(false); }
  }

  return (
    <>
      <tr style={{ borderTop: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
        <td style={{ padding: '12px 20px', fontWeight: 600 }}>{t.full_name}</td>
        <td style={{ padding: '12px 20px', color: 'var(--muted)' }}>{t.phone || '—'}</td>
        <td style={{ padding: '12px 20px', fontWeight: 600 }}>{t.unit_number || `#${t.house_id}`}</td>
        <td style={{ padding: '12px 20px', color: 'var(--muted)' }}>{t.plot_name || '—'}</td>
        <td style={{ padding: '12px 20px', color: 'var(--muted)' }}>{new Date(t.move_in_date).toLocaleDateString('en-KE')}</td>
        <td style={{ padding: '12px 20px' }}>
          <span style={{ background: months >= 12 ? 'var(--red-light)' : 'var(--amber-light)', color: months >= 12 ? 'var(--red)' : 'var(--amber)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700 }}>{months}m</span>
        </td>
        <td style={{ padding: '12px 20px' }}>
          {renewed ? (
            <span style={{ color: 'var(--green)', fontWeight: 600, fontSize: 13 }}>✓ Renewed</span>
          ) : (
            <button onClick={() => setShowForm(f => !f)} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: showForm ? 'var(--border)' : 'var(--primary)', color: showForm ? 'var(--text)' : '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
              {showForm ? 'Cancel' : 'Renew Lease'}
            </button>
          )}
        </td>
      </tr>
      {showForm && (
        <tr style={{ background: 'var(--primary-light)' }}>
          <td colSpan={7} style={{ padding: '12px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>New lease start date:</span>
              <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
                style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, outline: 'none', background: 'var(--surface)' }} />
              <button onClick={handleRenew} disabled={renewing} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: 'var(--green)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                {renewing ? 'Saving...' : 'Confirm Renewal'}
              </button>
              {error && <span style={{ color: 'var(--red)', fontSize: 12 }}>{error}</span>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

import { useState, useEffect } from 'react';
import API from '../services/api';

function StatCard({ label, value, icon, color, light, onClick, sub }) {
  return (
    <div onClick={onClick} style={{
      background: 'var(--surface)', borderRadius: 'var(--radius)',
      padding: '20px 22px', boxShadow: 'var(--shadow)',
      border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 14,
      cursor: 'pointer', transition: 'all 0.15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-lg)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--shadow)'; e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      <div style={{ width: 48, height: 48, borderRadius: 12, flexShrink: 0, background: light, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'Space Grotesk', color, lineHeight: 1.2 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
      </div>
      <span style={{ color: 'var(--muted)', fontSize: 16, flexShrink: 0 }}>›</span>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, width: '100%', maxWidth: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18 }}>{title}</h2>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'var(--surface2)', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>{children}</div>
      </div>
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

function TR({ cells, i }) {
  return (
    <tr style={{ borderTop: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
      {cells.map((c, j) => <td key={j} style={{ padding: '12px 20px', fontSize: 14, ...c.style }}>{c.value}</td>)}
    </tr>
  );
}

export default function Dashboard() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const [tr, pr, hr, mr, plr] = await Promise.all([
          API.get('/tenants'),
          API.get('/payments'),
          API.get('/houses'),
          API.get('/maintenance'),
          API.get('/plots'),
        ]);
        const tenants  = Array.isArray(tr.data) ? tr.data : (tr.data.data || []);
        const payments = Array.isArray(pr.data) ? pr.data : (pr.data.data || []);
        const houses   = Array.isArray(hr.data) ? hr.data : (hr.data.data || []);
        const requests = Array.isArray(mr.data) ? mr.data : (mr.data.data || []);
        const plots    = Array.isArray(plr.data) ? plr.data : (plr.data.data || []);

        const now       = new Date();
        const thisMonth = payments.filter(p => {
          const d = new Date(p.payment_date);
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        });

        const elevenMonthsAgo = new Date();
        elevenMonthsAgo.setMonth(elevenMonthsAgo.getMonth() - 11);

        setData({
          tenants, payments, houses, requests, plots,
          activeTenants:   tenants.filter(t => t.is_active),
          unpaidTenants:   tenants.filter(t => t.is_active && parseFloat(t.balance || 0) > 0),
          occupiedHouses:  houses.filter(h => h.status === 'occupied'),
          vacantHouses:    houses.filter(h => h.status === 'vacant'),
          pendingRequests: requests.filter(r => r.status === 'pending'),
          expiringLeases:  tenants.filter(t => t.is_active && t.move_in_date && new Date(t.move_in_date) <= elevenMonthsAgo),
          monthRevenue:    thisMonth.reduce((s, p) => s + parseFloat(p.amount || 0), 0),
          totalRevenue:    payments.reduce((s, p) => s + parseFloat(p.amount || 0), 0),
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

  const { tenants, payments, houses, requests, plots,
    activeTenants, unpaidTenants, occupiedHouses, vacantHouses,
    pendingRequests, expiringLeases, monthRevenue, totalRevenue, thisMonth } = data;

  const occupancyRate = houses.length > 0 ? Math.round((occupiedHouses.length / houses.length) * 100) : 0;
  const totalUnpaid   = unpaidTenants.reduce((s, t) => s + parseFloat(t.balance || 0), 0);

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Dashboard</h1>
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>Welcome back. Here's what's happening today.</p>
      </div>

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, marginBottom: 28 }}>
        <StatCard label="Active Tenants"    value={activeTenants.length}   icon="👥" color="var(--primary)" light="var(--primary-light)" onClick={() => setModal('tenants')} />
        <StatCard label="Occupied Units"    value={occupiedHouses.length}  icon="🏠" color="var(--green)"   light="var(--green-light)"   onClick={() => setModal('occupied')} />
        <StatCard label="Vacant Units"      value={vacantHouses.length}    icon="🔑" color="var(--amber)"   light="var(--amber-light)"   onClick={() => setModal('vacant')} />
        <StatCard label="Revenue (Month)"   value={`KES ${monthRevenue.toLocaleString()}`}  icon="💰" color="var(--blue)"    light="var(--blue-light)"    onClick={() => setModal('revenue')} />
        <StatCard label="Unpaid Rent"       value={`KES ${totalUnpaid.toLocaleString()}`}   icon="⚠️" color="var(--red)"     light="var(--red-light)"     onClick={() => setModal('unpaid')}  sub={`${unpaidTenants.length} tenant${unpaidTenants.length !== 1 ? 's' : ''}`} />
        <StatCard label="Total Revenue"     value={`KES ${totalRevenue.toLocaleString()}`}  icon="📈" color="#8b5cf6"       light="#ede9fe"              onClick={() => setModal('allrevenue')} />
        <StatCard label="Maintenance"       value={pendingRequests.length} icon="🔧" color="#f97316"       light="#fff7ed"              onClick={() => setModal('maintenance')} sub="pending requests" />
        <StatCard label="Occupancy Rate"    value={`${occupancyRate}%`}    icon="📊" color="var(--green)"   light="var(--green-light)"   onClick={() => setModal('occupancy')} sub={`${occupiedHouses.length} of ${houses.length} units`} />
        <StatCard label="Total Properties"  value={plots.length}           icon="🏢" color="var(--primary)" light="var(--primary-light)" onClick={() => setModal('plots')} sub={`${houses.length} total units`} />
        <StatCard label="Expiring Leases"   value={expiringLeases.length}  icon="📅" color="var(--amber)"   light="var(--amber-light)"   onClick={() => setModal('expiring')} sub="11+ months tenancy" />
      </div>

      {/* Recent Payments */}
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 16 }}>Recent Payments</h2>
        </div>
        {payments.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>No payments recorded yet.</div>
        ) : (
          <Table
            headers={['Tenant', 'Amount', 'Method', 'Status', 'Date']}
            rows={payments.slice(0, 6).map((p, i) => (
              <TR key={p.id} i={i} cells={[
                { value: p.tenant_name || '—', style: { fontWeight: 600 } },
                { value: `KES ${parseFloat(p.amount).toLocaleString()}`, style: { fontWeight: 700, color: 'var(--green)' } },
                { value: <span style={{ background: 'var(--blue-light)', color: 'var(--blue)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{p.method || 'mpesa'}</span> },
                { value: <span style={{ background: p.status === 'matched' ? 'var(--green-light)' : 'var(--amber-light)', color: p.status === 'matched' ? 'var(--green)' : 'var(--amber)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{p.status}</span> },
                { value: new Date(p.payment_date).toLocaleDateString('en-KE'), style: { color: 'var(--muted)' } },
              ]} />
            ))}
          />
        )}
      </div>

      {/* ── Modals ── */}

      {modal === 'tenants' && (
        <Modal title={`Active Tenants (${activeTenants.length})`} onClose={() => setModal(null)}>
          <Table headers={['Name', 'Phone', 'Email', 'Unit', 'Move-in', 'Balance']} rows={activeTenants.map((t, i) => (
            <TR key={t.id} i={i} cells={[
              { value: t.full_name, style: { fontWeight: 600 } },
              { value: t.phone || '—', style: { color: 'var(--muted)' } },
              { value: t.email || '—', style: { color: 'var(--muted)', fontSize: 12 } },
              { value: t.unit_number || `#${t.house_id}`, style: { fontWeight: 600 } },
              { value: t.move_in_date ? new Date(t.move_in_date).toLocaleDateString('en-KE') : '—', style: { color: 'var(--muted)' } },
              { value: `KES ${parseFloat(t.balance || 0).toLocaleString()}`, style: { fontWeight: 700, color: parseFloat(t.balance) > 0 ? 'var(--red)' : 'var(--green)' } },
            ]} />
          ))} />
        </Modal>
      )}

      {modal === 'unpaid' && (
        <Modal title={`Unpaid Rent — KES ${totalUnpaid.toLocaleString()}`} onClose={() => setModal(null)}>
          {unpaidTenants.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>All tenants are up to date! 🎉</div> : (
            <Table headers={['Tenant', 'Phone', 'Unit', 'Balance Owed', 'Move-in']} rows={unpaidTenants.map((t, i) => (
              <TR key={t.id} i={i} cells={[
                { value: t.full_name, style: { fontWeight: 600 } },
                { value: t.phone || '—', style: { color: 'var(--muted)' } },
                { value: t.unit_number || `#${t.house_id}`, style: { fontWeight: 600 } },
                { value: `KES ${parseFloat(t.balance).toLocaleString()}`, style: { fontWeight: 700, color: 'var(--red)' } },
                { value: t.move_in_date ? new Date(t.move_in_date).toLocaleDateString('en-KE') : '—', style: { color: 'var(--muted)' } },
              ]} />
            ))} />
          )}
        </Modal>
      )}

      {modal === 'occupied' && (
        <Modal title={`Occupied Units (${occupiedHouses.length})`} onClose={() => setModal(null)}>
          <Table headers={['Unit', 'Type', 'Rent/mo', 'Plot']} rows={occupiedHouses.map((h, i) => (
            <TR key={h.id} i={i} cells={[
              { value: `Unit ${h.unit_number}`, style: { fontWeight: 700 } },
              { value: h.house_type, style: { color: 'var(--muted)' } },
              { value: `KES ${parseFloat(h.rent_amount).toLocaleString()}`, style: { fontWeight: 700, color: 'var(--primary)' } },
              { value: h.plot_name || '—', style: { color: 'var(--muted)' } },
            ]} />
          ))} />
        </Modal>
      )}

      {modal === 'vacant' && (
        <Modal title={`Vacant Units (${vacantHouses.length})`} onClose={() => setModal(null)}>
          <Table headers={['Unit', 'Type', 'Rent/mo', 'Deposit', 'Plot']} rows={vacantHouses.map((h, i) => (
            <TR key={h.id} i={i} cells={[
              { value: `Unit ${h.unit_number}`, style: { fontWeight: 700 } },
              { value: h.house_type, style: { color: 'var(--muted)' } },
              { value: `KES ${parseFloat(h.rent_amount).toLocaleString()}`, style: { fontWeight: 700, color: 'var(--primary)' } },
              { value: `KES ${parseFloat(h.deposit || 0).toLocaleString()}`, style: { color: 'var(--muted)' } },
              { value: h.plot_name || '—', style: { color: 'var(--muted)' } },
            ]} />
          ))} />
        </Modal>
      )}

      {modal === 'revenue' && (
        <Modal title={`This Month's Payments (${thisMonth.length})`} onClose={() => setModal(null)}>
          <div style={{ padding: '14px 24px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 32 }}>
            <div><div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>TOTAL</div><div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 20, color: 'var(--green)' }}>KES {monthRevenue.toLocaleString()}</div></div>
            <div><div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>TRANSACTIONS</div><div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 20, color: 'var(--blue)' }}>{thisMonth.length}</div></div>
          </div>
          <Table headers={['Tenant', 'Amount', 'Method', 'Reference', 'Date']} rows={thisMonth.map((p, i) => (
            <TR key={p.id} i={i} cells={[
              { value: p.tenant_name || '—', style: { fontWeight: 600 } },
              { value: `KES ${parseFloat(p.amount).toLocaleString()}`, style: { fontWeight: 700, color: 'var(--green)' } },
              { value: <span style={{ background: 'var(--blue-light)', color: 'var(--blue)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{p.method || 'mpesa'}</span> },
              { value: p.receipt_no || '—', style: { color: 'var(--muted)', fontSize: 12 } },
              { value: new Date(p.payment_date).toLocaleDateString('en-KE'), style: { color: 'var(--muted)' } },
            ]} />
          ))} />
        </Modal>
      )}

      {modal === 'allrevenue' && (
        <Modal title={`All Time Revenue — KES ${totalRevenue.toLocaleString()}`} onClose={() => setModal(null)}>
          <div style={{ padding: '14px 24px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 32 }}>
            <div><div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>TOTAL COLLECTED</div><div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 20, color: '#8b5cf6' }}>KES {totalRevenue.toLocaleString()}</div></div>
            <div><div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>TOTAL TRANSACTIONS</div><div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 20, color: 'var(--blue)' }}>{payments.length}</div></div>
          </div>
          <Table headers={['Tenant', 'Amount', 'Method', 'Status', 'Date']} rows={payments.map((p, i) => (
            <TR key={p.id} i={i} cells={[
              { value: p.tenant_name || '—', style: { fontWeight: 600 } },
              { value: `KES ${parseFloat(p.amount).toLocaleString()}`, style: { fontWeight: 700, color: 'var(--green)' } },
              { value: <span style={{ background: 'var(--blue-light)', color: 'var(--blue)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{p.method || 'mpesa'}</span> },
              { value: <span style={{ background: p.status === 'matched' ? 'var(--green-light)' : 'var(--amber-light)', color: p.status === 'matched' ? 'var(--green)' : 'var(--amber)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{p.status}</span> },
              { value: new Date(p.payment_date).toLocaleDateString('en-KE'), style: { color: 'var(--muted)' } },
            ]} />
          ))} />
        </Modal>
      )}

      {modal === 'maintenance' && (
        <Modal title={`Pending Maintenance (${pendingRequests.length})`} onClose={() => setModal(null)}>
          <Table headers={['#', 'Issue', 'Priority', 'Reported']} rows={pendingRequests.map((r, i) => (
            <TR key={r.id} i={i} cells={[
              { value: `#${r.id}`, style: { color: 'var(--muted)', fontSize: 12 } },
              { value: r.issue, style: { fontWeight: 600 } },
              { value: <span style={{ background: r.priority === 'high' ? 'var(--red-light)' : r.priority === 'medium' ? 'var(--amber-light)' : 'var(--blue-light)', color: r.priority === 'high' ? 'var(--red)' : r.priority === 'medium' ? 'var(--amber)' : 'var(--blue)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>{r.priority}</span> },
              { value: new Date(r.reported_at).toLocaleDateString('en-KE'), style: { color: 'var(--muted)' } },
            ]} />
          ))} />
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
              { value: `Unit ${h.unit_number}`, style: { fontWeight: 700 } },
              { value: h.house_type, style: { color: 'var(--muted)' } },
              { value: `KES ${parseFloat(h.rent_amount).toLocaleString()}`, style: { fontWeight: 600, color: 'var(--primary)' } },
              { value: h.plot_name || '—', style: { color: 'var(--muted)' } },
              { value: <span style={{ background: h.status === 'vacant' ? 'var(--green-light)' : 'var(--amber-light)', color: h.status === 'vacant' ? 'var(--green)' : 'var(--amber)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{h.status}</span> },
            ]} />
          ))} />
        </Modal>
      )}

      {modal === 'plots' && (
        <Modal title={`Properties (${plots.length} plots · ${houses.length} units)`} onClose={() => setModal(null)}>
          <Table headers={['Plot Name', 'Location', 'Units']} rows={plots.map((p, i) => (
            <TR key={p.id} i={i} cells={[
              { value: p.name, style: { fontWeight: 700 } },
              { value: p.location || '—', style: { color: 'var(--muted)' } },
              { value: houses.filter(h => h.plot_id === p.id).length, style: { fontWeight: 600, color: 'var(--primary)' } },
            ]} />
          ))} />
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
                      // Reload data after renewal
                      setData(null);
                      setLoading(true);
                    }} />
                  );
                })}
              </tbody>
            </table>
          )}
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
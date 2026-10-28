// Owner portal: a read-only live view for a landlord whose properties are run
// by an agent. Their numbers for the month, per property, plus the PDF owner
// statement and a one-tap message to the agent. Nothing here can change data.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../services/api';
import { useAuth } from '../context/AuthContext';

const kes = (n) => `KES ${Math.round(Number(n || 0)).toLocaleString()}`;
const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthName = (m) => { const [y, mo] = m.split('-'); return new Date(+y, +mo - 1, 1).toLocaleString('en-KE', { month: 'long', year: 'numeric' }); };
const shortDate = (d) => new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });

export default function OwnerPortal() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);       // plot id whose detail is open
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState('arrears');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try { const r = await API.get('/portal/overview', { params: { month } }); setData(r.data); setErr(''); }
    catch (e) { setErr(e.response?.data?.error || 'Could not load your properties.'); }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!open) { setDetail(null); return; }
    setDetail(null);
    API.get(`/portal/plots/${open}`, { params: { month } }).then(r => setDetail(r.data)).catch(e => setErr(e.response?.data?.error || 'Could not load that property.'));
  }, [open, month]);

  const statement = async (plotId) => {
    setBusy(`pdf${plotId}`);
    try {
      const r = await API.get('/statements/landlord', { params: { month, plot_id: plotId }, responseType: 'blob' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = `owner_statement_${month}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch { setErr('Could not create the statement.'); }
    setBusy('');
  };
  const messageAgent = async (agent) => {
    if (!agent?.id) return;
    setBusy(`msg${agent.id}`);
    try {
      const r = await API.post('/notices/conversations/new', { recipient_id: agent.id, recipient_type: 'user' });
      navigate('/messages', { state: { conversationId: r.data.conversation_id } });
    } catch (e) { setErr(e.response?.data?.error || 'Could not open a conversation.'); }
    setBusy('');
  };

  const card = { background: 'var(--card, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 14, padding: 16 };
  const btn = { padding: '8px 14px', borderRadius: 9, border: '1px solid var(--border, #d1d5db)', background: 'var(--card, #fff)', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
  const primary = { ...btn, background: 'var(--primary, #7c3aed)', color: '#fff', border: 'none' };
  const th = { textAlign: 'left', padding: '7px 9px', fontSize: 12, color: 'var(--muted, #6b7280)', borderBottom: '1px solid var(--border, #e5e7eb)' };
  const td = { padding: '7px 9px', borderBottom: '1px solid var(--border, #f1f5f9)', fontSize: 14 };
  const muted = { color: 'var(--muted, #6b7280)' };
  const Bar = ({ pct, color }) => <div style={{ height: 8, borderRadius: 99, background: 'var(--border, #e5e7eb)', overflow: 'hidden' }}><div style={{ width: `${Math.min(100, Math.max(0, pct || 0))}%`, height: '100%', background: color }} /></div>;
  const Tile = ({ label, value, color }) => <div style={{ ...card, padding: 14 }}><div style={{ fontSize: 12, ...muted }}>{label}</div><div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div></div>;

  return (
    <div style={{ padding: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0 }}>Hello{user?.name ? `, ${user.name.split(' ')[0]}` : ''} 👋</h2>
          <div style={{ fontSize: 13, ...muted }}>Your properties, live. This page is view-only.</div>
        </div>
        <div style={{ flex: 1 }} />
        <input type="month" value={month} max={thisMonth()} onChange={e => e.target.value && setMonth(e.target.value)} style={{ ...btn, fontWeight: 500 }} />
      </div>
      {err && <div style={{ ...card, color: '#b91c1c', marginBottom: 12 }}>{err}</div>}
      {!data && !err && <div>Loading…</div>}
      {data && !data.plots.length && <div style={{ ...card, ...muted }}>No agent-managed properties to show yet.</div>}

      {data && data.plots.length > 0 && (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
          <Tile label={`Rent collected · ${monthName(month)}`} value={kes(data.totals.collected)} color="#15803d" />
          <Tile label="Expected this month" value={kes(data.totals.expected)} />
          <Tile label="Outstanding arrears" value={kes(data.totals.arrears_total)} color={data.totals.arrears_total ? '#b45309' : undefined} />
          <Tile label="Net to you (after expenses & agent fee)" value={kes(data.totals.net)} color="var(--primary, #7c3aed)" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {data.plots.map(p => (
            <div key={p.id} style={card}>
              <div style={{ fontWeight: 800, fontSize: 17 }}>{p.name}</div>
              <div style={{ fontSize: 13, ...muted, marginBottom: 10 }}>{p.location || ''}{p.location && p.agent?.name ? ' · ' : ''}{p.agent?.name ? `Agent: ${p.agent.name}` : ''}</div>
              <div style={{ fontSize: 12.5, ...muted }}>Occupancy · {p.units.occupied} of {p.units.total} units ({p.occupancy}%)</div>
              <Bar pct={p.occupancy} color="#2563eb" />
              <div style={{ fontSize: 12.5, ...muted, marginTop: 8 }}>Collected {kes(p.collected)} of {kes(p.expected)}{p.collection_rate != null ? ` (${p.collection_rate}%)` : ''}</div>
              <Bar pct={p.collection_rate} color="#16a34a" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 12, fontSize: 13 }}>
                <div><span style={muted}>Arrears</span><br /><b style={{ color: p.arrears_total ? '#b45309' : undefined }}>{kes(p.arrears_total)}</b> <span style={muted}>({p.arrears_count} unit{p.arrears_count === 1 ? '' : 's'})</span></div>
                <div><span style={muted}>Net to you</span><br /><b>{kes(p.net)}</b></div>
                <div><span style={muted}>Vacant units</span><br /><b>{p.units.vacant}</b></div>
                <div><span style={muted}>Open repairs</span><br /><b>{p.open_maintenance}</b></div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                <button style={primary} onClick={() => { setTab('arrears'); setOpen(open === p.id ? null : p.id); }}>{open === p.id ? 'Hide details' : 'View details'}</button>
                <button style={btn} disabled={busy === `pdf${p.id}`} onClick={() => statement(p.id)}>{busy === `pdf${p.id}` ? 'Preparing…' : '📄 Statement'}</button>
                <button style={btn} disabled={!p.agent?.id || busy === `msg${p.agent?.id}`} onClick={() => messageAgent(p.agent)}>💬 Message agent</button>
              </div>
            </div>
          ))}
        </div>

        {open && (
          <div style={{ ...card, marginTop: 16 }}>
            {!detail ? 'Loading…' : (<>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
                <b style={{ fontSize: 16, marginRight: 8 }}>{detail.plot.name} · {monthName(month)}</b>
                {[['arrears', `Arrears (${detail.arrears.length})`], ['payments', `Payments (${detail.payments.length})`], ['expenses', `Expenses (${detail.expenses_list.length})`], ['repairs', `Repairs (${detail.maintenance.length})`], ['vacant', `Vacant (${detail.vacant.length})`]].map(([k, l]) =>
                  <button key={k} style={tab === k ? primary : btn} onClick={() => setTab(k)}>{l}</button>)}
              </div>
              {!detail.show_tenants && <div style={{ fontSize: 12.5, ...muted, marginBottom: 8 }}>Tenant names and phone numbers aren't shown here. Ask your agent if you need them.</div>}
              <div style={{ overflowX: 'auto' }}>
                {tab === 'arrears' && <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>Unit</th>{detail.show_tenants && <><th style={th}>Tenant</th><th style={th}>Phone</th></>}<th style={th}>Owes</th><th style={th}>Months behind</th></tr></thead><tbody>
                  {detail.arrears.map((a, i) => <tr key={i}><td style={td}><b>{a.unit_number}</b></td>{detail.show_tenants && <><td style={td}>{a.full_name}</td><td style={td}>{a.phone}</td></>}<td style={td}>{kes(a.owed)}</td><td style={td}>{a.months_behind}</td></tr>)}
                  {!detail.arrears.length && <tr><td style={td} colSpan={5}>🎉 No arrears.</td></tr>}</tbody></table>}
                {tab === 'payments' && <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>Date</th><th style={th}>Unit</th>{detail.show_tenants && <th style={th}>Tenant</th>}<th style={th}>Method</th><th style={th}>Amount</th></tr></thead><tbody>
                  {detail.payments.map((p, i) => <tr key={i}><td style={td}>{shortDate(p.payment_date)}</td><td style={td}>{p.unit_number}</td>{detail.show_tenants && <td style={td}>{p.full_name || '—'}</td>}<td style={td}>{p.method}</td><td style={td}>{kes(p.amount)}</td></tr>)}
                  {!detail.payments.length && <tr><td style={td} colSpan={5}>No payments this month yet.</td></tr>}</tbody></table>}
                {tab === 'expenses' && <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>Date</th><th style={th}>Category</th><th style={th}>Description</th><th style={th}>Amount</th></tr></thead><tbody>
                  {detail.expenses_list.map((e, i) => <tr key={i}><td style={td}>{shortDate(e.expense_date)}</td><td style={td}>{e.category}</td><td style={td}>{e.description || '—'}</td><td style={td}>{kes(e.amount)}</td></tr>)}
                  {detail.agent_fee > 0 && <tr><td style={td} colSpan={3}>Agent fee ({detail.agent_fee_percent}% of rent collected)</td><td style={td}>{kes(detail.agent_fee)}</td></tr>}
                  {!detail.expenses_list.length && !detail.agent_fee && <tr><td style={td} colSpan={4}>No expenses this month.</td></tr>}</tbody></table>}
                {tab === 'repairs' && <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>Reported</th><th style={th}>Unit</th><th style={th}>Issue</th><th style={th}>Priority</th><th style={th}>Status</th></tr></thead><tbody>
                  {detail.maintenance.map(m => <tr key={m.id}><td style={td}>{shortDate(m.reported_at)}</td><td style={td}>{m.unit_number}</td><td style={td}>{m.issue}</td><td style={td}>{m.priority}</td><td style={td}>{String(m.status).replace('_', ' ')}</td></tr>)}
                  {!detail.maintenance.length && <tr><td style={td} colSpan={5}>No open repairs.</td></tr>}</tbody></table>}
                {tab === 'vacant' && <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>Unit</th><th style={th}>Type</th><th style={th}>Rent</th></tr></thead><tbody>
                  {detail.vacant.map((v, i) => <tr key={i}><td style={td}><b>{v.unit_number}</b></td><td style={td}>{v.house_type || '—'}</td><td style={td}>{kes(v.rent_amount)}</td></tr>)}
                  {!detail.vacant.length && <tr><td style={td} colSpan={3}>Fully occupied.</td></tr>}</tbody></table>}
              </div>
            </>)}
          </div>
        )}
      </>)}
    </div>
  );
}

// Rent passport: a PDF record of a tenant's rent payments that the tenant can show a new
// landlord or lender. Issued by staff, only when the tenant has asked for it.
import { useEffect, useMemo, useState } from 'react';
import API from '../services/api';

const COLOR = { on_time: '#16a34a', late: '#d97706', partial: '#ea580c', unpaid: '#dc2626' };
const LABEL = { on_time: 'On time', late: 'Late', partial: 'Part paid', unpaid: 'Not paid' };

export default function Passport() {
  const [tenants, setTenants] = useState([]);
  const [q, setQ] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [grace, setGrace] = useState(3);
  const [data, setData] = useState(null);
  const [comment, setComment] = useState('');
  const [asked, setAsked] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { API.get('/tenants').then(r => setTenants(r.data.data || r.data || [])).catch(() => setErr('Could not load tenants.')); }, []);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tenants.filter(t => !s || `${t.full_name} ${t.unit_number || ''} ${t.plot_name || ''}`.toLowerCase().includes(s)).slice(0, 30);
  }, [tenants, q]);

  useEffect(() => {
    setData(null); setAsked(false); if (!tenantId) return;
    API.get(`/passport/${tenantId}`, { params: { grace } }).then(r => { setData(r.data); setErr(''); }).catch(e => setErr(e.response?.data?.error || 'Could not load the record.'));
  }, [tenantId, grace]);

  const download = async () => {
    try {
      const r = await API.post(`/passport/${tenantId}/pdf`, { grace, comment, tenant_requested: asked }, { responseType: 'blob' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = `rent-passport-${data.tenant.full_name.replace(/\s+/g, '_')}.pdf`; a.click(); setErr('');
    } catch (e) {
      let m = 'Could not create the PDF.';
      try { m = JSON.parse(await e.response.data.text()).error || m; } catch { /* keep default */ }
      setErr(m);
    }
  };

  const card = { background: 'var(--card, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 14, padding: 16, marginBottom: 14 };
  const inp = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)', background: 'var(--bg, #fff)', color: 'inherit', fontSize: 14, boxSizing: 'border-box', width: '100%' };
  const btn = { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)', background: 'var(--card, #fff)', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
  const primary = { ...btn, background: 'var(--primary, #7c3aed)', color: '#fff', border: 'none' };
  const muted = { color: 'var(--muted, #6b7280)', fontSize: 13 };
  const s = data?.summary;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 4 }}>
      <h2 style={{ margin: '0 0 4px' }}>🪪 Rent passport</h2>
      <p style={{ ...muted, marginTop: 0 }}>A proof of rent payments for a tenant who asks for it, for example to rent a new home or apply for a loan. Only issue it when the tenant has asked.</p>
      {err && <div style={{ ...card, color: '#b91c1c' }}>{err}</div>}

      <div style={card}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>1. Choose a tenant</div>
        <input style={inp} placeholder="Search by name, unit or property" value={q} onChange={e => setQ(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, maxHeight: 150, overflowY: 'auto' }}>
          {matches.map(t => <button key={t.id} onClick={() => setTenantId(String(t.id))} style={{ ...btn, background: String(t.id) === tenantId ? 'var(--primary, #7c3aed)' : undefined, color: String(t.id) === tenantId ? '#fff' : undefined }}>{t.full_name} <span style={{ opacity: .7, fontWeight: 400 }}>{t.unit_number || ''}</span></button>)}
          {matches.length === 0 && <span style={muted}>No tenants found.</span>}
        </div>
      </div>

      {data && s && (<>
        <div style={card}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <b style={{ fontSize: 16 }}>{data.tenant.full_name}</b><span style={muted}>{data.tenant.plot_name}, Unit {data.tenant.unit_number}</span><div style={{ flex: 1 }} />
            <label style={muted}>Count as on time within <select style={{ ...inp, width: 'auto', padding: '4px 6px' }} value={grace} onChange={e => setGrace(Number(e.target.value))}>{[0, 1, 2, 3, 5, 7, 10].map(n => <option key={n} value={n}>{n} day{n === 1 ? '' : 's'}</option>)}</select> after the due day</label>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '14px 0' }}>
            {[['On time', `${s.on_time_pct}%`, `${s.on_time} of ${s.months} months`], ['Paid late', s.late, 'in full, after the grace days'], ['Part or not paid', s.partial + s.unpaid, 'months'], ['Longest on-time run', s.best_streak, 'months']].map(([l, v, sub]) => (
              <div key={l} style={{ flex: '1 1 150px', border: '1px solid var(--border, #e5e7eb)', borderRadius: 12, padding: '10px 14px' }}><div style={muted}>{l}</div><div style={{ fontSize: 24, fontWeight: 800 }}>{v}</div><div style={muted}>{sub}</div></div>))}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {data.months.map(m => <div key={m.label} title={`${m.label}: ${LABEL[m.status]}`} style={{ width: 52, textAlign: 'center', fontSize: 11 }}><div style={{ height: 22, borderRadius: 5, background: COLOR[m.status] }} />{m.label.replace(' 20', " '")}</div>)}
          </div>
          <div style={{ ...muted, marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>{Object.entries(LABEL).map(([k, l]) => <span key={k}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: COLOR[k], marginRight: 4 }} />{l}</span>)}</div>
          <p style={{ ...muted, marginBottom: 0 }}>The current month is left out until it ends. The tenant's current rent is used for every month.</p>
        </div>

        <div style={card}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>2. Issue</div>
          <label style={muted}>Optional comment from the landlord (printed on the passport)
            <textarea style={{ ...inp, minHeight: 60, marginTop: 4 }} maxLength={500} value={comment} onChange={e => setComment(e.target.value)} /></label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0', fontSize: 14 }}>
            <input type="checkbox" checked={asked} onChange={e => setAsked(e.target.checked)} /> The tenant has asked for their rent passport.
          </label>
          <button style={{ ...primary, opacity: asked ? 1 : .5 }} disabled={!asked} onClick={download}>Download PDF</button>
        </div>
      </>)}
      {data && !s && <div style={card}>No rent history yet. The tenant needs a move-in date and a rent amount.</div>}
    </div>
  );
}

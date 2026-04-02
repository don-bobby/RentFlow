import { useState, useEffect } from 'react';
import API from '../services/api';

export default function Payments() {
  const [payments, setPayments] = useState([]);
  const [tenants,  setTenants]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');
  const [filter,   setFilter]   = useState('all');
  const [form,     setForm]     = useState({ tenant_id: '', amount: '', payment_date: '', payment_method: 'mpesa', reference_number: '', notes: '' });

  async function load() {
    setLoading(true);
    try {
      const [pr, tr] = await Promise.all([
        API.get('/payments'),
        API.get('/tenants'),
      ]);
      setPayments(Array.isArray(pr.data) ? pr.data : (pr.data.data || []));
      setTenants(Array.isArray(tr.data) ? tr.data : (tr.data.data || []));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const tenant = tenants.find(t => String(t.id) === String(form.tenant_id));
      await API.post('/payments', { ...form, unit_id: tenant?.house_id });
      await load();
      setModal(false);
    } catch (e) {
      setError(e.response?.data?.message || e.response?.data?.error || e.message || 'Failed to record payment');
    } finally { setSaving(false); }
  }

  const filtered    = filter === 'all' ? payments : payments.filter(p => p.status === filter);
  const total       = filtered.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
  const statusColor = { matched: 'var(--green)', unmatched: 'var(--amber)', review: 'var(--blue)' };
  const statusBg    = { matched: 'var(--green-light)', unmatched: 'var(--amber-light)', review: 'var(--blue-light)' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Payments</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>{payments.length} transactions · KES {payments.reduce((s,p)=>s+parseFloat(p.amount||0),0).toLocaleString()} total</p>
        </div>
        <button onClick={() => { setForm({ tenant_id:tenants[0]?.id||'', amount:'', payment_date:new Date().toISOString().split('T')[0], payment_method:'mpesa', reference_number:'', notes:'' }); setModal(true); setError(''); }}
          style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 14 }}>
          + Record Payment
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['all','matched','unmatched','review'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '7px 16px', borderRadius: 99, border: '1px solid var(--border)', background: filter === f ? 'var(--primary)' : 'var(--surface)', color: filter === f ? '#fff' : 'var(--muted)', fontWeight: 600, fontSize: 13, textTransform: 'capitalize' }}>{f}</button>
        ))}
        <div style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--primary)', fontSize: 15, display: 'flex', alignItems: 'center' }}>
          KES {total.toLocaleString()}
        </div>
      </div>

      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>No payments found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                {['Receipt / Ref', 'Amount', 'Phone', 'Method', 'Status', 'Date'].map(h => (
                  <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => (
                <tr key={p.id} style={{ borderTop: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
                  <td style={{ padding: '12px 20px', fontFamily: 'JetBrains Mono', fontSize: 12, color: 'var(--muted)' }}>{p.receipt_no || p.transaction_id || '—'}</td>
                  <td style={{ padding: '12px 20px', fontWeight: 700, color: 'var(--green)', fontSize: 15 }}>KES {parseFloat(p.amount).toLocaleString()}</td>
                  <td style={{ padding: '12px 20px', color: 'var(--muted)' }}>{p.phone || '—'}</td>
                  <td style={{ padding: '12px 20px' }}>
                    <span style={{ background: 'var(--blue-light)', color: 'var(--blue)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{p.method || 'mpesa'}</span>
                  </td>
                  <td style={{ padding: '12px 20px' }}>
                    <span style={{ background: statusBg[p.status] || 'var(--border)', color: statusColor[p.status] || 'var(--muted)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{p.status}</span>
                  </td>
                  <td style={{ padding: '12px 20px', color: 'var(--muted)', fontSize: 13 }}>{new Date(p.payment_date).toLocaleDateString('en-KE')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 460, boxShadow: 'var(--shadow-lg)' }}>
            <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18, marginBottom: 20 }}>Record Payment</h2>
            {error && <div style={{ background: 'var(--red-light)', color: 'var(--red)', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle}>Tenant</label>
                <select value={form.tenant_id} onChange={e => setForm(f=>({...f,tenant_id:e.target.value}))} style={inputStyle}>
                  {tenants.filter(t=>t.is_active).map(t => <option key={t.id} value={t.id}>{t.full_name} — {t.phone}</option>)}
                </select>
              </div>
              <Field label="Amount (KES)"       value={form.amount}           onChange={v=>setForm(f=>({...f,amount:v}))}           placeholder="15000" type="number" />
              <Field label="Payment Date"       value={form.payment_date}     onChange={v=>setForm(f=>({...f,payment_date:v}))}     type="date" />
              <div>
                <label style={labelStyle}>Method</label>
                <select value={form.payment_method} onChange={e=>setForm(f=>({...f,payment_method:e.target.value}))} style={inputStyle}>
                  {['mpesa','cash','bank_transfer','cheque'].map(m=><option key={m}>{m}</option>)}
                </select>
              </div>
              <Field label="Reference / Receipt" value={form.reference_number} onChange={v=>setForm(f=>({...f,reference_number:v}))} placeholder="e.g. QHJ7K2X" />
              <Field label="Notes (optional)"    value={form.notes}            onChange={v=>setForm(f=>({...f,notes:v}))}            placeholder="March rent" />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={() => setModal(false)} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14 }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 14 }}>
                {saving ? 'Saving...' : 'Record'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' };
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 14, color: 'var(--text)', outline: 'none' };

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

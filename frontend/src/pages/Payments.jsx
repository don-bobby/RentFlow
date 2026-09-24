import { useState, useEffect } from 'react';
import API from '../services/api';

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Tracks the light/dark theme Layout.jsx sets via document.documentElement's
// data-theme attribute — same helper used on Dashboard.jsx, Properties.jsx and
// Tenants.jsx.
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

const BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

export default function Payments() {
  const [payments,       setPayments]       = useState([]);
  const [tenants,        setTenants]        = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [modal,          setModal]          = useState(false);
  const [stkModal,       setStkModal]       = useState(false);
  const [stkTenant,      setStkTenant]      = useState(null);   // tenant object for STK modal
  const [stkPhone,       setStkPhone]       = useState('');
  const [stkAmount,      setStkAmount]      = useState('');
  const [stkStatus,      setStkStatus]      = useState('idle'); // idle | pending | success | failed
  const [stkMsg,         setStkMsg]         = useState('');
  const [stkLoading,     setStkLoading]     = useState(false);
  const [arrears,        setArrears]        = useState(null);
  const [arrearsLoading, setArrearsLoading] = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState('');
  const [filter,         setFilter]         = useState('all');
  const [form,           setForm]           = useState({
    tenant_id: '', amount: '', payment_date: '', payment_method: 'mpesa', reference_number: '', notes: '',
  });

  async function load() {
    setLoading(true);
    try {
      const [pr, tr] = await Promise.all([API.get('/payments'), API.get('/tenants')]);
      setPayments(Array.isArray(pr.data) ? pr.data : (pr.data.data || []));
      setTenants(Array.isArray(tr.data) ? tr.data : (tr.data.data || []));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function loadArrears(tenantId) {
    if (!tenantId) { setArrears(null); return; }
    setArrearsLoading(true);
    try {
      const res = await API.get(`/payments/arrears/${tenantId}`);
      setArrears(res.data.data);
    } catch (e) { setArrears(null); }
    finally { setArrearsLoading(false); }
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const tenant = tenants.find(t => String(t.id) === String(form.tenant_id));
      await API.post('/payments', { ...form, unit_id: tenant?.house_id });
      await load();
      setModal(false);
      setArrears(null);
    } catch (e) {
      setError(e.response?.data?.message || e.response?.data?.error || e.message || 'Failed to record payment');
    } finally { setSaving(false); }
  }

  // ── STK Push ─────────────────────────────────────────────────
  function openStkModal(tenant) {
    setStkTenant(tenant);
    setStkPhone(tenant.phone || '');
    setStkAmount('');
    setStkStatus('idle');
    setStkMsg('');
    setStkModal(true);
    loadArrears(tenant.id);
  }

  async function triggerStkPush() {
    if (!stkAmount || parseFloat(stkAmount) <= 0) { setStkMsg('Enter a valid amount.'); return; }
    setStkLoading(true); setStkMsg(''); setStkStatus('idle');
    try {
      const token = localStorage.getItem('token');
      const res   = await fetch(`${BASE}/mpesa/stk-push`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ tenant_id: stkTenant?.id, phone: stkPhone, amount: stkAmount }),
      });
      const data = await res.json();
      if (data.success) {
        const checkoutId = data.data?.CheckoutRequestID;
        setStkStatus('pending');
        setStkMsg('⏳ STK push sent — tenant should enter M-Pesa PIN on their phone. Waiting for confirmation...');
        setStkAmount('');
        pollPaymentStatus(checkoutId);
      } else {
        setStkStatus('failed');
        setStkMsg(data.error || 'Failed to send STK push.');
      }
    } catch (e) {
      setStkStatus('failed');
      setStkMsg('Failed to connect. Please try again.');
    } finally { setStkLoading(false); }
  }

  async function pollPaymentStatus(checkoutId) {
    if (!checkoutId) return;
    const maxAttempts = 12; // 60 seconds
    let attempts = 0;
    const token = localStorage.getItem('token');
    const interval = setInterval(async () => {
      attempts++;
      try {
        const res  = await fetch(`${BASE}/mpesa/stk-status/${encodeURIComponent(checkoutId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.status === 'matched') {
          clearInterval(interval);
          setStkStatus('success');
          setStkMsg('✅ Payment confirmed! The account has been updated.');
          load(); // refresh payments table
        } else if (data.status === 'failed') {
          clearInterval(interval);
          setStkStatus('failed');
          setStkMsg(`❌ Payment failed — ${data.reason || 'insufficient funds or PIN cancelled'}.`);
        } else if (attempts >= maxAttempts) {
          clearInterval(interval);
          setStkStatus('failed');
          setStkMsg('⚠️ No confirmation after 60s. Check M-Pesa messages to confirm if payment went through.');
        }
      } catch { /* keep polling */ }
    }, 5000);
  }

  const filtered    = filter === 'all' ? payments : payments.filter(p => p.status === filter);
  const total       = filtered.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
  const isDark      = useIsDarkMode();
  const statusColor = {
    matched:   isDark ? '#4ade80' : 'var(--green, #16a34a)',
    unmatched: isDark ? '#fbbf24' : 'var(--amber, #d97706)',
    review:    isDark ? '#60a5fa' : 'var(--blue, #2563eb)',
    pending:   'var(--muted)',
    failed:    isDark ? '#f87171' : 'var(--red, #dc2626)',
  };
  const statusBg    = {
    matched:   isDark ? hexToRgba('#16a34a', 0.2) : 'var(--green-light, #dcfce7)',
    unmatched: isDark ? hexToRgba('#d97706', 0.2) : 'var(--amber-light, #fef3c7)',
    review:    isDark ? hexToRgba('#2563eb', 0.2) : 'var(--blue-light, #dbeafe)',
    pending:   'var(--surface2)',
    failed:    isDark ? hexToRgba('#dc2626', 0.2) : 'var(--red-light, #fee2e2)',
  };
  const monthName   = (y, m) => new Date(y, m - 1, 1).toLocaleString('en-KE', { month: 'long', year: 'numeric' });

  const activeTenants = tenants.filter(t => t.is_active);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>Payments</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>{payments.length} transactions · KES {payments.reduce((s,p)=>s+parseFloat(p.amount||0),0).toLocaleString()} total</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => {
            const firstActive = activeTenants[0];
            setStkTenant(firstActive || null);
            setStkPhone(firstActive?.phone || '');
            setStkAmount('');
            setStkStatus('idle');
            setStkMsg('');
            setStkModal(true);
            setArrears(null);
            if (firstActive) loadArrears(firstActive.id);
          }} style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            📱 STK Push
          </button>
          <button onClick={() => {
            const firstActive = activeTenants[0];
            setForm({ tenant_id: firstActive?.id || '', amount: '', payment_date: new Date().toISOString().split('T')[0], payment_method: 'mpesa', reference_number: '', notes: '' });
            setArrears(null);
            if (firstActive) loadArrears(firstActive.id);
            setModal(true); setError('');
          }} style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--primary, #7c3aed)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            + Record Payment
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['all','matched','unmatched','review','pending','failed'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '7px 16px', borderRadius: 99, border: '1px solid var(--border)', background: filter === f ? 'var(--primary, #7c3aed)' : 'var(--surface)', color: filter === f ? '#fff' : 'var(--muted)', fontWeight: 600, fontSize: 13, textTransform: 'capitalize', cursor: 'pointer' }}>{f}</button>
        ))}
        <div style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--primary, #7c3aed)', fontSize: 15, display: 'flex', alignItems: 'center' }}>
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
                {['Tenant', 'Receipt / Ref', 'Amount', 'Allocated To', 'Method', 'Status', 'Date', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => (
                <tr key={p.id} style={{ borderTop: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: isDark ? 'var(--blue, #2563eb)' : 'var(--text)' }}>{p.tenant_name || '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Unit {p.unit_number || '—'}</div>
                  </td>
                  <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)' }}>{p.receipt_no || p.transaction_id || '—'}</td>
                  <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--green, #16a34a)', fontSize: 15 }}>KES {parseFloat(p.amount).toLocaleString()}</td>
                  <td style={{ padding: '12px 16px' }}>
                    {p.for_year && p.for_month
                      ? <span style={{ background: isDark ? hexToRgba('#7c3aed', 0.22) : 'var(--primary-light)', color: isDark ? '#c4b5fd' : 'var(--primary, #7c3aed)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{monthName(p.for_year, p.for_month)}</span>
                      : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ background: isDark ? hexToRgba('#2563eb', 0.22) : 'var(--blue-light)', color: isDark ? '#93c5fd' : 'var(--blue, #2563eb)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{p.method || 'mpesa'}</span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ background: statusBg[p.status] || 'var(--surface2)', color: statusColor[p.status] || 'var(--muted)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{p.status}</span>
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--muted)', fontSize: 13, fontWeight: 700 }}>{new Date(p.payment_date).toLocaleDateString('en-KE')}</td>
                  <td style={{ padding: '12px 16px' }}>
                    {p.tenant_id && (
                      <button
                        onClick={() => {
                          const t = tenants.find(t => t.id === p.tenant_id);
                          if (t) openStkModal(t);
                        }}
                        title="Send STK Push to this tenant"
                        style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--primary, #7c3aed)' }}>
                        📱
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── STK Push Modal ─────────────────────────────────────── */}
      {stkModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 480, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>📱 Send M-Pesa STK Push</h2>
              <button onClick={() => { setStkModal(false); setArrears(null); }} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'var(--surface2)', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}>×</button>
            </div>

            {/* Tenant selector */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Tenant</label>
              <select value={stkTenant?.id || ''} onChange={e => {
                const t = tenants.find(t => String(t.id) === e.target.value);
                setStkTenant(t || null);
                setStkPhone(t?.phone || '');
                setStkStatus('idle'); setStkMsg('');
                if (t) loadArrears(t.id);
              }} style={inputStyle}>
                <option value="">— Select tenant —</option>
                {activeTenants.map(t => (
                  <option key={t.id} value={t.id}>{t.full_name} — {t.phone} (Unit {t.unit_number || t.house_id})</option>
                ))}
              </select>
            </div>

            {/* Arrears summary */}
            {arrearsLoading && <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>Loading arrears...</div>}
            {arrears && !arrearsLoading && arrears.total_arrears > 0 && (
              <div style={{ background: isDark ? hexToRgba('#dc2626', 0.15) : 'var(--red-light)', border: '1px solid var(--red, #dc2626)', borderRadius: 10, padding: '12px 14px', marginBottom: 14, fontSize: 13 }}>
                <div style={{ fontWeight: 700, color: 'var(--red, #dc2626)', marginBottom: 6 }}>⚠️ Outstanding: KES {arrears.total_arrears.toLocaleString()}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {arrears.unpaid_months?.map(m => (
                    <span key={`${m.year}-${m.month}`} style={{ background: isDark ? 'var(--surface2)' : 'white', border: '1px solid var(--red, #dc2626)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, color: 'var(--red, #dc2626)' }}>
                      {monthName(m.year, m.month)} — KES {m.balance.toLocaleString()}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Payment will allocate to oldest month first.</div>
              </div>
            )}
            {arrears && !arrearsLoading && arrears.total_arrears === 0 && (
              <div style={{ background: isDark ? hexToRgba('#16a34a', 0.15) : 'var(--green-light)', border: '1px solid var(--green, #16a34a)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, fontWeight: 600, color: 'var(--green, #16a34a)' }}>
                ✅ No arrears — tenant is up to date.
              </div>
            )}

            {/* Phone field */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>M-Pesa Phone Number</label>
              <input type="tel" value={stkPhone} onChange={e => setStkPhone(e.target.value)}
                placeholder="e.g. 0712345678" style={inputStyle} />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Pre-filled from tenant record. Change if paying from a different line.</div>
            </div>

            {/* Amount field */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Amount (KES)</label>
              <input type="number" value={stkAmount} onChange={e => setStkAmount(e.target.value)}
                placeholder="Enter amount" style={{ ...inputStyle, fontSize: 18, fontWeight: 600 }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {stkTenant && (
                  <button onClick={() => setStkAmount(String(stkTenant.rent_amount || ''))}
                    style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--muted)' }}>
                    One Month (KES {parseFloat(stkTenant.rent_amount || 0).toLocaleString()})
                  </button>
                )}
                {arrears && arrears.total_arrears > 0 && (
                  <button onClick={() => setStkAmount(String(arrears.total_arrears))}
                    style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--red, #dc2626)', background: isDark ? hexToRgba('#dc2626', 0.18) : 'var(--red-light)', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--red, #dc2626)' }}>
                    Clear All (KES {arrears.total_arrears.toLocaleString()})
                  </button>
                )}
              </div>
            </div>

            {/* Status message */}
            {stkMsg && (
              <div style={{
                background: stkStatus === 'success' ? (isDark ? hexToRgba('#16a34a', 0.18) : 'var(--green-light)') : stkStatus === 'pending' ? (isDark ? hexToRgba('#2563eb', 0.18) : 'var(--blue-light)') : (isDark ? hexToRgba('#dc2626', 0.18) : 'var(--red-light)'),
                color:      stkStatus === 'success' ? 'var(--green, #16a34a)' : stkStatus === 'pending' ? 'var(--blue, #2563eb)' : 'var(--red, #dc2626)',
                padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 500
              }}>
                {stkMsg}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => { setStkModal(false); setArrears(null); }} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: 'var(--text)' }}>
                Close
              </button>
              <button onClick={triggerStkPush} disabled={stkLoading || stkStatus === 'pending'}
                style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: stkStatus === 'success' ? 'var(--green, #16a34a)' : 'var(--primary, #7c3aed)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                {stkLoading ? 'Sending...' : stkStatus === 'pending' ? '⏳ Waiting...' : stkStatus === 'success' ? '✅ Confirmed' : '📱 Send STK Push'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Record Payment Modal ───────────────────────────────── */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20, overflowY: 'auto' }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 520, boxShadow: 'var(--shadow-lg)', margin: 'auto' }}>
            <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18, marginBottom: 20, color: 'var(--text)' }}>Record Payment</h2>
            {error && <div style={{ background: isDark ? hexToRgba('#dc2626', 0.18) : 'var(--red-light)', color: 'var(--red, #dc2626)', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle}>Tenant</label>
                <select value={form.tenant_id} onChange={e => {
                  setForm(f => ({ ...f, tenant_id: e.target.value }));
                  loadArrears(e.target.value);
                }} style={inputStyle}>
                  {activeTenants.map(t => (
                    <option key={t.id} value={t.id}>{t.full_name} — {t.phone}</option>
                  ))}
                </select>
              </div>

              {arrearsLoading && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading arrears...</div>}
              {arrears && !arrearsLoading && (
                <div style={{ background: arrears.total_arrears > 0 ? (isDark ? hexToRgba('#dc2626', 0.15) : 'var(--red-light)') : (isDark ? hexToRgba('#16a34a', 0.15) : 'var(--green-light)'), border: `1px solid ${arrears.total_arrears > 0 ? 'var(--red, #dc2626)' : 'var(--green, #16a34a)'}`, borderRadius: 10, padding: 14 }}>
                  {arrears.total_arrears > 0 ? (
                    <>
                      <div style={{ fontWeight: 700, color: 'var(--red, #dc2626)', marginBottom: 8, fontSize: 14 }}>
                        ⚠️ Total Arrears: KES {arrears.total_arrears.toLocaleString()}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {arrears.unpaid_months?.map(m => (
                          <div key={`${m.year}-${m.month}`} style={{ background: isDark ? 'var(--surface2)' : 'white', border: '1px solid var(--red, #dc2626)', borderRadius: 8, padding: '4px 10px', fontSize: 12 }}>
                            <span style={{ fontWeight: 600, color: 'var(--red, #dc2626)' }}>{monthName(m.year, m.month)}</span>
                            <span style={{ color: 'var(--muted)', marginLeft: 4 }}>· KES {m.balance.toLocaleString()} owed</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--red, #dc2626)', marginTop: 8 }}>Payment will be applied to oldest unpaid month first.</div>
                    </>
                  ) : (
                    <div style={{ fontWeight: 600, color: 'var(--green, #16a34a)', fontSize: 14 }}>✅ No arrears — tenant is up to date.</div>
                  )}
                </div>
              )}

              <Field label="Amount (KES)"        value={form.amount}           onChange={v => setForm(f=>({...f,amount:v}))}           placeholder="15000" type="number" />
              <Field label="Payment Date"         value={form.payment_date}     onChange={v => setForm(f=>({...f,payment_date:v}))}     type="date" />
              <div>
                <label style={labelStyle}>Method</label>
                <select value={form.payment_method} onChange={e => setForm(f=>({...f,payment_method:e.target.value}))} style={inputStyle}>
                  {['mpesa','cash','bank_transfer','cheque'].map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <Field label="Reference / Receipt"  value={form.reference_number} onChange={v => setForm(f=>({...f,reference_number:v}))} placeholder="e.g. QHJ7K2X" />
              <Field label="Notes (optional)"     value={form.notes}            onChange={v => setForm(f=>({...f,notes:v}))}            placeholder="Optional" />
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={() => { setModal(false); setArrears(null); }} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: 'var(--text)' }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--primary, #7c3aed)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
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
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 14, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' };

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

import { useState, useEffect, useMemo, useRef } from 'react';
import API from '../services/api';
import { IconInline } from './Icon';
import TenantPicker, { buildPlotLookup, tName } from './TenantPicker';
import { Field, labelStyle, inputStyle, hexToRgba, useIsDarkMode } from './formKit';

const METHOD_LABELS = { mpesa: 'M-Pesa', cash: 'Cash', bank_transfer: 'Bank transfer', cheque: 'Cheque' };
const monthName = (y, m) => new Date(y, m - 1, 1).toLocaleString('en-KE', { month: 'long', year: 'numeric' });

// Record Payment modal, shared by the Dashboard and the Payments page.
//   tenants   all tenants (active ones are offered)
//   payments  existing payments — used for the duplicate guard and property lookup
//   houses    optional; lets the picker find a tenant's property via their unit
//   onClose() / onSaved()   saved => the caller refreshes its own data
export default function RecordPaymentModal({ tenants, payments = [], houses = [], onClose, onSaved }) {
  const isDark = useIsDarkMode();
  const activeTenants = useMemo(() => tenants.filter(t => t.is_active), [tenants]);
  const plotLookup    = useMemo(() => buildPlotLookup(payments, houses), [payments, houses]);

  const [form, setForm] = useState(() => {
    let method = 'mpesa';
    try { method = localStorage.getItem('pm_last_method') || 'mpesa'; } catch { /* ignore */ }
    return {
      tenant_id: '', amount: '',
      payment_date: new Date().toLocaleDateString('en-CA'), // local date (toISOString is UTC and can be "yesterday" in Kenya)
      payment_method: method, reference_number: '', notes: '',
    };
  });
  const [utilities,      setUtilities]      = useState([]); // optional utility lines: [{ type, amount }]
  const [arrears,        setArrears]        = useState(null);
  const [arrearsLoading, setArrearsLoading] = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState('');

  // Only the latest arrears request may update the screen (quick clicking
  // through tenants can return responses out of order).
  const arrearsReq = useRef(0);
  async function loadArrears(tenantId) {
    const req = ++arrearsReq.current;
    if (!tenantId) { setArrears(null); setArrearsLoading(false); return; }
    setArrearsLoading(true);
    try {
      const res = await API.get(`/payments/arrears/${tenantId}`);
      if (req === arrearsReq.current) setArrears(res.data.data);
    } catch (e) { if (req === arrearsReq.current) setArrears(null); }
    finally { if (req === arrearsReq.current) setArrearsLoading(false); }
  }

  const dirty = !!form.tenant_id || !!form.amount || utilities.length > 0;
  function requestClose() { if (!saving) onClose(); }

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // re-bound each render so it always sees the latest `saving`

  async function handleSave() {
    if (saving) return;
    setError('');
    const tenant = tenants.find(t => String(t.id) === String(form.tenant_id));
    if (!tenant) { setError('Select a tenant first.'); return; }
    const utilItems = utilities
      .filter(u => parseFloat(u.amount) > 0)
      .map(u => ({ type: u.type, amount: parseFloat(u.amount) }));
    const amt     = parseFloat(form.amount) || 0;
    const hasRent = amt > 0;
    if (!hasRent && utilItems.length === 0) { setError('Enter a rent amount or a utility amount.'); return; }
    if (!form.payment_date) { setError('Choose the payment date.'); return; }

    const ref = form.reference_number.trim().toUpperCase();
    if ((form.payment_method === 'mpesa' || form.payment_method === 'bank_transfer') && !ref) {
      setError(`Enter the ${form.payment_method === 'mpesa' ? 'M-Pesa code' : 'bank reference'} — it's how this payment is traced later.`);
      return;
    }

    // Duplicate guard (rent payments only — those are what's in the table).
    if (hasRent) {
      if (ref) {
        const dup = payments.find(p => String(p.receipt_no || p.transaction_id || '').toUpperCase() === ref);
        if (dup) { setError(`Reference ${ref} is already recorded (${dup.tenant_name || 'another payment'}). Check before recording it again.`); return; }
      } else {
        const sameDay = payments.find(p =>
          String(p.tenant_id) === String(tenant.id) &&
          parseFloat(p.amount) === amt &&
          p.payment_date && new Date(p.payment_date).toLocaleDateString('en-CA') === form.payment_date
        );
        if (sameDay && !window.confirm(`${tName(tenant)} already has a payment of KES ${amt.toLocaleString()} on this date. Record another one?`)) return;
      }
    }

    setSaving(true);
    try {
      if (hasRent) await API.post('/payments', { ...form, reference_number: ref, unit_id: tenant.house_id });
      if (utilItems.length) {
        await API.post('/utilities', {
          tenant_id: form.tenant_id, payment_date: form.payment_date, method: form.payment_method,
          reference: ref, notes: form.notes, items: utilItems,
        });
      }
      try { localStorage.setItem('pm_last_method', form.payment_method); } catch { /* ignore */ }
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e.response?.data?.message || e.response?.data?.error || e.message || 'Failed to record payment');
    } finally { setSaving(false); }
  }

  const selectedTenant = tenants.find(t => String(t.id) === String(form.tenant_id)) || null;
  const amountNum  = parseFloat(form.amount) || 0;
  const isMpesa    = form.payment_method === 'mpesa';
  const needsRef   = isMpesa || form.payment_method === 'bank_transfer';
  const refVal     = form.reference_number.trim();
  const mpesaOdd   = isMpesa && refVal && !/^[A-Za-z0-9]{10}$/.test(refVal);
  const hasUtil    = utilities.some(u => parseFloat(u.amount) > 0);
  const canSubmit  = !!selectedTenant && (amountNum > 0 || hasUtil) && !saving;
  const pillBtn    = { padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--muted)' };

  // What the amount will do, using the arrears we already loaded.
  let preview = null;
  if (selectedTenant && arrears && amountNum > 0) {
    const owed = arrears.total_arrears || 0;
    if (owed <= 0)               preview = `Tenant is up to date — KES ${amountNum.toLocaleString()} will count toward future months.`;
    else if (amountNum < owed)   preview = `Covers KES ${amountNum.toLocaleString()} of KES ${owed.toLocaleString()} arrears — KES ${(owed - amountNum).toLocaleString()} will still be owed.`;
    else if (amountNum === owed) preview = 'Clears all arrears exactly.';
    else                         preview = `Clears all KES ${owed.toLocaleString()} arrears; KES ${(amountNum - owed).toLocaleString()} beyond that will count toward future months.`;
  }


  return (
    <div
      role="dialog" aria-modal="true" aria-label="Record payment"
      onKeyDown={e => {
        // Enter submits from single-line inputs, except the tenant search box (it uses Enter to pick).
        if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !e.target.dataset.noSubmit && e.target.type !== 'button') {
          e.preventDefault(); handleSave();
        }
      }}
      onMouseDown={e => { if (e.target === e.currentTarget && !dirty) requestClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, width: '100%', maxWidth: 540, maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <h2 style={{ fontFamily: 'Bricolage Grotesque', fontWeight: 700, fontSize: 18, color: 'var(--text)', margin: 0 }}>Record Payment</h2>
          <button onClick={requestClose} aria-label="Close" style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'var(--surface2)', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}>×</button>
        </div>

        {/* Scrollable body */}
        <div style={{ padding: '16px 24px', overflowY: 'auto', flex: 1 }}>
          {error && <div style={{ background: isDark ? hexToRgba('#dc2626', 0.18) : 'var(--red-light)', color: 'var(--red, #dc2626)', padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{error}</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>Tenant</label>
              <TenantPicker
                tenants={activeTenants} lookup={plotLookup} autoFocus rememberKey="pm_last_plot"
                value={form.tenant_id}
                onSelect={t => { setForm(f => ({ ...f, tenant_id: String(t.id) })); loadArrears(t.id); }}
              />
            </div>

            {selectedTenant && arrearsLoading && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading arrears...</div>}
            {selectedTenant && arrears && !arrearsLoading && (
              <div style={{ background: arrears.total_arrears > 0 ? (isDark ? hexToRgba('#dc2626', 0.15) : 'var(--red-light)') : (isDark ? hexToRgba('#16a34a', 0.15) : 'var(--green-light)'), border: `1px solid ${arrears.total_arrears > 0 ? 'var(--red, #dc2626)' : 'var(--green, #16a34a)'}`, borderRadius: 10, padding: 14 }}>
                {arrears.total_arrears > 0 ? (
                  <>
                    <div style={{ fontWeight: 700, color: 'var(--red, #dc2626)', marginBottom: 8, fontSize: 14 }}>
                      <IconInline name="⚠️" />Total Arrears: KES {arrears.total_arrears.toLocaleString()}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {arrears.deposit_owed > 0 && (
                        <div style={{ background: isDark ? 'var(--surface2)' : 'white', border: '1px solid var(--red, #dc2626)', borderRadius: 8, padding: '4px 10px', fontSize: 12 }}>
                          <span style={{ fontWeight: 700, color: 'var(--red, #dc2626)' }}><IconInline name="🔒" size={13} />Deposit shortfall</span>
                          <span style={{ color: 'var(--muted)', marginLeft: 4 }}>· KES {arrears.deposit_owed.toLocaleString()} owed</span>
                        </div>
                      )}
                      {arrears.unpaid_months?.map(m => (
                        <div key={`${m.year}-${m.month}`} style={{ background: isDark ? 'var(--surface2)' : 'white', border: '1px solid var(--red, #dc2626)', borderRadius: 8, padding: '4px 10px', fontSize: 12 }}>
                          <span style={{ fontWeight: 600, color: 'var(--red, #dc2626)' }}>{monthName(m.year, m.month)}</span>
                          <span style={{ color: 'var(--muted)', marginLeft: 4 }}>· KES {m.balance.toLocaleString()} owed</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--red, #dc2626)', marginTop: 8 }}>
                      {arrears.deposit_owed > 0 ? 'Payment will clear the deposit shortfall first, then the oldest unpaid month.' : 'Payment will be applied to oldest unpaid month first.'}
                    </div>
                  </>
                ) : (
                  <div style={{ fontWeight: 600, color: 'var(--green, #16a34a)', fontSize: 14 }}><IconInline name="✅" />No arrears — tenant is up to date.</div>
                )}
              </div>
            )}

            {/* Amount + quick-fill chips */}
            <div>
              <Field label="Amount (KES)" value={form.amount} onChange={v => setForm(f => ({ ...f, amount: v }))} placeholder="15000" type="number" />
              {selectedTenant && (selectedTenant.rent_amount || (arrears && arrears.total_arrears > 0)) && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {selectedTenant.rent_amount ? (
                    <button type="button" onClick={() => setForm(f => ({ ...f, amount: String(selectedTenant.rent_amount) }))} style={pillBtn}>
                      One Month (KES {parseFloat(selectedTenant.rent_amount).toLocaleString()})
                    </button>
                  ) : null}
                  {arrears && arrears.total_arrears > 0 && (
                    <button type="button" onClick={() => setForm(f => ({ ...f, amount: String(arrears.total_arrears) }))}
                      style={{ ...pillBtn, border: '1px solid var(--red, #dc2626)', background: isDark ? hexToRgba('#dc2626', 0.18) : 'var(--red-light)', color: 'var(--red, #dc2626)' }}>
                      Clear All (KES {arrears.total_arrears.toLocaleString()})
                    </button>
                  )}
                </div>
              )}
              {preview && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>→ {preview}</div>}
            </div>

            {/* Date + method side by side */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
              <Field label="Payment Date" value={form.payment_date} onChange={v => setForm(f => ({ ...f, payment_date: v }))} type="date" />
              <div>
                <label style={labelStyle}>Method</label>
                <select value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))} style={inputStyle}>
                  {['mpesa', 'cash', 'bank_transfer', 'cheque'].map(m => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
                </select>
              </div>
            </div>

            <Field
              label={isMpesa ? 'M-Pesa code' : form.payment_method === 'bank_transfer' ? 'Bank reference' : form.payment_method === 'cheque' ? 'Cheque number (optional)' : 'Receipt no. (optional)'}
              required={needsRef}
              value={form.reference_number}
              onChange={v => setForm(f => ({ ...f, reference_number: isMpesa ? v.toUpperCase() : v }))}
              placeholder={isMpesa ? 'e.g. SLK4Q9X2AB' : 'Reference'}
              hint={mpesaOdd ? 'M-Pesa codes are usually 10 letters/numbers — double-check this one.' : null}
              hintWarn={!!mpesaOdd}
            />
            <Field label="Notes (optional)" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="Optional" />

            {/* Optional utilities — tracked separately, never reduce rent arrears */}
            <div style={{ padding: 14, borderRadius: 10, border: '1px dashed var(--border)', background: 'var(--surface2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>Utilities (optional)</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>Water, electricity, garbage… recorded separately from rent and shown on Expenses as recovered.</div>
                </div>
                <button type="button" onClick={() => setUtilities(u => [...u, { type: 'Water', amount: '' }])}
                  style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>+ Add</button>
              </div>
              {utilities.map((u, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <select value={u.type} onChange={e => setUtilities(list => list.map((x, j) => j === i ? { ...x, type: e.target.value } : x))} style={{ ...inputStyle, flex: 1 }}>
                    {['Water', 'Electricity', 'Garbage Collection', 'Other'].map(t => <option key={t}>{t}</option>)}
                  </select>
                  <input type="number" min="0" placeholder="Amount" value={u.amount}
                    onChange={e => setUtilities(list => list.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))}
                    style={{ ...inputStyle, flex: 1 }} />
                  <button type="button" onClick={() => setUtilities(list => list.filter((_, j) => j !== i))} aria-label="Remove utility"
                    style={{ padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--red, #dc2626)', cursor: 'pointer', fontWeight: 700 }}>✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer stays visible while the body scrolls (important on phones) */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', padding: '14px 24px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button onClick={requestClose} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: 'var(--text)' }}>Cancel</button>
          <button onClick={handleSave} disabled={!canSubmit}
            style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--primary, #1b6b45)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: canSubmit ? 'pointer' : 'default', opacity: canSubmit ? 1 : 0.5 }}>
            {saving ? 'Saving...' : amountNum > 0 ? `Record KES ${amountNum.toLocaleString()}` : 'Record'}
          </button>
        </div>
      </div>
    </div>

  );
}

// Meter readings and utility bills. The caretaker walks the property with the
// reading sheet; the system works out each tenant's water / electricity bill.
// A paid bill becomes an ordinary utility receipt (rent is never touched).
import { useCallback, useEffect, useMemo, useState } from 'react';
import API from '../services/api';
import { useAuth } from '../context/AuthContext';
import SharedMeter from './SharedMeter';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);
const kes = (n) => `KES ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const monthName = (m) => { const [y, mo] = m.split('-'); return new Date(+y, +mo - 1, 1).toLocaleString('en-KE', { month: 'long', year: 'numeric' }); };
function waNumber(phone) {
  const d = String(phone || '').replace(/[^\d]/g, '');
  if (!d) return null;
  if (d.startsWith('254')) return d;
  if (d.startsWith('0')) return `254${d.slice(1)}`;
  return d.length <= 9 ? `254${d}` : d;
}
const STATUS = { billed: ['Unpaid', '#b45309'], paid: ['Paid', '#16a34a'], no_tenant: ['No tenant', '#6b7280'], opening: ['Opening', '#6b7280'] };

export default function Meters() {
  const { can } = useAuth();
  const [plots, setPlots] = useState([]);
  const [plotId, setPlotId] = useState('');
  const [type, setType] = useState('Water');
  const [month, setMonth] = useState(thisMonth());
  const [tab, setTab] = useState('sheet');
  const [sheet, setSheet] = useState(null);
  const [vals, setVals] = useState({});
  const [readDate, setReadDate] = useState(today());
  const [rowErr, setRowErr] = useState({});
  const [msg, setMsg] = useState({ ok: '', err: '' });
  const [busy, setBusy] = useState(false);
  const [rateForm, setRateForm] = useState(null);
  const [bills, setBills] = useState([]);
  const [billStatus, setBillStatus] = useState('billed');
  const [payFor, setPayFor] = useState(null);
  const [pay, setPay] = useState({ method: 'Cash', reference: '' });

  useEffect(() => {
    API.get('/plots').then(r => {
      const list = Array.isArray(r.data) ? r.data : (r.data.data || []);
      setPlots(list); if (list.length) setPlotId(String(list[0].id));
    }).catch(() => setMsg({ ok: '', err: 'Could not load properties.' }));
  }, []);

  const loadSheet = useCallback(async () => {
    if (!plotId) return;
    try {
      const r = await API.get('/meters/sheet', { params: { plot_id: plotId, type, month } });
      setSheet(r.data);
      setVals(Object.fromEntries(r.data.data.filter(x => x.reading != null).map(x => [x.house_id, String(x.reading)])));
      setRowErr({}); setMsg(m => ({ ...m, err: '' }));
    } catch (e) { setSheet(null); setMsg({ ok: '', err: e.response?.data?.error || 'Could not load the sheet.' }); }
  }, [plotId, type, month]);
  useEffect(() => { if (tab === 'sheet') loadSheet(); }, [tab, loadSheet]);

  const loadBills = useCallback(async () => {
    try {
      const r = await API.get('/meters/bills', { params: { plot_id: plotId || undefined, month: month || undefined, status: billStatus || undefined, type } });
      setBills(r.data.data);
    } catch (e) { setMsg({ ok: '', err: e.response?.data?.error || 'Could not load bills.' }); }
  }, [plotId, month, billStatus, type]);
  useEffect(() => { if (tab === 'bills') loadBills(); }, [tab, loadBills]);

  const rate = sheet?.rate;
  const calc = (row) => {
    const v = vals[row.house_id];
    if (v === '' || v == null || row.previous_reading == null || !rate) return null;
    const n = Number(v); if (!Number.isFinite(n) || n < row.previous_reading) return null;
    const units = Math.round((n - row.previous_reading) * 100) / 100;
    return { units, amount: Math.round((units * rate.rate + rate.standing_charge) * 100) / 100 };
  };
  const total = useMemo(() => (sheet?.data || []).reduce((a, r) => a + (r.tenant_id ? (calc(r)?.amount || 0) : 0), 0), [sheet, vals]); // eslint-disable-line

  const save = async () => {
    const sharedIds = new Set((sheet?.data || []).filter(r => r.shared_meter_number).map(r => String(r.house_id)));
    const readings = Object.entries(vals).filter(([id, v]) => v !== '' && v != null && !sharedIds.has(id)).map(([house_id, reading]) => ({ house_id: Number(house_id), reading }));
    if (!readings.length) return setMsg({ ok: '', err: 'Enter at least one reading.' });
    setBusy(true); setMsg({ ok: '', err: '' }); setRowErr({});
    try {
      const r = await API.post('/meters/readings', { plot_id: Number(plotId), utility_type: type, billing_month: month, reading_date: readDate, readings });
      const opening = r.data.saved.filter(s => s.status === 'opening').length;
      setMsg({ ok: `Saved ${r.data.saved.length} readings. Billed ${kes(r.data.billed_total)}.${opening ? ` ${opening} were recorded as starting readings (no bill yet).` : ''}`, err: '' });
      loadSheet();
    } catch (e) {
      setMsg({ ok: '', err: e.response?.data?.error || 'Could not save.' });
      setRowErr(Object.fromEntries((e.response?.data?.rows || []).map(x => [x.house_id, x.error])));
    }
    setBusy(false);
  };
  const saveRate = async () => {
    try { await API.put('/meters/rates', { plot_id: Number(plotId), utility_type: type, ...rateForm }); setRateForm(null); loadSheet(); }
    catch (e) { setMsg({ ok: '', err: e.response?.data?.error || 'Could not save the rate.' }); }
  };
  const removeReading = async (row) => {
    if (!window.confirm(`Remove ${row.unit_number}'s reading for ${monthName(month)}?`)) return;
    try { await API.delete(`/meters/readings/${row.reading_id}`); loadSheet(); } catch (e) { setMsg({ ok: '', err: e.response?.data?.error || 'Could not remove.' }); }
  };
  const doPay = async () => {
    try { await API.post(`/meters/bills/${payFor.id}/pay`, pay); setPayFor(null); setPay({ method: 'Cash', reference: '' }); setMsg({ ok: 'Marked paid. A utility receipt was created.', err: '' }); loadBills(); }
    catch (e) { setMsg({ ok: '', err: e.response?.data?.error || 'Could not record the payment.' }); setPayFor(null); }
  };
  const billMessage = (b) => `Hello ${b.tenant_name}, your ${b.utility_type.toLowerCase()} bill for ${monthName(b.billing_month)} (${b.plot_name}, unit ${b.unit_number}): meter ${b.previous_reading} → ${b.reading} = ${b.units} units${b.rate != null ? ` × KES ${b.rate}` : ''}${b.standing_charge ? ` + KES ${b.standing_charge} standing charge` : ''}. Amount due: KES ${Number(b.amount).toLocaleString()}. Thank you.`;

  const card = { background: 'var(--card, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 12, padding: 14 };
  const inp = { padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)', background: 'var(--bg, #fff)', color: 'inherit', fontSize: 14, boxSizing: 'border-box' };
  const btn = { padding: '7px 13px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)', background: 'var(--card, #fff)', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
  const primary = { ...btn, background: 'var(--primary, #7c3aed)', color: '#fff', border: 'none' };
  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: 'var(--muted, #6b7280)', borderBottom: '1px solid var(--border, #e5e7eb)', whiteSpace: 'nowrap' };
  const td = { padding: '8px 10px', borderBottom: '1px solid var(--border, #f1f5f9)', fontSize: 14 };

  return (
    <div style={{ padding: 4 }}>
      <h2 style={{ marginTop: 0 }}>💧 Meters & Utility Bills</h2>
      <div style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <select style={inp} value={plotId} onChange={e => setPlotId(e.target.value)}>{plots.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select style={inp} value={type} onChange={e => setType(e.target.value)}><option>Water</option><option>Electricity</option></select>
        <input style={inp} type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} />
        <div style={{ flex: 1 }} />
        <button style={tab === 'sheet' ? primary : btn} onClick={() => setTab('sheet')}>📝 Reading sheet</button>
        <button style={tab === 'bills' ? primary : btn} onClick={() => setTab('bills')}>🧾 Bills</button>
        <button style={tab === 'shared' ? primary : btn} onClick={() => setTab('shared')}>🔗 Shared meter</button>
      </div>
      {msg.err && <div style={{ ...card, color: '#b91c1c', marginBottom: 10 }}>{msg.err}</div>}
      {msg.ok && <div style={{ ...card, color: '#15803d', marginBottom: 10 }}>{msg.ok}</div>}

      {tab === 'shared' && (
        <SharedMeter plotId={plotId} plotName={plots.find(p => String(p.id) === String(plotId))?.name || ''} type={type} month={month} setMonth={setMonth}
          styles={{ card, inp, btn, primary, th, td }} />
      )}

      {tab === 'sheet' && sheet && (<>
        <div style={{ ...card, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {rate && !rateForm && <span>Rate: <b>{kes(rate.rate)}</b> per {rate.unit_label || 'unit'}{rate.standing_charge ? <> + <b>{kes(rate.standing_charge)}</b> standing charge</> : ''}</span>}
          {!rate && !rateForm && <span style={{ color: '#b45309' }}>No {type.toLowerCase()} rate is set for this property yet.</span>}
          {sheet.can_set_rates && !rateForm && <button style={btn} onClick={() => setRateForm({ rate: rate?.rate ?? '', standing_charge: rate?.standing_charge ?? 0, unit_label: rate?.unit_label || (type === 'Water' ? 'm³' : 'kWh') })}>{rate ? 'Change rate' : 'Set rate'}</button>}
          {rateForm && <>
            <label>Rate per unit <input style={{ ...inp, width: 90 }} type="number" min="0" step="0.01" value={rateForm.rate} onChange={e => setRateForm({ ...rateForm, rate: e.target.value })} /></label>
            <label>Unit <input style={{ ...inp, width: 60 }} value={rateForm.unit_label} onChange={e => setRateForm({ ...rateForm, unit_label: e.target.value })} /></label>
            <label>Standing charge <input style={{ ...inp, width: 90 }} type="number" min="0" value={rateForm.standing_charge} onChange={e => setRateForm({ ...rateForm, standing_charge: e.target.value })} /></label>
            <button style={primary} onClick={saveRate}>Save rate</button><button style={btn} onClick={() => setRateForm(null)}>Cancel</button>
          </>}
          <div style={{ flex: 1 }} />
          <label style={{ fontSize: 13 }}>Date read <input style={inp} type="date" value={readDate} onChange={e => setReadDate(e.target.value)} /></label>
        </div>
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Unit</th><th style={th}>Tenant</th><th style={th}>Last reading</th><th style={th}>This reading</th><th style={th}>Units</th><th style={th}>Bill</th><th style={th} /></tr></thead>
            <tbody>
              {sheet.data.map(row => {
                const c = calc(row); const paid = row.status === 'paid';
                return (
                  <tr key={row.house_id}>
                    <td style={td}><b>{row.unit_number}</b>{row.shared_meter_number && <div style={{ fontSize: 11, color: '#7c3aed' }} title="Billed through the Shared meter tab">shared meter {row.shared_meter_number}</div>}</td>
                    <td style={td}>{row.tenant_name || <span style={{ color: 'var(--muted, #9ca3af)' }}>Vacant</span>}</td>
                    <td style={td}>{row.previous_reading ?? <span title="First reading for this meter becomes the starting reading" style={{ color: 'var(--muted, #9ca3af)' }}>— start</span>}</td>
                    <td style={td}>
                      <input style={{ ...inp, width: 100, borderColor: rowErr[row.house_id] ? '#dc2626' : undefined }} type="number" inputMode="decimal" min="0" step="0.01" disabled={!sheet.can_record || paid || !!row.shared_meter_number}
                        value={vals[row.house_id] ?? ''} onChange={e => setVals({ ...vals, [row.house_id]: e.target.value })} />
                      {rowErr[row.house_id] && <div style={{ color: '#dc2626', fontSize: 12, maxWidth: 220 }}>{rowErr[row.house_id]}</div>}
                    </td>
                    <td style={td}>{c ? c.units : (row.units ?? '')}</td>
                    <td style={td}>{row.tenant_id ? (c ? kes(c.amount) : (row.status === 'billed' || paid ? kes(row.amount) : '')) : ''}{paid && <span style={{ color: '#16a34a', fontSize: 12 }}> ✓ paid</span>}</td>
                    <td style={td}>{sheet.can_record && row.reading_id && !paid && <button style={{ ...btn, padding: '2px 8px' }} onClick={() => removeReading(row)} title="Remove this reading">✕</button>}</td>
                  </tr>
                );
              })}
              {!sheet.data.length && <tr><td style={td} colSpan={7}>This property has no units yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <div><b>{monthName(month)}</b> — bills to tenants: <b>{kes(total)}</b></div>
          <div style={{ flex: 1 }} />
          {sheet.can_record ? <button style={primary} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save readings'}</button> : <span style={{ color: 'var(--muted, #6b7280)', fontSize: 13 }}>You can view readings but not record them.</span>}
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--muted, #6b7280)' }}>The first reading you enter for a meter is its starting point and isn't billed. From the next month on, each reading is billed as (this reading − last reading) × rate. Vacant units record their usage but aren't billed.</p>
      </>)}

      {tab === 'bills' && (<>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {[['billed', 'Unpaid'], ['paid', 'Paid'], ['', 'All']].map(([v, l]) => <button key={v} style={billStatus === v ? primary : btn} onClick={() => setBillStatus(v)}>{l}</button>)}
        </div>
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Unit</th><th style={th}>Tenant</th><th style={th}>Meter</th><th style={th}>Units</th><th style={th}>Amount</th><th style={th}>Status</th><th style={th} /></tr></thead>
            <tbody>
              {bills.map(b => {
                const wa = waNumber(b.tenant_phone);
                return (
                  <tr key={b.id}>
                    <td style={td}><b>{b.unit_number}</b></td>
                    <td style={td}>{b.tenant_name || '—'}</td>
                    <td style={td}>{b.previous_reading} → {b.reading}</td>
                    <td style={td}>{b.units}</td>
                    <td style={td}>{kes(b.amount)}</td>
                    <td style={{ ...td, color: STATUS[b.status]?.[1], fontWeight: 700 }}>{STATUS[b.status]?.[0]}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {b.status === 'billed' && wa && <a style={{ ...btn, textDecoration: 'none', display: 'inline-block', marginRight: 6 }} href={`https://wa.me/${wa}?text=${encodeURIComponent(billMessage(b))}`} target="_blank" rel="noopener noreferrer">💬 WhatsApp bill</a>}
                      {b.status === 'billed' && can('payments.record_manual', b.plot_id) && <button style={primary} onClick={() => setPayFor(b)}>Mark paid</button>}
                    </td>
                  </tr>
                );
              })}
              {!bills.length && <tr><td style={td} colSpan={7}>No bills for these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </>)}

      {payFor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 2000, display: 'grid', placeItems: 'center', padding: 12 }} onClick={() => setPayFor(null)}>
          <div style={{ ...card, width: 'min(380px, 100%)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Record payment</h3>
            <div style={{ marginBottom: 10 }}>{payFor.tenant_name} · unit {payFor.unit_number} · <b>{kes(payFor.amount)}</b> ({payFor.utility_type}, {monthName(payFor.billing_month)})</div>
            <div style={{ display: 'grid', gap: 8 }}>
              <select style={inp} value={pay.method} onChange={e => setPay({ ...pay, method: e.target.value })}><option>Cash</option><option>M-Pesa</option><option>Bank</option></select>
              <input style={inp} placeholder="Reference (e.g. M-Pesa code)" maxLength={100} value={pay.reference} onChange={e => setPay({ ...pay, reference: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}><button style={btn} onClick={() => setPayFor(null)}>Cancel</button><button style={primary} onClick={doPay}>Confirm payment</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

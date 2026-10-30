// Shared meter tab: one meter serves many units (e.g. a building's single water
// meter). Staff enter the monthly bill; it is split by unit weight among the
// occupied units, and tenants' water receipts fund it. Pass-through money — it
// is not an expense or income, and never touches rent.
import { Fragment, useCallback, useEffect, useState } from 'react';
import API from '../services/api';

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
const ST = { paid: ['Paid', '#16a34a'], partial: ['Part paid', '#b45309'], unpaid: ['Not paid', '#dc2626'] };

export default function SharedMeter({ plotId, plotName, type, month, setMonth, styles }) {
  const { card, inp, btn, primary, th, td } = styles;
  const [list, setList] = useState(null);       // { data, can_record, can_manage }
  const [meterId, setMeterId] = useState(null);
  const [sum, setSum] = useState(null);
  const [units, setUnits] = useState([]);       // all units of the plot (for setup)
  const [msg, setMsg] = useState({ ok: '', err: '' });
  const [setup, setSetup] = useState(null);     // create/edit form
  const [billForm, setBillForm] = useState(null);
  const [contrib, setContrib] = useState(null);
  const [payerForm, setPayerForm] = useState(null); // a second business sharing a unit
  const [histKey, setHistKey] = useState(null);   // which row's payment history is open
  const [hist, setHist] = useState([]);
  const [editPay, setEditPay] = useState(null);

  const loadList = useCallback(async () => {
    if (!plotId) return;
    try {
      const r = await API.get('/shared-meters', { params: { plot_id: plotId } });
      setList(r.data);
      const mine = r.data.data.filter(m => m.utility_type === type);
      setMeterId(id => (mine.find(m => m.id === id) ? id : mine[0]?.id || null));
    } catch (e) { setMsg({ ok: '', err: e.response?.data?.error || 'Could not load shared meters.' }); }
  }, [plotId, type]);
  useEffect(() => { loadList(); }, [loadList]);

  const loadSum = useCallback(async () => {
    if (!meterId) { setSum(null); return; }
    try { setSum((await API.get(`/shared-meters/${meterId}/summary`)).data); }
    catch (e) { setMsg({ ok: '', err: e.response?.data?.error || 'Could not load the meter.' }); }
  }, [meterId]);
  useEffect(() => { loadSum(); }, [loadSum]);

  useEffect(() => {
    if (!plotId) return;
    API.get('/meters/sheet', { params: { plot_id: plotId, type, month } }).then(r => setUnits(r.data.data)).catch(() => setUnits([]));
  }, [plotId, type, month]);

  const meters = (list?.data || []).filter(m => m.utility_type === type);
  const bill = sum?.bills.find(b => b.billing_month === month) || null;
  const canManage = list?.can_manage, canRecord = list?.can_record;
  const isCat = sum?.meter.split_mode === 'category';
  // Categories among units occupied right now, with how many of each (what a new bill will charge).
  const occCats = (() => { const m = new Map(); (sum?.units || []).filter(u => u.tenant_id).forEach(u => { const c = u.category || 'Other'; m.set(c, (m.get(c) || 0) + 1); }); (sum?.payers || []).forEach(p => { const c = p.category || 'Other'; m.set(c, (m.get(c) || 0) + 1); }); return [...m.entries()]; })();
  const lastRates = () => (sum?.bills.find(b => b.category_rates)?.category_rates) || {};
  const billExpected = (f) => occCats.reduce((a, [c, n]) => a + n * (Number(f.rates?.[c]) || 0), 0);
  const err = (e, fallback) => setMsg({ ok: '', err: e.response?.data?.error || fallback });
  const reload = () => { loadSum(); loadList(); };

  // ── setup form ──
  const openSetup = (m) => {
    const onOther = new Set(units.filter(u => u.shared_meter_number && (!m || u.shared_meter_number !== m.meter_number)).map(u => u.house_id));
    setSetup({
      id: m?.id || null, split_mode: m?.split_mode || 'weight', meter_number: m?.meter_number || '', account_number: m?.account_number || '', start_month: m?.start_month || month,
      rows: units.filter(u => !onOther.has(u.house_id)).map(u => {
        const cur = m?.units.find(x => x.house_id === u.house_id);
        return { house_id: u.house_id, unit_number: u.unit_number, tenant_name: u.tenant_name, on: !!cur || (!m), weight: cur ? cur.weight : 1, category: cur?.category || '' };
      }),
    });
  };
  const saveSetup = async () => {
    const chosen = setup.rows.filter(r => r.on).map(r => ({ house_id: r.house_id, weight: Number(r.weight) || 1, category: r.category }));
    const body = { split_mode: setup.split_mode, meter_number: setup.meter_number, account_number: setup.account_number, start_month: setup.start_month, units: chosen };
    try {
      if (setup.id) await API.put(`/shared-meters/${setup.id}`, body);
      else { const r = await API.post('/shared-meters', { ...body, plot_id: Number(plotId), utility_type: type }); setMeterId(r.data.data.id); }
      setSetup(null); setMsg({ ok: 'Meter saved.', err: '' }); reload();
    } catch (e) { err(e, 'Could not save the meter.'); }
  };

  // ── bills ──
  const saveBill = async () => {
    try {
      if (billForm.id) await API.put(`/shared-meters/bills/${billForm.id}`, { category_rates: isCat ? billForm.rates : undefined, amount: Number(billForm.amount), due_date: billForm.due_date || null, reference: billForm.reference, notes: billForm.notes });
      else await API.post(`/shared-meters/${meterId}/bills`, { category_rates: isCat ? billForm.rates : undefined, billing_month: month, amount: Number(billForm.amount), due_date: billForm.due_date || null, reference: billForm.reference, notes: billForm.notes });
      setBillForm(null); setMsg({ ok: 'Bill saved and split between the occupied units.', err: '' }); loadSum();
    } catch (e) { err(e, 'Could not save the bill.'); }
  };
  const resplit = async () => {
    if (!window.confirm('Re-split this bill between the units occupied right now? Use this after a tenant moves in or out.')) return;
    try { await API.put(`/shared-meters/bills/${bill.id}`, { resplit: true }); setMsg({ ok: 'Bill re-split.', err: '' }); loadSum(); } catch (e) { err(e, 'Could not re-split.'); }
  };
  const delBill = async () => {
    if (!window.confirm(`Delete the ${monthName(month)} bill? Tenants' receipts stay; they will count toward the next bill.`)) return;
    try { await API.delete(`/shared-meters/bills/${bill.id}`); loadSum(); } catch (e) { err(e, 'Could not delete.'); }
  };
  const providerPaid = async (date) => {
    try { await API.post(`/shared-meters/bills/${bill.id}/provider-paid`, { date }); loadSum(); } catch (e) { err(e, 'Could not update.'); }
  };
  const saveContrib = async () => {
    try {
      if (contrib.payer_id) {
        await API.post(`/shared-meters/payers/${contrib.payer_id}/payments`, { amount: Number(contrib.amount), payment_date: contrib.date, method: contrib.method, reference: contrib.reference });
        setContrib(null); setMsg({ ok: 'Contribution recorded.', err: '' }); loadSum(); return;
      }
      await API.post('/utilities', { tenant_id: contrib.tenant_id, payment_date: contrib.date, method: contrib.method, reference: contrib.reference,
        notes: `Shared ${type.toLowerCase()} meter ${sum.meter.meter_number}, ${monthName(month)}`, items: [{ type, amount: Number(contrib.amount) }] });
      setContrib(null); setMsg({ ok: 'Contribution recorded.', err: '' }); loadSum();
    } catch (e) { err(e, 'Could not record the contribution.'); }
  };

  const loadHist = async (r) => {
    try {
      const r2 = await API.get(`/shared-meters/${meterId}/payments`, { params: r.payer_id ? { payer_id: r.payer_id } : { house_id: r.house_id } });
      setHist(r2.data.data);
    } catch (e) { setHist([]); err(e, 'Could not load the payments.'); }
  };
  const toggleHist = (r) => {
    const k = `${r.house_id}-${r.payer_id || 0}`;
    if (histKey === k) { setHistKey(null); setEditPay(null); return; }
    setHistKey(k); setEditPay(null); setHist([]); loadHist(r);
  };
  const savePay = async (row) => {
    try {
      await API.put(`/shared-meters/payments/${editPay.kind}/${editPay.id}`, { amount: Number(editPay.amount), payment_date: editPay.payment_date, method: editPay.method, reference: editPay.reference });
      setEditPay(null); setMsg({ ok: 'Payment updated.', err: '' }); await loadHist(row); loadSum();
    } catch (e) { err(e, 'Could not update the payment.'); }
  };
  const delPay = async (row, p) => {
    if (!window.confirm(`Delete this KES ${p.amount.toLocaleString()} payment (${String(p.payment_date).slice(0, 10)})? This changes the balance and is recorded in the audit log.`)) return;
    try { await API.delete(`/shared-meters/payments/${p.kind}/${p.id}`); setMsg({ ok: 'Payment deleted.', err: '' }); await loadHist(row); loadSum(); }
    catch (e) { err(e, 'Could not delete the payment.'); }
  };
  const addPayer = async () => {
    try {
      await API.post(`/shared-meters/${meterId}/payers`, { ...payerForm, house_id: Number(payerForm.house_id) });
      setPayerForm(null); setMsg({ ok: 'Business added. It will be charged on the next bill, or use Re-split on this month\'s bill.', err: '' }); loadSum();
    } catch (e) { err(e, 'Could not add the business.'); }
  };
  const removePayer = async (p) => {
    if (!window.confirm(`Remove ${p.name} from the water meter? Past bills and payments stay on record; they just won't be charged on new bills.`)) return;
    try { await API.delete(`/shared-meters/payers/${p.id}`); loadSum(); } catch (e) { err(e, 'Could not remove.'); }
  };
  const reminder = (r) => `Hello ${r.tenant_name}, the shared ${type.toLowerCase()} bill for ${monthName(month)} at ${plotName} is KES ${bill.amount.toLocaleString()}. Your share (unit ${r.unit_number}) is KES ${r.share.toLocaleString()}${r.paid > 0 ? `; you have paid KES ${r.paid.toLocaleString()}` : ''}. Balance: KES ${r.balance.toLocaleString()}${bill.due_date ? `, due ${new Date(bill.due_date).toLocaleDateString('en-KE')}` : ''}. Thank you.`;
  const downloadCsv = () => {
    const rows = bill.rows.filter(r => r.status !== 'paid');
    const csv = [['Unit', 'Tenant', 'Phone', 'Share', 'Paid', 'Balance'], ...rows.map(r => [r.unit_number, r.tenant_name || '', r.tenant_phone || '', r.share, r.paid, r.balance])]
      .map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${plotName}-${type}-${month}-not-contributed.csv`; a.click();
  };

  if (!list) return <div style={card}>Loading…</div>;
  if (list.migration_needed) return <div style={{ ...card, color: '#b45309' }}>Shared meters need migration 028 (028_shared_meters.sql) to be run on this database first.</div>;

  return (
    <div>
      {msg.err && <div style={{ ...card, color: '#b91c1c', marginBottom: 10 }}>{msg.err}</div>}
      {msg.ok && <div style={{ ...card, color: '#15803d', marginBottom: 10 }}>{msg.ok}</div>}

      {!meters.length && !setup && (
        <div style={card}>
          <b>No shared {type.toLowerCase()} meter set up for {plotName}.</b>
          <p style={{ margin: '6px 0 10px', color: 'var(--muted, #6b7280)', fontSize: 14 }}>If one meter serves several units, set it up here: choose the units on it and how heavily each one uses it. The monthly bill is then split between the occupied units and funded by their {type.toLowerCase()} payments.</p>
          {canManage ? <button style={primary} onClick={() => openSetup(null)}>Set up a shared meter</button> : <span style={{ fontSize: 13 }}>Ask an admin to set it up.</span>}
        </div>
      )}

      {setup && (
        <div style={{ ...card, marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>{setup.id ? 'Edit shared meter' : 'New shared meter'}</h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <label style={{ fontSize: 13 }}>Meter number<br /><input style={inp} value={setup.meter_number} maxLength={60} onChange={e => setSetup({ ...setup, meter_number: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}>Account no. (optional)<br /><input style={inp} value={setup.account_number} maxLength={60} onChange={e => setSetup({ ...setup, account_number: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}>Counts payments from<br /><input style={inp} type="month" value={setup.start_month} onChange={e => e.target.value && setSetup({ ...setup, start_month: e.target.value })} /></label>
          </div>
          <label style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>How is the bill split?<br />
            <select style={inp} value={setup.split_mode} onChange={e => setSetup({ ...setup, split_mode: e.target.value })}>
              <option value="weight">Equally (or by weight)</option>
              <option value="category">By category: a fixed amount per unit (shops, offices, salons…)</option>
            </select></label>
          <datalist id="unit-cats"><option value="Shop" /><option value="Office" /><option value="Salon" /><option value="Other" /></datalist>
          <div style={{ fontSize: 13, color: 'var(--muted, #6b7280)', marginBottom: 6 }}>{setup.split_mode === 'category'
            ? <>Tick the units on this meter and give each a <b>category</b>. When you enter a bill you'll set how much each category pays per unit.</>
            : <>Tick the units on this meter. <b>Weight</b>: 1 = a normal unit (everyone equal), 2 = uses about twice as much.</>}</div>
          <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border, #e5e7eb)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
              {setup.rows.map((r, i) => (
                <tr key={r.house_id}>
                  <td style={td}><input type="checkbox" checked={r.on} onChange={e => setSetup({ ...setup, rows: setup.rows.map((x, j) => j === i ? { ...x, on: e.target.checked } : x) })} /></td>
                  <td style={td}><b>{r.unit_number}</b></td>
                  <td style={td}>{r.tenant_name || <span style={{ color: '#9ca3af' }}>Vacant</span>}</td>
                  <td style={td}>{setup.split_mode === 'category'
                    ? <input style={{ ...inp, width: 110 }} list="unit-cats" maxLength={30} placeholder="Category" disabled={!r.on} value={r.category} onChange={e => setSetup({ ...setup, rows: setup.rows.map((x, j) => j === i ? { ...x, category: e.target.value } : x) })} />
                    : <input style={{ ...inp, width: 70 }} type="number" min="0.1" step="0.1" disabled={!r.on} value={r.weight} onChange={e => setSetup({ ...setup, rows: setup.rows.map((x, j) => j === i ? { ...x, weight: e.target.value } : x) })} />}</td>
                </tr>))}
            </tbody></table>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button style={primary} onClick={saveSetup}>Save meter</button><button style={btn} onClick={() => setSetup(null)}>Cancel</button></div>
        </div>
      )}

      {meters.length > 0 && !setup && (
        <div style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          {meters.length > 1 && <select style={inp} value={meterId || ''} onChange={e => setMeterId(Number(e.target.value))}>{meters.map(m => <option key={m.id} value={m.id}>Meter {m.meter_number}</option>)}</select>}
          {sum && <span>Meter <b>{sum.meter.meter_number}</b>{sum.meter.account_number ? <> · account {sum.meter.account_number}</> : ''} · {sum.units.length} units · {isCat ? 'priced by category' : `split by weight (total ${sum.units.reduce((a, u) => a + u.weight, 0)})`}</span>}
          <div style={{ flex: 1 }} />
          {canManage && sum && <button style={btn} onClick={() => openSetup(meters.find(m => m.id === meterId))}>Edit meter / weights</button>}
          {canManage && <button style={btn} onClick={() => openSetup(null)}>+ Another meter</button>}
        </div>
      )}

      {sum && !setup && (canManage || sum.payers?.length > 0) && (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <b>Businesses sharing a unit</b>
            <span style={{ fontSize: 12.5, color: 'var(--muted, #6b7280)' }}>pay rent with the unit, pay water separately</span>
            <div style={{ flex: 1 }} />
            {canManage && !payerForm && <button style={btn} onClick={() => setPayerForm({ house_id: sum.units[0]?.house_id || '', name: '', phone: '', category: '', weight: 1 })}>+ Add a business</button>}
          </div>
          {(sum.payers || []).map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--border, #f1f5f9)', flexWrap: 'wrap' }}>
              <span><b>{p.name}</b> · shares unit <b>{p.unit_number}</b>{p.category ? <> · {p.category}</> : ''}{p.phone ? <> · {p.phone}</> : ''}</span>
              <div style={{ flex: 1 }} />
              {canManage && <button style={{ ...btn, padding: '3px 10px' }} onClick={() => removePayer(p)}>Remove</button>}
            </div>))}
          {payerForm && (
            <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ fontSize: 13 }}>Unit<br /><select style={inp} value={payerForm.house_id} onChange={e => setPayerForm({ ...payerForm, house_id: e.target.value })}>
                {sum.units.map(u => <option key={u.house_id} value={u.house_id}>{u.unit_number}{u.tenant_name ? ` — ${u.tenant_name}` : ''}</option>)}</select></label>
              <label style={{ fontSize: 13 }}>Business name<br /><input style={inp} maxLength={80} value={payerForm.name} onChange={e => setPayerForm({ ...payerForm, name: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}>Phone (optional)<br /><input style={{ ...inp, width: 130 }} maxLength={20} value={payerForm.phone} onChange={e => setPayerForm({ ...payerForm, phone: e.target.value })} /></label>
              {isCat
                ? <label style={{ fontSize: 13 }}>Category<br /><input style={{ ...inp, width: 110 }} list="unit-cats" maxLength={30} value={payerForm.category} onChange={e => setPayerForm({ ...payerForm, category: e.target.value })} /></label>
                : <label style={{ fontSize: 13 }}>Weight<br /><input style={{ ...inp, width: 70 }} type="number" min="0.1" step="0.1" value={payerForm.weight} onChange={e => setPayerForm({ ...payerForm, weight: e.target.value })} /></label>}
              <button style={primary} onClick={addPayer}>Add</button><button style={btn} onClick={() => setPayerForm(null)}>Cancel</button>
            </div>)}
          <datalist id="unit-cats"><option value="Shop" /><option value="Office" /><option value="Salon" /><option value="Other" /></datalist>
        </div>
      )}

      {sum && !setup && (<>
        {!bill && !billForm && (
          <div style={{ ...card, marginBottom: 12 }}>
            <b>No bill entered for {monthName(month)}.</b>
            {canRecord
              ? <div style={{ marginTop: 8 }}><button style={primary} onClick={() => setBillForm({ amount: '', due_date: '', reference: '', notes: '', rates: lastRates() })}>Enter the {type.toLowerCase()} bill</button></div>
              : <div style={{ fontSize: 13, marginTop: 6 }}>Only staff who can record meters may enter the bill.</div>}
          </div>
        )}
        {billForm && (
          <div style={{ ...card, marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>{billForm.id ? 'Edit' : 'Enter'} {monthName(month)} bill</h3>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 13 }}>Amount to pay (KES)<br /><input style={inp} type="number" min="1" step="0.01" value={billForm.amount} onChange={e => setBillForm({ ...billForm, amount: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}>Pay by<br /><input style={inp} type="date" value={billForm.due_date || ''} onChange={e => setBillForm({ ...billForm, due_date: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}>Bill reference<br /><input style={inp} maxLength={100} value={billForm.reference || ''} onChange={e => setBillForm({ ...billForm, reference: e.target.value })} /></label>
            </div>
            {isCat && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 13, marginBottom: 6 }}><b>What each unit pays</b> (pre-filled from the last bill)</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {occCats.map(([c, n]) => (
                    <label key={c} style={{ fontSize: 13 }}>{c} ({n} unit{n === 1 ? '' : 's'})<br />
                      <input style={{ ...inp, width: 110 }} type="number" min="1" step="0.01" value={billForm.rates?.[c] ?? ''} onChange={e => setBillForm({ ...billForm, rates: { ...billForm.rates, [c]: e.target.value } })} />
                    </label>))}
                </div>
                {(() => { const exp = billExpected(billForm), amt = Number(billForm.amount) || 0, gap = Math.round((amt - exp) * 100) / 100;
                  return <div style={{ fontSize: 13, marginTop: 8, color: gap === 0 ? '#16a34a' : '#b45309' }}>
                    Units will pay <b>{kes(exp)}</b> in total{amt ? (gap === 0 ? ' — exactly the bill.' : gap > 0 ? ` — ${kes(gap)} short of the bill.` : ` — ${kes(-gap)} more than the bill.`) : '.'}</div>; })()}
              </div>
            )}
            <p style={{ fontSize: 12.5, color: 'var(--muted, #6b7280)' }}>{isCat ? "Each occupied unit pays the amount for its category, and the bill amount above is the target. Vacant units aren't charged." : 'This is split by weight between the units occupied right now.'} Don't also add it under Expenses: it is the tenants' own bill, so it stays out of your profit and loss.</p>
            <div style={{ display: 'flex', gap: 8 }}><button style={primary} onClick={saveBill}>Save bill</button><button style={btn} onClick={() => setBillForm(null)}>Cancel</button></div>
          </div>
        )}

        {bill && (
          <div style={{ ...card, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>{monthName(month)}</h3>
              <span style={{ fontSize: 22, fontWeight: 800 }}>{kes(bill.funded)}</span><span style={{ color: 'var(--muted, #6b7280)' }}>of {kes(bill.amount)} funded</span>
              <div style={{ flex: 1 }} />
              <b style={{ color: bill.pct >= 100 ? '#16a34a' : '#b45309' }}>{bill.pct}%</b>
            </div>
            <div style={{ height: 14, borderRadius: 99, background: 'var(--border, #e5e7eb)', overflow: 'hidden', margin: '8px 0' }} role="progressbar" aria-valuenow={bill.pct} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${bill.pct}%`, height: '100%', background: bill.pct >= 100 ? '#16a34a' : '#7c3aed', transition: 'width .4s' }} />
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 14 }}>
              <span>Still needed: <b>{kes(bill.outstanding)}</b></span>
              <span style={{ color: '#16a34a' }}>✓ {bill.counts.paid} paid</span>
              <span style={{ color: '#b45309' }}>◐ {bill.counts.partial} part paid</span>
              <span style={{ color: '#dc2626' }}>✕ {bill.counts.unpaid} not paid</span>
              {bill.due_date && <span>Pay by {new Date(bill.due_date).toLocaleDateString('en-KE')}</span>}
              {bill.reference && <span>Ref {bill.reference}</span>}
              {isCat && bill.gap !== 0 && <span style={{ color: '#b45309' }}>Shares add up to {kes(bill.expected)} — {bill.gap > 0 ? `${kes(bill.gap)} short of` : `${kes(-bill.gap)} over`} the bill</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
              {bill.provider_paid_on
                ? <span style={{ color: '#16a34a', fontWeight: 600 }}>Utility company paid on {new Date(bill.provider_paid_on).toLocaleDateString('en-KE')}</span>
                : <span style={{ color: 'var(--muted, #6b7280)', fontSize: 13 }}>Utility company not marked paid yet</span>}
              {canRecord && (bill.provider_paid_on
                ? <button style={btn} onClick={() => providerPaid(null)}>Undo</button>
                : <button style={btn} onClick={() => providerPaid(today())}>Mark paid to utility company</button>)}
              <div style={{ flex: 1 }} />
              {canRecord && <button style={btn} onClick={() => setBillForm({ id: bill.id, rates: bill.category_rates || lastRates(), amount: bill.amount, due_date: bill.due_date ? String(bill.due_date).slice(0, 10) : '', reference: bill.reference || '', notes: bill.notes || '' })}>Edit amount</button>}
              {canRecord && <button style={btn} onClick={resplit} title="After a move-in or move-out">Re-split</button>}
              {canRecord && <button style={btn} onClick={delBill}>Delete</button>}
            </div>
          </div>
        )}

        {bill && (
          <div style={{ ...card, padding: 0, overflowX: 'auto', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', gap: 8 }}>
              <b>Who has contributed</b><div style={{ flex: 1 }} />
              <button style={btn} onClick={downloadCsv} disabled={!bill.rows.some(r => r.status !== 'paid')}>⬇ Not contributed (CSV)</button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Unit</th><th style={th}>Tenant</th><th style={th}>{isCat ? 'Category' : 'Weight'}</th><th style={th}>Share</th><th style={th}>Paid</th><th style={th}>Balance</th><th style={th}>Status</th><th style={th} /></tr></thead>
              <tbody>
                {bill.rows.map(r => {
                  const wa = waNumber(r.tenant_phone);
                  const rk = `${r.house_id}-${r.payer_id || 0}`;
                  return (
                    <Fragment key={rk}>
                    <tr style={r.status === 'paid' ? undefined : { background: r.status === 'unpaid' ? 'rgba(220,38,38,.05)' : 'rgba(180,83,9,.06)' }}>
                      <td style={td}><b>{r.unit_number}</b>{r.payer_id && <span title="A second business sharing this unit" style={{ fontSize: 11, color: '#7c3aed' }}> +shared</span>}</td><td style={td}>{r.tenant_name || '—'}</td><td style={td}>{isCat ? (r.category || '—') : r.weight}</td>
                      <td style={td}>{kes(r.share)}</td><td style={td}>{kes(r.received ?? r.paid)}{r.extra > 0 && <div style={{ fontSize: 11, color: '#16a34a' }}>incl. {kes(r.extra)} extra, credit for next bill</div>}</td><td style={td}>{kes(r.balance)}</td>
                      <td style={{ ...td, color: ST[r.status][1], fontWeight: 700 }}>{ST[r.status][0]}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {r.status !== 'paid' && wa && <a style={{ ...btn, textDecoration: 'none', display: 'inline-block', marginRight: 6 }} href={`https://wa.me/${wa}?text=${encodeURIComponent(reminder(r))}`} target="_blank" rel="noopener noreferrer">💬 Remind</a>}
                        <button style={{ ...btn, marginRight: 6 }} onClick={() => toggleHist(r)} title="See, edit or delete this row's payments">🧾 Payments</button>
                        {(r.tenant_id || r.payer_id) && <button style={primary} onClick={() => setContrib({ tenant_id: r.tenant_id, payer_id: r.payer_id, name: r.tenant_name, unit: r.unit_number, amount: r.balance || '', method: 'Cash', reference: '', date: today() })}>+ Record</button>}
                      </td>
                    </tr>
                    {histKey === rk && (
                      <tr><td colSpan={8} style={{ ...td, background: 'var(--bg, #f8fafc)' }}>
                        <div style={{ fontSize: 13, marginBottom: 6 }}><b>Water payments for {r.tenant_name || `unit ${r.unit_number}`}</b> <span style={{ color: 'var(--muted, #6b7280)' }}>· applied to the oldest bill first</span></div>
                        {hist.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted, #6b7280)' }}>No payments recorded yet.</div>}
                        {hist.map(p => (
                          <div key={`${p.kind}-${p.id}`} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '5px 0', borderTop: '1px solid var(--border, #e5e7eb)' }}>
                            {editPay && editPay.id === p.id && editPay.kind === p.kind ? (<>
                              <input style={{ ...inp, width: 100 }} type="number" min="1" step="0.01" value={editPay.amount} onChange={e => setEditPay({ ...editPay, amount: e.target.value })} />
                              <input style={inp} type="date" value={editPay.payment_date} onChange={e => setEditPay({ ...editPay, payment_date: e.target.value })} />
                              <select style={inp} value={editPay.method || ''} onChange={e => setEditPay({ ...editPay, method: e.target.value })}><option value="">—</option><option>Cash</option><option>M-Pesa</option><option>Bank</option></select>
                              <input style={{ ...inp, width: 140 }} placeholder="Reference" maxLength={100} value={editPay.reference || ''} onChange={e => setEditPay({ ...editPay, reference: e.target.value })} />
                              <button style={primary} onClick={() => savePay(r)}>Save</button><button style={btn} onClick={() => setEditPay(null)}>Cancel</button>
                            </>) : (<>
                              <b style={{ width: 110 }}>{kes(p.amount)}</b><span style={{ width: 100 }}>{String(p.payment_date).slice(0, 10)}</span>
                              <span style={{ width: 80 }}>{p.method || '—'}</span><span style={{ flex: 1, color: 'var(--muted, #6b7280)' }}>{p.reference || ''}</span>
                              {canRecord && <button style={{ ...btn, padding: '3px 10px' }} onClick={() => setEditPay({ id: p.id, kind: p.kind, amount: p.amount, payment_date: String(p.payment_date).slice(0, 10), method: p.method || '', reference: p.reference || '' })}>Edit</button>}
                              {canRecord && <button style={{ ...btn, padding: '3px 10px', color: '#b91c1c' }} onClick={() => delPay(r, p)}>Delete</button>}
                            </>)}
                          </div>))}
                      </td></tr>)}
                    </Fragment>);
                })}
              </tbody>
            </table>
          </div>
        )}

        {sum.bills.length > 0 && (
          <div style={{ ...card, marginBottom: 12 }}>
            <b>All months</b>
            {sum.bills.map(b => (
              <div key={b.id} onClick={() => setMonth(b.billing_month)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', cursor: 'pointer', borderTop: '1px solid var(--border, #f1f5f9)', fontWeight: b.billing_month === month ? 700 : 400 }}>
                <span style={{ width: 130 }}>{monthName(b.billing_month)}</span>
                <div style={{ flex: 1, height: 8, borderRadius: 99, background: 'var(--border, #e5e7eb)', overflow: 'hidden' }}><div style={{ width: `${b.pct}%`, height: '100%', background: b.pct >= 100 ? '#16a34a' : '#7c3aed' }} /></div>
                <span style={{ width: 170, textAlign: 'right', fontSize: 13 }}>{kes(b.funded)} / {kes(b.amount)}</span>
              </div>))}
          </div>
        )}
        {sum.units.some(u => u.credit > 0) && (
          <div style={{ ...card, fontSize: 13 }}>
            <b>Credit carried forward</b> (paid ahead, applied to the next bill): {sum.units.filter(u => u.credit > 0).map(u => `${u.unit_number} ${kes(u.credit)}`).join(' · ')}
          </div>
        )}
        <p style={{ fontSize: 12.5, color: 'var(--muted, #6b7280)' }}>How it works: each month's bill is split by weight between the units occupied when it was entered (vacant units are left out, so the others cover the whole bill). A tenant's {type.toLowerCase()} payments pay the oldest bill first, so a shortfall carries forward and any extra rolls into the next month as credit. None of this is rent, and it never appears in your expenses or profit and loss.</p>
      </>)}

      {contrib && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 2000, display: 'grid', placeItems: 'center', padding: 12 }} onClick={() => setContrib(null)}>
          <div style={{ ...card, width: 'min(380px, 100%)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Record contribution</h3>
            <div style={{ marginBottom: 10 }}>{contrib.name} · unit {contrib.unit} · shared {type.toLowerCase()}</div>
            <div style={{ display: 'grid', gap: 8 }}>
              <input style={inp} type="number" min="1" step="0.01" placeholder="Amount (KES)" value={contrib.amount} onChange={e => setContrib({ ...contrib, amount: e.target.value })} />
              <input style={inp} type="date" value={contrib.date} onChange={e => setContrib({ ...contrib, date: e.target.value })} />
              <select style={inp} value={contrib.method} onChange={e => setContrib({ ...contrib, method: e.target.value })}><option>Cash</option><option>M-Pesa</option><option>Bank</option></select>
              <input style={inp} placeholder="Reference (e.g. M-Pesa code)" maxLength={100} value={contrib.reference} onChange={e => setContrib({ ...contrib, reference: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}><button style={btn} onClick={() => setContrib(null)}>Cancel</button><button style={primary} onClick={saveContrib}>Save</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

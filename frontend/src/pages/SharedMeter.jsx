// Shared meter tab: one meter serves many units (e.g. a building's single water
// meter). Staff enter the monthly bill; it is split by unit weight among the
// occupied units, and tenants' water receipts fund it. Pass-through money — it
// is not an expense or income, and never touches rent.
import { useCallback, useEffect, useState } from 'react';
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
  const err = (e, fallback) => setMsg({ ok: '', err: e.response?.data?.error || fallback });
  const reload = () => { loadSum(); loadList(); };

  // ── setup form ──
  const openSetup = (m) => {
    const onOther = new Set(units.filter(u => u.shared_meter_number && (!m || u.shared_meter_number !== m.meter_number)).map(u => u.house_id));
    setSetup({
      id: m?.id || null, meter_number: m?.meter_number || '', account_number: m?.account_number || '', start_month: m?.start_month || month,
      rows: units.filter(u => !onOther.has(u.house_id)).map(u => {
        const cur = m?.units.find(x => x.house_id === u.house_id);
        return { house_id: u.house_id, unit_number: u.unit_number, tenant_name: u.tenant_name, on: !!cur || (!m), weight: cur ? cur.weight : 1 };
      }),
    });
  };
  const saveSetup = async () => {
    const chosen = setup.rows.filter(r => r.on).map(r => ({ house_id: r.house_id, weight: Number(r.weight) }));
    const body = { meter_number: setup.meter_number, account_number: setup.account_number, start_month: setup.start_month, units: chosen };
    try {
      if (setup.id) await API.put(`/shared-meters/${setup.id}`, body);
      else { const r = await API.post('/shared-meters', { ...body, plot_id: Number(plotId), utility_type: type }); setMeterId(r.data.data.id); }
      setSetup(null); setMsg({ ok: 'Meter saved.', err: '' }); reload();
    } catch (e) { err(e, 'Could not save the meter.'); }
  };

  // ── bills ──
  const saveBill = async () => {
    try {
      if (billForm.id) await API.put(`/shared-meters/bills/${billForm.id}`, { amount: Number(billForm.amount), due_date: billForm.due_date || null, reference: billForm.reference, notes: billForm.notes });
      else await API.post(`/shared-meters/${meterId}/bills`, { billing_month: month, amount: Number(billForm.amount), due_date: billForm.due_date || null, reference: billForm.reference, notes: billForm.notes });
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
      await API.post('/utilities', { tenant_id: contrib.tenant_id, payment_date: contrib.date, method: contrib.method, reference: contrib.reference,
        notes: `Shared ${type.toLowerCase()} meter ${sum.meter.meter_number}, ${monthName(month)}`, items: [{ type, amount: Number(contrib.amount) }] });
      setContrib(null); setMsg({ ok: 'Contribution recorded.', err: '' }); loadSum();
    } catch (e) { err(e, 'Could not record the contribution.'); }
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
          <div style={{ fontSize: 13, color: 'var(--muted, #6b7280)', marginBottom: 6 }}>Tick the units on this meter. <b>Weight</b>: 1 = a normal unit, 2 = uses about twice as much (e.g. a salon).</div>
          <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border, #e5e7eb)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
              {setup.rows.map((r, i) => (
                <tr key={r.house_id}>
                  <td style={td}><input type="checkbox" checked={r.on} onChange={e => setSetup({ ...setup, rows: setup.rows.map((x, j) => j === i ? { ...x, on: e.target.checked } : x) })} /></td>
                  <td style={td}><b>{r.unit_number}</b></td>
                  <td style={td}>{r.tenant_name || <span style={{ color: '#9ca3af' }}>Vacant</span>}</td>
                  <td style={td}><input style={{ ...inp, width: 70 }} type="number" min="0.1" step="0.1" disabled={!r.on} value={r.weight} onChange={e => setSetup({ ...setup, rows: setup.rows.map((x, j) => j === i ? { ...x, weight: e.target.value } : x) })} /></td>
                </tr>))}
            </tbody></table>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button style={primary} onClick={saveSetup}>Save meter</button><button style={btn} onClick={() => setSetup(null)}>Cancel</button></div>
        </div>
      )}

      {meters.length > 0 && !setup && (
        <div style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          {meters.length > 1 && <select style={inp} value={meterId || ''} onChange={e => setMeterId(Number(e.target.value))}>{meters.map(m => <option key={m.id} value={m.id}>Meter {m.meter_number}</option>)}</select>}
          {sum && <span>Meter <b>{sum.meter.meter_number}</b>{sum.meter.account_number ? <> · account {sum.meter.account_number}</> : ''} · {sum.units.length} units (total weight {sum.units.reduce((a, u) => a + u.weight, 0)})</span>}
          <div style={{ flex: 1 }} />
          {canManage && sum && <button style={btn} onClick={() => openSetup(meters.find(m => m.id === meterId))}>Edit meter / weights</button>}
          {canManage && <button style={btn} onClick={() => openSetup(null)}>+ Another meter</button>}
        </div>
      )}

      {sum && !setup && (<>
        {!bill && !billForm && (
          <div style={{ ...card, marginBottom: 12 }}>
            <b>No bill entered for {monthName(month)}.</b>
            {canRecord
              ? <div style={{ marginTop: 8 }}><button style={primary} onClick={() => setBillForm({ amount: '', due_date: '', reference: '', notes: '' })}>Enter the {type.toLowerCase()} bill</button></div>
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
            <p style={{ fontSize: 12.5, color: 'var(--muted, #6b7280)' }}>This is split by weight between the units occupied right now. Don't also add it under Expenses: it is the tenants' own bill, so it stays out of your profit and loss.</p>
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
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
              {bill.provider_paid_on
                ? <span style={{ color: '#16a34a', fontWeight: 600 }}>Utility company paid on {new Date(bill.provider_paid_on).toLocaleDateString('en-KE')}</span>
                : <span style={{ color: 'var(--muted, #6b7280)', fontSize: 13 }}>Utility company not marked paid yet</span>}
              {canRecord && (bill.provider_paid_on
                ? <button style={btn} onClick={() => providerPaid(null)}>Undo</button>
                : <button style={btn} onClick={() => providerPaid(today())}>Mark paid to utility company</button>)}
              <div style={{ flex: 1 }} />
              {canRecord && <button style={btn} onClick={() => setBillForm({ id: bill.id, amount: bill.amount, due_date: bill.due_date ? String(bill.due_date).slice(0, 10) : '', reference: bill.reference || '', notes: bill.notes || '' })}>Edit amount</button>}
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
              <thead><tr><th style={th}>Unit</th><th style={th}>Tenant</th><th style={th}>Weight</th><th style={th}>Share</th><th style={th}>Paid</th><th style={th}>Balance</th><th style={th}>Status</th><th style={th} /></tr></thead>
              <tbody>
                {bill.rows.map(r => {
                  const wa = waNumber(r.tenant_phone);
                  return (
                    <tr key={r.house_id} style={r.status === 'paid' ? undefined : { background: r.status === 'unpaid' ? 'rgba(220,38,38,.05)' : 'rgba(180,83,9,.06)' }}>
                      <td style={td}><b>{r.unit_number}</b></td><td style={td}>{r.tenant_name || '—'}</td><td style={td}>{r.weight}</td>
                      <td style={td}>{kes(r.share)}</td><td style={td}>{kes(r.paid)}</td><td style={td}>{kes(r.balance)}</td>
                      <td style={{ ...td, color: ST[r.status][1], fontWeight: 700 }}>{ST[r.status][0]}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {r.status !== 'paid' && wa && <a style={{ ...btn, textDecoration: 'none', display: 'inline-block', marginRight: 6 }} href={`https://wa.me/${wa}?text=${encodeURIComponent(reminder(r))}`} target="_blank" rel="noopener noreferrer">💬 Remind</a>}
                        {r.tenant_id && <button style={primary} onClick={() => setContrib({ tenant_id: r.tenant_id, name: r.tenant_name, unit: r.unit_number, amount: r.balance || '', method: 'Cash', reference: '', date: today() })}>+ Record</button>}
                      </td>
                    </tr>);
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

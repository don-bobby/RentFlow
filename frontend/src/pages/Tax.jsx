// KRA Monthly Rental Income (MRI) helper. Works out the figures for the return from
// the rent actually received. It does not file anything: the landlord or staff still
// submit the return and payment on KRA's system.
import { useCallback, useEffect, useMemo, useState } from 'react';
import API from '../services/api';
import { IconInline } from '../components/Icon';

const kes = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const monthName = (m) => { const [y, mo] = m.split('-'); return new Date(+y, +mo - 1, 1).toLocaleString('en-KE', { month: 'long', year: 'numeric' }); };
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const daysFromToday = (iso) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) / 86400000);

// Defined outside Tax so it keeps its open/closed state when the page re-renders.
function Section({ title, hint, children }) {
  return (
    <details style={{ background: 'var(--card, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 14, marginBottom: 14, overflow: 'hidden' }}>
      <summary style={{ cursor: 'pointer', padding: '14px 16px', fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 10 }}><span>{title}</span><span style={{ color: 'var(--muted, #6b7280)', fontSize: 13, fontWeight: 400 }}>{hint}</span></summary>
      <div style={{ padding: '0 16px 16px' }}>{children}</div>
    </details>
  );
}

export default function Tax() {
  const [landlords, setLandlords] = useState(null);
  const [landlordId, setLandlordId] = useState('');
  const [month, setMonth] = useState(prevMonth());
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState({ ok: '', err: '' });
  const [migration, setMigration] = useState(false);
  const [st, setSt] = useState({ filed_on: '', paid_on: '', reference: '', notes: '' });
  const [pin, setPin] = useState('');
  const [setForm, setSetForm] = useState(null);

  useEffect(() => {
    API.get('/tax/landlords').then(r => {
      if (r.data.migration_needed) return setMigration(true);
      setLandlords(r.data.data); if (r.data.data.length) setLandlordId(String(r.data.data[0].id));
    }).catch(e => setMsg({ ok: '', err: e.response?.data?.error || 'Could not load landlords.' }));
  }, []);

  const load = useCallback(async () => {
    if (!landlordId) return;
    try {
      const r = await API.get('/tax/mri', { params: { landlord_id: landlordId, month } });
      if (r.data.migration_needed) return setMigration(true);
      setD(r.data); setPin(r.data.landlord.kra_pin || '');
      setSt({ filed_on: r.data.status.filed_on || '', paid_on: r.data.status.paid_on || '', reference: r.data.status.reference || '', notes: r.data.status.notes || '' });
    } catch (e) { setD(null); setMsg({ ok: '', err: e.response?.data?.error || 'Could not load the figures.' }); }
  }, [landlordId, month]);
  useEffect(() => { load(); }, [load]);

  const err = (e, f) => setMsg({ ok: '', err: e.response?.data?.error || f });
  const ok = (m) => setMsg({ ok: m, err: '' });
  const saveStatus = async () => { try { await API.post('/tax/mri/status', { landlord_id: Number(landlordId), month, ...st }); ok('Saved.'); load(); } catch (e) { err(e, 'Could not save.'); } };
  const savePin = async () => { try { await API.put(`/tax/landlords/${landlordId}/pin`, { kra_pin: pin }); ok('KRA PIN saved.'); load(); } catch (e) { err(e, 'Could not save the PIN.'); } };
  const setPlotUse = async (id, rental_use) => { try { await API.put(`/tax/plots/${id}/use`, { rental_use }); load(); } catch (e) { err(e, 'Could not change.'); } };
  const setUnitUse = async (id, v) => { try { await API.put(`/tax/houses/${id}/use`, { use_type: v || null }); load(); } catch (e) { err(e, 'Could not change.'); } };
  const saveSettings = async () => {
    try { await API.put('/tax/settings', Object.fromEntries(Object.entries(setForm).map(([k, v]) => [k, Number(v)]))); setSetForm(null); ok('Tax settings saved.'); load(); }
    catch (e) { err(e, 'Could not save the settings.'); }
  };
  const download = async () => {
    try {
      const r = await API.get('/tax/mri/pdf', { params: { landlord_id: landlordId, month }, responseType: 'blob' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = `MRI-${d.landlord.name}-${month}.pdf`; a.click();
    } catch (e) { setMsg({ ok: '', err: 'Could not create the PDF.' }); }
  };
  const csv = () => {
    const rows = [['Landlord', d.landlord.name], ['KRA PIN', d.landlord.kra_pin || ''], ['Rent month', month], ['Due', d.due_date], [],
      ['Property', 'Residential rent collected', 'Commercial (not included)'], ...d.properties.map(p => [p.plot_name, p.residential, p.commercial]), [],
      ['Gross monthly rental income', d.gross], [`Tax at ${Number(d.settings.mri_rate)}%`, d.tax], ['Number of properties', d.property_count]];
    const text = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = `MRI-${d.landlord.name}-${month}.csv`; a.click();
  };
  const copyFigures = async () => {
    const t = `Rent month: ${month}\nGross monthly rental income: ${d.gross}\nTax at ${Number(d.settings.mri_rate)}%: ${d.tax}\nNumber of properties: ${d.property_count}`;
    try { await navigator.clipboard.writeText(t); ok('Figures copied.'); } catch { setMsg({ ok: '', err: 'Could not copy.' }); }
  };

  const card = { background: 'var(--card, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 14, padding: 16, marginBottom: 14 };
  const inp = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)', background: 'var(--bg, #fff)', color: 'inherit', fontSize: 14, boxSizing: 'border-box' };
  const btn = { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)', background: 'var(--card, #fff)', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
  const primary = { ...btn, background: 'var(--primary, #1b6b45)', color: '#fff', border: 'none' };
  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: 'var(--muted, #6b7280)', borderBottom: '1px solid var(--border, #e5e7eb)', whiteSpace: 'nowrap' };
  const td = { padding: '8px 10px', borderBottom: '1px solid var(--border, #f1f5f9)', fontSize: 14 };
  const muted = { color: 'var(--muted, #6b7280)', fontSize: 13 };
  const lbl = { ...muted, display: 'flex', flexDirection: 'column', gap: 4 };
  const tile = { flex: '1 1 200px', border: '1px solid var(--border, #e5e7eb)', borderRadius: 12, padding: '14px 16px' };
  const tileLabel = { ...muted, marginBottom: 4 };
  const tileValue = { fontSize: 26, fontWeight: 800, lineHeight: 1.2 };
  const chip = (c) => ({ display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, color: c, background: `${c}1a` });
  const sec = { ...card, padding: 0, overflow: 'hidden' };
  const secHead = { cursor: 'pointer', padding: '14px 16px', fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 10, listStyle: 'none' };
  const secBody = { padding: '0 16px 16px' };

  const dueInfo = useMemo(() => {
    if (!d) return null;
    const n = daysFromToday(d.due_date);
    if (d.status.filed_on && d.status.paid_on) return { text: 'Filed and paid', color: '#16a34a' };
    if (n < 0) return { text: `Overdue by ${-n} day${n === -1 ? '' : 's'}`, color: '#dc2626' };
    if (n === 0) return { text: 'Due today', color: '#b45309' };
    return { text: `Due in ${n} day${n === 1 ? '' : 's'}`, color: n <= 5 ? '#b45309' : '#16a34a' };
  }, [d]);

  if (migration) return <div style={card}>The tax helper needs migration 031 (031_mri_tax.sql) to be run on this database first.</div>;
  const bandMsg = d && ({
    below: [`On track for ${kes(d.year.projected)} this year, below the ${kes(d.settings.lower_threshold)} limit, so MRI may not apply.`, '#b45309', 'Below limit'],
    above: [`On track for ${kes(d.year.projected)} this year, above the ${kes(d.settings.upper_threshold)} limit. Ordinary income tax may apply instead.`, '#dc2626', 'Above limit'],
    inside: [`On track for ${kes(d.year.projected)} this year, inside the MRI band.`, '#16a34a', 'Within MRI band'],
  })[d.year.band];
  const rate = d && Number(d.settings.mri_rate);
  const homes = d ? d.units.filter(u => u.use === 'residential').length : 0;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <h1 style={{ fontFamily: 'Bricolage Grotesque', fontSize: 32, fontWeight: 700, letterSpacing: '-0.4px', margin: 0, color: 'var(--text)' }}><IconInline name="🧮" size={14} />Rental income tax</h1>
        <span style={chip('#1b6b45')}>KRA MRI</span>
      </div>
      <p style={{ ...muted, marginTop: 0 }}>Figures from recorded rent, for your return. Nothing is filed with KRA from here.</p>
      {msg.err && <div style={{ ...card, color: '#b91c1c' }}>{msg.err}</div>}
      {msg.ok && <div style={{ ...card, color: '#15803d' }}>{msg.ok}</div>}

      <div style={{ ...card, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {landlords && landlords.length > 1 && <label style={lbl}>Landlord<select style={inp} value={landlordId} onChange={e => setLandlordId(e.target.value)}>{landlords.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>}
        {landlords && landlords.length === 1 && <label style={lbl}>Landlord<b style={{ fontSize: 15, color: 'inherit' }}>{landlords[0].name}</b></label>}
        <label style={lbl}>Rent month<input style={inp} type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></label>
        <div style={{ flex: 1 }} />
        {d && <><button style={btn} onClick={copyFigures}>Copy</button><button style={btn} onClick={csv}>CSV</button><button style={primary} onClick={download}>Download PDF</button></>}
      </div>
      {landlords && landlords.length === 0 && <div style={card}>No landlords with properties you can see.</div>}

      {d && (<>
        <div style={card}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={tile}><div style={tileLabel}>Home rent collected</div><div style={tileValue}>{kes(d.gross)}</div><div style={muted}>{monthName(month)}</div></div>
            <div style={{ ...tile, borderColor: '#1b6b4555', background: 'rgba(27,107,69,.06)' }}><div style={tileLabel}>Tax to pay ({rate}%)</div><div style={{ ...tileValue, color: '#1b6b45' }}>{kes(d.tax)}</div><div style={muted}>{d.property_count} propert{d.property_count === 1 ? 'y' : 'ies'}</div></div>
            <div style={tile}><div style={tileLabel}>Pay and file by</div><div style={{ ...tileValue, fontSize: 20 }}>{new Date(d.due_date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}</div><span style={chip(dueInfo.color)}>{dueInfo.text}</span></div>
          </div>

          {(d.commercial_excluded > 0 || d.unmatched || !d.landlord.kra_pin) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12, ...muted }}>
              {d.commercial_excluded > 0 && <div>ℹ️ {kes(d.commercial_excluded)} of shop/office rent is not included. MRI covers homes only.</div>}
              {d.unmatched && <div style={{ color: '#b45309' }}><IconInline name="⚠️" size={14} />{d.unmatched.count} payment{d.unmatched.count === 1 ? '' : 's'} ({kes(d.unmatched.total)}) not matched to a unit, so not counted. Match them on Payments.</div>}
              {!d.landlord.kra_pin && <div style={{ color: '#b45309' }}><IconInline name="⚠️" size={14} />No KRA PIN saved yet. Add it under "PIN and settings" below.</div>}
            </div>)}
          {d.penalties.total > 0 && (
            <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'rgba(220,38,38,.08)', color: '#b91c1c', fontSize: 14 }}>
              Estimated penalties: <b>{kes(d.penalties.total)}</b>
              <span style={{ ...muted, color: 'inherit', opacity: .8 }}> (KRA's own figure applies)</span>
            </div>)}
        </div>

        <div style={card}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Filing status</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={lbl}>Return filed on<input style={inp} type="date" value={st.filed_on} onChange={e => setSt({ ...st, filed_on: e.target.value })} /></label>
            <label style={lbl}>Tax paid on<input style={inp} type="date" value={st.paid_on} onChange={e => setSt({ ...st, paid_on: e.target.value })} /></label>
            <label style={{ ...lbl, flex: '1 1 160px' }}>KRA payment reference<input style={inp} maxLength={60} value={st.reference} onChange={e => setSt({ ...st, reference: e.target.value })} /></label>
            <button style={primary} onClick={saveStatus}>Save</button>
          </div>
        </div>

        <Section title="This year so far" hint={<span style={{ color: bandMsg[1] }}>● {bandMsg[2]}</span>}>
          <p style={{ margin: '0 0 8px', fontSize: 14, color: bandMsg[1] }}>{bandMsg[0]} Check with KRA if unsure.</p>
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Month</th><th style={th}>Homes</th><th style={th}>Shops/offices</th><th style={th}>Tax</th></tr></thead>
            <tbody>{d.year.months.map(m => <tr key={m.month}><td style={td}>{monthName(m.month)}</td><td style={td}>{kes(m.residential)}</td><td style={td}>{kes(m.commercial)}</td><td style={td}>{kes(m.residential * rate / 100)}</td></tr>)}</tbody>
            <tfoot><tr><td style={{ ...td, fontWeight: 700 }}>Total</td><td style={{ ...td, fontWeight: 700 }}>{kes(d.year.ytd)}</td><td style={td} /><td style={td} /></tr></tfoot>
          </table></div>
        </Section>

        <Section title="By property" hint={`${d.properties.length} propert${d.properties.length === 1 ? 'y' : 'ies'}`}>
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Property</th><th style={th}>Homes (counted)</th><th style={th}>Shops/offices (not counted)</th></tr></thead>
            <tbody>{d.properties.map(p => <tr key={p.plot_id}><td style={td}><b>{p.plot_name}</b></td><td style={td}>{kes(p.residential)}</td><td style={td}>{kes(p.commercial)}</td></tr>)}</tbody>
          </table></div>
        </Section>

        <Section title="Which units count as homes?" hint={`${homes} of ${d.units.length} units`}>
          <p style={{ ...muted, marginTop: 0 }}>Shops, offices and salons are commercial; bedsitters and bedrooms are homes. {d.can_edit ? 'Set a whole property, or override a single unit.' : 'An admin can change these.'}</p>
          {d.plots.map(p => (
            <div key={p.id} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                <b>{p.name}</b>
                {d.can_edit
                  ? <select style={inp} value={p.rental_use} onChange={e => setPlotUse(p.id, e.target.value)}><option value="mixed">Decide per unit</option><option value="residential">All homes</option><option value="commercial">All commercial</option></select>
                  : <span style={muted}>{({ mixed: 'decided per unit', residential: 'all homes', commercial: 'all commercial' })[p.rental_use]}</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {d.units.filter(u => u.plot_id === p.id).map(u => (
                  <div key={u.id} title={u.reason} style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, padding: '5px 9px', fontSize: 13, background: u.use === 'residential' ? 'rgba(22,163,74,.08)' : 'rgba(180,83,9,.08)' }}>
                    <b>{u.unit_number}</b> <span style={muted}>{u.house_type || ''}</span>{' '}
                    {d.can_edit
                      ? <select style={{ ...inp, padding: '2px 4px', fontSize: 12 }} value={u.use_type || ''} onChange={e => setUnitUse(u.id, e.target.value)}><option value="">Auto ({u.use === 'residential' ? 'home' : 'commercial'})</option><option value="residential">Home</option><option value="commercial">Commercial</option></select>
                      : <span style={{ color: u.use === 'residential' ? '#16a34a' : '#b45309', fontWeight: 600 }}>{u.use === 'residential' ? 'home' : 'commercial'}</span>}
                  </div>))}
              </div>
            </div>))}
        </Section>

        <Section title="PIN and settings" hint={d.landlord.kra_pin || 'No PIN yet'}>
          {d.can_pin && (<div style={{ marginBottom: 14 }}>
            <div style={{ ...muted, marginBottom: 6 }}>KRA PIN</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input style={{ ...inp, width: 160 }} placeholder="A123456789B" maxLength={11} value={pin} onChange={e => setPin(e.target.value.toUpperCase())} />
              <button style={primary} onClick={savePin}>Save PIN</button>
            </div>
          </div>)}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ ...muted, flex: 1 }}>Tax rules used</div>
            {d.can_edit && !setForm && <button style={btn} onClick={() => setSetForm({ mri_rate: d.settings.mri_rate, lower_threshold: d.settings.lower_threshold, upper_threshold: d.settings.upper_threshold, due_day: d.settings.due_day, late_filing_min: d.settings.late_filing_min, late_filing_pct: d.settings.late_filing_pct, late_payment_pct: d.settings.late_payment_pct, late_interest_pct: d.settings.late_interest_pct })}>Change</button>}
          </div>
          {!setForm && <ul style={{ ...muted, margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Rate {rate}% of home rent received, no deductions</li>
            <li>Yearly band {kes(d.settings.lower_threshold)} to {kes(d.settings.upper_threshold)}</li>
            <li>Due on the {d.settings.due_day}th of the next month</li>
            <li>Late filing: {kes(d.settings.late_filing_min)} or {Number(d.settings.late_filing_pct)}%. Late payment: {Number(d.settings.late_payment_pct)}% plus {Number(d.settings.late_interest_pct)}% a month</li>
            <li>KRA's rules change, so confirm these with KRA</li>
          </ul>}
          {setForm && (<>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
              {[['mri_rate', 'Rate %'], ['lower_threshold', 'Lower limit (yearly)'], ['upper_threshold', 'Upper limit (yearly)'], ['due_day', 'Due day (1-28)'], ['late_filing_min', 'Late filing minimum'], ['late_filing_pct', 'Late filing %'], ['late_payment_pct', 'Late payment %'], ['late_interest_pct', 'Interest % a month']].map(([k, l]) => (
                <label key={k} style={lbl}>{l}<input style={{ ...inp, width: 140 }} type="number" step="any" value={setForm[k]} onChange={e => setSetForm({ ...setForm, [k]: e.target.value })} /></label>))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}><button style={primary} onClick={saveSettings}>Save settings</button><button style={btn} onClick={() => setSetForm(null)}>Cancel</button></div>
          </>)}
        </Section>
      </>)}
    </div>
  );
}

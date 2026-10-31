// KRA Monthly Rental Income (MRI) helper. Works out the figures for the return from
// the rent actually received. It does not file anything: the landlord or staff still
// submit the return and payment on KRA's system.
import { useCallback, useEffect, useMemo, useState } from 'react';
import API from '../services/api';

const kes = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const monthName = (m) => { const [y, mo] = m.split('-'); return new Date(+y, +mo - 1, 1).toLocaleString('en-KE', { month: 'long', year: 'numeric' }); };
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const daysFromToday = (iso) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) / 86400000);

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

  const card = { background: 'var(--card, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 12, padding: 14, marginBottom: 12 };
  const inp = { padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)', background: 'var(--bg, #fff)', color: 'inherit', fontSize: 14, boxSizing: 'border-box' };
  const btn = { padding: '7px 13px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)', background: 'var(--card, #fff)', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
  const primary = { ...btn, background: 'var(--primary, #7c3aed)', color: '#fff', border: 'none' };
  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: 'var(--muted, #6b7280)', borderBottom: '1px solid var(--border, #e5e7eb)', whiteSpace: 'nowrap' };
  const td = { padding: '8px 10px', borderBottom: '1px solid var(--border, #f1f5f9)', fontSize: 14 };
  const muted = { color: 'var(--muted, #6b7280)', fontSize: 13 };

  const dueInfo = useMemo(() => {
    if (!d) return null;
    const n = daysFromToday(d.due_date);
    const done = d.status.filed_on && d.status.paid_on;
    if (done) return { text: 'Filed and paid', color: '#16a34a' };
    if (n < 0) return { text: `Overdue by ${-n} day${n === -1 ? '' : 's'}`, color: '#dc2626' };
    if (n === 0) return { text: 'Due today', color: '#b45309' };
    return { text: `Due in ${n} day${n === 1 ? '' : 's'}`, color: n <= 5 ? '#b45309' : '#16a34a' };
  }, [d]);

  if (migration) return <div style={card}>The tax helper needs migration 031 (031_mri_tax.sql) to be run on this database first.</div>;
  const bandMsg = d && ({
    below: [`This landlord's rent from homes is on track for ${kes(d.year.projected)} this year, below the ${kes(d.settings.lower_threshold)} limit, so MRI may not apply. Check with KRA.`, '#b45309'],
    above: [`Rent from homes is on track for ${kes(d.year.projected)} this year, above the ${kes(d.settings.upper_threshold)} limit. Above it, ordinary income tax applies instead of MRI. Check with KRA or an accountant.`, '#dc2626'],
    inside: [`Rent from homes is on track for ${kes(d.year.projected)} this year, inside the MRI band (${kes(d.settings.lower_threshold)} to ${kes(d.settings.upper_threshold)}).`, '#16a34a'],
  })[d.year.band];

  return (
    <div style={{ padding: 4 }}>
      <h2 style={{ marginTop: 0 }}>🧮 Rental income tax (KRA MRI)</h2>
      <div style={{ ...card, background: 'rgba(124,58,237,.06)', ...muted }}>
        A helper only. These figures come from the rent recorded in RentFlow and do not file anything with KRA. Check them before you submit the return and payment on KRA's system. MRI covers <b>homes</b>, not shops or offices, and the rate and limits below come from the saved tax settings; confirm they are current with KRA.
      </div>
      {msg.err && <div style={{ ...card, color: '#b91c1c' }}>{msg.err}</div>}
      {msg.ok && <div style={{ ...card, color: '#15803d' }}>{msg.ok}</div>}

      <div style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {landlords && landlords.length > 1 && <select style={inp} value={landlordId} onChange={e => setLandlordId(e.target.value)}>{landlords.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
        {landlords && landlords.length === 1 && <b>{landlords[0].name}</b>}
        <label style={muted}>Rent month <input style={inp} type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></label>
        <div style={{ flex: 1 }} />
        {d && <><button style={btn} onClick={copyFigures}>Copy figures</button><button style={btn} onClick={csv}>⬇ CSV</button><button style={primary} onClick={download}>⬇ PDF</button></>}
      </div>
      {landlords && landlords.length === 0 && <div style={card}>No landlords with properties you can see.</div>}

      {d && (<>
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Figures for {monthName(month)}</h3>
            <span style={{ color: dueInfo.color, fontWeight: 700 }}>{dueInfo.text}</span>
            <span style={muted}>· return and payment due {new Date(d.due_date).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>
          <table style={{ borderCollapse: 'collapse', marginTop: 8 }}><tbody>
            <tr><td style={td}>Gross monthly rental income (homes)</td><td style={{ ...td, fontWeight: 800, fontSize: 18 }}>{kes(d.gross)}</td></tr>
            <tr><td style={td}>Tax at {Number(d.settings.mri_rate)}%</td><td style={{ ...td, fontWeight: 800, fontSize: 18, color: '#7c3aed' }}>{kes(d.tax)}</td></tr>
            <tr><td style={td}>Number of properties with rent</td><td style={{ ...td, fontWeight: 700 }}>{d.property_count}</td></tr>
            <tr><td style={td}>KRA PIN</td><td style={{ ...td, fontWeight: 700 }}>{d.landlord.kra_pin || <span style={{ color: '#b45309' }}>not recorded</span>}</td></tr>
          </tbody></table>
          {d.commercial_excluded > 0 && <p style={{ ...muted, margin: '8px 0 0' }}>Not included: {kes(d.commercial_excluded)} of <b>commercial</b> rent (shops, offices, salons). MRI doesn't cover it; it is taxed under ordinary income tax. Ask KRA or an accountant.</p>}
          <p style={{ ...muted, margin: '6px 0 0' }}>Counts rent actually received in the month, including rent paid ahead. No deductions are allowed. Water bills and other utility payments are not rent and are left out.</p>
          {d.unmatched && <p style={{ ...muted, color: '#b45309' }}>{d.unmatched.count} payment{d.unmatched.count === 1 ? '' : 's'} totalling {kes(d.unmatched.total)} this month aren't matched to a unit yet, so they are not counted. Match them on the Payments page.</p>}
        </div>

        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Filed and paid?</h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={muted}>Return filed on<br /><input style={inp} type="date" value={st.filed_on} onChange={e => setSt({ ...st, filed_on: e.target.value })} /></label>
            <label style={muted}>Tax paid on<br /><input style={inp} type="date" value={st.paid_on} onChange={e => setSt({ ...st, paid_on: e.target.value })} /></label>
            <label style={muted}>KRA payment reference<br /><input style={inp} maxLength={60} value={st.reference} onChange={e => setSt({ ...st, reference: e.target.value })} /></label>
            <button style={primary} onClick={saveStatus}>Save</button>
          </div>
          {d.penalties.total > 0 && (
            <p style={{ color: '#b91c1c', fontSize: 14, marginBottom: 0 }}>
              Estimated penalties: <b>{kes(d.penalties.total)}</b>
              <span style={muted}> ({d.penalties.late_filing ? `late filing ${kes(d.penalties.filing)}` : ''}{d.penalties.late_filing && d.penalties.late_payment ? ', ' : ''}{d.penalties.late_payment ? `late payment ${kes(d.penalties.payment)} + interest ${kes(d.penalties.interest)} for ${d.penalties.months_late} month${d.penalties.months_late === 1 ? '' : 's'}` : ''}). An estimate only; KRA's own figure applies.</span>
            </p>)}
        </div>

        <div style={card}>
          <h3 style={{ marginTop: 0 }}>This year so far</h3>
          <div style={{ color: bandMsg[1], fontSize: 14, marginBottom: 8 }}>{bandMsg[0]}</div>
          <div style={muted}>Rent from homes, January to {monthName(month)}: <b>{kes(d.year.ytd)}</b></div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
            <thead><tr><th style={th}>Month</th><th style={th}>Homes (MRI)</th><th style={th}>Commercial</th><th style={th}>Tax</th></tr></thead>
            <tbody>{d.year.months.map(m => <tr key={m.month}><td style={td}>{monthName(m.month)}</td><td style={td}>{kes(m.residential)}</td><td style={td}>{kes(m.commercial)}</td><td style={td}>{kes(m.residential * Number(d.settings.mri_rate) / 100)}</td></tr>)}</tbody>
          </table>
        </div>

        <div style={card}>
          <h3 style={{ marginTop: 0 }}>By property, {monthName(month)}</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Property</th><th style={th}>Homes (counted)</th><th style={th}>Commercial (not counted)</th></tr></thead>
            <tbody>{d.properties.map(p => <tr key={p.plot_id}><td style={td}><b>{p.plot_name}</b></td><td style={td}>{kes(p.residential)}</td><td style={td}>{kes(p.commercial)}</td></tr>)}</tbody>
          </table>
        </div>

        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Which units count as homes?</h3>
          <p style={muted}>Only home rent is taxed under MRI. Units are sorted by their type (a Shop, Office or Saloon is commercial, a Bedsitter or Bedroom is a home). {d.can_edit ? 'You can set a whole property, or override a single unit.' : 'An admin can change these.'}</p>
          {d.plots.map(p => (
            <div key={p.id} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <b>{p.name}</b>
                {d.can_edit
                  ? <select style={inp} value={p.rental_use} onChange={e => setPlotUse(p.id, e.target.value)}><option value="mixed">Decide per unit</option><option value="residential">All homes</option><option value="commercial">All commercial</option></select>
                  : <span style={muted}>{({ mixed: 'decided per unit', residential: 'all homes', commercial: 'all commercial' })[p.rental_use]}</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                {d.units.filter(u => u.plot_id === p.id).map(u => (
                  <div key={u.id} title={u.reason} style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, padding: '4px 8px', fontSize: 13, background: u.use === 'residential' ? 'rgba(22,163,74,.08)' : 'rgba(180,83,9,.08)' }}>
                    <b>{u.unit_number}</b> <span style={muted}>{u.house_type || ''}</span>{' '}
                    {d.can_edit
                      ? <select style={{ ...inp, padding: '2px 4px', fontSize: 12 }} value={u.use_type || ''} onChange={e => setUnitUse(u.id, e.target.value)}><option value="">Auto ({u.use === 'residential' ? 'home' : 'commercial'})</option><option value="residential">Home</option><option value="commercial">Commercial</option></select>
                      : <span style={{ color: u.use === 'residential' ? '#16a34a' : '#b45309', fontWeight: 600 }}>{u.use === 'residential' ? 'home' : 'commercial'}</span>}
                  </div>))}
              </div>
            </div>))}
        </div>

        {d.can_pin && (
          <div style={card}>
            <h3 style={{ marginTop: 0 }}>KRA PIN</h3>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input style={{ ...inp, width: 160 }} placeholder="A123456789B" maxLength={11} value={pin} onChange={e => setPin(e.target.value.toUpperCase())} />
              <button style={primary} onClick={savePin}>Save PIN</button>
            </div>
          </div>)}

        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h3 style={{ margin: 0 }}>Tax settings</h3><div style={{ flex: 1 }} />
            {d.can_edit && !setForm && <button style={btn} onClick={() => setSetForm({ mri_rate: d.settings.mri_rate, lower_threshold: d.settings.lower_threshold, upper_threshold: d.settings.upper_threshold, due_day: d.settings.due_day, late_filing_min: d.settings.late_filing_min, late_filing_pct: d.settings.late_filing_pct, late_payment_pct: d.settings.late_payment_pct, late_interest_pct: d.settings.late_interest_pct })}>Change</button>}
          </div>
          {!setForm && <p style={muted}>Rate {Number(d.settings.mri_rate)}% · limits {kes(d.settings.lower_threshold)} to {kes(d.settings.upper_threshold)} a year · due on the {d.settings.due_day}th of the next month · late filing {kes(d.settings.late_filing_min)} or {Number(d.settings.late_filing_pct)}% · late payment {Number(d.settings.late_payment_pct)}% + {Number(d.settings.late_interest_pct)}% a month. KRA's rules change, so confirm these with KRA.</p>}
          {setForm && (<>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
              {[['mri_rate', 'Rate %'], ['lower_threshold', 'Lower limit (yearly)'], ['upper_threshold', 'Upper limit (yearly)'], ['due_day', 'Due day (1-28)'], ['late_filing_min', 'Late filing minimum'], ['late_filing_pct', 'Late filing %'], ['late_payment_pct', 'Late payment %'], ['late_interest_pct', 'Interest % a month']].map(([k, l]) => (
                <label key={k} style={muted}>{l}<br /><input style={{ ...inp, width: 130 }} type="number" step="any" value={setForm[k]} onChange={e => setSetForm({ ...setForm, [k]: e.target.value })} /></label>))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button style={primary} onClick={saveSettings}>Save settings</button><button style={btn} onClick={() => setSetForm(null)}>Cancel</button></div>
          </>)}
        </div>
      </>)}
    </div>
  );
}

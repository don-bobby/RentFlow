// Vendor directory: plumbers, electricians and other trades people, with how many jobs
// they have done for you and what you spent. Vendors are assigned to requests on the Maintenance page.
import { useEffect, useMemo, useState } from 'react';
import API from '../services/api';
import { IconInline } from '../components/Icon';

const TRADES = ['Plumber', 'Electrician', 'Painter', 'Carpenter', 'Mason', 'Cleaner', 'Welder', 'Security', 'Other'];
const kes = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const wa = (p) => { const d = String(p || '').replace(/\D/g, ''); return d ? `https://wa.me/${d.startsWith('0') ? '254' + d.slice(1) : d}` : null; };
const EMPTY = { name: '', trade: 'Plumber', phone: '', email: '', area: '', notes: '', rating: '', landlord_id: '' };

export default function Vendors() {
  const [rows, setRows] = useState(null);
  const [landlords, setLandlords] = useState([]);
  const [q, setQ] = useState('');
  const [trade, setTrade] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState(null);
  const [err, setErr] = useState('');
  const [migration, setMigration] = useState(false);

  const load = () => API.get('/vendors').then(r => {
    if (r.data.migration_needed) return setMigration(true);
    setRows(r.data.data); setLandlords(r.data.landlords || []);
  }).catch(e => setErr(e.response?.data?.error || 'Could not load vendors.'));
  useEffect(() => { load(); }, []);

  const trades = useMemo(() => [...new Set((rows || []).map(v => v.trade).filter(Boolean))].sort(), [rows]);
  const shown = useMemo(() => (rows || []).filter(v =>
    (showArchived || v.is_active) && (!trade || v.trade === trade) &&
    (!q.trim() || `${v.name} ${v.trade || ''} ${v.area || ''} ${v.phone || ''}`.toLowerCase().includes(q.trim().toLowerCase()))), [rows, q, trade, showArchived]);

  const save = async () => {
    setErr('');
    try {
      const body = { ...form, rating: form.rating || null };
      if (form.id) await API.put(`/vendors/${form.id}`, body); else await API.post('/vendors', body);
      setForm(null); load();
    } catch (e) { setErr(e.response?.data?.error || 'Could not save.'); }
  };
  const toggle = async (v) => { try { await API.put(`/vendors/${v.id}`, { is_active: !v.is_active }); load(); } catch (e) { setErr(e.response?.data?.error || 'Could not change.'); } };

  const card = { background: 'var(--card, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 14, padding: 16, marginBottom: 14 };
  const inp = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)', background: 'var(--bg, #fff)', color: 'inherit', fontSize: 14, boxSizing: 'border-box', width: '100%' };
  const btn = { padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)', background: 'var(--card, #fff)', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 600, textDecoration: 'none', display: 'inline-block' };
  const primary = { ...btn, background: 'var(--primary, #1b6b45)', color: '#fff', border: 'none' };
  const muted = { color: 'var(--muted, #6b7280)', fontSize: 13 };
  const lbl = { ...muted, display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px' };
  const canAdd = landlords.length > 0;

  if (migration) return <div style={card}>The vendor directory needs migration 032 (032_vendors.sql) to be run on this database first.</div>;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: 'Bricolage Grotesque', fontSize: 32, fontWeight: 700, letterSpacing: '-0.4px', margin: 0, color: 'var(--text)' }}><IconInline name="🔧" size={14} />Vendors</h1><div style={{ flex: 1 }} />
        {canAdd && !form && <button style={primary} onClick={() => setForm({ ...EMPTY, landlord_id: landlords[0].id })}>+ Add vendor</button>}
      </div>
      <p style={{ ...muted, marginTop: 4 }}>Trades people you use. Assign one to a request on the Maintenance page and their cost shows up here.</p>
      {err && <div style={{ ...card, color: '#b91c1c' }}>{err}</div>}

      {form && (
        <div style={card}>
          <b>{form.id ? 'Edit vendor' : 'New vendor'}</b>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
            <label style={lbl}>Name<input style={inp} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label style={lbl}>Trade<input style={inp} list="trades" value={form.trade || ''} onChange={e => setForm({ ...form, trade: e.target.value })} /><datalist id="trades">{TRADES.map(t => <option key={t} value={t} />)}</datalist></label>
            <label style={lbl}>Phone<input style={inp} value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
            <label style={lbl}>Email<input style={inp} value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
            <label style={lbl}>Area<input style={inp} value={form.area || ''} onChange={e => setForm({ ...form, area: e.target.value })} /></label>
            <label style={lbl}>Rating<select style={inp} value={form.rating || ''} onChange={e => setForm({ ...form, rating: e.target.value })}><option value="">Not rated</option>{[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{'★'.repeat(n)}</option>)}</select></label>
            {!form.id && landlords.length > 1 && <label style={lbl}>For landlord<select style={inp} value={form.landlord_id} onChange={e => setForm({ ...form, landlord_id: Number(e.target.value) })}>{landlords.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>}
            <label style={{ ...lbl, flex: '1 1 100%' }}>Notes<textarea style={{ ...inp, minHeight: 60 }} value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}><button style={primary} onClick={save}>Save</button><button style={btn} onClick={() => { setForm(null); setErr(''); }}>Cancel</button></div>
        </div>)}

      <div style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...inp, flex: '1 1 220px', width: 'auto' }} placeholder="Search name, trade, area or phone" value={q} onChange={e => setQ(e.target.value)} />
        <select style={{ ...inp, width: 'auto' }} value={trade} onChange={e => setTrade(e.target.value)}><option value="">All trades</option>{trades.map(t => <option key={t}>{t}</option>)}</select>
        <label style={{ ...muted, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />Show archived</label>
      </div>

      {rows === null && !err && <div style={muted}>Loading…</div>}
      {rows && shown.length === 0 && <div style={card}>No vendors yet.{canAdd ? ' Use "Add vendor" to start your list.' : ''}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {shown.map(v => (
          <div key={v.id} style={{ ...card, marginBottom: 0, opacity: v.is_active ? 1 : .6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div><b style={{ fontSize: 16 }}>{v.name}</b><div style={muted}>{[v.trade, v.area].filter(Boolean).join(' · ') || '—'}</div></div>
              {v.rating && <span style={{ color: '#f59e0b', whiteSpace: 'nowrap' }}>{'★'.repeat(v.rating)}</span>}
            </div>
            <div style={{ ...muted, marginTop: 8 }}>{v.jobs} job{v.jobs === 1 ? '' : 's'} ({v.completed} done) · spent {kes(v.spent)}</div>
            {rows.some(r => r.landlord_id !== v.landlord_id) && <div style={muted}>For {v.landlord_name}</div>}
            {v.notes && <div style={{ ...muted, marginTop: 6 }}>{v.notes}</div>}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {v.phone && <a style={btn} href={`tel:${v.phone}`}>Call</a>}
              {wa(v.phone) && <a style={btn} href={wa(v.phone)} target="_blank" rel="noreferrer">WhatsApp</a>}
              {v.can_edit && <button style={btn} onClick={() => setForm({ ...v, rating: v.rating || '' })}>Edit</button>}
              {v.can_edit && <button style={btn} onClick={() => toggle(v)}>{v.is_active ? 'Archive' : 'Restore'}</button>}
            </div>
          </div>))}
      </div>
    </div>
  );
}

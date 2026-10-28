// Admin-only: post Airbnb-style stays and properties for sale to the public
// listings page. Rentals still come from vacant units; this is for the rest.
import { useCallback, useEffect, useRef, useState } from 'react';
import API from '../services/api';
import { priceText } from '../components/SpecialCard';

const EMPTY = { kind: 'stay', title: '', description: '', price: '', price_unit: 'night', location: '', lat: '', lng: '', bedrooms: '', bathrooms: '', contact_phone: '', status: 'active' };
const STATUS = { active: ['Live', '#16a34a'], hidden: ['Hidden', '#6b7280'], closed: ['Closed', '#b45309'] };

async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
}

export default function Specials() {
  const [items, setItems] = useState([]);
  const [max, setMax] = useState(12);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);          // null = closed; {id?, ...fields}
  const [photos, setPhotos] = useState([]);        // photo ids of the listing being edited
  const [urls, setUrls] = useState({});            // photoId -> blob url (admin previews need the token)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);
  const urlsRef = useRef({});

  const load = useCallback(async () => {
    try { const r = await API.get('/specials/admin'); setItems(r.data.data); setMax(r.data.max_photos || 12); setErr(''); }
    catch (e) { setErr(e.response?.data?.error || 'Could not load. Has migration 024 been run?'); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => Object.values(urlsRef.current).forEach(u => URL.revokeObjectURL(u)), []);

  const ensureUrls = useCallback(async (ids) => {
    for (const id of ids) {
      if (urlsRef.current[id]) continue;
      try {
        const r = await API.get(`/specials/admin/photo/${id}`, { responseType: 'blob' });
        urlsRef.current[id] = URL.createObjectURL(r.data);
        setUrls({ ...urlsRef.current });
      } catch { /* preview just stays blank */ }
    }
  }, []);
  useEffect(() => { items.forEach(i => ensureUrls(i.photos.slice(0, 1))); }, [items, ensureUrls]);

  const open = (it) => {
    setErr('');
    if (it) { setForm({ ...EMPTY, ...Object.fromEntries(Object.entries(it).map(([k, v]) => [k, v ?? ''])) }); setPhotos(it.photos); ensureUrls(it.photos); }
    else { setForm({ ...EMPTY }); setPhotos([]); }
  };
  const set = (k, v) => setForm(f => ({ ...f, [k]: v, ...(k === 'kind' ? { price_unit: v === 'sale' ? 'total' : 'night' } : {}) }));

  const save = async () => {
    setBusy(true); setErr('');
    try {
      let id = form.id;
      if (id) await API.put(`/specials/admin/${id}`, form);
      else { const r = await API.post('/specials/admin', form); id = r.data.id; setForm(f => ({ ...f, id })); }
      await load();
      if (!form.id) { setPhotos([]); }   // new listing stays open so photos can be added now
      if (form.id) setForm(null);
    } catch (e) { setErr(e.response?.data?.error || 'Could not save.'); }
    setBusy(false);
  };
  const addPhoto = async (file) => {
    if (!file || !form?.id) return;
    setBusy(true); setErr('');
    try {
      const blob = await shrink(file); const fd = new FormData(); fd.append('file', blob, 'photo.jpg');
      const r = await API.post(`/specials/admin/${form.id}/photos`, fd);
      setPhotos(p => [...p, r.data.id]); ensureUrls([r.data.id]); load();
    } catch (e) { setErr(e.response?.data?.error || 'Photo upload failed.'); }
    setBusy(false); if (fileRef.current) fileRef.current.value = '';
  };
  const delPhoto = async (pid) => { try { await API.delete(`/specials/admin/photos/${pid}`); setPhotos(p => p.filter(x => x !== pid)); load(); } catch (e) { setErr(e.response?.data?.error || 'Could not delete.'); } };
  const cover = async (pid) => { try { await API.put(`/specials/admin/${form.id}/cover/${pid}`); setPhotos(p => [pid, ...p.filter(x => x !== pid)]); load(); } catch (e) { setErr(e.response?.data?.error || 'Could not change.'); } };
  const del = async (it) => { if (!window.confirm(`Delete "${it.title}" and its photos?`)) return; try { await API.delete(`/specials/admin/${it.id}`); load(); } catch (e) { setErr(e.response?.data?.error || 'Could not delete.'); } };
  const quick = async (it, status) => { try { await API.put(`/specials/admin/${it.id}`, { ...it, status }); load(); } catch (e) { setErr(e.response?.data?.error || 'Could not update.'); } };

  const card = { background: 'var(--card, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 12, padding: 16 };
  const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)', background: 'var(--bg, #fff)', color: 'inherit', fontSize: 14, boxSizing: 'border-box' };
  const btn = { padding: '7px 13px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)', background: 'var(--card, #fff)', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
  const primary = { ...btn, background: 'var(--primary, #7c3aed)', color: '#fff', border: 'none' };
  const lab = { fontSize: 12, fontWeight: 700, color: 'var(--muted, #6b7280)', marginBottom: 3, display: 'block' };

  return (
    <div style={{ padding: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>⭐ Specials</h2>
        <span style={{ color: 'var(--muted, #6b7280)', fontSize: 13 }}>Airbnb stays and properties for sale, shown on the public listings page. Only admins can post here.</span>
        <div style={{ flex: 1 }} />
        <button style={primary} onClick={() => open(null)}>＋ New special</button>
      </div>
      {err && !form && <div style={{ ...card, color: '#b91c1c', marginBottom: 12 }}>{err}</div>}
      {loading && <div>Loading…</div>}
      {!loading && !items.length && !err && <div style={{ ...card, color: 'var(--muted, #6b7280)' }}>Nothing posted yet. Tap “New special” to add a stay or a property for sale.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
        {items.map(it => (
          <div key={it.id} style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ aspectRatio: '16/9', background: '#1f2937', display: 'grid', placeItems: 'center', fontSize: 34 }}>
              {it.photos[0] && urls[it.photos[0]] ? <img src={urls[it.photos[0]]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (it.kind === 'sale' ? '🏡' : '🏖️')}
            </div>
            <div style={{ padding: 12 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                <b style={{ flex: 1 }}>{it.title}</b>
                <span style={{ fontSize: 11, fontWeight: 700, color: STATUS[it.status][1] }}>● {STATUS[it.status][0]}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted, #6b7280)' }}>{it.kind === 'sale' ? 'For sale' : 'Stay'} · {priceText(it)} · {it.photos.length} photo{it.photos.length === 1 ? '' : 's'}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                <button style={btn} onClick={() => open(it)}>Edit</button>
                {it.status === 'active'
                  ? <button style={btn} onClick={() => quick(it, 'hidden')}>Hide</button>
                  : <button style={btn} onClick={() => quick(it, 'active')}>Publish</button>}
                {it.status !== 'closed' && <button style={btn} onClick={() => quick(it, 'closed')}>{it.kind === 'sale' ? 'Mark sold' : 'Mark booked'}</button>}
                <button style={{ ...btn, color: '#b91c1c' }} onClick={() => del(it)}>Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {form && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 2000, display: 'grid', placeItems: 'center', padding: 12 }} onClick={() => setForm(null)}>
          <div style={{ ...card, width: 'min(640px, 100%)', maxHeight: '92vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{form.id ? 'Edit special' : 'New special'}</h3>
            {err && <div style={{ color: '#b91c1c', marginBottom: 10, fontSize: 13 }}>{err}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label><span style={lab}>Type</span><select style={inp} value={form.kind} onChange={e => set('kind', e.target.value)}><option value="stay">Airbnb / short stay</option><option value="sale">Property for sale</option></select></label>
              <label><span style={lab}>Status</span><select style={inp} value={form.status} onChange={e => set('status', e.target.value)}><option value="active">Live (public)</option><option value="hidden">Hidden</option><option value="closed">Closed (sold / booked)</option></select></label>
              <label style={{ gridColumn: '1 / -1' }}><span style={lab}>Title</span><input style={inp} value={form.title} maxLength={120} onChange={e => set('title', e.target.value)} placeholder="e.g. Cosy 1BR in Kilimani" /></label>
              <label><span style={lab}>{form.kind === 'sale' ? 'Asking price (KES)' : 'Price (KES)'}</span><input style={inp} type="number" min="0" value={form.price} onChange={e => set('price', e.target.value)} /></label>
              {form.kind === 'stay'
                ? <label><span style={lab}>Per</span><select style={inp} value={form.price_unit} onChange={e => set('price_unit', e.target.value)}><option value="night">night</option><option value="month">month</option></select></label>
                : <div />}
              <label style={{ gridColumn: '1 / -1' }}><span style={lab}>Location (area / address)</span><input style={inp} value={form.location} onChange={e => set('location', e.target.value)} placeholder="Kilimani, Nairobi" /></label>
              <label><span style={lab}>Latitude (for exact directions)</span><input style={inp} value={form.lat} onChange={e => set('lat', e.target.value)} placeholder="-1.2921" /></label>
              <label><span style={lab}>Longitude</span><input style={inp} value={form.lng} onChange={e => set('lng', e.target.value)} placeholder="36.8219" /></label>
              <label><span style={lab}>Bedrooms</span><input style={inp} type="number" min="0" max="50" value={form.bedrooms} onChange={e => set('bedrooms', e.target.value)} /></label>
              <label><span style={lab}>Bathrooms</span><input style={inp} type="number" min="0" max="50" value={form.bathrooms} onChange={e => set('bathrooms', e.target.value)} /></label>
              <label style={{ gridColumn: '1 / -1' }}><span style={lab}>Contact phone (WhatsApp / call buttons)</span><input style={inp} value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} placeholder="0712 345 678" /></label>
              <label style={{ gridColumn: '1 / -1' }}><span style={lab}>Description</span><textarea style={{ ...inp, minHeight: 90 }} value={form.description} maxLength={4000} onChange={e => set('description', e.target.value)} /></label>
            </div>
            <div style={{ marginTop: 12 }}>
              <span style={lab}>Photos {form.id ? `(${photos.length}/${max}) — the first one is the cover` : ''}</span>
              {!form.id && <div style={{ fontSize: 13, color: 'var(--muted, #6b7280)' }}>Save first, then you can add photos.</div>}
              {form.id && <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '6px 0' }}>
                  {photos.map((pid, ix) => (
                    <div key={pid} style={{ width: 86, textAlign: 'center' }}>
                      <div style={{ width: 86, height: 64, background: '#1f2937', borderRadius: 8, overflow: 'hidden' }}>{urls[pid] && <img src={urls[pid]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</div>
                      <div style={{ display: 'flex', gap: 2, justifyContent: 'center', marginTop: 3 }}>
                        {ix > 0 && <button style={{ ...btn, padding: '1px 6px', fontSize: 11 }} onClick={() => cover(pid)}>Cover</button>}
                        <button style={{ ...btn, padding: '1px 6px', fontSize: 11, color: '#b91c1c' }} onClick={() => delPhoto(pid)}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={e => addPhoto(e.target.files[0])} />
                <button style={btn} disabled={busy || photos.length >= max} onClick={() => fileRef.current?.click()}>＋ Add photo</button>
              </>}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button style={btn} onClick={() => setForm(null)}>{form.id ? 'Close' : 'Cancel'}</button>
              <button style={primary} disabled={busy} onClick={save}>{busy ? 'Saving…' : (form.id ? 'Save changes' : 'Create & add photos')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

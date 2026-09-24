import { useState, useEffect } from 'react';
import API from '../services/api';

const BASE = (process.env.REACT_APP_API_URL || 'http://localhost:5000/api').replace('/api', '');

export default function Listings() {
  const [plots,      setPlots]      = useState([]);
  const [houses,     setHouses]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState('all');    // all | listed | hidden | occupied
  const [search,     setSearch]     = useState('');
  const [mediaUnit,  setMediaUnit]  = useState(null);
  const [media,      setMedia]      = useState([]);
  const [uploading,  setUploading]  = useState(false);
  const [mediaErr,   setMediaErr]   = useState('');
  const [descUnit,   setDescUnit]   = useState(null);
  const [descText,   setDescText]   = useState('');
  const [descSaving, setDescSaving] = useState(false);
  const [descMsg,    setDescMsg]    = useState('');

  async function load() {
    setLoading(true);
    try {
      const [pr, hr] = await Promise.all([API.get('/plots'), API.get('/houses')]);
      setPlots(Array.isArray(pr.data) ? pr.data : (pr.data.data || []));
      setHouses(Array.isArray(hr.data) ? hr.data : (hr.data.data || []));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  // ── Filtering ────────────────────────────────────────────────────────────────
  const filtered = houses.filter(h => {
    const matchSearch = search === '' ||
      h.unit_number?.toLowerCase().includes(search.toLowerCase()) ||
      plots.find(p => p.id === h.plot_id)?.name?.toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filter === 'all'      ? true :
      filter === 'listed'   ? (h.status === 'vacant' && h.listed !== false) :
      filter === 'hidden'   ? (h.status === 'vacant' && h.listed === false) :
      filter === 'occupied' ? h.status === 'occupied' : true;
    return matchSearch && matchFilter;
  });

  // Group by plot
  const grouped = {};
  for (const h of filtered) {
    const plot = plots.find(p => p.id === h.plot_id);
    const key  = plot?.id || 'unknown';
    if (!grouped[key]) grouped[key] = { plot, units: [] };
    grouped[key].units.push(h);
  }

  // ── Toggle listed ─────────────────────────────────────────────────────────
  async function toggleListed(house) {
    try {
      const res = await API.patch(`/listings/toggle/${house.id}`);
      setHouses(hs => hs.map(h => h.id === house.id ? { ...h, listed: res.data.listed } : h));
    } catch { /* silent */ }
  }

  // ── Media ────────────────────────────────────────────────────────────────
  async function openMedia(house) {
    setMediaUnit(house); setMediaErr('');
    try {
      const res = await API.get(`/listings/media/${house.id}`);
      setMedia(res.data.data || []);
    } catch { setMedia([]); }
  }

  async function handleUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length || !mediaUnit) return;
    setUploading(true); setMediaErr('');
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    try {
      const res = await fetch(`${process.env.REACT_APP_API_URL || 'http://localhost:5000/api'}/listings/media/${mediaUnit.id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: formData,
      });
      const data = await res.json();
      if (data.success) setMedia(m => [...m, ...data.data]);
      else setMediaErr(data.error || 'Upload failed');
    } catch { setMediaErr('Upload failed. Please try again.'); }
    finally { setUploading(false); e.target.value = ''; }
  }

  async function deleteMedia(id) {
    try {
      await API.delete(`/listings/media/${id}`);
      setMedia(m => m.filter(x => x.id !== id));
    } catch { setMediaErr('Failed to delete.'); }
  }

  // ── Description ──────────────────────────────────────────────────────────
  async function openDesc(house) {
    setDescUnit(house);
    setDescText(house.description || '');
    setDescMsg('');
  }

  async function saveDesc() {
    if (!descUnit) return;
    setDescSaving(true); setDescMsg('');
    try {
      await API.patch(`/houses/${descUnit.id}/description`, { description: descText });
      setHouses(hs => hs.map(h => h.id === descUnit.id ? { ...h, description: descText } : h));
      setDescMsg('Saved!');
      setTimeout(() => setDescMsg(''), 2000);
    } catch { setDescMsg('Failed to save.'); }
    finally { setDescSaving(false); }
  }

  // ── Stats ────────────────────────────────────────────────────────────────
  const totalVacant   = houses.filter(h => h.status === 'vacant').length;
  const totalListed   = houses.filter(h => h.status === 'vacant' && h.listed !== false).length;
  const totalHidden   = houses.filter(h => h.status === 'vacant' && h.listed === false).length;
  const totalOccupied = houses.filter(h => h.status === 'occupied').length;

  const filterTabs = [
    { key: 'all',      label: 'All Units',   count: houses.length,  color: 'var(--primary)' },
    { key: 'listed',   label: '🌐 Listed',   count: totalListed,    color: 'var(--green)' },
    { key: 'hidden',   label: '👁️ Hidden',   count: totalHidden,    color: 'var(--amber)' },
    { key: 'occupied', label: '🔒 Occupied', count: totalOccupied,  color: 'var(--muted)' },
  ];

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Listings</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>Manage what appears on your public listings page</p>
        </div>
        <a href="/listings" target="_blank" rel="noreferrer"
          style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--primary)', fontWeight: 600, fontSize: 14, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
          🔗 View Public Page
        </a>
      </div>

      {/* ── Stats row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Total Vacant',  value: totalVacant,   color: 'var(--primary)', bg: 'var(--primary-light)' },
          { label: 'Listed',        value: totalListed,   color: 'var(--green)',   bg: 'var(--green-light)' },
          { label: 'Hidden',        value: totalHidden,   color: 'var(--amber)',   bg: 'var(--amber-light)' },
          { label: 'Occupied',      value: totalOccupied, color: 'var(--muted)',   bg: 'var(--surface2)' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', boxShadow: 'var(--shadow)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontFamily: 'Space Grotesk', fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── Filter tabs + search ── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        {filterTabs.map(t => (
          <button key={t.key} onClick={() => setFilter(t.key)} style={{
            padding: '7px 14px', borderRadius: 99, border: `1px solid ${filter === t.key ? t.color : 'var(--border)'}`,
            background: filter === t.key ? t.color : 'var(--surface)',
            color: filter === t.key ? '#fff' : 'var(--muted)',
            fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center',
          }}>
            {t.label}
            <span style={{ background: 'rgba(255,255,255,0.25)', borderRadius: 99, padding: '1px 7px', fontSize: 11 }}>{t.count}</span>
          </button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by unit or property..."
          style={{ marginLeft: 'auto', padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 13, color: 'var(--text)', outline: 'none', width: 240 }} />
      </div>

      {/* ── Property groups ── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading...</div>
      ) : Object.keys(grouped).length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>No units match this filter.</div>
      ) : (
        Object.values(grouped).map(({ plot, units }) => (
          <div key={plot?.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, marginBottom: 20, overflow: 'hidden', boxShadow: 'var(--shadow)' }}>

            {/* Plot header */}
            <div style={{ padding: '14px 20px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>🏢</span>
              <div>
                <span style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 15 }}>{plot?.name}</span>
                {plot?.location && <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 8 }}>📍 {plot.location}</span>}
              </div>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{units.length} unit{units.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Unit rows */}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  {['Unit', 'Type', 'Rent', 'Deposit', 'Status', 'Description', 'Media', 'Listing'].map(h => (
                    <th key={h} style={{ padding: '9px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {units.map((house, i) => {
                  const isVacant  = house.status === 'vacant';
                  const isListed  = isVacant && house.listed !== false;
                  const isHidden  = isVacant && house.listed === false;

                  return (
                    <tr key={house.id} style={{ borderTop: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>

                      <td style={{ padding: '12px 16px', fontWeight: 700, fontSize: 14 }}>
                        {house.unit_number}
                      </td>

                      <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--muted)' }}>
                        {house.house_type || '—'}
                      </td>

                      <td style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13 }}>
                        KES {parseFloat(house.rent_amount || 0).toLocaleString()}
                      </td>

                      <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--muted)' }}>
                        {house.deposit > 0 ? `KES ${parseFloat(house.deposit).toLocaleString()}` : '—'}
                      </td>

                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600,
                          background: isListed ? 'var(--green-light)' : isHidden ? 'var(--amber-light)' : 'var(--surface2)',
                          color: isListed ? 'var(--green)' : isHidden ? 'var(--amber)' : 'var(--muted)',
                        }}>
                          {isListed ? '🌐 Listed' : isHidden ? '👁️ Hidden' : '🔒 Occupied'}
                        </span>
                      </td>

                      <td style={{ padding: '12px 16px' }}>
                        <button onClick={() => openDesc(house)}
                          style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', background: house.description ? 'var(--primary-light)' : 'var(--surface2)', color: house.description ? 'var(--primary)' : 'var(--muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          {house.description ? '✏️ Edit' : '+ Add'}
                        </button>
                      </td>

                      <td style={{ padding: '12px 16px' }}>
                        <button onClick={() => openMedia(house)}
                          style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          📷 Media
                        </button>
                      </td>

                      <td style={{ padding: '12px 16px' }}>
                        {isVacant ? (
                          <button onClick={() => toggleListed(house)} style={{
                            padding: '5px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            border: `1px solid ${isListed ? 'var(--green)' : 'var(--amber)'}`,
                            background: isListed ? 'var(--green-light)' : 'var(--amber-light)',
                            color: isListed ? 'var(--green)' : 'var(--amber)',
                          }}>
                            {isListed ? 'Hide' : 'List'}
                          </button>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}

      {/* ── Description Modal ── */}
      {descUnit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, width: '100%', maxWidth: 500, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 16, margin: 0 }}>
                📝 Description — Unit {descUnit.unit_number}
              </h3>
              <button onClick={() => setDescUnit(null)} style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'var(--surface2)', cursor: 'pointer', fontSize: 16, color: 'var(--muted)' }}>×</button>
            </div>
            <div style={{ padding: 22 }}>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
                This description will appear on the public listings page under this unit.
              </p>
              <textarea
                value={descText}
                onChange={e => setDescText(e.target.value)}
                placeholder="e.g. Spacious bedsitter on the ground floor with natural lighting, a built-in wardrobe, and a private bathroom. Water included in rent."
                rows={5}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 14, color: 'var(--text)', resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.6 }}
              />
              {descMsg && (
                <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: descMsg === 'Saved!' ? 'var(--green)' : 'var(--red)' }}>{descMsg}</div>
              )}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                <button onClick={() => setDescUnit(null)} style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: 'var(--text)' }}>Cancel</button>
                <button onClick={saveDesc} disabled={descSaving} style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  {descSaving ? 'Saving...' : 'Save Description'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Media Modal ── */}
      {mediaUnit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, width: '100%', maxWidth: 620, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div>
                <h3 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 16, margin: 0 }}>📷 Media — Unit {mediaUnit.unit_number}</h3>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>Photos and videos shown on the public listings page</p>
              </div>
              <button onClick={() => setMediaUnit(null)} style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'var(--surface2)', cursor: 'pointer', fontSize: 16, color: 'var(--muted)' }}>×</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: 22 }}>
              {mediaErr && <div style={{ background: 'var(--red-light)', color: 'var(--red)', padding: '9px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{mediaErr}</div>}

              {/* Upload area */}
              <label style={{ display: 'block', border: '2px dashed var(--border)', borderRadius: 12, padding: '24px', textAlign: 'center', cursor: 'pointer', marginBottom: 20, background: 'var(--surface2)', transition: 'border-color 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--primary)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                <input type="file" multiple accept="image/*,video/mp4,video/mov,video/webm" onChange={handleUpload} style={{ display: 'none' }} />
                <div style={{ fontSize: 28, marginBottom: 8 }}>{uploading ? '⏳' : '📁'}</div>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>
                  {uploading ? 'Uploading...' : 'Click to upload photos or videos'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>JPG, PNG, WEBP, MP4, MOV — up to 100MB each</div>
              </label>

              {/* Grid */}
              {media.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px 0', fontSize: 14 }}>No media yet — upload the first photo or video above.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
                  {media.map(m => (
                    <div key={m.id} style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: '#000', aspectRatio: '4/3' }}>
                      {m.media_type === 'video'
                        ? <video src={`${BASE}${m.url}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <img src={`${BASE}${m.url}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                      <div style={{ position: 'absolute', inset: 0 }}>
                        <button onClick={() => deleteMedia(m.id)} style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(239,68,68,0.85)', color: '#fff', border: 'none', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                        <span style={{ position: 'absolute', bottom: 6, left: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>{m.media_type === 'video' ? '🎬' : '📷'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

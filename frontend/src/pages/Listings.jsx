import { useState, useEffect } from 'react';
import API from '../services/api';

const BASE = (process.env.REACT_APP_API_URL || 'http://localhost:5000/api').replace('/api', '');

// ── Theme-safe colours ───────────────────────────────────────────────────────
// Same token system as Reports.jsx, for visual consistency across the app.
// Raw var(--green)/var(--blue)/etc. vanish or turn dark on a dark background;
// these scoped --ls-* tones stay legible in both themes.
const STYLES = `
.ls-page {
  --ls-text: var(--text, #0f172a);
  --ls-muted: var(--muted, #64748b);
  --ls-surface: var(--surface, #ffffff);
  --ls-surface2: var(--surface2, #f1f5f9);
  --ls-border: var(--border, #e2e8f0);
  --ls-accent: var(--primary, #7c3aed);
  --ls-primary: #7c3aed; --ls-green: #15803d; --ls-red: #dc2626; --ls-blue: #2563eb; --ls-amber: #b45309;
  --ls-shadow: 0 1px 2px rgba(15,23,42,.04), 0 6px 20px rgba(15,23,42,.06);
  color: var(--ls-text);
}
:root[data-theme="dark"] .ls-page {
  --ls-text: var(--text, #e8eaf6);
  --ls-muted: var(--muted, #8b91b0);
  --ls-surface: var(--surface, #1a1d27);
  --ls-surface2: var(--surface2, #21253a);
  --ls-border: var(--border, #2a2f45);
  --ls-primary: #a78bfa; --ls-green: #4ade80; --ls-red: #f87171; --ls-blue: #60a5fa; --ls-amber: #fbbf24;
  --ls-shadow: 0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.35);
}
.ls-page * { box-sizing: border-box; }
.ls-page button { font-family: inherit; cursor: pointer; }
.ls-page button:focus-visible, .ls-page input:focus-visible { outline: 2px solid var(--ls-accent); outline-offset: 2px; }

.ls-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 22px; flex-wrap: wrap; }
.ls-title { font-family: 'Space Grotesk', sans-serif; font-size: 28px; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 4px; color: var(--ls-text); }
.ls-sub { margin: 0; font-size: 14px; color: var(--ls-muted); }

.ls-card { background: var(--ls-surface); border: 1px solid var(--ls-border); border-radius: 16px; box-shadow: var(--ls-shadow); }

.ls-btn { display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--ls-border); background: var(--ls-surface); color: var(--ls-text); font-weight: 600; font-size: 13px; text-decoration: none; transition: background .15s; }
.ls-btn:hover { background: var(--ls-surface2); }
.ls-btn-primary { border-color: transparent; background: var(--ls-accent); color: #fff; }
.ls-btn-primary:hover { background: var(--ls-accent); filter: brightness(1.08); }
.ls-btn:disabled { opacity: .55; cursor: default; }

/* KPI summary cards — same pattern as Reports' .rp-kpi */
.ls-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 20px; }
.ls-kpi { position: relative; overflow: hidden; padding: 14px 18px 14px 20px; }
.ls-kpi::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--ls-tone); }
.ls-kpi-label { font-size: 12.5px; color: var(--ls-muted); text-transform: uppercase; letter-spacing: .4px; margin-bottom: 4px; }
.ls-kpi-value { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 26px; line-height: 1.2; color: var(--ls-tone); }

/* Filter tabs + search */
.ls-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 20px; flex-wrap: wrap; }
.ls-tab { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 99px; border: 1px solid var(--ls-border); background: var(--ls-surface); color: var(--ls-muted); font-weight: 600; font-size: 13px; transition: background .15s, border-color .15s, color .15s; }
.ls-tab:hover { background: var(--ls-surface2); }
.ls-tab.on { border-color: var(--ls-tone); background: var(--ls-tone); color: #fff; }
.ls-tab-count { background: rgba(255,255,255,0.25); border-radius: 99px; padding: 1px 7px; font-size: 11px; }
.ls-tab:not(.on) .ls-tab-count { background: var(--ls-surface2); color: var(--ls-muted); }
.ls-search { margin-left: auto; padding: 8px 14px; border-radius: 10px; border: 1px solid var(--ls-border); background: var(--ls-surface2); font-size: 13px; color: var(--ls-text); outline: none; width: 240px; }
.ls-search::placeholder { color: var(--ls-muted); }

/* Plot group + table */
.ls-plot { margin-bottom: 20px; overflow: hidden; }
.ls-plot-head { padding: 14px 20px; background: var(--ls-surface2); border-bottom: 1px solid var(--ls-border); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ls-plot-ico { font-size: 18px; }
.ls-plot-name { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 15px; color: var(--ls-text); }
.ls-plot-loc { color: var(--ls-muted); font-size: 12px; margin-left: 8px; }
.ls-plot-count { margin-left: auto; font-size: 12px; color: var(--ls-muted); }

.ls-scroll { overflow-x: auto; }
.ls-table { width: 100%; border-collapse: collapse; min-width: 720px; }
.ls-table th { padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 600; color: var(--ls-muted); text-transform: uppercase; letter-spacing: .4px; white-space: nowrap; background: var(--ls-surface2); }
.ls-table td { padding: 12px 16px; font-size: 13px; color: var(--ls-text); white-space: nowrap; border-top: 1px solid var(--ls-border); }
.ls-table tbody tr:nth-child(even) { background: color-mix(in srgb, var(--ls-surface2) 55%, transparent); }
.ls-table tbody tr:hover { background: color-mix(in srgb, var(--ls-accent) 9%, transparent); }
.ls-unit { font-weight: 700; font-size: 14px; }
.ls-money { font-weight: 600; }

.ls-badge { display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 12px; font-weight: 600; }
.ls-badge-green { background: color-mix(in srgb, var(--ls-green) 16%, transparent); color: var(--ls-green); }
.ls-badge-amber { background: color-mix(in srgb, var(--ls-amber) 18%, transparent); color: var(--ls-amber); }
.ls-badge-muted { background: var(--ls-surface2); color: var(--ls-muted); }

.ls-mini { padding: 5px 12px; border-radius: 8px; border: 1px solid var(--ls-border); background: var(--ls-surface2); color: var(--ls-muted); font-size: 12px; font-weight: 600; }
.ls-mini.has-value { background: color-mix(in srgb, var(--ls-primary) 14%, transparent); color: var(--ls-primary); border-color: transparent; }
.ls-toggle { padding: 5px 14px; border-radius: 8px; font-size: 12px; font-weight: 600; border: 1px solid var(--ls-tone); background: color-mix(in srgb, var(--ls-tone) 14%, transparent); color: var(--ls-tone); }

.ls-state { text-align: center; padding: 60px 20px; color: var(--ls-muted); font-size: 14px; }

/* Modals */
.ls-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
.ls-modal-head { padding: 16px 22px; border-bottom: 1px solid var(--ls-border); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
.ls-modal-title { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 16px; margin: 0; color: var(--ls-text); }
.ls-modal-close { width: 30px; height: 30px; border-radius: 50%; border: none; background: var(--ls-surface2); cursor: pointer; font-size: 16px; color: var(--ls-muted); flex-shrink: 0; }

@media (max-width: 640px) {
  .ls-title { font-size: 24px; }
  .ls-search { width: 100%; margin-left: 0; order: 10; }
  .ls-kpis { grid-template-columns: repeat(2, 1fr); }
}
@media (prefers-reduced-motion: reduce) { .ls-tab, .ls-btn { transition: none; } }
`;

// Maps a semantic color name to the --ls-tone custom property a card/tab/badge reads.
const toneVar = (name) => ({
  primary: 'var(--ls-primary)', green: 'var(--ls-green)', amber: 'var(--ls-amber)', muted: 'var(--ls-muted)',
}[name] || 'var(--ls-primary)');

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

  const kpis = [
    { label: 'Total Vacant', value: totalVacant,   tone: 'primary' },
    { label: 'Listed',       value: totalListed,   tone: 'green' },
    { label: 'Hidden',       value: totalHidden,   tone: 'amber' },
    { label: 'Occupied',     value: totalOccupied, tone: 'muted' },
  ];

  const filterTabs = [
    { key: 'all',      label: 'All Units',   count: houses.length,  tone: 'primary' },
    { key: 'listed',   label: '🌐 Listed',   count: totalListed,    tone: 'green' },
    { key: 'hidden',   label: '👁️ Hidden',   count: totalHidden,    tone: 'amber' },
    { key: 'occupied', label: '🔒 Occupied', count: totalOccupied,  tone: 'muted' },
  ];

  return (
    <div className="ls-page">
      <style>{STYLES}</style>

      {/* ── Header ── */}
      <div className="ls-head">
        <div>
          <h1 className="ls-title">Listings</h1>
          <p className="ls-sub">Manage what appears on your public listings page</p>
        </div>
        <a href="/listings" target="_blank" rel="noreferrer" className="ls-btn">
          🔗 View Public Page
        </a>
      </div>

      {/* ── Stats row ── */}
      <div className="ls-kpis">
        {kpis.map(k => (
          <div key={k.label} className="ls-card ls-kpi" style={{ '--ls-tone': toneVar(k.tone) }}>
            <div className="ls-kpi-label">{k.label}</div>
            <div className="ls-kpi-value">{k.value}</div>
          </div>
        ))}
      </div>

      {/* ── Filter tabs + search ── */}
      <div className="ls-toolbar">
        {filterTabs.map(t => (
          <button key={t.key} onClick={() => setFilter(t.key)}
            className={`ls-tab${filter === t.key ? ' on' : ''}`}
            style={{ '--ls-tone': toneVar(t.tone) }}>
            {t.label}
            <span className="ls-tab-count">{t.count}</span>
          </button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by unit or property..." className="ls-search" />
      </div>

      {/* ── Property groups ── */}
      {loading ? (
        <div className="ls-state">Loading...</div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="ls-state">No units match this filter.</div>
      ) : (
        Object.values(grouped).map(({ plot, units }) => (
          <div key={plot?.id} className="ls-card ls-plot">

            {/* Plot header */}
            <div className="ls-plot-head">
              <span className="ls-plot-ico">🏢</span>
              <div>
                <span className="ls-plot-name">{plot?.name}</span>
                {plot?.location && <span className="ls-plot-loc">📍 {plot.location}</span>}
              </div>
              <span className="ls-plot-count">{units.length} unit{units.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Unit rows */}
            <div className="ls-scroll">
              <table className="ls-table">
                <thead>
                  <tr>
                    {['Unit', 'Type', 'Rent', 'Deposit', 'Status', 'Description', 'Media', 'Listing'].map(h => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {units.map(house => {
                    const isVacant  = house.status === 'vacant';
                    const isListed  = isVacant && house.listed !== false;
                    const isHidden  = isVacant && house.listed === false;
                    const statusTone   = isListed ? 'green' : isHidden ? 'amber' : 'muted';
                    const statusLabel  = isListed ? '🌐 Listed' : isHidden ? '👁️ Hidden' : '🔒 Occupied';

                    return (
                      <tr key={house.id}>
                        <td className="ls-unit">{house.unit_number}</td>
                        <td style={{ color: 'var(--ls-muted)' }}>{house.house_type || '—'}</td>
                        <td className="ls-money">KES {parseFloat(house.rent_amount || 0).toLocaleString()}</td>
                        <td style={{ color: 'var(--ls-muted)' }}>
                          {house.deposit > 0 ? `KES ${parseFloat(house.deposit).toLocaleString()}` : '—'}
                        </td>
                        <td>
                          <span className={`ls-badge ls-badge-${statusTone}`}>{statusLabel}</span>
                        </td>
                        <td>
                          <button onClick={() => openDesc(house)} className={`ls-mini${house.description ? ' has-value' : ''}`}>
                            {house.description ? '✏️ Edit' : '+ Add'}
                          </button>
                        </td>
                        <td>
                          <button onClick={() => openMedia(house)} className="ls-mini">📷 Media</button>
                        </td>
                        <td>
                          {isVacant ? (
                            <button onClick={() => toggleListed(house)} className="ls-toggle" style={{ '--ls-tone': toneVar(isListed ? 'green' : 'amber') }}>
                              {isListed ? 'Hide' : 'List'}
                            </button>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--ls-muted)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {/* ── Description Modal ── */}
      {descUnit && (
        <div className="ls-modal-backdrop">
          <div className="ls-card" style={{ width: '100%', maxWidth: 500 }}>
            <div className="ls-modal-head">
              <h3 className="ls-modal-title">📝 Description — Unit {descUnit.unit_number}</h3>
              <button onClick={() => setDescUnit(null)} className="ls-modal-close">×</button>
            </div>
            <div style={{ padding: 22 }}>
              <p style={{ fontSize: 13, color: 'var(--ls-muted)', marginBottom: 12 }}>
                This description will appear on the public listings page under this unit.
              </p>
              <textarea
                value={descText}
                onChange={e => setDescText(e.target.value)}
                placeholder="e.g. Spacious bedsitter on the ground floor with natural lighting, a built-in wardrobe, and a private bathroom. Water included in rent."
                rows={5}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--ls-border)', background: 'var(--ls-surface2)', fontSize: 14, color: 'var(--ls-text)', resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.6 }}
              />
              {descMsg && (
                <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: descMsg === 'Saved!' ? 'var(--ls-green)' : 'var(--ls-red)' }}>{descMsg}</div>
              )}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                <button onClick={() => setDescUnit(null)} className="ls-btn">Cancel</button>
                <button onClick={saveDesc} disabled={descSaving} className="ls-btn ls-btn-primary">
                  {descSaving ? 'Saving...' : 'Save Description'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Media Modal ── */}
      {mediaUnit && (
        <div className="ls-modal-backdrop">
          <div className="ls-card" style={{ width: '100%', maxWidth: 620, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div className="ls-modal-head">
              <div>
                <h3 className="ls-modal-title">📷 Media — Unit {mediaUnit.unit_number}</h3>
                <p style={{ fontSize: 12, color: 'var(--ls-muted)', marginTop: 3 }}>Photos and videos shown on the public listings page</p>
              </div>
              <button onClick={() => setMediaUnit(null)} className="ls-modal-close">×</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: 22 }}>
              {mediaErr && <div style={{ background: 'color-mix(in srgb, var(--ls-red) 14%, transparent)', color: 'var(--ls-red)', padding: '9px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{mediaErr}</div>}

              {/* Upload area */}
              <label style={{ display: 'block', border: '2px dashed var(--ls-border)', borderRadius: 12, padding: '24px', textAlign: 'center', cursor: 'pointer', marginBottom: 20, background: 'var(--ls-surface2)', transition: 'border-color 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--ls-accent)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--ls-border)'}>
                <input type="file" multiple accept="image/*,video/mp4,video/mov,video/webm" onChange={handleUpload} style={{ display: 'none' }} />
                <div style={{ fontSize: 28, marginBottom: 8 }}>{uploading ? '⏳' : '📁'}</div>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ls-text)', marginBottom: 4 }}>
                  {uploading ? 'Uploading...' : 'Click to upload photos or videos'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ls-muted)' }}>JPG, PNG, WEBP, MP4, MOV — up to 100MB each</div>
              </label>

              {/* Grid */}
              {media.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--ls-muted)', padding: '20px 0', fontSize: 14 }}>No media yet — upload the first photo or video above.</div>
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

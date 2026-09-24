import { useState, useEffect, useRef } from 'react';
import API from '../services/api';

function getUser() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try { return JSON.parse(atob(token.split('.')[1])); }
  catch { return null; }
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Tracks the light/dark theme Layout.jsx sets via document.documentElement's
// data-theme attribute.
function useIsDarkMode() {
  const [isDark, setIsDark] = useState(document.documentElement.getAttribute('data-theme') === 'dark');
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setIsDark(el.getAttribute('data-theme') === 'dark'));
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

// A single "Actions" button that opens a small dropdown menu, replacing a row
// of separate buttons (Add Unit / Edit / Delete, or Edit / Delete). Renders
// the menu with position:fixed (computed from the button's own position) so
// it isn't clipped by the plot card's overflow:hidden.
function ActionMenu({ id, openMenu, setOpenMenu, items, size = 'md' }) {
  const btnRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const isOpen = openMenu === id;

  function toggle(e) {
    e.stopPropagation();
    if (!isOpen && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.right });
    }
    setOpenMenu(isOpen ? null : id);
  }

  return (
    <div style={{ display: 'inline-block' }}>
      <button ref={btnRef} onClick={toggle} style={{
        padding: size === 'sm' ? '4px 10px' : '6px 12px', borderRadius: 8, border: '1px solid var(--border)',
        background: 'var(--surface)', fontSize: size === 'sm' ? 11 : 12, fontWeight: 600, color: 'var(--text)',
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
      }}>
        Actions <span style={{ fontSize: 9 }}>▾</span>
      </button>
      {isOpen && (
        <div onClick={e => e.stopPropagation()} style={{
          position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-100%)',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: 'var(--shadow-lg)', minWidth: 150, zIndex: 500, overflow: 'hidden',
        }}>
          {items.map((it, i) => (
            <button key={i} onClick={() => { it.onClick(); setOpenMenu(null); }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              style={{ display: 'block', width: '100%', padding: '10px 14px', border: 'none', background: 'transparent', fontSize: 13, fontWeight: it.danger ? 700 : 500, color: it.danger ? 'var(--red, #dc2626)' : 'var(--text)', cursor: 'pointer', textAlign: 'left' }}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Properties() {
  const [plots,     setPlots]     = useState([]);
  const [houses,    setHouses]    = useState([]);
  const [landlords, setLandlords] = useState([]);
  const [caretakers, setCaretakers] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [modal,     setModal]     = useState(null);
  const [editing,   setEditing]   = useState(null);
  const [form,      setForm]      = useState({});
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Backing state for openMediaManager/handleMediaUpload/deleteMedia below —
  // these were referencing undeclared variables (a no-undef build error).
  // Currently unused by any button/modal in this file; declared here just to
  // fix the compile error without inventing a UI that wasn't asked for.
  const [mediaUnit, setMediaUnit] = useState(null);
  const [media,     setMedia]     = useState([]);
  const [mediaErr,  setMediaErr]  = useState('');
  const [uploading, setUploading] = useState(false);

  const user = getUser();
  const isAdmin    = user?.role === 'admin';
  const isCaretaker = user?.role === 'caretaker';
  const isDark      = useIsDarkMode();
  const [openMenu, setOpenMenu] = useState(null);

  useEffect(() => {
    function closeMenus() { setOpenMenu(null); }
    document.addEventListener('click', closeMenus);
    return () => document.removeEventListener('click', closeMenus);
  }, []);



  async function load() {
    setLoading(true);
    try {
      const requests = [API.get('/plots'), API.get('/houses')];
      if (isAdmin) requests.push(API.get('/auth/users'));
      const [pr, hr, ur] = await Promise.all(requests);
      setPlots(Array.isArray(pr.data) ? pr.data : (pr.data.data || []));
      setHouses(Array.isArray(hr.data) ? hr.data : (hr.data.data || []));
      if (ur) {
        const users = ur.data.data || [];
        setLandlords(users.filter(u => u.role === 'landlord' && u.is_approved));
        setCaretakers(users.filter(u => u.role === 'caretaker'));
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  // Intentionally run once on mount only — `load` is a plain function
  // recreated every render, so including it in the deps array would refetch
  // on every render instead of just once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  function openAddPlot() {
    setEditing(null);
    setForm({ name: '', location: '', description: '', owner_id: landlords[0]?.id || '', gps_lat: '', gps_lng: '' });
    setModal('plot'); setError('');
  }

  function openEditPlot(plot) {
    setEditing(plot);
    setForm({
      name:        plot.name,
      location:    plot.location    || '',
      description: plot.description || '',
      owner_id:    plot.user_id     || '',
      gps_lat:     plot.gps_lat     != null ? String(plot.gps_lat) : '',
      gps_lng:     plot.gps_lng     != null ? String(plot.gps_lng) : '',
    });
    setModal('plot'); setError('');
  }

  function openAddHouse(plotId) {
    setEditing(null);
    setForm({ unit_number: '', house_type: 'Bedsitter', rent_amount: '', deposit: '', plot_id: String(plotId || plots[0]?.id || ''), status: 'vacant' });
    setModal('house'); setError('');
  }

  function openEditHouse(house) {
    setEditing(house);
    setForm({ unit_number: house.unit_number, house_type: house.house_type, rent_amount: house.rent_amount, deposit: house.deposit || '', plot_id: house.plot_id, status: house.status, meter_no: house.meter_no || '' });
    setModal('house'); setError('');
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      if (modal === 'plot') {
        if (editing) {
          await API.put(`/plots/${editing.id}`, form);
        } else {
          await API.post('/plots', form);
        }
      } else {
        const housePayload = {
          plot_id:    form.plot_id,
          unit_number: form.unit_number,
          house_type: form.house_type,
          rent_amount: form.rent_amount,
          deposit:    form.deposit,
          status:     form.status,
          meter_no:   form.meter_no || '',
        };
        if (editing) {
          await API.put(`/houses/${editing.id}`, housePayload);
        } else {
          await API.post('/houses', housePayload);
        }
      }
      await load();
      setModal(null);
      setEditing(null);
    } catch (e) {
      setError(e.response?.data?.error || (typeof e.message === 'string' ? e.message : 'Failed to save'));
    } finally { setSaving(false); }
  }

  async function handleDeletePlot(id) {
    if (!window.confirm('Delete this plot? All units inside will also be deleted.')) return;
    try {
      await API.delete(`/plots/${id}`);
      await load();
    } catch (e) { alert(e.response?.data?.error || 'Failed to delete plot'); }
  }

  async function handleDeleteHouse(id) {
    if (!window.confirm('Delete this unit?')) return;
    try {
      await API.delete(`/houses/${id}`);
      await load();
    } catch (e) { alert(e.response?.data?.error || 'Failed to delete unit'); }
  }

  const allPlotHouses = (plotId) => houses.filter(h => h.plot_id === plotId);
  const plotHouses = (plotId) => allPlotHouses(plotId).filter(h => statusFilter === 'all' || h.status === statusFilter);

  async function approveHouse(houseId) {
    try {
      await API.patch(`/houses/${houseId}/approve`);
      setHouses(hs => hs.map(h => h.id === houseId ? { ...h, is_approved: true, rejection_reason: null } : h));
    } catch (e) { console.error(e); }
  }

  async function rejectHouse(houseId, reason) {
    try {
      await API.patch(`/houses/${houseId}/reject`, { reason });
      setHouses(hs => hs.map(h => h.id === houseId ? { ...h, is_approved: false, rejection_reason: reason || 'Rejected' } : h));
    } catch (e) { console.error(e); }
  }

  async function openMediaManager(house) {
    setMediaUnit(house);
    setMediaErr('');
    try {
      const res = await API.get(`/listings/media/${house.id}`);
      setMedia(res.data.data || []);
    } catch { setMedia([]); }
  }

  async function handleMediaUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>Properties</h1>
          <p style={{ color: isDark ? 'var(--blue, #2563eb)' : 'var(--muted)', fontSize: 14 }}>{plots.length} plots · {houses.length} units</p>
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{
          padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)',
          fontSize: 13, fontWeight: 600, color: 'var(--text)', cursor: 'pointer', outline: 'none',
        }}>
          <option value="all">All Units</option>
          <option value="vacant">Vacant</option>
          <option value="occupied">Occupied</option>
          <option value="maintenance">Under Maintenance</option>
        </select>
        <div style={{ display: 'flex', gap: 10 }}>
          {!isCaretaker && (
            <button onClick={openAddPlot} style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--red, #dc2626)', color: '#fff', fontWeight: 600, fontSize: 14 }}>+ Add Plot</button>
          )}
        </div>
      </div>

      {loading ? <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Loading...</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {plots.length === 0 && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 60 }}>No properties yet. Add your first plot to get started.</div>}
          {plots.map(plot => (
            <div key={plot.id} style={{ background: 'var(--surface, #ffffff)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow, 0 2px 8px rgba(0,0,0,0.10))', border: '1.5px solid var(--border, #94a3b8)', overflow: 'hidden' }}>
              {/* Plot header */}
              <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border, #cbd5e1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface2, #f1f5f9)' }}>
                <div>
                  <div style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 17, marginBottom: 8, color: 'var(--text)' }}>{plot.name}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: isDark ? 'var(--blue, #2563eb)' : 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', minWidth: 64 }}>Location</span>
                      <span style={{ fontSize: 13, color: 'var(--text)' }}>📍 {plot.location || '—'}</span>
                    </div>
                    {isAdmin && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: isDark ? 'var(--blue, #2563eb)' : 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', minWidth: 64 }}>Owner</span>
                        <span style={{ fontSize: 13, color: 'var(--text)' }}>👤 {landlords.find(l => l.id === plot.user_id)?.name || 'Admin'}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: isDark ? 'var(--blue, #2563eb)' : 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', minWidth: 64 }}>Caretaker</span>
                      {(() => {
                        const ct = caretakers.find(c => c.plot_id === plot.id);
                        return ct
                          ? <span style={{ fontSize: 13, color: 'var(--text)' }}>🧑‍🔧 {ct.name}</span>
                          : <span style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>None assigned</span>;
                      })()}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ background: isDark ? 'rgba(124,58,237,0.25)' : 'var(--primary-light)', color: isDark ? '#c4b5fd' : 'var(--primary)', padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>
                    {allPlotHouses(plot.id).length} units
                  </span>
                  <ActionMenu id={`plot-${plot.id}`} openMenu={openMenu} setOpenMenu={setOpenMenu} items={[
                    { label: '+ Add Unit', onClick: () => openAddHouse(plot.id) },
                    ...(!isCaretaker ? [
                      { label: 'Edit', onClick: () => openEditPlot(plot) },
                      { label: 'Delete', onClick: () => handleDeletePlot(plot.id), danger: true },
                    ] : []),
                  ]} />
                </div>
              </div>

              {/* Units grid */}
              {plotHouses(plot.id).length === 0 ? (
                <div style={{ padding: '20px 24px', color: 'var(--muted)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, background: isDark ? 'var(--surface2)' : 'transparent' }}>
                  {allPlotHouses(plot.id).length === 0 ? (
                    <>
                      No units added yet.
                      <button onClick={() => openAddHouse(plot.id)} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: 'var(--primary)', fontSize: 12, fontWeight: 600, color: '#fff', cursor: 'pointer' }}>+ Add Unit</button>
                    </>
                  ) : (
                    <>No units match this filter.</>
                  )}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, padding: 16 }}>
                  {plotHouses(plot.id).map(house => (
                    <div key={house.id} style={{ padding: '14px 16px', borderRadius: 10, border: '1px solid var(--border)', background: house.status === 'vacant' ? 'var(--surface2)' : house.status === 'maintenance' ? hexToRgba('#dc2626', 0.15) : hexToRgba('#39FF14', 0.18) }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>Unit {house.unit_number}</div>
                        {!isCaretaker && (
                          <ActionMenu id={`house-${house.id}`} size="sm" openMenu={openMenu} setOpenMenu={setOpenMenu} items={[
                            { label: 'Edit', onClick: () => openEditHouse(house) },
                            { label: 'Delete', onClick: () => handleDeleteHouse(house.id), danger: true },
                          ]} />
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{house.house_type}</div>
                      <div style={{ fontWeight: 700, color: 'var(--primary)', fontSize: 14 }}>KES {parseFloat(house.rent_amount).toLocaleString()}/mo</div>
                      {house.rejection_reason && (
                        <div style={{ fontSize: 11, color: 'var(--red, #dc2626)', marginTop: 4, fontStyle: 'italic' }}>"{house.rejection_reason}"</div>
                      )}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                        <span style={{ display: 'inline-block', background: house.status === 'vacant' ? 'var(--green-light, #dcfce7)' : house.status === 'maintenance' ? 'var(--red-light, #fee2e2)' : 'var(--amber-light, #fef3c7)', color: house.status === 'vacant' ? 'var(--green, #16a34a)' : house.status === 'maintenance' ? 'var(--red, #dc2626)' : 'var(--amber, #d97706)', padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600 }}>{house.status}</span>
                        {house.is_approved !== true && !house.rejection_reason && (
                          <span style={{ display: 'inline-block', background: 'var(--amber-light, #fef3c7)', color: 'var(--amber, #d97706)', padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600 }}>⏳ Pending Approval</span>
                        )}
                        {house.rejection_reason && (
                          <span style={{ display: 'inline-block', background: 'var(--red-light, #fee2e2)', color: 'var(--red, #dc2626)', padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600 }}>❌ Rejected</span>
                        )}
                        {house.is_approved !== true && !isCaretaker && (
                          <>
                            <button onClick={() => approveHouse(house.id)} style={{ padding: '2px 8px', borderRadius: 6, border: 'none', background: 'var(--green, #16a34a)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>✓ Approve</button>
                            <button onClick={() => { setRejectTarget(house.id); setRejectReason(''); }} style={{ padding: '2px 8px', borderRadius: 6, border: 'none', background: 'var(--red-light, #fee2e2)', color: 'var(--red, #dc2626)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>✗ Reject</button>
                          </>
                        )}
                        {/* Inline reject reason */}
                        {rejectTarget === house.id && (
                          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <input value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                              placeholder="Reason (optional)..."
                              style={{ flex: 1, minWidth: 120, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 11, color: 'var(--text)', outline: 'none' }} />
                            <button onClick={() => { rejectHouse(house.id, rejectReason); setRejectTarget(null); }}
                              style={{ padding: '4px 8px', borderRadius: 6, border: 'none', background: 'var(--red, #dc2626)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Confirm</button>
                            <button onClick={() => setRejectTarget(null)}
                              style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>Cancel</button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 460, boxShadow: 'var(--shadow-lg)' }}>
            <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18, marginBottom: 20, color: 'var(--text)' }}>
              {editing ? 'Edit' : 'Add'} {modal === 'plot' ? 'Plot' : 'Unit'}
            </h2>
            {error && <div style={{ background: 'var(--red-light, #fee2e2)', color: 'var(--red, #dc2626)', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {modal === 'plot' ? (<>
                <Field label="Plot Name"   value={form.name}        onChange={v => setForm(f => ({ ...f, name: v }))}        placeholder="e.g. Westlands Apartments" />
                <Field label="Location"    value={form.location}    onChange={v => setForm(f => ({ ...f, location: v }))}    placeholder="e.g. Westlands, Nairobi" />
                <Field label="Description" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="Optional notes" />

                {/* ── GPS Coordinates (optional) ──────────────────────────
                    Admin can type/paste coordinates directly.
                    Non-admins see the current values read-only so they know
                    whether the plot has been geocoded yet.                  */}
                <div>
                  <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
                    GPS Coordinates
                    <span style={{ fontSize: 10, fontWeight: 500, color: isDark ? 'rgba(255,255,255,0.38)' : '#94a3b8', textTransform: 'none', letterSpacing: 0 }}>
                      — optional · auto-filled from location if left blank
                    </span>
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {/* Latitude */}
                    <div>
                      <label style={{ ...labelStyle, fontSize: 10, marginBottom: 4 }}>Latitude</label>
                      {isAdmin ? (
                        <input
                          type="number"
                          step="any"
                          value={form.gps_lat}
                          onChange={e => setForm(f => ({ ...f, gps_lat: e.target.value }))}
                          placeholder="-1.2921"
                          style={inputStyle}
                        />
                      ) : (
                        <div style={{ ...inputStyle, background: isDark ? 'rgba(255,255,255,0.04)' : '#f1f5f9', color: 'var(--muted)', cursor: 'not-allowed', fontSize: 13 }}>
                          {form.gps_lat || <span style={{ fontStyle: 'italic' }}>Not set</span>}
                        </div>
                      )}
                    </div>
                    {/* Longitude */}
                    <div>
                      <label style={{ ...labelStyle, fontSize: 10, marginBottom: 4 }}>Longitude</label>
                      {isAdmin ? (
                        <input
                          type="number"
                          step="any"
                          value={form.gps_lng}
                          onChange={e => setForm(f => ({ ...f, gps_lng: e.target.value }))}
                          placeholder="36.8219"
                          style={inputStyle}
                        />
                      ) : (
                        <div style={{ ...inputStyle, background: isDark ? 'rgba(255,255,255,0.04)' : '#f1f5f9', color: 'var(--muted)', cursor: 'not-allowed', fontSize: 13 }}>
                          {form.gps_lng || <span style={{ fontStyle: 'italic' }}>Not set</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Status chip — tells admin whether the plot is already on the map */}
                  {isAdmin && (
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {form.gps_lat && form.gps_lng ? (
                        <span style={{ fontSize: 11, fontWeight: 600, color: isDark ? '#34d399' : '#16a34a', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                          Plot will appear on map
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 600, color: isDark ? '#fbbf24' : '#d97706', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                          Leave blank — auto-geocodes from Location on save
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {isAdmin && (
                  <div>
                    <label style={labelStyle}>{editing ? 'Reassign Owner' : 'Assign to Landlord'}</label>
                    <select value={form.owner_id} onChange={e => setForm(f => ({ ...f, owner_id: e.target.value }))} style={inputStyle}>
                      <option value="">— Admin (self) —</option>
                      {landlords.map(l => <option key={l.id} value={l.id}>{l.name} ({l.email})</option>)}
                    </select>
                  </div>
                )}
              </>) : (<>
                <div>
                  <label style={labelStyle}>Plot</label>
                  <select value={form.plot_id} onChange={e => setForm(f => ({ ...f, plot_id: e.target.value }))} style={inputStyle}>
                    {plots.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <Field label="Unit Number" value={form.unit_number} onChange={v => setForm(f => ({ ...f, unit_number: v }))} placeholder="e.g. A1" />
                <div>
                  <label style={labelStyle}>Type</label>
                  <select value={form.house_type} onChange={e => setForm(f => ({ ...f, house_type: e.target.value }))} style={inputStyle}>
                    {['Bedsitter','1 Bedroom','2 Bedroom','3 Bedroom','Shop','Studio'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <Field label="Rent (KES)"    value={form.rent_amount} onChange={v => setForm(f => ({ ...f, rent_amount: v }))} placeholder="e.g. 15000" type="number" />
                <Field label="Deposit (KES)" value={form.deposit}     onChange={v => setForm(f => ({ ...f, deposit: v }))}     placeholder="e.g. 15000" type="number" />
                <div>
                  <label style={labelStyle}>Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={inputStyle}>
                    <option value="vacant">Vacant</option>
                    <option value="occupied">Occupied</option>
                    <option value="maintenance">Under Maintenance</option>
                  </select>
                </div>
              </>)}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={() => { setModal(null); setEditing(null); }} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 14 }}>
                {saving ? 'Saving...' : editing ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' };
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 14, color: 'var(--text)', outline: 'none' };

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

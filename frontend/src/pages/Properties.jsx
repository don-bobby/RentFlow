import { useState, useEffect } from 'react';
import API from '../services/api';

function getUser() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try { return JSON.parse(atob(token.split('.')[1])); }
  catch { return null; }
}

export default function Properties() {
  const [plots,     setPlots]     = useState([]);
  const [houses,    setHouses]    = useState([]);
  const [landlords, setLandlords] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [modal,     setModal]     = useState(null);
  const [editing,   setEditing]   = useState(null);
  const [form,      setForm]      = useState({});
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const user = getUser();
  const isAdmin = user?.role === 'admin';

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
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function openAddPlot() {
    setEditing(null);
    setForm({ name: '', location: '', description: '', owner_id: landlords[0]?.id || '' });
    setModal('plot'); setError('');
  }

  function openEditPlot(plot) {
    setEditing(plot);
    setForm({ name: plot.name, location: plot.location || '', description: plot.description || '', owner_id: plot.user_id || '' });
    setModal('plot'); setError('');
  }

  function openAddHouse() {
    setEditing(null);
    setForm({ unit_number: '', house_type: 'Bedsitter', rent_amount: '', deposit: '', plot_id: plots[0]?.id || '', status: 'vacant' });
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
        if (editing) {
          await API.put(`/houses/${editing.id}`, form);
        } else {
          await API.post('/houses', form);
        }
      }
      await load();
      setModal(null);
      setEditing(null);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to save');
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

  const plotHouses = (plotId) => houses.filter(h => h.plot_id === plotId);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Properties</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>{plots.length} plots · {houses.length} units</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={openAddHouse} style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14 }}>+ Add Unit</button>
          <button onClick={openAddPlot}  style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 14 }}>+ Add Plot</button>
        </div>
      </div>

      {loading ? <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Loading...</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {plots.length === 0 && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 60 }}>No properties yet. Add your first plot to get started.</div>}
          {plots.map(plot => (
            <div key={plot.id} style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)', overflow: 'hidden' }}>
              {/* Plot header */}
              <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface2)' }}>
                <div>
                  <div style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 16 }}>{plot.name}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>📍 {plot.location || 'No location set'}</div>
                  {isAdmin && (
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      👤 {landlords.find(l => l.id === plot.user_id)?.name || 'Admin'}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ background: 'var(--primary-light)', color: 'var(--primary)', padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>
                    {plotHouses(plot.id).length} units
                  </span>
                  <button onClick={() => openEditPlot(plot)} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, fontWeight: 600, color: 'var(--primary)' }}>Edit</button>
                  <button onClick={() => handleDeletePlot(plot.id)} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'var(--red-light)', fontSize: 12, fontWeight: 600, color: 'var(--red)' }}>Delete</button>
                </div>
              </div>

              {/* Units grid */}
              {plotHouses(plot.id).length === 0 ? (
                <div style={{ padding: '20px 24px', color: 'var(--muted)', fontSize: 13 }}>No units added yet.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, padding: 16 }}>
                  {plotHouses(plot.id).map(house => (
                    <div key={house.id} style={{ padding: '14px 16px', borderRadius: 10, border: '1px solid var(--border)', background: house.status === 'vacant' ? '#f0fdf4' : '#fafafa' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>Unit {house.unit_number}</div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => openEditHouse(house)} style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'white', fontSize: 11, fontWeight: 600, color: 'var(--primary)' }}>Edit</button>
                          <button onClick={() => handleDeleteHouse(house.id)} style={{ padding: '2px 8px', borderRadius: 6, border: 'none', background: 'var(--red-light)', fontSize: 11, fontWeight: 600, color: 'var(--red)' }}>Del</button>
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{house.house_type}</div>
                      <div style={{ fontWeight: 700, color: 'var(--primary)', fontSize: 14 }}>KES {parseFloat(house.rent_amount).toLocaleString()}/mo</div>
                      <span style={{ display: 'inline-block', marginTop: 8, background: house.status === 'vacant' ? 'var(--green-light)' : 'var(--amber-light)', color: house.status === 'vacant' ? 'var(--green)' : 'var(--amber)', padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600 }}>{house.status}</span>
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
            <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18, marginBottom: 20 }}>
              {editing ? 'Edit' : 'Add'} {modal === 'plot' ? 'Plot' : 'Unit'}
            </h2>
            {error && <div style={{ background: 'var(--red-light)', color: 'var(--red)', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {modal === 'plot' ? (<>
                <Field label="Plot Name"   value={form.name}        onChange={v => setForm(f => ({ ...f, name: v }))}        placeholder="e.g. Westlands Apartments" />
                <Field label="Location"    value={form.location}    onChange={v => setForm(f => ({ ...f, location: v }))}    placeholder="e.g. Westlands, Nairobi" />
                <Field label="Description" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="Optional notes" />
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
                  </select>
                </div>
              </>)}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={() => { setModal(null); setEditing(null); }} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14 }}>Cancel</button>
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

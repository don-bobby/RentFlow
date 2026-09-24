import { useState, useEffect } from 'react';
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
// data-theme attribute — same helper used on Dashboard.jsx and Properties.jsx.
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

const emptyForm = {
  full_name: '', phone: '', email: '', national_id: '',
  house_id: '', move_in_date: '', rent_due_day: 5, deposit_paid: '', emergency_phone: '',
};

export default function Tenants() {
  const [tenants,  setTenants]  = useState([]);
  const [houses,   setHouses]   = useState([]);
  const [allHouses,setAllHouses]= useState([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(null); // null | 'add' | 'edit'
  const [editing,  setEditing]  = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');
  const [search,   setSearch]   = useState('');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [statusFilter,   setStatusFilter]   = useState('all');
  const [moveInFrom,     setMoveInFrom]     = useState('');
  const [moveInTo,       setMoveInTo]       = useState('');
  const [form,     setForm]     = useState(emptyForm);

  const [pinModal,  setPinModal]  = useState(null); // tenant object
  const [pin,       setPin]       = useState('');
  const [pinSaving, setPinSaving] = useState(false);
  const [pinError,  setPinError]  = useState('');
  const [pinSuccess,setPinSuccess]= useState('');

  const user     = getUser();
  const canEdit  = user?.role === 'admin' || user?.role === 'landlord' || user?.role === 'caretaker';
  const isDark   = useIsDarkMode();

  async function load() {
    setLoading(true);
    try {
      const [tr, hr] = await Promise.all([API.get('/tenants'), API.get('/houses')]);
      setTenants(Array.isArray(tr.data) ? tr.data : (tr.data.data || []));
      const ah = Array.isArray(hr.data) ? hr.data : (hr.data.data || []);
      setAllHouses(ah);
      setHouses(ah.filter(h => h.status === 'vacant'));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function openAdd() {
    setEditing(null);
    setForm({ ...emptyForm, house_id: houses[0]?.id || '' });
    setModal('add'); setError('');
  }

  function openEdit(tenant) {
    setEditing(tenant);
    setForm({
      full_name:       tenant.full_name || '',
      phone:           tenant.phone || '',
      email:           tenant.email || '',
      national_id:     tenant.national_id || '',
      house_id:        tenant.house_id || '',
      move_in_date:    tenant.move_in_date ? tenant.move_in_date.slice(0, 10) : '',
      rent_due_day:    tenant.rent_due_day || 5,
      deposit_paid:    tenant.deposit_paid || '',
      emergency_phone: tenant.emergency_phone || '',
      is_active:       tenant.is_active ?? true,
    });
    setModal('edit'); setError('');
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      if (modal === 'edit' && editing) {
        await API.put(`/tenants/${editing.id}`, form);
      } else {
        await API.post('/tenants', form);
      }
      await load();
      setModal(null); setEditing(null);
    } catch (e) {
      setError(e.response?.data?.message || e.response?.data?.error || e.message || 'Failed to save tenant');
    } finally { setSaving(false); }
  }

  async function handleSetPin() {
    if (!pin || pin.length < 4) { setPinError('PIN must be at least 4 digits.'); return; }
    setPinSaving(true); setPinError(''); setPinSuccess('');
    try {
      await API.patch(`/auth/tenants/${pinModal.id}/set-pin`, { pin });
      setPinSuccess(`PIN set successfully for ${pinModal.full_name}. They can now log in at /tenant/login`);
      setPin('');
    } catch (e) {
      setPinError(e.response?.data?.error || 'Failed to set PIN.');
    } finally { setPinSaving(false); }
  }

  function tenantPlotName(t) {
    return t.plot_name || allHouses.find(h => h.id === t.house_id)?.plot_name || '—';
  }

  const propertyOptions = [...new Set(allHouses.map(h => h.plot_name).filter(Boolean))].sort();

  const filtered = tenants.filter(t => {
    const matchesSearch = t.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      t.phone?.includes(search) ||
      t.email?.toLowerCase().includes(search.toLowerCase());
    const matchesProperty = propertyFilter === 'all' || tenantPlotName(t) === propertyFilter;
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? t.is_active : !t.is_active);
    const matchesMoveIn = (!moveInFrom || (t.move_in_date && t.move_in_date.slice(0, 10) >= moveInFrom)) &&
      (!moveInTo || (t.move_in_date && t.move_in_date.slice(0, 10) <= moveInTo));
    return matchesSearch && matchesProperty && matchesStatus && matchesMoveIn;
  });

  // For edit modal, include the tenant's current unit even if occupied
  const unitOptions = modal === 'edit'
    ? allHouses.filter(h => h.status === 'vacant' || h.id === editing?.house_id)
    : houses;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>Tenants</h1>
          <p style={{ color: isDark ? 'var(--blue, #2563eb)' : 'var(--muted)', fontSize: 14 }}>{tenants.filter(t => t.is_active).length} active tenants</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ ...labelStyle, marginBottom: 4 }}>Property</label>
            <select value={propertyFilter} onChange={e => setPropertyFilter(e.target.value)} style={filterInputStyle}>
              <option value="all">All Properties</option>
              {propertyOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={{ ...labelStyle, marginBottom: 4 }}>Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={filterInputStyle}>
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label style={{ ...labelStyle, marginBottom: 4 }}>Move-in From</label>
            <input type="date" value={moveInFrom} onChange={e => setMoveInFrom(e.target.value)} style={filterInputStyle} />
          </div>
          <div>
            <label style={{ ...labelStyle, marginBottom: 4 }}>Move-in To</label>
            <input type="date" value={moveInTo} onChange={e => setMoveInTo(e.target.value)} style={filterInputStyle} />
          </div>
        </div>
        {canEdit && (
          <button onClick={openAdd}
            style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--primary, #7c3aed)', color: '#fff', fontWeight: 600, fontSize: 14 }}>
            + Add Tenant
          </button>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <style>{`.tenant-search-input::placeholder { color: ${isDark ? '#ffffff' : '#6b7280'}; opacity: ${isDark ? 0.75 : 1}; }`}</style>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, phone or email..."
          className="tenant-search-input"
          style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 14, width: '100%', maxWidth: 360, outline: 'none', color: 'var(--text)' }} />
      </div>

      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>No tenants found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                {['Name', 'Phone', 'Unit', 'Property', 'Move-in', 'Balance', 'Status', ...(canEdit ? [''] : [])].map(h => (
                  <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => (
                <tr key={t.id} style={{ borderTop: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
                  <td style={{ padding: '13px 20px' }}>
                    <div style={{ fontWeight: 600, color: isDark ? 'var(--blue, #2563eb)' : 'var(--text)' }}>{t.full_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.email}</div>
                  </td>
                  <td style={{ padding: '13px 20px', color: 'var(--muted)' }}>{t.phone}</td>
                  <td style={{ padding: '13px 20px', fontWeight: 600, color: 'var(--text)' }}>
                    {t.unit_number ? `Unit ${t.unit_number}` : `#${t.house_id}`}
                  </td>
                  <td style={{ padding: '13px 20px', color: 'var(--muted)' }}>{tenantPlotName(t)}</td>
                  <td style={{ padding: '13px 20px', color: 'var(--muted)', fontSize: 13, fontWeight: 700 }}>
                    {t.move_in_date ? new Date(t.move_in_date).toLocaleDateString('en-KE') : '—'}
                  </td>
                  <td style={{ padding: '13px 20px' }}>
                    <span style={{ fontWeight: 700, color: parseFloat(t.balance) > 0 ? 'var(--red, #dc2626)' : 'var(--green, #16a34a)' }}>
                      KES {parseFloat(t.balance || 0).toLocaleString()}
                    </span>
                  </td>
                  <td style={{ padding: '13px 20px' }}>
                    <span style={{
                      background: isDark ? (t.is_active ? hexToRgba('#16a34a', 0.22) : hexToRgba('#dc2626', 0.22)) : (t.is_active ? 'var(--green-light)' : 'var(--red-light)'),
                      color: isDark ? (t.is_active ? '#4ade80' : '#f87171') : (t.is_active ? 'var(--green)' : 'var(--red)'),
                      padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600,
                    }}>
                      {t.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {canEdit && (
                    <td style={{ padding: '13px 20px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => openEdit(t)} style={{ padding: '5px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, fontWeight: 600, color: 'var(--primary, #7c3aed)', cursor: 'pointer' }}>
                          Edit
                        </button>
                        <button onClick={() => { setPinModal(t); setPin(''); setPinError(''); setPinSuccess(''); }} style={{
                          padding: '5px 14px', borderRadius: 8, border: 'none',
                          background: isDark ? hexToRgba('#7c3aed', 0.22) : 'var(--primary-light)',
                          color: isDark ? '#c4b5fd' : 'var(--primary)',
                          fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}>
                          Set PIN
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Set PIN Modal */}
      {pinModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 400, boxShadow: 'var(--shadow-lg)' }}>
            <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18, marginBottom: 6, color: 'var(--text)' }}>Set Portal PIN</h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>
              Setting PIN for <strong>{pinModal.full_name}</strong> ({pinModal.phone}). They will use this PIN to log into the tenant portal.
            </p>
            {pinError   && <div style={{ background: isDark ? hexToRgba('#dc2626', 0.2) : 'var(--red-light)',   color: isDark ? '#f87171' : 'var(--red)',   padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{pinError}</div>}
            {pinSuccess && <div style={{ background: isDark ? hexToRgba('#16a34a', 0.2) : 'var(--green-light)', color: isDark ? '#4ade80' : 'var(--green)', padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{pinSuccess}</div>}
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>New PIN (min 4 digits)</label>
              <input
                type="password" value={pin} onChange={e => setPin(e.target.value)}
                placeholder="e.g. 1234" maxLength={10}
                style={{ ...inputStyle, fontSize: 20, letterSpacing: 6, textAlign: 'center' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setPinModal(null)} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>Close</button>
              <button onClick={handleSetPin} disabled={pinSaving} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--primary, #7c3aed)', color: '#fff', fontWeight: 600, fontSize: 14 }}>
                {pinSaving ? 'Saving...' : 'Set PIN'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20, overflowY: 'auto' }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 500, boxShadow: 'var(--shadow-lg)', margin: 'auto' }}>
            <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18, marginBottom: 20, color: 'var(--text)' }}>
              {modal === 'edit' ? `Edit Tenant — ${editing?.full_name}` : 'Add New Tenant'}
            </h2>
            {error && <div style={{ background: isDark ? hexToRgba('#dc2626', 0.2) : 'var(--red-light)', color: isDark ? '#f87171' : 'var(--red)', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Full Name"       value={form.full_name}       onChange={v => setForm(f=>({...f,full_name:v}))}       placeholder="Jane Doe"     span />
              <Field label="Phone"           value={form.phone}           onChange={v => setForm(f=>({...f,phone:v}))}           placeholder="0712345678" />
              <Field label="Email"           value={form.email}           onChange={v => setForm(f=>({...f,email:v}))}           placeholder="jane@email.com" type="email" />
              <Field label="National ID"     value={form.national_id}     onChange={v => setForm(f=>({...f,national_id:v}))}     placeholder="12345678" />
              <div style={{ gridColumn: '1/-1' }}>
                <label style={labelStyle}>Assign Unit</label>
                <select value={form.house_id} onChange={e => setForm(f=>({...f,house_id:e.target.value}))} style={inputStyle}>
                  <option value="">— Select unit —</option>
                  {unitOptions.map(h => (
                    <option key={h.id} value={h.id}>
                      Unit {h.unit_number} — KES {parseFloat(h.rent_amount).toLocaleString()} {h.id === editing?.house_id ? '(current)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Move-in date — highlighted as key field */}
              <div style={{ gridColumn: '1/-1', background: isDark ? hexToRgba('#7c3aed', 0.15) : 'var(--primary-light)', border: '1px solid var(--primary, #7c3aed)', borderRadius: 10, padding: '12px 14px' }}>
                <label style={{ ...labelStyle, color: 'var(--primary, #7c3aed)' }}>📅 Move-in Date</label>
                <input type="date" value={form.move_in_date} onChange={e => setForm(f=>({...f,move_in_date:e.target.value}))}
                  style={{ ...inputStyle, background: 'var(--surface)', borderColor: 'var(--primary, #7c3aed)' }} />
                <div style={{ fontSize: 11, color: 'var(--primary, #7c3aed)', marginTop: 6 }}>
                  This determines which months are counted as unpaid on the dashboard.
                </div>
              </div>

              <Field label="Rent Due Day"    value={form.rent_due_day}    onChange={v => setForm(f=>({...f,rent_due_day:v}))}    placeholder="5"     type="number" />
              <Field label="Deposit Paid"    value={form.deposit_paid}    onChange={v => setForm(f=>({...f,deposit_paid:v}))}    placeholder="15000" type="number" />
              <Field label="Emergency Phone" value={form.emergency_phone} onChange={v => setForm(f=>({...f,emergency_phone:v}))} placeholder="0700000000" span />

              {modal === 'edit' && (
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={labelStyle}>Status</label>
                  <select value={form.is_active} onChange={e => setForm(f=>({...f,is_active:e.target.value==='true'}))} style={inputStyle}>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={() => { setModal(null); setEditing(null); }}
                style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--primary, #7c3aed)', color: '#fff', fontWeight: 600, fontSize: 14 }}>
                {saving ? 'Saving...' : modal === 'edit' ? 'Update Tenant' : 'Add Tenant'}
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
const filterInputStyle = { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 13, color: 'var(--text)', outline: 'none', minWidth: 160 };

function Field({ label, value, onChange, placeholder, type = 'text', span }) {
  return (
    <div style={span ? { gridColumn: '1/-1' } : {}}>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

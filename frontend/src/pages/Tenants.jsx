import { useState, useEffect, useRef } from 'react';
import API from '../services/api';
import { useAuth } from '../context/AuthContext';

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Deterministic avatar color + initials from a name — same tenant always
// gets the same color, no state or extra data needed.
const AVATAR_COLORS = ['#7c3aed', '#2563eb', '#16a34a', '#d97706', '#dc2626', '#0891b2', '#db2777'];
function initialsAvatar(name) {
  const clean = (name || '?').trim();
  const parts = clean.split(/\s+/);
  const initials = ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
  let hash = 0;
  for (let i = 0; i < clean.length; i++) hash = (hash * 31 + clean.charCodeAt(i)) % AVATAR_COLORS.length;
  return { initials, color: AVATAR_COLORS[hash] };
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
  const [moveInPreset,   setMoveInPreset]   = useState('any'); // any | month | 3m | year | custom
  const [form,     setForm]     = useState(emptyForm);

  const [pinModal,  setPinModal]  = useState(null); // tenant object
  const [pin,       setPin]       = useState('');
  const [pinSaving, setPinSaving] = useState(false);
  const [pinError,  setPinError]  = useState('');
  const [pinSuccess,setPinSuccess]= useState('');

  const { can }   = useAuth();
  const canAdd     = can('tenants.create');
  const canEditRow = can('tenants.edit');
  const canSetPin  = can('tenants.set_pin');
  const canManageRow = canEditRow || canSetPin; // whether the Actions column shows at all
  const isDark    = useIsDarkMode();

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

  // ── Filter bar helpers ──────────────────────────────────────────────
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function applyMoveInPreset(preset) {
    setMoveInPreset(preset);
    const now = new Date();
    if (preset === 'any') { setMoveInFrom(''); setMoveInTo(''); }
    else if (preset === 'month') {
      setMoveInFrom(ymd(new Date(now.getFullYear(), now.getMonth(), 1)));
      setMoveInTo(ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
    } else if (preset === '3m') {
      setMoveInFrom(ymd(new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())));
      setMoveInTo(ymd(now));
    } else if (preset === 'year') {
      setMoveInFrom(ymd(new Date(now.getFullYear(), 0, 1)));
      setMoveInTo(ymd(new Date(now.getFullYear(), 11, 31)));
    }
    // 'custom' keeps the current dates so they can be edited
  }

  const filtersActive = !!search.trim() || propertyFilter !== 'all' || statusFilter !== 'all' || moveInPreset !== 'any';
  function clearFilters() {
    setSearch(''); setPropertyFilter('all'); setStatusFilter('all'); applyMoveInPreset('any');
  }
  const statusCounts = {
    all: tenants.length,
    active: tenants.filter(t => t.is_active).length,
    inactive: tenants.filter(t => !t.is_active).length,
  };

  // For edit modal, include the tenant's current unit even if occupied
  const unitOptions = modal === 'edit'
    ? allHouses.filter(h => h.status === 'vacant' || h.id === editing?.house_id)
    : houses;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>Tenants</h1>
          <p style={{ color: isDark ? 'var(--blue, #2563eb)' : 'var(--muted)', fontSize: 14 }}>{statusCounts.active} active tenants</p>
        </div>
        {canAdd && (
          <button onClick={openAdd}
            style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--primary, #7c3aed)', color: '#fff', fontWeight: 600, fontSize: 14 }}>
            + Add Tenant
          </button>
        )}
      </div>

      {/* Filter bar */}
      <style>{`
        .tenant-search-input::placeholder { color: ${isDark ? '#ffffff' : '#6b7280'}; opacity: ${isDark ? 0.75 : 1}; }
        .tn-row { transition: background 0.12s ease; }
        .tn-row:hover { background: var(--primary-light, #ede9fe) !important; }
        .tn-skel { background: var(--surface2); border-radius: 6px; animation: tn-pulse 1.3s ease-in-out infinite; }
        @keyframes tn-pulse { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .tn-row, .tn-skel { transition: none; animation: none; } }
      `}</style>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 24 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>

          <div>
            <div style={filterLabelStyle}>Status</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']].map(([val, label]) => {
                const on = statusFilter === val;
                return (
                  <button key={val} onClick={() => setStatusFilter(val)} style={{
                    padding: '7px 12px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${on ? 'var(--primary, #7c3aed)' : 'var(--border)'}`,
                    background: on ? 'var(--primary, #7c3aed)' : 'var(--surface)',
                    color: on ? '#fff' : 'var(--text)',
                  }}>
                    {label} <span style={{ opacity: 0.7, marginLeft: 2 }}>{statusCounts[val]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ minWidth: 170 }}>
            <div style={filterLabelStyle}>Property</div>
            <select value={propertyFilter} onChange={e => setPropertyFilter(e.target.value)}
              style={{ ...selectStyle, borderColor: propertyFilter !== 'all' ? 'var(--primary, #7c3aed)' : 'var(--border)' }}>
              <option value="all">All properties</option>
              {propertyOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div style={{ minWidth: 170 }}>
            <div style={filterLabelStyle}>Move-in date</div>
            <select value={moveInPreset} onChange={e => applyMoveInPreset(e.target.value)}
              style={{ ...selectStyle, borderColor: moveInPreset !== 'any' ? 'var(--primary, #7c3aed)' : 'var(--border)' }}>
              <option value="any">Any time</option>
              <option value="month">This month</option>
              <option value="3m">Last 3 months</option>
              <option value="year">This year</option>
              <option value="custom">Custom range…</option>
            </select>
          </div>

          {moveInPreset === 'custom' && (
            <>
              <div>
                <div style={filterLabelStyle}>From</div>
                <input type="date" value={moveInFrom} onChange={e => setMoveInFrom(e.target.value)} style={{ ...selectStyle, minWidth: 150 }} />
              </div>
              <div>
                <div style={filterLabelStyle}>To</div>
                <input type="date" value={moveInTo} onChange={e => setMoveInTo(e.target.value)} style={{ ...selectStyle, minWidth: 150 }} />
              </div>
            </>
          )}

          <ExpandableSearch value={search} onChange={setSearch} />

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>Showing {filtered.length} of {tenants.length} tenants</span>
            {filtersActive && (
              <button onClick={clearFilters} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}>Clear filters</button>
            )}
          </div>
        </div>
      </div>

      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0' }}>
                <div className="tn-skel" style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} />
                <div className="tn-skel" style={{ height: 14, width: `${40 + (i * 7) % 30}%` }} />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>👥</div>
            <div style={{ marginBottom: filtersActive ? 14 : 0 }}>No tenants found.</div>
            {filtersActive && (
              <button onClick={clearFilters} style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 12, fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}>
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                {['Name', 'Phone', 'Unit', 'Property', 'Move-in', 'Balance', 'Status', ...(canManageRow ? [''] : ['Last Payment'])].map(h => (
                  <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => (
                <tr key={t.id} className="tn-row" style={{ borderTop: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
                  <td style={{ padding: '13px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {(() => {
                        const { initials, color } = initialsAvatar(t.full_name);
                        return (
                          <div style={{
                            width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                            background: hexToRgba(color, isDark ? 0.3 : 0.15), color,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 12, fontWeight: 700,
                          }}>{initials}</div>
                        );
                      })()}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: isDark ? 'var(--blue, #2563eb)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.full_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.email}</div>
                      </div>
                    </div>
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
                  {canManageRow ? (
                    <td style={{ padding: '13px 20px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {canEditRow && (
                          <button onClick={() => openEdit(t)} style={{ padding: '5px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, fontWeight: 600, color: 'var(--primary, #7c3aed)', cursor: 'pointer' }}>
                            Edit
                          </button>
                        )}
                        {canSetPin && (
                          <button onClick={() => { setPinModal(t); setPin(''); setPinError(''); setPinSuccess(''); }} style={{
                            padding: '5px 14px', borderRadius: 8, border: 'none',
                            background: isDark ? hexToRgba('#7c3aed', 0.22) : 'var(--primary-light)',
                            color: isDark ? '#c4b5fd' : 'var(--primary)',
                            fontSize: 12, fontWeight: 600, cursor: 'pointer',
                          }}>
                            Set PIN
                          </button>
                        )}
                      </div>
                    </td>
                  ) : (
                    <td style={{ padding: '13px 20px' }}>
                      {t.last_payment_amount ? (
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--green, #16a34a)' }}>
                            KES {parseFloat(t.last_payment_amount).toLocaleString()}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                            {t.last_payment_date ? new Date(t.last_payment_date).toLocaleDateString('en-KE') : ''}
                            {t.last_payment_method ? ` · ${t.last_payment_method}` : ''}
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>No payments yet</span>
                      )}
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
const filterLabelStyle = { fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 };
const selectStyle = { width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13, fontWeight: 600, color: 'var(--text)', cursor: 'pointer', outline: 'none' };

function Field({ label, value, onChange, placeholder, type = 'text', span }) {
  return (
    <div style={span ? { gridColumn: '1/-1' } : {}}>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

// A search icon that expands into an input when clicked. Stays open while it
// has text; collapses on blur when empty or on Esc (which also clears it).
function ExpandableSearch({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const expanded = open || !!value;

  function openIt() {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', flexShrink: 0, overflow: 'hidden',
      height: 40, width: expanded ? 260 : 40, maxWidth: '100%',
      transition: 'width 0.2s ease, border-color 0.15s',
      borderRadius: 10, background: 'var(--surface)',
      border: `1px solid ${expanded ? 'var(--primary, #7c3aed)' : 'var(--border)'}`,
    }}>
      <button type="button" onClick={openIt} aria-label="Search tenants" title="Search tenants"
        style={{ width: 38, height: 38, flex: 'none', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15 }}>🔍</button>
      <input
        ref={inputRef}
        className="tenant-search-input"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={e => { if (e.key === 'Escape') { onChange(''); setOpen(false); e.currentTarget.blur(); } }}
        placeholder="Name, phone or email…"
        tabIndex={expanded ? 0 : -1}
        style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 13, paddingRight: value ? 0 : 10 }}
      />
      {value && (
        <button type="button" onClick={() => { onChange(''); inputRef.current?.focus(); }} aria-label="Clear search"
          style={{ width: 30, height: 30, flex: 'none', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16, color: 'var(--muted)' }}>×</button>
      )}
    </div>
  );
}

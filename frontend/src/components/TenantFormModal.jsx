import { useState, useEffect, useMemo } from 'react';
import API from '../services/api';
import { useAuth } from '../context/AuthContext';
import { IconInline } from './Icon';
import { Field, labelStyle, inputStyle, hexToRgba, useIsDarkMode } from './formKit';

const emptyForm = {
  full_name: '', phone: '', email: '', national_id: '',
  house_id: '', move_in_date: '', rent_due_day: 5, deposit_paid: '', emergency_phone: '',
};

// Add / Edit Tenant modal, shared by the Tenants page and the Dashboard.
//   mode     'add' | 'edit'            tenant   the tenant being edited (edit only)
//   houses   ALL units (/houses) — vacant ones are offered when adding
//   onSaved(mode)  caller refreshes its own data;  onClose()
export default function TenantFormModal({ mode = 'add', tenant = null, houses, onClose, onSaved }) {
  const { can } = useAuth();
  const isDark  = useIsDarkMode();
  const isEdit  = mode === 'edit' && !!tenant;

  const [form, setForm] = useState(() => isEdit ? {
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
  } : emptyForm);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  // A property-specific GRANT of tenants.create counts too: narrow the unit
  // list to those properties unless the permission is held globally, so staff
  // can't pick a unit the backend would reject.
  const addablePlotIds = useMemo(
    () => [...new Set(houses.map(h => h.plot_id).filter(id => id != null))].filter(id => can('tenants.create', id)),
    [houses, can]
  );
  const canAddGlobally = can('tenants.create');
  const vacant = houses.filter(h => h.status === 'vacant');
  const addableHouses = canAddGlobally ? vacant : vacant.filter(h => addablePlotIds.includes(h.plot_id));
  // Editing: include the tenant's current unit even though it's occupied
  const unitOptions = isEdit ? houses.filter(h => h.status === 'vacant' || h.id === tenant.house_id) : addableHouses;

  // Grouped by property so the dropdown reads "Wa Chege Building > Unit B1"
  const unitOptionsByPlot = (() => {
    const groups = {};
    for (const h of unitOptions) (groups[h.plot_name || 'No Property'] ||= []).push(h);
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([plotName, list]) => [plotName, [...list].sort((a, b) => String(a.unit_number || '').localeCompare(String(b.unit_number || ''), undefined, { numeric: true }))]);
  })();

  // Required deposit for the selected unit, shown next to "Deposit Paid" so a
  // short deposit is caught at entry time.
  const selectedUnitDeposit = houses.find(h => h.id === Number(form.house_id))?.deposit;
  const depositShortfall = selectedUnitDeposit != null && form.deposit_paid !== ''
    ? Math.max(0, parseFloat(selectedUnitDeposit) - parseFloat(form.deposit_paid || 0))
    : 0;

  const dirty = !isEdit && (!!form.full_name || !!form.phone || !!form.house_id);
  function requestClose() { if (!saving) onClose(); }
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // re-bound each render so it always sees the latest `saving`

  async function handleSave() {
    if (saving) return;
    setError('');
    if (!form.full_name.trim()) { setError('Enter the tenant\u2019s full name.'); return; }
    if (!isEdit && !form.house_id) { setError('Select a unit for this tenant.'); return; }
    setSaving(true);
    try {
      if (isEdit) await API.put(`/tenants/${tenant.id}`, form);
      else        await API.post('/tenants', form);
      await onSaved?.(isEdit ? 'edit' : 'add');
      onClose();
    } catch (e) {
      setError(e.response?.data?.message || e.response?.data?.error || e.message || 'Failed to save tenant');
    } finally { setSaving(false); }
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit tenant' : 'Add tenant'}
      onMouseDown={e => { if (e.target === e.currentTarget && !dirty && !isEdit) requestClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <h2 style={{ fontFamily: 'Bricolage Grotesque', fontWeight: 700, fontSize: 18, color: 'var(--text)', margin: 0 }}>
            {isEdit ? `Edit Tenant — ${tenant.full_name}` : 'Add New Tenant'}
          </h2>
          <button onClick={requestClose} aria-label="Close" style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'var(--surface2)', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}>×</button>
        </div>

        <div style={{ padding: '16px 24px', overflowY: 'auto', flex: 1 }}>
          {error && <div style={{ background: isDark ? hexToRgba('#dc2626', 0.2) : 'var(--red-light)', color: isDark ? '#f87171' : 'var(--red)', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            <Field label="Full Name" value={form.full_name} onChange={v => setForm(f => ({ ...f, full_name: v }))} placeholder="Jane Doe" span autoFocus={!isEdit} />
            <Field label="Phone"       value={form.phone}       onChange={v => setForm(f => ({ ...f, phone: v }))}       placeholder="0712345678" />
            <Field label="Email"       value={form.email}       onChange={v => setForm(f => ({ ...f, email: v }))}       placeholder="jane@email.com" type="email" />
            <Field label="National ID" value={form.national_id} onChange={v => setForm(f => ({ ...f, national_id: v }))} placeholder="12345678" />
            <div style={{ gridColumn: '1/-1' }}>
              <label style={labelStyle}>Assign Unit</label>
              <select value={form.house_id} onChange={e => setForm(f => ({ ...f, house_id: e.target.value }))} style={inputStyle}>
                <option value="">— Select unit —</option>
                {unitOptionsByPlot.map(([plotName, list]) => (
                  <optgroup key={plotName} label={plotName}>
                    {list.map(h => (
                      <option key={h.id} value={h.id}>
                        Unit {h.unit_number} — KES {parseFloat(h.rent_amount).toLocaleString()} {isEdit && h.id === tenant.house_id ? '(current)' : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {!isEdit && unitOptions.length === 0 && (
                <div style={{ fontSize: 11, marginTop: 4, color: 'var(--amber, #d97706)' }}>No vacant units available to add a tenant to.</div>
              )}
            </div>

            {/* Move-in date — highlighted as key field */}
            <div style={{ gridColumn: '1/-1', background: isDark ? hexToRgba('#1b6b45', 0.15) : 'var(--primary-light)', border: '1px solid var(--primary, #1b6b45)', borderRadius: 10, padding: '12px 14px' }}>
              <label style={{ ...labelStyle, color: 'var(--primary, #1b6b45)' }}><IconInline name="📅" size={14} />Move-in date</label>
              <input type="date" value={form.move_in_date} onChange={e => setForm(f => ({ ...f, move_in_date: e.target.value }))}
                style={{ ...inputStyle, background: 'var(--surface)', borderColor: 'var(--primary, #1b6b45)' }} />
              <div style={{ fontSize: 11, color: 'var(--primary, #1b6b45)', marginTop: 6 }}>
                This determines which months are counted as unpaid on the dashboard.
              </div>
            </div>

            <Field label="Rent Due Day" value={form.rent_due_day} onChange={v => setForm(f => ({ ...f, rent_due_day: v }))} placeholder="5" type="number" />
            <div>
              <Field label="Deposit Paid" value={form.deposit_paid} onChange={v => setForm(f => ({ ...f, deposit_paid: v }))} placeholder="15000" type="number" />
              {selectedUnitDeposit != null && (
                <div style={{ fontSize: 11, marginTop: 4, color: depositShortfall > 0 ? 'var(--amber, #d97706)' : 'var(--muted)' }}>
                  {depositShortfall > 0
                    ? `Short by KES ${depositShortfall.toLocaleString()} — this unit requires KES ${parseFloat(selectedUnitDeposit).toLocaleString()}`
                    : `Required for this unit: KES ${parseFloat(selectedUnitDeposit).toLocaleString()}`}
                </div>
              )}
            </div>
            <Field label="Emergency Phone" value={form.emergency_phone} onChange={v => setForm(f => ({ ...f, emergency_phone: v }))} placeholder="0700000000" span />

            {isEdit && (
              <div style={{ gridColumn: '1/-1' }}>
                <label style={labelStyle}>Status</label>
                <select value={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.value === 'true' }))} style={inputStyle}>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', padding: '14px 24px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button onClick={requestClose}
            style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, color: 'var(--text)', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--primary, #1b6b45)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving...' : isEdit ? 'Update Tenant' : 'Add Tenant'}
          </button>
        </div>
      </div>
    </div>
  );
}

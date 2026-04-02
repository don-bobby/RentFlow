import { useState, useEffect } from 'react';
import API from '../services/api';

export default function Tenants() {
  const [tenants, setTenants] = useState([]);
  const [houses,  setHouses]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [search,  setSearch]  = useState('');
  const [form,    setForm]    = useState({
    full_name: '', phone: '', email: '', national_id: '',
    house_id: '', move_in_date: '', rent_due_day: 5, deposit_paid: '', emergency_phone: '',
  });

  async function load() {
    setLoading(true);
    try {
      const [tr, hr] = await Promise.all([
        API.get('/tenants'),
        API.get('/houses'),
      ]);
      setTenants(Array.isArray(tr.data) ? tr.data : (tr.data.data || []));
      const allHouses = Array.isArray(hr.data) ? hr.data : (hr.data.data || []);
      setHouses(allHouses.filter(h => h.status === 'vacant'));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleSave() {
    setSaving(true); setError('');
    try {
      await API.post('/tenants', form);
      await load();
      setModal(false);
    } catch (e) {
      setError(e.response?.data?.message || e.response?.data?.error || e.message || 'Failed to save tenant');
    } finally { setSaving(false); }
  }

  const filtered = tenants.filter(t =>
    t.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    t.phone?.includes(search) ||
    t.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Tenants</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>{tenants.filter(t => t.is_active).length} active tenants</p>
        </div>
        <button onClick={() => { setForm({ full_name:'',phone:'',email:'',national_id:'',house_id:houses[0]?.id||'',move_in_date:'',rent_due_day:5,deposit_paid:'',emergency_phone:'' }); setModal(true); setError(''); }}
          style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 14 }}>
          + Add Tenant
        </button>
      </div>

      <div style={{ marginBottom: 20 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, phone or email..."
          style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 14, width: '100%', maxWidth: 360, outline: 'none' }} />
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
                {['Name', 'Phone', 'Unit', 'Move-in', 'Balance', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => (
                <tr key={t.id} style={{ borderTop: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
                  <td style={{ padding: '13px 20px' }}>
                    <div style={{ fontWeight: 600 }}>{t.full_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.email}</div>
                  </td>
                  <td style={{ padding: '13px 20px', color: 'var(--muted)' }}>{t.phone}</td>
                  <td style={{ padding: '13px 20px', fontWeight: 600 }}>Unit {t.house_id}</td>
                  <td style={{ padding: '13px 20px', color: 'var(--muted)', fontSize: 13 }}>
                    {t.move_in_date ? new Date(t.move_in_date).toLocaleDateString('en-KE') : '—'}
                  </td>
                  <td style={{ padding: '13px 20px' }}>
                    <span style={{ fontWeight: 700, color: parseFloat(t.balance) > 0 ? 'var(--red)' : 'var(--green)' }}>
                      KES {parseFloat(t.balance || 0).toLocaleString()}
                    </span>
                  </td>
                  <td style={{ padding: '13px 20px' }}>
                    <span style={{ background: t.is_active ? 'var(--green-light)' : 'var(--red-light)', color: t.is_active ? 'var(--green)' : 'var(--red)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>
                      {t.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20, overflowY: 'auto' }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 500, boxShadow: 'var(--shadow-lg)', margin: 'auto' }}>
            <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18, marginBottom: 20 }}>Add New Tenant</h2>
            {error && <div style={{ background: 'var(--red-light)', color: 'var(--red)', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Full Name"       value={form.full_name}       onChange={v => setForm(f=>({...f,full_name:v}))}       placeholder="Jane Doe" span />
              <Field label="Phone"           value={form.phone}           onChange={v => setForm(f=>({...f,phone:v}))}           placeholder="0712345678" />
              <Field label="Email"           value={form.email}           onChange={v => setForm(f=>({...f,email:v}))}           placeholder="jane@email.com" type="email" />
              <Field label="National ID"     value={form.national_id}     onChange={v => setForm(f=>({...f,national_id:v}))}     placeholder="12345678" />
              <div style={{ gridColumn: '1/-1' }}>
                <label style={labelStyle}>Assign Unit</label>
                <select value={form.house_id} onChange={e => setForm(f=>({...f,house_id:e.target.value}))} style={inputStyle}>
                  <option value="">— Select vacant unit —</option>
                  {houses.map(h => <option key={h.id} value={h.id}>Unit {h.unit_number} — KES {parseFloat(h.rent_amount).toLocaleString()}</option>)}
                </select>
              </div>
              <Field label="Move-in Date"    value={form.move_in_date}    onChange={v => setForm(f=>({...f,move_in_date:v}))}    type="date" />
              <Field label="Rent Due Day"    value={form.rent_due_day}    onChange={v => setForm(f=>({...f,rent_due_day:v}))}    placeholder="5" type="number" />
              <Field label="Deposit Paid"    value={form.deposit_paid}    onChange={v => setForm(f=>({...f,deposit_paid:v}))}    placeholder="15000" type="number" />
              <Field label="Emergency Phone" value={form.emergency_phone} onChange={v => setForm(f=>({...f,emergency_phone:v}))} placeholder="0700000000" />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={() => setModal(false)} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14 }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 14 }}>
                {saving ? 'Saving...' : 'Add Tenant'}
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

function Field({ label, value, onChange, placeholder, type = 'text', span }) {
  return (
    <div style={span ? { gridColumn: '1/-1' } : {}}>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}
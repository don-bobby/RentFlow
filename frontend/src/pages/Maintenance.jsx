import { useState, useEffect } from 'react';
import API from '../services/api';

const PRIORITY_COLOR = { low: 'var(--blue)', medium: 'var(--amber)', high: 'var(--red)' };
const PRIORITY_BG    = { low: 'var(--blue-light)', medium: 'var(--amber-light)', high: 'var(--red-light)' };
const STATUS_COLOR   = { pending: 'var(--amber)', in_progress: 'var(--blue)', completed: 'var(--green)' };
const STATUS_BG      = { pending: 'var(--amber-light)', in_progress: 'var(--blue-light)', completed: 'var(--green-light)' };

export default function Maintenance() {
  const [requests, setRequests] = useState([]);
  const [tenants,  setTenants]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');
  const [filter,   setFilter]   = useState('all');
  const [form,     setForm]     = useState({ tenant_id: '', issue: '', priority: 'medium' });

  async function load() {
    setLoading(true);
    try {
      const [mr, tr] = await Promise.all([
        API.get('/maintenance'),
        API.get('/tenants'),
      ]);
      setRequests(Array.isArray(mr.data) ? mr.data : (mr.data.data || []));
      setTenants(Array.isArray(tr.data) ? tr.data : (tr.data.data || []));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const tenant = tenants.find(t => String(t.id) === String(form.tenant_id));
      await API.post('/maintenance', { ...form, house_id: tenant?.house_id });
      await load();
      setModal(false);
    } catch (e) {
      setError(e.response?.data?.message || e.response?.data?.error || e.message || 'Failed to save');
    } finally { setSaving(false); }
  }

  async function updateStatus(id, status) {
    try {
      await API.patch(`/maintenance/${id}`, { status });
      await load();
    } catch (e) { console.error(e); }
  }

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Maintenance</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>
            {requests.filter(r => r.status === 'pending').length} pending ·{' '}
            {requests.filter(r => r.status === 'in_progress').length} in progress
          </p>
        </div>
        <button onClick={() => { setForm({ tenant_id:tenants[0]?.id||'', issue:'', priority:'medium' }); setModal(true); setError(''); }}
          style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 14 }}>
          + New Request
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['all','pending','in_progress','completed'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '7px 16px', borderRadius: 99, border: '1px solid var(--border)', background: filter === f ? 'var(--primary)' : 'var(--surface)', color: filter === f ? '#fff' : 'var(--muted)', fontWeight: 600, fontSize: 13 }}>
            {f.replace('_', ' ')}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>No maintenance requests found.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {filtered.map(r => (
            <div key={r.id} style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ background: PRIORITY_BG[r.priority], color: PRIORITY_COLOR[r.priority], padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{r.priority}</span>
                  <span style={{ background: STATUS_BG[r.status], color: STATUS_COLOR[r.status], padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>{r.status?.replace('_',' ')}</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>#{r.id}</span>
              </div>
              <p style={{ fontWeight: 600, marginBottom: 8, lineHeight: 1.5 }}>{r.issue}</p>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
                Reported {new Date(r.reported_at).toLocaleDateString('en-KE')}
                {r.resolved_at && ` · Resolved ${new Date(r.resolved_at).toLocaleDateString('en-KE')}`}
              </div>
              {r.status !== 'completed' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  {r.status === 'pending' && (
                    <button onClick={() => updateStatus(r.id, 'in_progress')} style={{ flex: 1, padding: '7px', borderRadius: 8, border: 'none', background: 'var(--blue-light)', color: 'var(--blue)', fontWeight: 600, fontSize: 12 }}>Start Work</button>
                  )}
                  <button onClick={() => updateStatus(r.id, 'completed')} style={{ flex: 1, padding: '7px', borderRadius: 8, border: 'none', background: 'var(--green-light)', color: 'var(--green)', fontWeight: 600, fontSize: 12 }}>Mark Done</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 460, boxShadow: 'var(--shadow-lg)' }}>
            <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18, marginBottom: 20 }}>New Maintenance Request</h2>
            {error && <div style={{ background: 'var(--red-light)', color: 'var(--red)', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle}>Tenant</label>
                <select value={form.tenant_id} onChange={e=>setForm(f=>({...f,tenant_id:e.target.value}))} style={inputStyle}>
                  {tenants.filter(t=>t.is_active).map(t=><option key={t.id} value={t.id}>{t.full_name} — Unit {t.house_id}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Issue Description</label>
                <textarea value={form.issue} onChange={e=>setForm(f=>({...f,issue:e.target.value}))} placeholder="Describe the maintenance issue..." rows={4}
                  style={{ ...inputStyle, resize: 'vertical' }} />
              </div>
              <div>
                <label style={labelStyle}>Priority</label>
                <select value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))} style={inputStyle}>
                  {['low','medium','high'].map(p=><option key={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={() => setModal(false)} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14 }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 14 }}>
                {saving ? 'Saving...' : 'Submit'}
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

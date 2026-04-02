import { useState, useEffect } from 'react';
import API from '../services/api';

const DEFAULT_PASSWORD = 'RentFlow@123';

function getUser() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try { return JSON.parse(atob(token.split('.')[1])); }
  catch { return null; }
}

export default function Users() {
  const [users,   setUsers]   = useState([]);
  const [plots,   setPlots]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(null); // null | 'create' | 'edit' | 'reset' | 'assign'
  const [editing, setEditing] = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [form,    setForm]    = useState({ name: '', email: '', password: '', role: 'landlord', phone: '', plot_id: '' });
  const [assignPlotId, setAssignPlotId] = useState('');
  const currentUser = getUser();
  const isAdmin = currentUser?.role === 'admin';

  async function load() {
    setLoading(true);
    try {
      const [ur, pr] = await Promise.all([
        API.get('/auth/users'),
        API.get('/plots'),
      ]);
      setUsers(ur.data.data || []);
      setPlots(Array.isArray(pr.data) ? pr.data : (pr.data.data || []));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    // Landlords can only create caretakers
    setForm({ name: '', email: '', password: '', role: isAdmin ? 'landlord' : 'caretaker', phone: '', plot_id: plots[0]?.id || '' });
    setError(''); setSuccess('');
    setModal('create');
  }

  function openEdit(user) {
    setEditing(user);
    setForm({ name: user.name, email: user.email, phone: user.phone || '', role: user.role, password: '' });
    setError(''); setSuccess('');
    setModal('edit');
  }

  function openReset(user) {
    setEditing(user);
    setError(''); setSuccess('');
    setModal('reset');
  }

  function openAssign(user) {
    setEditing(user);
    setAssignPlotId(user.plot_id || '');
    setError(''); setSuccess('');
    setModal('assign');
  }

  async function handleCreate() {
    setSaving(true); setError('');
    try {
      await API.post('/auth/users', form);
      await load();
      setModal(null);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  }

  async function handleEdit() {
    setSaving(true); setError('');
    try {
      await API.patch(`/auth/users/${editing.id}/profile`, { name: form.name, email: form.email, phone: form.phone });
      if (isAdmin && form.role !== editing.role) {
        await API.patch(`/auth/users/${editing.id}/role`, { role: form.role });
      }
      await load();
      setSuccess('User updated successfully.');
      setTimeout(() => setModal(null), 1200);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  }

  async function handleResetPassword() {
    setSaving(true); setError('');
    try {
      await API.patch(`/auth/users/${editing.id}/reset-password`, { new_password: DEFAULT_PASSWORD });
      setSuccess(`Password reset to: ${DEFAULT_PASSWORD}`);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  }

  async function handleAssignPlot() {
    setSaving(true); setError('');
    try {
      await API.patch(`/auth/users/${editing.id}/assign-plot`, { plot_id: assignPlotId || null });
      await load();
      setSuccess('Caretaker assigned successfully.');
      setTimeout(() => setModal(null), 1200);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  }

  async function handleApprove(id) {
    try { await API.patch(`/auth/users/${id}/approve`); await load(); } catch (e) { console.error(e); }
  }

  async function handleReject(id) {
    try { await API.patch(`/auth/users/${id}/reject`); await load(); } catch (e) { console.error(e); }
  }

  async function handleDelete(id) {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    try { await API.delete(`/auth/users/${id}`); await load(); } catch (e) { console.error(e); }
  }

  const roleColor = { admin: 'var(--primary)', landlord: 'var(--green)', caretaker: 'var(--blue)' };
  const roleBg    = { admin: 'var(--primary-light)', landlord: 'var(--green-light)', caretaker: 'var(--blue-light)' };
  const pending   = users.filter(u => u.role === 'landlord' && !u.is_approved);
  const caretakers = users.filter(u => u.role === 'caretaker');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Users</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>
            {users.length} total · {pending.length} pending · {caretakers.length} caretaker{caretakers.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={openCreate} style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 14 }}>
          + {isAdmin ? 'Add User' : 'Add Caretaker'}
        </button>
      </div>

      {/* Pending Approvals — admin only */}
      {isAdmin && pending.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 16, marginBottom: 14, color: 'var(--amber)' }}>⏳ Pending Approval ({pending.length})</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pending.map(u => (
              <div key={u.id} style={{ background: 'var(--surface)', border: '1px solid var(--amber)', borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: 'var(--shadow)' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{u.name}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>{u.email} {u.phone && `· ${u.phone}`}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Registered {new Date(u.created_at).toLocaleDateString('en-KE')}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleApprove(u.id)} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--green-light)', color: 'var(--green)', fontWeight: 600, fontSize: 13 }}>Approve</button>
                  <button onClick={() => handleReject(u.id)}  style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--red-light)',   color: 'var(--red)',   fontWeight: 600, fontSize: 13 }}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Users Table */}
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
          <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 15 }}>{isAdmin ? 'All Users' : 'My Caretakers'}</h2>
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                {['Name', 'Email', 'Phone', 'Role', 'Assigned Plot', 'Status', 'Joined', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={u.id} style={{ borderTop: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>{u.name}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--muted)', fontSize: 13 }}>{u.email}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--muted)', fontSize: 13 }}>{u.phone || '—'}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ background: roleBg[u.role] || 'var(--border)', color: roleColor[u.role] || 'var(--muted)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, textTransform: 'capitalize' }}>{u.role}</span>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13 }}>
                    {u.role === 'caretaker' ? (
                      u.plot_name ? <span style={{ color: 'var(--primary)', fontWeight: 600 }}>📍 {u.plot_name}</span> : <span style={{ color: 'var(--muted)' }}>Unassigned</span>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ background: u.is_approved ? 'var(--green-light)' : 'var(--amber-light)', color: u.is_approved ? 'var(--green)' : 'var(--amber)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>
                      {u.is_approved ? 'Active' : 'Pending'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--muted)', fontSize: 13 }}>{new Date(u.created_at).toLocaleDateString('en-KE')}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={() => openEdit(u)} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--primary)', fontWeight: 600, fontSize: 12 }}>Edit</button>
                      <button onClick={() => openReset(u)} style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: 'var(--amber-light)', color: 'var(--amber)', fontWeight: 600, fontSize: 12 }}>Reset PW</button>
                      {isAdmin && u.role === 'caretaker' && (
                        <button onClick={() => openAssign(u)} style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: 'var(--blue-light)', color: 'var(--blue)', fontWeight: 600, fontSize: 12 }}>Assign Plot</button>
                      )}
                      {isAdmin && u.role === 'landlord' && !u.is_approved && (
                        <button onClick={() => handleApprove(u.id)} style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: 'var(--green-light)', color: 'var(--green)', fontWeight: 600, fontSize: 12 }}>Approve</button>
                      )}
                      {isAdmin && u.role === 'landlord' && u.is_approved && (
                        <button onClick={() => handleReject(u.id)} style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: 'var(--amber-light)', color: 'var(--amber)', fontWeight: 600, fontSize: 12 }}>Suspend</button>
                      )}
                      {isAdmin && (
                        <button onClick={() => handleDelete(u.id)} style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: 'var(--red-light)', color: 'var(--red)', fontWeight: 600, fontSize: 12 }}>Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Create User Modal ── */}
      {modal === 'create' && (
        <ModalWrapper title={isAdmin ? 'Add New User' : 'Add Caretaker'} onClose={() => setModal(null)}>
          {error && <Alert type="error" msg={error} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Full Name" value={form.name}     onChange={v => setForm(f => ({ ...f, name: v }))}     placeholder="John Doe" />
            <Field label="Email"     value={form.email}    onChange={v => setForm(f => ({ ...f, email: v }))}    placeholder="john@email.com" type="email" />
            <Field label="Password"  value={form.password} onChange={v => setForm(f => ({ ...f, password: v }))} placeholder="Set a password" type="password" />
            <Field label="Phone"     value={form.phone}    onChange={v => setForm(f => ({ ...f, phone: v }))}    placeholder="0712345678" />
            {isAdmin && (
              <div>
                <label style={labelStyle}>Role</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} style={inputStyle}>
                  <option value="landlord">Landlord</option>
                  <option value="caretaker">Caretaker</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            )}
            {(form.role === 'caretaker') && (
              <div>
                <label style={labelStyle}>Assign to Plot</label>
                <select value={form.plot_id} onChange={e => setForm(f => ({ ...f, plot_id: e.target.value }))} style={inputStyle}>
                  <option value="">— Select plot —</option>
                  {plots.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
            <button onClick={() => setModal(null)} style={cancelBtn}>Cancel</button>
            <button onClick={handleCreate} disabled={saving} style={saveBtn}>{saving ? 'Creating...' : 'Create'}</button>
          </div>
        </ModalWrapper>
      )}

      {/* ── Edit User Modal ── */}
      {modal === 'edit' && (
        <ModalWrapper title={`Edit — ${editing?.name}`} onClose={() => setModal(null)}>
          {error   && <Alert type="error"   msg={error} />}
          {success && <Alert type="success" msg={success} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Full Name" value={form.name}  onChange={v => setForm(f => ({ ...f, name: v }))}  placeholder="Full name" />
            <Field label="Email"     value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} placeholder="Email" type="email" />
            <Field label="Phone"     value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} placeholder="Phone" />
            {isAdmin && (
              <div>
                <label style={labelStyle}>Role</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} style={inputStyle}>
                  <option value="landlord">Landlord</option>
                  <option value="caretaker">Caretaker</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
            <button onClick={() => setModal(null)} style={cancelBtn}>Cancel</button>
            <button onClick={handleEdit} disabled={saving} style={saveBtn}>{saving ? 'Saving...' : 'Save Changes'}</button>
          </div>
        </ModalWrapper>
      )}

      {/* ── Assign Plot Modal ── */}
      {modal === 'assign' && (
        <ModalWrapper title={`Assign Plot — ${editing?.name}`} onClose={() => setModal(null)}>
          {error   && <Alert type="error"   msg={error} />}
          {success && <Alert type="success" msg={success} />}
          {!success && (
            <>
              <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 16 }}>
                Assign this caretaker to a property plot. They will be responsible for that plot.
              </p>
              <div>
                <label style={labelStyle}>Select Plot</label>
                <select value={assignPlotId} onChange={e => setAssignPlotId(e.target.value)} style={inputStyle}>
                  <option value="">— Unassign —</option>
                  {plots.map(p => <option key={p.id} value={p.id}>{p.name} {p.location ? `(${p.location})` : ''}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
                <button onClick={() => setModal(null)} style={cancelBtn}>Cancel</button>
                <button onClick={handleAssignPlot} disabled={saving} style={saveBtn}>{saving ? 'Assigning...' : 'Assign Plot'}</button>
              </div>
            </>
          )}
        </ModalWrapper>
      )}

      {/* ── Reset Password Modal ── */}
      {modal === 'reset' && (
        <ModalWrapper title={`Reset Password — ${editing?.name}`} onClose={() => setModal(null)}>
          {error   && <Alert type="error"   msg={error} />}
          {success && <Alert type="success" msg={success} />}
          {!success && (
            <>
              <div style={{ padding: 16, background: 'var(--amber-light)', borderRadius: 10, marginBottom: 16 }}>
                <p style={{ fontSize: 14, color: 'var(--amber)', fontWeight: 600 }}>⚠️ Password will be reset to:</p>
                <p style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 800, color: 'var(--text)', marginTop: 8 }}>{DEFAULT_PASSWORD}</p>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>Inform the user of their new password.</p>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setModal(null)} style={cancelBtn}>Cancel</button>
                <button onClick={handleResetPassword} disabled={saving} style={{ ...saveBtn, background: 'var(--amber)' }}>
                  {saving ? 'Resetting...' : 'Reset Password'}
                </button>
              </div>
            </>
          )}
          {success && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}><button onClick={() => setModal(null)} style={saveBtn}>Done</button></div>}
        </ModalWrapper>
      )}
    </div>
  );
}

function ModalWrapper({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 460, boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18 }}>{title}</h2>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'var(--surface2)', cursor: 'pointer', fontSize: 16, color: 'var(--muted)' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Alert({ type, msg }) {
  const isError = type === 'error';
  return <div style={{ background: isError ? 'var(--red-light)' : 'var(--green-light)', color: isError ? 'var(--red)' : 'var(--green)', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{msg}</div>;
}

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' };
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 14, color: 'var(--text)', outline: 'none' };
const cancelBtn  = { padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: 'var(--text)' };
const saveBtn    = { padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' };

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

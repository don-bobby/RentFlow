import { useState, useEffect } from 'react';
import API from '../services/api';

function getUser() {
  try { return JSON.parse(atob(localStorage.getItem('token').split('.')[1])); } catch { return null; }
}

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' };
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 14, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' };

export default function Users() {
  const [users,        setUsers]        = useState([]);
  const [plots,        setPlots]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [modal,        setModal]        = useState(null); // 'create' | 'edit' | 'plots'
  const [selected,     setSelected]     = useState(null);
  const [caretakerPlots,    setCaretakerPlots]    = useState([]); // plots assigned to selected caretaker
  const [plotCaretakers,    setPlotCaretakers]    = useState({}); // map of plot_id -> caretaker name
  const [addingPlot,   setAddingPlot]   = useState('');
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState('');
  const [msg,          setMsg]          = useState('');
  const [search,       setSearch]       = useState('');
  const [roleFilter,   setRoleFilter]   = useState('all');
  const [form,         setForm]         = useState({ name: '', email: '', password: '', role: 'caretaker', phone: '', plot_id: '' });

  const me = getUser();
  const isAdmin = me?.role === 'admin';

  async function load() {
    setLoading(true);
    try {
      const [ur, pr] = await Promise.all([API.get('/auth/users'), API.get('/plots')]);
      setUsers(Array.isArray(ur.data) ? ur.data : (ur.data.data || []));
      setPlots(Array.isArray(pr.data) ? pr.data : (pr.data.data || []));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    setSaving(true); setError('');
    try {
      await API.post('/auth/users', form);
      await load();
      setModal(null);
      setMsg('User created successfully.');
      setTimeout(() => setMsg(''), 3000);
    } catch (e) { setError(e.response?.data?.error || 'Failed to create user.'); }
    finally { setSaving(false); }
  }

  async function handleApprove(user, approved) {
    try {
      await API.patch(`/auth/users/${user.id}/approve`, { is_approved: approved });
      setUsers(us => us.map(u => u.id === user.id ? { ...u, is_approved: approved } : u));
    } catch (e) { alert(e.response?.data?.error || 'Failed to update.'); }
  }

  async function handleResetPassword(user) {
    if (!window.confirm(`Reset ${user.name}'s password to RentFlow@123?`)) return;
    try {
      await API.patch(`/auth/users/${user.id}/reset-password`);
      setMsg(`Password reset for ${user.name}.`);
      setTimeout(() => setMsg(''), 3000);
    } catch (e) { alert(e.response?.data?.error || 'Failed to reset password.'); }
  }

  async function openPlots(user) {
    setSelected(user);
    setAddingPlot('');
    setError('');
    if (user.role === 'caretaker') {
      try {
        const [plotsRes, allUsersRes] = await Promise.all([
          API.get(`/auth/users/${user.id}/plots`),
          API.get('/auth/users'),
        ]);
        setCaretakerPlots(plotsRes.data.data || []);
        // Build map of plot_id -> caretaker name from all caretakers
        const caretakers = (allUsersRes.data.data || []).filter(u => u.role === 'caretaker');
        const map = {};
        caretakers.forEach(c => { if (c.plot_id) map[c.plot_id] = c.name; });
        setPlotCaretakers(map);
      } catch { setCaretakerPlots([]); }
    } else {
      setCaretakerPlots([]);
    }
    setModal('plots');
  }

  async function handleAddPlot() {
    if (!addingPlot) return;
    try {
      const res = await API.post(`/auth/users/${selected.id}/assign-plot`, { plot_id: addingPlot });
      setCaretakerPlots(res.data.data || []);
      setAddingPlot('');
      // Update local users list
      setUsers(us => us.map(u => u.id === selected.id ? { ...u, plot_id: parseInt(addingPlot) } : u));
    } catch (e) { setError(e.response?.data?.error || 'Failed to assign plot.'); }
  }

  async function handleRemovePlot(plotId) {
    try {
      const res = await API.delete(`/auth/users/${selected.id}/assign-plot/${plotId}`);
      setCaretakerPlots(res.data.data || []);
    } catch (e) { setError(e.response?.data?.error || 'Failed to remove plot.'); }
  }

  const filtered = users.filter(u => {
    const matchRole   = roleFilter === 'all' || u.role === roleFilter;
    const matchSearch = search === '' || u.name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase());
    // Landlord should not see themselves in the list
    const notSelf = isAdmin || u.id !== me?.id;
    return matchRole && matchSearch && notSelf;
  });

  const roleBadge = (role, approved) => {
    const colors = {
      admin:     { bg: 'var(--primary-light, #ede9fe)', color: 'var(--primary, #7c3aed)' },
      landlord:  { bg: 'var(--blue-light, #dbeafe)',    color: 'var(--blue, #2563eb)'    },
      caretaker: { bg: 'var(--green-light, #dcfce7)',   color: 'var(--green, #16a34a)'   },
    };
    const c = colors[role] || { bg: 'var(--surface2)', color: 'var(--muted)' };
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ background: c.bg, color: c.color, padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{role}</span>
        {role === 'landlord' && (
          <span style={{ background: approved ? 'var(--green-light, #dcfce7)' : 'var(--amber-light, #fef3c7)', color: approved ? 'var(--green, #16a34a)' : 'var(--amber, #d97706)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>
            {approved ? 'approved' : 'pending'}
          </span>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Users</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>{users.length} total users</p>
        </div>
        <button onClick={() => { setForm({ name: '', email: '', password: '', role: 'caretaker', phone: '', plot_id: '' }); setError(''); setModal('create'); }}
          style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--primary, #7c3aed)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
          + Add User
        </button>
      </div>

      {msg && <div style={{ background: 'var(--green-light, #dcfce7)', color: 'var(--green, #16a34a)', padding: '10px 16px', borderRadius: 10, marginBottom: 16, fontWeight: 600, fontSize: 13 }}>{msg}</div>}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {['all', 'admin', 'landlord', 'caretaker'].map(r => (
          <button key={r} onClick={() => setRoleFilter(r)} style={{ padding: '7px 16px', borderRadius: 99, border: '1px solid var(--border)', background: roleFilter === r ? 'var(--primary, #7c3aed)' : 'var(--surface)', color: roleFilter === r ? '#fff' : 'var(--muted)', fontWeight: 600, fontSize: 13, textTransform: 'capitalize', cursor: 'pointer' }}>{r}</button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or email..."
          style={{ marginLeft: 'auto', padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 13, color: 'var(--text)', outline: 'none', width: 220 }} />
      </div>

      {/* Table */}
      <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>No users found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                {['Name', 'Email', 'Phone', 'Role', 'Assigned Plot(s)', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => (
                <tr key={u.id} style={{ borderTop: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>{u.name}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--muted)', fontSize: 13 }}>{u.email}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--muted)', fontSize: 13 }}>{u.phone || '—'}</td>
                  <td style={{ padding: '12px 16px' }}>{roleBadge(u.role, u.is_approved)}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13 }}>
                    {u.role === 'caretaker' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {u.caretaker_plots ? (() => {
                          const allPlots = u.caretaker_plots.split(', ');
                          const first    = allPlots[0];
                          const extra    = allPlots.length - 1;
                          return (
                            <>
                              <span style={{ background: 'var(--primary-light, #ede9fe)', color: 'var(--primary, #7c3aed)', padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>{first}</span>
                              {extra > 0 && (
                                <button onClick={() => openPlots(u)}
                                  style={{ background: 'var(--surface2)', color: 'var(--muted)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                                  +{extra} more
                                </button>
                              )}
                            </>
                          );
                        })() : (
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>No plot assigned</span>
                        )}
                        {isAdmin && (
                          <button onClick={() => openPlots(u)} style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 11, fontWeight: 600, color: 'var(--primary, #7c3aed)', cursor: 'pointer' }}>
                            ⚙️ Manage
                          </button>
                        )}
                      </div>
                    ) : u.role === 'landlord' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {u.landlord_plots ? (() => {
                          const allPlots = u.landlord_plots.split(', ');
                          const first    = allPlots[0];
                          const extra    = allPlots.length - 1;
                          return (
                            <>
                              <span style={{ background: 'var(--blue-light, #dbeafe)', color: 'var(--blue, #2563eb)', padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>{first}</span>
                              {extra > 0 && (
                                <button onClick={() => openPlots(u)}
                                  style={{ background: 'var(--surface2)', color: 'var(--muted)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                                  +{extra} more
                                </button>
                              )}
                            </>
                          );
                        })() : (
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>No properties</span>
                        )}
                        {isAdmin && (
                          <button onClick={() => openPlots(u)} style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 11, fontWeight: 600, color: 'var(--blue, #2563eb)', cursor: 'pointer' }}>
                            ⚙️ Manage
                          </button>
                        )}
                      </div>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {isAdmin && u.role === 'landlord' && !u.is_approved && (
                        <button onClick={() => handleApprove(u, true)} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: 'var(--green, #16a34a)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Approve</button>
                      )}
                      {isAdmin && u.role === 'landlord' && u.is_approved && (
                        <button onClick={() => handleApprove(u, false)} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: 'var(--amber, #d97706)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Suspend</button>
                      )}
                      {isAdmin && (
                        <button onClick={() => handleResetPassword(u)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, fontWeight: 600, color: 'var(--muted)', cursor: 'pointer' }}>Reset PW</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create User Modal */}
      {modal === 'create' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 460, boxShadow: 'var(--shadow-lg)' }}>
            <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18, marginBottom: 20 }}>Add User</h2>
            {error && <div style={{ background: 'var(--red-light, #fee2e2)', color: 'var(--red, #dc2626)', padding: '9px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{error}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Full Name"  value={form.name}     onChange={v => setForm(f => ({ ...f, name: v }))}     placeholder="e.g. John Kamau" />
              <Field label="Email"      value={form.email}    onChange={v => setForm(f => ({ ...f, email: v }))}    placeholder="john@example.com" type="email" />
              <Field label="Phone"      value={form.phone}    onChange={v => setForm(f => ({ ...f, phone: v }))}    placeholder="0712345678" />
              <Field label="Password"   value={form.password} onChange={v => setForm(f => ({ ...f, password: v }))} placeholder="Min 6 characters" type="password" />
              <div>
                <label style={labelStyle}>Role</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} style={inputStyle}>
                  {isAdmin && <option value="admin">Admin</option>}
                  {isAdmin && <option value="landlord">Landlord</option>}
                  <option value="caretaker">Caretaker</option>
                </select>
              </div>
              {form.role === 'caretaker' && (
                <div>
                  <label style={labelStyle}>Assign Plot (optional)</label>
                  <select value={form.plot_id} onChange={e => setForm(f => ({ ...f, plot_id: e.target.value }))} style={inputStyle}>
                    <option value="">— None —</option>
                    {plots.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={() => setModal(null)} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleCreate} disabled={saving} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--primary, #7c3aed)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                {saving ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Plots Modal */}
      {modal === 'plots' && selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 480, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18 }}>
                🏢 {selected.role === 'landlord' ? 'Properties' : 'Assigned Plots'} — {selected.name}
              </h2>
              <button onClick={() => setModal(null)} style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'var(--surface2)', cursor: 'pointer', fontSize: 16, color: 'var(--muted)' }}>×</button>
            </div>

            {error && <div style={{ background: 'var(--red-light, #fee2e2)', color: 'var(--red, #dc2626)', padding: '9px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{error}</div>}

            {selected.role === 'landlord' ? (
              /* Landlord — show owned properties read-only */
              <div>
                <label style={labelStyle}>Owned Properties</label>
                {plots.filter(p => p.user_id === selected.id).length === 0 ? (
                  <div style={{ color: 'var(--muted)', fontSize: 13, padding: '10px 0' }}>No properties owned by this landlord.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {plots.filter(p => p.user_id === selected.id).map(p => (
                      <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                          {p.location && <div style={{ fontSize: 12, color: 'var(--muted)' }}>📍 {p.location}</div>}
                        </div>
                        <span style={{ background: 'var(--blue-light, #dbeafe)', color: 'var(--blue, #2563eb)', padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>Owner</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Caretaker — assigned plots list */}
                <div style={{ marginBottom: 20 }}>
                  <label style={labelStyle}>Assigned Properties</label>
                  {caretakerPlots.length === 0 ? (
                    <div style={{ color: 'var(--muted)', fontSize: 13, padding: '10px 0' }}>No properties assigned yet.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {caretakerPlots.map(p => (
                        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                            {p.location && <div style={{ fontSize: 12, color: 'var(--muted)' }}>📍 {p.location}</div>}
                          </div>
                          <button onClick={() => handleRemovePlot(p.id)} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: 'var(--red-light, #fee2e2)', color: 'var(--red, #dc2626)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Add new plot to caretaker */}
                <div>
                  <label style={labelStyle}>Add Another Property</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select value={addingPlot} onChange={e => setAddingPlot(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                      <option value="">— Select property —</option>
                      {plots
                        .filter(p => !caretakerPlots.some(cp => cp.id === p.id))
                        .map(p => {
                          const assignedTo = plotCaretakers[p.id];
                          const isOccupied = assignedTo && assignedTo !== selected?.name;
                          return (
                            <option key={p.id} value={p.id} disabled={isOccupied}>
                              {p.name}{isOccupied ? ` (assigned to ${assignedTo})` : ''}
                            </option>
                          );
                        })}
                    </select>
                    <button onClick={handleAddPlot} disabled={!addingPlot} style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: 'var(--primary, #7c3aed)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      + Add
                    </button>
                  </div>
                </div>
              </>
            )}

            <div style={{ marginTop: 24, textAlign: 'right' }}>
              <button onClick={() => setModal(null)} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

import { useState, useEffect } from 'react';
import API from '../services/api';
import { useAuth } from '../context/AuthContext';

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' };

const AVATAR_COLORS = ['#7c3aed', '#2563eb', '#16a34a', '#d97706', '#dc2626', '#0891b2', '#db2777'];
function initialsAvatar(name) {
  const clean = (name || '?').trim();
  const parts = clean.split(/\s+/);
  const initials = ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
  let hash = 0;
  for (let i = 0; i < clean.length; i++) hash = (hash * 31 + clean.charCodeAt(i)) % AVATAR_COLORS.length;
  return { initials, color: AVATAR_COLORS[hash] };
}
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
  const [pendingOnly,  setPendingOnly]  = useState(false); // driven by ?filter=pending
  const [approveTarget, setApproveTarget] = useState(null); // landlord being approved in the modal
  const [selectedAgent, setSelectedAgent] = useState('');   // agent_id chosen in the approve modal
  const [form,         setForm]         = useState({ name: '', email: '', password: '', role: 'caretaker', phone: '', plot_id: '' });

  const { user: me, can } = useAuth();
  const isAdmin = me?.role === 'admin' || me?.role === 'super_admin';
  const isAgent = me?.role === 'agent';

  async function load() {
    setLoading(true);
    try {
      const [ur, pr] = await Promise.all([API.get('/auth/users'), API.get('/plots')]);
      setUsers(Array.isArray(ur.data) ? ur.data : (ur.data.data || []));
      setPlots(Array.isArray(pr.data) ? pr.data : (pr.data.data || []));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Support /users?filter=pending (e.g. from the dashboard's pending-landlords alert)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('filter') === 'pending') {
      setRoleFilter('landlord');
      setPendingOnly(true);
    }
  }, []);

  function clearPendingFilter() {
    setPendingOnly(false);
    window.history.replaceState({}, '', window.location.pathname);
  }

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

  function openApprove(user) {
    setApproveTarget(user);
    setSelectedAgent('');
    setError('');
    setModal('approve');
  }

  async function handleApprove() {
    if (!approveTarget) return;
    setSaving(true); setError('');
    try {
      const agentId = selectedAgent ? parseInt(selectedAgent) : null;
      await API.patch(`/auth/users/${approveTarget.id}/approve`, { agent_id: agentId });
      setUsers(us => us.map(u => u.id === approveTarget.id ? { ...u, is_approved: true, agent_id: agentId } : u));
      // The sidebar/topbar "pending landlords" badge (Layout.jsx) only
      // otherwise refreshes on a 30s poll — fire this so it updates
      // immediately instead of looking stale right after an approval.
      window.dispatchEvent(new Event('pending-landlords-changed'));
      setModal(null);
      setApproveTarget(null);
      setMsg('Landlord approved.');
      setTimeout(() => setMsg(''), 3000);
    } catch (e) { setError(e.response?.data?.error || 'Failed to approve.'); }
    finally { setSaving(false); }
  }

  async function handleReject(user) {
    const extra = user.role === 'agent'
      ? ' Their landlords will be switched to self-managed and will NOT be reassigned automatically if you reactivate this agent.'
      : '';
    if (!window.confirm(`Suspend ${user.name}? They will lose access until re-approved.${extra}`)) return;
    try {
      await API.patch(`/auth/users/${user.id}/reject`);
      setUsers(us => us.map(u => {
        if (u.id === user.id) return { ...u, is_approved: false };
        if (user.role === 'agent' && u.agent_id === user.id) return { ...u, agent_id: null };
        return u;
      }));
      // Suspending a landlord puts them back into "pending" — refresh the
      // sidebar/topbar badge immediately rather than waiting on its poll.
      if (user.role === 'landlord') window.dispatchEvent(new Event('pending-landlords-changed'));
    } catch (e) { alert(e.response?.data?.error || 'Failed to suspend user.'); }
  }

  // Reactivate a suspended agent (landlords use the Approve modal instead).
  async function handleReactivate(user) {
    if (!window.confirm(`Reactivate ${user.name}? They will be able to log in again.`)) return;
    try {
      await API.patch(`/auth/users/${user.id}/approve`, { agent_id: null });
      setUsers(us => us.map(u => u.id === user.id ? { ...u, is_approved: true } : u));
    } catch (e) { alert(e.response?.data?.error || 'Failed to reactivate user.'); }
  }

  // Reassign (or clear) an already-approved landlord's agent — separate from
  // the approve dialog, which only sets this at approval time.
  async function handleAgentChange(user, newAgentId) {
    try {
      const agentId = newAgentId ? parseInt(newAgentId) : null;
      await API.patch(`/auth/users/${user.id}/agent`, { agent_id: agentId });
      setUsers(us => us.map(u => u.id === user.id ? { ...u, agent_id: agentId } : u));
    } catch (e) { alert(e.response?.data?.error || 'Failed to update agent.'); }
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

  // Only active, approved agents are real choices for "assign an agent to
  // manage this landlord" — a suspended agent can't log in or act on
  // anything, so a landlord/agent assigned to one is silently cut off with
  // no error anywhere in the UI. Both the Approve-Landlord modal and the
  // inline per-row reassignment <select> read from this same list.
  const agents = users.filter(u => u.role === 'agent' && u.is_approved);

  // Non-admins never see themselves in the list (a landlord managing their
  // own caretakers shouldn't see "themselves" as a row), so every other
  // count on this page needs to be taken AFTER that exclusion too — not
  // from the raw `users` array. Previously the header ("N total users") and
  // the role badges counted the raw array while the table applied
  // `notSelf` separately, so a landlord with no caretakers yet saw
  // "1 total user" (themselves, counted) right above a "No users found"
  // table (themselves, excluded) — same list, two different answers.
  const visibleUsers = users.filter(u => isAdmin || u.id !== me?.id);
  const roleCounts = visibleUsers.reduce((m, u) => { m[u.role] = (m[u.role] || 0) + 1; return m; }, {});
  const pendingLandlordCount = visibleUsers.filter(u => u.role === 'landlord' && !u.is_approved).length;

  const filtered = visibleUsers.filter(u => {
    const matchRole    = roleFilter === 'all' || u.role === roleFilter;
    const matchSearch  = search === '' || u.name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase());
    const matchPending = !pendingOnly || (u.role === 'landlord' && !u.is_approved);
    return matchRole && matchSearch && matchPending;
  });

  const roleBadge = (role, approved) => {
    const colors = {
      admin:       { bg: 'var(--primary-light, #ede9fe)', color: 'var(--primary, #7c3aed)' },
      super_admin: { bg: 'var(--primary-light, #ede9fe)', color: 'var(--primary, #7c3aed)' },
      agent:       { bg: 'var(--pink-light, #fce7f3)',    color: '#db2777' },
      landlord:    { bg: 'var(--blue-light, #dbeafe)',    color: 'var(--blue, #2563eb)'    },
      caretaker:   { bg: 'var(--green-light, #dcfce7)',   color: 'var(--green, #16a34a)'   },
    };
    const c = colors[role] || { bg: 'var(--surface2)', color: 'var(--muted)' };
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ background: c.bg, color: c.color, padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{role}</span>
        {role === 'landlord' && (
          <span className={approved ? '' : 'us-pending-badge'} style={{ background: approved ? 'var(--green-light, #dcfce7)' : 'var(--amber-light, #fef3c7)', color: approved ? 'var(--green, #16a34a)' : 'var(--amber, #d97706)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>
            {approved ? '✓ approved' : '⏳ pending'}
          </span>
        )}
        {role === 'agent' && (
          <span className={approved ? '' : 'us-pending-badge'} style={{ background: approved ? 'var(--green-light, #dcfce7)' : 'var(--red-light, #fee2e2)', color: approved ? 'var(--green, #16a34a)' : 'var(--red, #dc2626)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>
            {approved ? '✓ active' : '⏸ suspended'}
          </span>
        )}
      </div>
    );
  };

  return (
    <div>
      <style>{`
        .us-row { transition: background 0.12s ease; }
        .us-row:hover { background: var(--primary-light, #ede9fe) !important; }
        .us-skel { background: var(--surface2); border-radius: 6px; animation: us-pulse 1.3s ease-in-out infinite; }
        @keyframes us-pulse { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
        @keyframes us-glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(217,119,6,0.4); } 50% { box-shadow: 0 0 0 4px rgba(217,119,6,0); } }
        .us-pending-badge { animation: us-glow 1.8s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .us-row, .us-skel, .us-pending-badge { transition: none; animation: none; } }
      `}</style>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>Users</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>
            {visibleUsers.length} total user{visibleUsers.length !== 1 ? 's' : ''}
            {pendingLandlordCount > 0 && <> · <span style={{ color: 'var(--amber, #d97706)', fontWeight: 700 }}>{pendingLandlordCount} pending approval</span></>}
          </p>
        </div>
        {(isAdmin || isAgent || can('users.create_caretaker')) && (
          <button onClick={() => { setForm({ name: '', email: '', password: '', role: 'caretaker', phone: '', plot_id: '' }); setError(''); setModal('create'); }}
            style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--primary, #7c3aed)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            + Add User
          </button>
        )}
      </div>

      {!loading && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          {Object.entries(roleCounts).map(([role, count]) => (
            <div key={role} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 14px', fontSize: 13 }}>
              <span style={{ fontWeight: 700, color: 'var(--text)' }}>{count}</span>
              <span style={{ color: 'var(--muted)', textTransform: 'capitalize', marginLeft: 5 }}>{role}{count !== 1 ? 's' : ''}</span>
            </div>
          ))}
        </div>
      )}

      {msg && <div style={{ background: 'var(--green-light, #dcfce7)', color: 'var(--green, #16a34a)', padding: '10px 16px', borderRadius: 10, marginBottom: 16, fontWeight: 600, fontSize: 13 }}>{msg}</div>}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {(isAdmin ? ['all', 'admin', 'agent', 'landlord', 'caretaker']
          : isAgent ? ['all', 'landlord', 'caretaker']
          : ['all', 'caretaker'] // landlord (either profile) — filtering by "landlord" is pointless, they only ever see themselves
        ).map(r => {
          const count = r === 'all' ? visibleUsers.length : (roleCounts[r] || 0);
          return (
            <button key={r} onClick={() => setRoleFilter(r)} style={{ padding: '7px 16px', borderRadius: 99, border: '1px solid var(--border)', background: roleFilter === r ? 'var(--primary, #7c3aed)' : 'var(--surface)', color: roleFilter === r ? '#fff' : 'var(--muted)', fontWeight: 600, fontSize: 13, textTransform: 'capitalize', cursor: 'pointer' }}>{r} ({count})</button>
          );
        })}
        {pendingOnly && (
          <button onClick={clearPendingFilter} style={{ padding: '7px 16px', borderRadius: 99, border: '1px solid var(--amber, #d97706)', background: 'var(--amber-light, #fef3c7)', color: 'var(--amber, #d97706)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Pending landlords only ×
          </button>
        )}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or email..."
          style={{ marginLeft: 'auto', padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 13, color: 'var(--text)', outline: 'none', width: 220 }} />
      </div>

      {/* Table */}
      <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0' }}>
                <div className="us-skel" style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} />
                <div className="us-skel" style={{ height: 14, width: `${35 + (i * 9) % 35}%` }} />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>👤</div>
            No users found.
          </div>
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
                <tr key={u.id} className="us-row" style={{ borderTop: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {(() => {
                        const { initials, color } = initialsAvatar(u.name);
                        return (
                          <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: `${color}26`, color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                            {initials}
                          </div>
                        );
                      })()}
                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{u.name}</span>
                    </div>
                  </td>
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
                        {(isAdmin || can('users.assign_caretaker')) && (
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
                    ) : u.role === 'agent' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {u.agent_plots ? (() => {
                          const allPlots = u.agent_plots.split(', ');
                          const first    = allPlots[0];
                          const extra    = allPlots.length - 1;
                          return (
                            <>
                              <span style={{ background: 'var(--pink-light, #fce7f3)', color: '#db2777', padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>{first}</span>
                              {extra > 0 && (
                                <button onClick={() => openPlots(u)}
                                  style={{ background: 'var(--surface2)', color: 'var(--muted)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                                  +{extra} more
                                </button>
                              )}
                            </>
                          );
                        })() : (
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>No properties managed</span>
                        )}
                        {isAdmin && (
                          <button onClick={() => openPlots(u)} style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 11, fontWeight: 600, color: '#db2777', cursor: 'pointer' }}>
                            ⚙️ Manage
                          </button>
                        )}
                      </div>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {isAdmin && u.role === 'landlord' && !u.is_approved && (
                        <button onClick={() => openApprove(u)} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: 'var(--green, #16a34a)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Approve</button>
                      )}
                      {isAdmin && u.role === 'landlord' && u.is_approved && (
                        <>
                          <button onClick={() => handleReject(u)} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: 'var(--amber, #d97706)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Suspend</button>
                          <select
                            value={u.agent_id || ''}
                            onChange={e => handleAgentChange(u, e.target.value)}
                            title="Assign or change this landlord's agent"
                            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 12, color: 'var(--text)', cursor: 'pointer' }}
                          >
                            <option value="">— Self-managed —</option>
                            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </>
                      )}
                      {isAdmin && u.role === 'agent' && u.is_approved && (
                        <button onClick={() => handleReject(u)} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: 'var(--amber, #d97706)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Suspend</button>
                      )}
                      {isAdmin && u.role === 'agent' && !u.is_approved && (
                        <button onClick={() => handleReactivate(u)} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: 'var(--green, #16a34a)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Reactivate</button>
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
                  {isAdmin && <option value="agent">Agent</option>}
                  {(isAdmin || isAgent) && <option value="landlord">Landlord</option>}
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

      {/* Approve Landlord Modal */}
      {modal === 'approve' && approveTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 440, boxShadow: 'var(--shadow-lg)' }}>
            <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Approve Landlord</h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>
              Approving <strong>{approveTarget.name}</strong>. Optionally assign an agent to manage them — leave this blank to keep them self-managed.
            </p>
            {error && <div style={{ background: 'var(--red-light, #fee2e2)', color: 'var(--red, #dc2626)', padding: '9px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{error}</div>}
            <div>
              <label style={labelStyle}>Assign Agent (optional)</label>
              <select value={selectedAgent} onChange={e => setSelectedAgent(e.target.value)} style={inputStyle}>
                <option value="">— Self-managed (no agent) —</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {agents.length === 0 && (
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>No agents exist yet — this landlord will be approved as self-managed.</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={() => { setModal(null); setApproveTarget(null); }} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleApprove} disabled={saving} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--green, #16a34a)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                {saving ? 'Approving...' : 'Approve'}
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
                🏢 {selected.role === 'landlord' ? 'Properties' : selected.role === 'agent' ? 'Managed Properties' : 'Assigned Plots'} — {selected.name}
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
            ) : selected.role === 'agent' ? (
              /* Agent — read-only: these come from plots.agent_id, which is
                 either inherited from the landlord's own agent setting or
                 overridden per-property. There's no separate add/remove
                 list here — reassign from the landlord's row (or the
                 property's own edit screen for a one-off override). */
              <div>
                <label style={labelStyle}>Managed Properties</label>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 10 }}>
                  Inherited from each property's landlord, or individually overridden on the property itself.
                </div>
                {plots.filter(p => p.agent_id === selected.id).length === 0 ? (
                  <div style={{ color: 'var(--muted)', fontSize: 13, padding: '10px 0' }}>No properties currently managed by this agent.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {plots.filter(p => p.agent_id === selected.id).map(p => (
                      <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                          {p.location && <div style={{ fontSize: 12, color: 'var(--muted)' }}>📍 {p.location}</div>}
                        </div>
                        <span style={{ background: 'var(--pink-light, #fce7f3)', color: '#db2777', padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>Agent</span>
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

// frontend/src/pages/PermissionOverrides.jsx
//
// System-wide view of every active permission override — across every
// user and every property — in one screen. Complements the two existing
// permission screens rather than replacing either:
//   - RolesPermissions.jsx answers "what does each ROLE get by default"
//   - Users.jsx's "🔑 Permissions" modal answers/edits "what does THIS user
//     get" (add/remove overrides for one person at a time)
//   - This page answers "what's been overridden, anywhere, for anyone" —
//     for an admin auditing the system instead of checking user by user.
// Read-only list + remove (reuses the same DELETE endpoint the per-user
// modal uses) — adding a new override still happens in that modal, so
// there's exactly one place that picks the permission/property/effect and
// enforces the admin-only/no-admin-targets rules.
//
// Admin/super_admin only — enforced both by the route guard wherever this
// gets mounted in app.jsx and by requireAdmin on the backend endpoint.

import { useState, useEffect, useMemo } from 'react';
import API from '../services/api';
import { useAuth } from '../context/AuthContext';
import { IconInline } from '../components/Icon';

const inputStyle = { padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13, outline: 'none' };

export default function PermissionOverrides() {
  const { user: me } = useAuth();
  const isAdmin = me?.role === 'admin' || me?.role === 'super_admin';

  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [removing, setRemoving] = useState(null); // override id currently being removed

  const [search, setSearch]           = useState('');
  const [userFilter, setUserFilter]   = useState('all');
  const [plotFilter, setPlotFilter]   = useState('all');
  const [effectFilter, setEffectFilter] = useState('all');

  async function load() {
    setLoading(true);
    try {
      const res = await API.get('/auth/permission-overrides');
      setRows(res.data.data || []);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load permission overrides.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (isAdmin) load(); }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // Distinct users/properties actually present in the data, for the filter
  // dropdowns — only ever shows options that could possibly matter, instead
  // of every user/property in the system.
  const users = useMemo(() => {
    const seen = new Map();
    rows.forEach(r => seen.set(r.user_id, r.user_name));
    return Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const plots = useMemo(() => {
    const seen = new Map();
    rows.forEach(r => { if (r.plot_id) seen.set(r.plot_id, r.plot_name); });
    return Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const filtered = rows.filter(r => {
    const q = search.trim().toLowerCase();
    const matchSearch = !q || r.permission.toLowerCase().includes(q) || r.user_name.toLowerCase().includes(q) || (r.plot_name || '').toLowerCase().includes(q) || (r.reason || '').toLowerCase().includes(q);
    const matchUser   = userFilter === 'all' || String(r.user_id) === userFilter;
    const matchPlot   = plotFilter === 'all' || (plotFilter === 'global' ? r.plot_id == null : String(r.plot_id) === plotFilter);
    const matchEffect = effectFilter === 'all' || r.effect === effectFilter;
    return matchSearch && matchUser && matchPlot && matchEffect;
  });

  async function handleRemove(o) {
    if (!window.confirm(`Remove this override?\n\n${o.user_name} — ${o.effect} ${o.permission}${o.plot_id ? ` (${o.plot_name})` : ' (all properties)'}${o.reason ? `\nReason on file: "${o.reason}"` : ''}`)) return;
    setRemoving(o.id);
    try {
      await API.delete(`/auth/users/${o.user_id}/permission-overrides/${o.id}`);
      setRows(rs => rs.filter(r => r.id !== o.id));
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to remove override.');
    } finally {
      setRemoving(null);
    }
  }

  if (!isAdmin) {
    return <div style={{ padding: 24 }}>This page is only available to super admin.</div>;
  }

  return (
    <div style={{ padding: 4 }}>
      <style>{`
        .po-row { transition: background 0.12s ease; }
        .po-row:hover { background: var(--surface2); }
        .po-skel { background: var(--surface2); border-radius: 8px; animation: po-pulse 1.3s ease-in-out infinite; }
        @keyframes po-pulse { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .po-row, .po-skel { transition: none; animation: none; } }
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontFamily: 'Bricolage Grotesque', fontSize: 32, fontWeight: 700, letterSpacing: '-0.4px', margin: '0 0 4px', color: 'var(--text)' }}><IconInline name="🔑" size={14} />Permission Overrides</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>
            Every grant/revoke currently set for a specific user, across every property. To add one, open that user's
            <IconInline name="🔑" size={14} />Permissions on the Users page — this view is for seeing and removing what's already there.
          </p>
        </div>
      </div>

      {error && <div style={{ padding: 24, color: 'var(--red, #dc2626)', background: 'var(--red-light, #fee2e2)', borderRadius: 10, marginBottom: 16 }}>{error}</div>}

      {loading && !error && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius, 10px)', padding: 16 }}>
          <div className="po-skel" style={{ height: 32, marginBottom: 10 }} />
          {[0, 1, 2, 3, 4].map(i => <div key={i} className="po-skel" style={{ height: 22, marginBottom: 8 }} />)}
        </div>
      )}

      {!loading && !error && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <select value={userFilter} onChange={e => setUserFilter(e.target.value)} style={inputStyle}>
              <option value="all">All users</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <select value={plotFilter} onChange={e => setPlotFilter(e.target.value)} style={inputStyle}>
              <option value="all">Show all</option>
              <option value="global">Not tied to a property</option>
              {plots.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={effectFilter} onChange={e => setEffectFilter(e.target.value)} style={inputStyle}>
              <option value="all">Grants &amp; revokes</option>
              <option value="grant">Grants only</option>
              <option value="revoke">Revokes only</option>
            </select>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search permission, user, property…"
              style={{ ...inputStyle, flex: 1, minWidth: 200 }}
            />
          </div>

          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius, 10px)', overflow: 'hidden' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  {['User', 'Role', 'Permission', 'Property', 'Effect', 'Added by', 'When', ''].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>
                    {rows.length === 0 ? 'No overrides set anywhere — every user is on their role\'s plain defaults.' : 'Nothing matches your filters.'}
                  </td></tr>
                )}
                {filtered.map(o => (
                  <tr key={o.id} className="po-row" style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--text)' }}>{o.user_name}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--muted)', textTransform: 'capitalize' }}>{o.user_role}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--text)' }}>
                      {o.permission}
                      {o.reason && (
                        <div style={{ fontSize: 11.5, color: 'var(--muted)', fontStyle: 'italic', marginTop: 2 }}>
                          “{o.reason}”
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--muted)' }}>{o.plot_id ? `${o.plot_name || `Property #${o.plot_id}`}` : 'All properties'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        background: o.effect === 'grant' ? 'var(--green-light, #dcfce7)' : 'var(--red-light, #fee2e2)',
                        color: o.effect === 'grant' ? 'var(--green, #16a34a)' : 'var(--red, #dc2626)',
                        padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, textTransform: 'uppercase',
                      }}>
                        {o.effect}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--muted)' }}>{o.granted_by_name || '—'}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--muted)' }}>{o.created_at ? new Date(o.created_at).toLocaleDateString('en-KE') : '—'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <button
                        onClick={() => handleRemove(o)}
                        disabled={removing === o.id}
                        style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: 'var(--red-light, #fee2e2)', color: 'var(--red, #dc2626)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >
                        {removing === o.id ? '…' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 0 && (
            <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
              Showing {filtered.length} of {rows.length} override{rows.length !== 1 ? 's' : ''}.
            </p>
          )}
        </>
      )}
    </div>
  );
}

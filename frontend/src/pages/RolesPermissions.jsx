// frontend/src/pages/RolesPermissions.jsx
//
// Visual editor for the role_permissions table (backend/database/migrations/
// 003_roles_permissions.sql). Super admin only — enforced both by the route
// guard in app.jsx and by requireAdmin on the backend endpoints themselves.
//
// super_admin is never shown as a column here: it always has every
// permission, hardcoded in middleware/permissions.js, and can't be edited.
//
// All fetch/toggle/rollback logic below is unchanged from before — this
// pass is presentation only: a search box (the matrix only grows over
// time), toggle switches instead of bare checkboxes, per-group icons and
// per-profile enabled-counts, row hover, and a skeleton loading state.

import { useState, useEffect, useMemo, Fragment } from 'react';
import { useAuth } from '../context/AuthContext';
import { getRolePermissions, setRolePermission } from '../services/api';

const PROFILE_LABELS = {
  agent:               'Agent',
  landlord_with_agent: 'Landlord (has agent)',
  landlord_self:       'Landlord (self-managed)',
  caretaker:           'Caretaker',
};

const GROUP_ICONS = {
  plots: '🏢', houses: '🏠', tenants: '👥', payments: '💳',
  maintenance: '🔧', expenses: '🧾', notices: '📢', messages: '💬',
  users: '👤', reports: '📊', deposits: '💰', listings: '🏷️',
};

// Turns "payments.record_manual" into { group: "payments", label: "record manual" }
function splitPermission(key) {
  const [group, ...rest] = key.split('.');
  return { group, label: rest.join('.').replace(/_/g, ' ') };
}

export default function RolesPermissions() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const [rows, setRows]       = useState([]);   // raw [{profile, permission, allowed}]
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [savingKey, setSavingKey] = useState(null); // "profile:permission" currently in flight
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!isSuperAdmin) return;
    (async () => {
      try {
        const res = await getRolePermissions();
        setRows(res.data.data);
        setProfiles(res.data.profiles);
      } catch (e) {
        setError(e.response?.data?.error || 'Failed to load permissions.');
      } finally {
        setLoading(false);
      }
    })();
  }, [isSuperAdmin]);

  // matrix[permission][profile] = boolean
  const matrix = useMemo(() => {
    const m = {};
    for (const r of rows) {
      (m[r.permission] ||= {})[r.profile] = r.allowed;
    }
    return m;
  }, [rows]);

  // Grouped, sorted list of every permission key that appears for ANY
  // profile, filtered by the search box (matches the group, the label, or
  // the full dotted key).
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byGroup = {};
    for (const key of Object.keys(matrix).sort()) {
      const { group, label } = splitPermission(key);
      if (q && !group.includes(q) && !label.includes(q) && !key.includes(q)) continue;
      (byGroup[group] ||= []).push({ key, label });
    }
    return byGroup;
  }, [matrix, search]);

  const totalPermissions = Object.keys(matrix).length;
  const visiblePermissions = Object.values(groups).reduce((n, g) => n + g.length, 0);

  // Per-profile enabled count, shown as a small badge under each column
  // header — a quick "how locked-down is this role" glance.
  const enabledCounts = useMemo(() => {
    const counts = {};
    for (const p of profiles) counts[p] = rows.filter(r => r.profile === p && r.allowed).length;
    return counts;
  }, [profiles, rows]);

  async function toggle(profile, permission, current) {
    const next = !current;
    const cellKey = `${profile}:${permission}`;
    setSavingKey(cellKey);

    // Optimistic update
    setRows(rs => {
      const exists = rs.some(r => r.profile === profile && r.permission === permission);
      return exists
        ? rs.map(r => (r.profile === profile && r.permission === permission ? { ...r, allowed: next } : r))
        : [...rs, { profile, permission, allowed: next }];
    });

    try {
      await setRolePermission(profile, permission, next);
    } catch (e) {
      // Roll back on failure
      setRows(rs => rs.map(r => (r.profile === profile && r.permission === permission ? { ...r, allowed: current } : r)));
      alert(e.response?.data?.error || 'Failed to update permission.');
    } finally {
      setSavingKey(null);
    }
  }

  if (!isSuperAdmin) {
    return <div style={{ padding: 24 }}>This page is only available to super admin.</div>;
  }

  return (
    <div className="rp2-page" style={{ padding: 4 }}>
      <style>{`
        .rp2-page input[type="text"]::placeholder { color: var(--muted); }
        .rp2-row { transition: background 0.12s ease; }
        .rp2-row:hover { background: var(--surface2); }
        .rp2-switch {
          position: relative; display: inline-block; width: 36px; height: 20px;
          flex-shrink: 0; cursor: pointer;
        }
        .rp2-switch input { opacity: 0; width: 0; height: 0; }
        .rp2-slider {
          position: absolute; inset: 0; background: var(--border);
          border-radius: 99px; transition: background 0.15s ease;
        }
        .rp2-slider::before {
          content: ''; position: absolute; width: 16px; height: 16px; left: 2px; top: 2px;
          background: #fff; border-radius: 50%; transition: transform 0.15s ease;
          box-shadow: 0 1px 3px rgba(0,0,0,0.25);
        }
        .rp2-switch input:checked + .rp2-slider { background: var(--green, #16a34a); }
        .rp2-switch input:checked + .rp2-slider::before { transform: translateX(16px); }
        .rp2-switch input:disabled + .rp2-slider { opacity: 0.5; cursor: wait; }
        .rp2-skel { background: var(--surface2); border-radius: 8px; animation: rp2-pulse 1.3s ease-in-out infinite; }
        @keyframes rp2-pulse { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .rp2-row, .rp2-slider, .rp2-slider::before, .rp2-skel { transition: none; animation: none; } }
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontFamily: 'Space Grotesk, sans-serif', color: 'var(--text)' }}>🛡️ Roles &amp; Permissions</h2>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>
            Control what each role can do. Super admin always has full access and isn't shown here.
          </p>
        </div>
        {!loading && !error && (
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Search permissions…"
            style={{
              padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border)',
              background: 'var(--surface2)', color: 'var(--text)', fontSize: 13,
              minWidth: 220, outline: 'none',
            }}
          />
        )}
      </div>

      {error && (
        <div style={{ padding: 24, color: 'var(--red, #dc2626)', background: 'var(--red-light, #fee2e2)', borderRadius: 10 }}>{error}</div>
      )}

      {loading && !error && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius, 10px)', padding: 16 }}>
          <div className="rp2-skel" style={{ height: 32, marginBottom: 10 }} />
          {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="rp2-skel" style={{ height: 22, marginBottom: 8 }} />)}
        </div>
      )}

      {!loading && !error && (
        <>
          <div style={{ overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius, 10px)', maxHeight: '72vh' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  <th style={{ textAlign: 'left', padding: '12px 14px', position: 'sticky', left: 0, top: 0, background: 'var(--surface2)', zIndex: 2, color: 'var(--text)' }}>
                    Permission
                  </th>
                  {profiles.map(p => (
                    <th key={p} style={{ textAlign: 'center', padding: '12px 14px', minWidth: 150, position: 'sticky', top: 0, background: 'var(--surface2)', zIndex: 1 }}>
                      <div style={{ color: 'var(--text)' }}>{PROFILE_LABELS[p] || p}</div>
                      <div style={{ fontWeight: 400, fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        {enabledCounts[p] || 0} enabled
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visiblePermissions === 0 && (
                  <tr><td colSpan={profiles.length + 1} style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>
                    No permissions match "{search}".
                  </td></tr>
                )}
                {Object.entries(groups).map(([group, perms]) => (
                  <Fragment key={group}>
                    <tr>
                      <td colSpan={profiles.length + 1} style={{
                        padding: '8px 14px', fontWeight: 700, fontSize: 11,
                        textTransform: 'uppercase', letterSpacing: 0.5,
                        color: 'var(--muted)', background: 'var(--surface)',
                        borderTop: '1px solid var(--border)',
                      }}>
                        {GROUP_ICONS[group] || '•'} {group}
                      </td>
                    </tr>
                    {perms.map(({ key, label }) => (
                      <tr key={key} className="rp2-row" style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 14px', position: 'sticky', left: 0, background: 'var(--surface)', color: 'var(--text)' }}>{label}</td>
                        {profiles.map(profile => {
                          const allowed = matrix[key]?.[profile] || false;
                          const cellKey = `${profile}:${key}`;
                          return (
                            <td key={profile} style={{ textAlign: 'center', padding: '8px 14px' }}>
                              <label className="rp2-switch" title={allowed ? 'Enabled — click to disable' : 'Disabled — click to enable'}>
                                <input
                                  type="checkbox"
                                  checked={allowed}
                                  disabled={savingKey === cellKey}
                                  onChange={() => toggle(profile, key, allowed)}
                                />
                                <span className="rp2-slider" />
                              </label>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {search && visiblePermissions > 0 && (
            <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
              Showing {visiblePermissions} of {totalPermissions} permissions.
            </p>
          )}
        </>
      )}
    </div>
  );
}

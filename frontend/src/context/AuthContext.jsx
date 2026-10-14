// frontend/src/context/AuthContext.jsx
//
// Replaces the old getUser() token-decode pattern in app.jsx. That approach
// only ever saw { id, role } from the token itself, which is up to 7 days
// stale. This calls GET /api/auth/me, which reads the LIVE database row
// (role, agent_id, profile, permissions) on every load.

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import API from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null); // { id, name, email, role, agent_id, profile, permissions }
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await API.get('/auth/me');
      setUser(res.data.data);
    } catch {
      // Token invalid/expired/user deleted — log them out client-side.
      localStorage.removeItem('token');
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // permissions is ['*'] for super_admin, or a real list (role defaults +
  // any GLOBAL overrides) for everyone else — that part is unchanged.
  //
  // Pass a second argument, plotId, to check the permission against ONE
  // specific property instead: this now matches the backend's
  // getPermissions(user, plotId) resolution exactly — most specific wins —
  // using the per-property overrides GET /auth/me now sends down in
  // user.overrides. If there's no override for that exact property, the
  // answer falls back to the plain (role + global-override) permissions
  // list, same as calling can(permission) with no plotId at all.
  const can = useCallback(
    (permission, plotId) => {
      if (!user) return false;
      if (user.permissions?.includes('*')) return true;

      let allowed = user.permissions?.includes(permission) ?? false;

      if (plotId != null && Array.isArray(user.overrides)) {
        const plotIdNum = Number(plotId);
        const override = user.overrides.find(
          (o) => o.plot_id === plotIdNum && o.permission === permission
        );
        if (override) allowed = override.effect === 'grant';
      }

      return allowed;
    },
    [user]
  );

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, can, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// Usage: const { user, can, loading } = useAuth();
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

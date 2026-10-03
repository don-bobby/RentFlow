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

  // permissions is ['*'] for super_admin, or a real list for everyone else.
  const can = useCallback(
    (permission) => {
      if (!user) return false;
      return user.permissions?.includes('*') || user.permissions?.includes(permission);
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

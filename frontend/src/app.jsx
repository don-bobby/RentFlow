import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard      from './pages/Dashboard';
import Tenants        from './pages/Tenants';
import Properties     from './pages/Properties';
import Payments       from './pages/Payments';
import Maintenance    from './pages/Maintenance';
import PublicListings from './pages/PublicListings';
import Login          from './pages/Login';
import Register       from './pages/Register';
import Users          from './pages/Users';
import Reports        from './pages/Reports';
import Layout         from './components/Layout';
import TenantLogin    from './pages/TenantLogin';
import TenantPortal   from './pages/TenantPortal';
import ListingsAdmin  from './pages/Listings';
import Notices        from './pages/Notices';
import RolesPermissions from './pages/RolesPermissions';
import Expenses from './pages/Expenses';
import SmsMessages from './pages/SmsMessages';
import { AuthProvider, useAuth } from './context/AuthContext';
import { initTheme } from './utils/theme';

// Replaces the old getUser() token-decode. `user` here is the LIVE database
// row (role, agent_id, profile, permissions) from GET /api/auth/me, not a
// stale snapshot from the token.
function ProtectedRoute({ children, allowedRoles }) {
  const { user, loading } = useAuth();
  if (loading) return null; // avoid a flash of redirect while /me is in flight
  if (!user) return <Navigate to="/login" />;
  if (allowedRoles && !allowedRoles.includes(user.role)) return <Navigate to="/" />;
  return children;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return null; // brief blank screen while /me resolves on first load

  return (
    <Routes>
      {/* Public pages */}
      <Route path="/listings"       element={<PublicListings />} />
      <Route path="/login"          element={<Login />} />
      <Route path="/register"       element={<Register />} />

      {/* Tenant portal */}
      <Route path="/tenant/login"     element={<TenantLogin />} />
      <Route path="/tenant/dashboard" element={<TenantPortal />} />

      {/* Protected pages */}
      <Route path="/" element={user ? <Layout /> : <Navigate to="/listings" />}>
        <Route index             element={<Dashboard />} />
        <Route path="properties" element={<Properties />} />
        <Route path="tenants"    element={<Tenants />} />
        <Route path="payments"   element={
          <ProtectedRoute allowedRoles={['admin', 'super_admin', 'agent', 'landlord']}>
            <Payments />
          </ProtectedRoute>
        } />
        <Route path="maintenance" element={<Maintenance />} />
        <Route path="reports"     element={
          <ProtectedRoute allowedRoles={['admin', 'super_admin', 'agent', 'landlord']}>
            <Reports />
          </ProtectedRoute>
        } />
        <Route path="expenses" element={
          <ProtectedRoute allowedRoles={['admin', 'super_admin', 'agent', 'landlord', 'caretaker']}>
            <Expenses />
          </ProtectedRoute>
        } />
        <Route path="manage/listings" element={
          <ProtectedRoute allowedRoles={['admin', 'super_admin', 'agent', 'landlord']}>
            <ListingsAdmin />
          </ProtectedRoute>
        } />
        <Route path="notices" element={
          <ProtectedRoute allowedRoles={['admin', 'super_admin', 'agent', 'landlord', 'caretaker']}>
            <Notices defaultTab="notices" />
          </ProtectedRoute>
        } />
        <Route path="messages" element={
          <ProtectedRoute allowedRoles={['admin', 'super_admin', 'agent', 'landlord', 'caretaker']}>
            <Notices defaultTab="messages" />
          </ProtectedRoute>
        } />
        <Route path="users"       element={
          <ProtectedRoute allowedRoles={['admin', 'super_admin', 'agent', 'landlord']}>
            <Users />
          </ProtectedRoute>
        } />
        <Route path="roles" element={
          <ProtectedRoute allowedRoles={['admin', 'super_admin']}>
            <RolesPermissions />
          </ProtectedRoute>
        } />
        {/* Admin/agent only — matches the backend's sms.js restriction
            exactly. Landlord and caretaker never see this route at all. */}
        <Route path="sms" element={
          <ProtectedRoute allowedRoles={['admin', 'super_admin', 'agent']}>
            <SmsMessages />
          </ProtectedRoute>
        } />
      </Route>
    </Routes>
  );
}

// Applies --bg/--surface/--border/--text/--muted etc. to <html> ONCE, for
// every route, before this app renders anything. Previously these only
// existed on pages wrapped in <Layout> (the staff app) — TenantLogin,
// Login, Register, and PublicListings never got them at all, which is why
// elements using var(--xxx) with no fallback (like TenantLogin's Sign In
// button) were rendering invisible.
initTheme();

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard      from './pages/Dashboard';
import Tenants        from './pages/Tenants';
import Properties     from './pages/Properties';
import Building3D      from './pages/Building3D';
import EstateMap        from './pages/EstateMap';
import Specials         from './pages/Specials';
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
import PermissionOverrides from './pages/PermissionOverrides';
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
        <Route path="building"   element={<Building3D />} />
        {/* Admin-only: the whole estate on one map, with fly/walk modes and a drone tour. */}
        <Route path="estate" element={
          <ProtectedRoute allowedRoles={['admin', 'super_admin']}>
            <EstateMap />
          </ProtectedRoute>
        } />
        {/* Admin-only: Airbnb stays and properties for sale shown on the public listings page. */}
        <Route path="specials" element={
          <ProtectedRoute allowedRoles={['admin', 'super_admin']}>
            <Specials />
          </ProtectedRoute>
        } />
        <Route path="tenants"    element={<Tenants />} />
        {/* Was gated here by allowedRoles={['admin','super_admin','agent',
            'landlord']} — a role-only guest list checked BEFORE the page
            even tried to load data, same mistake as the old backend
            requirePermission('payments.view') middleware we already removed.
            An admin can grant payments.view to ANY role for a single
            property (we proved this works for caretaker on the backend),
            but this list had no way to know that — it only ever checked
            the requester's role, so a caretaker with a valid per-property
            grant was bounced back to the Dashboard before the backend ever
            got a chance to apply it. Removed, to match how Maintenance and
            Tenants already work: load the page for anyone logged in, and
            let the backend's per-row permission filter (already fixed)
            decide what they actually see. */}
        <Route path="payments"   element={<Payments />} />
        <Route path="maintenance" element={<Maintenance />} />
        {/* Same bug as Payments had, same fix: this was gated by
            allowedRoles={['admin','super_admin','agent','landlord']} — no
            'caretaker' — checked purely by role, before the page ever got
            a chance to load. A caretaker with a per-property report
            permission granted via an override was bounced back to the
            Dashboard regardless. Removed, to match Payments/Tenants/
            Maintenance: load the page for anyone logged in, and let the
            backend (GET /auth/my-plot-permissions, already proven correct
            by test-reports-plot-permissions.js) decide what data they
            actually see inside it. */}
        <Route path="reports"     element={<Reports />} />
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
        {/* Same admin-only gate as "roles" above — this page's own backend
            endpoint (GET /api/auth/permission-overrides) is requireAdmin
            too, so this route guard is a UX nicety (redirect instead of a
            403 flash), not the actual enforcement. */}
        <Route path="permission-overrides" element={
          <ProtectedRoute allowedRoles={['admin', 'super_admin']}>
            <PermissionOverrides />
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

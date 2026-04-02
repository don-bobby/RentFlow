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

function getUser() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload;
  } catch {
    return null;
  }
}

function ProtectedRoute({ children, allowedRoles }) {
  const user = getUser();
  if (!user) return <Navigate to="/login" />;
  if (allowedRoles && !allowedRoles.includes(user.role)) return <Navigate to="/" />;
  return children;
}

export default function App() {
  const user = getUser();

  return (
    <BrowserRouter>
      <Routes>
        {/* Public pages */}
        <Route path="/listings"  element={<PublicListings />} />
        <Route path="/login"     element={<Login />} />
        <Route path="/register"  element={<Register />} />

        {/* Protected pages */}
        <Route path="/" element={user ? <Layout /> : <Navigate to="/login" />}>
          <Route index             element={<Dashboard />} />
          <Route path="properties" element={<Properties />} />
          <Route path="tenants"    element={<Tenants />} />
          <Route path="payments"   element={
            <ProtectedRoute allowedRoles={['admin', 'landlord']}>
              <Payments />
            </ProtectedRoute>
          } />
          <Route path="maintenance" element={<Maintenance />} />
          <Route path="reports"     element={
            <ProtectedRoute allowedRoles={['admin', 'landlord']}>
              <Reports />
            </ProtectedRoute>
          } />
          <Route path="users"       element={
            <ProtectedRoute allowedRoles={['admin', 'landlord']}>
              <Users />
            </ProtectedRoute>
          } />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

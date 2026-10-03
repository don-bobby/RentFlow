// frontend/src/components/PendingLandlordsAlert.jsx
//
// Two render modes from one shared data source (avoids two separate
// polling loops hitting the same endpoint):
//   <PendingLandlordsAlert variant="banner" />  — full alert for the Dashboard
//   <PendingLandlordsAlert variant="badge" />   — small count for the sidebar

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getPendingLandlordsCount } from '../services/api';

export default function PendingLandlordsAlert({ variant = 'banner' }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [count, setCount] = useState(0);

  // Approval is admin/super-admin only today (matches requireAdmin on the
  // backend route) — it isn't in the role_permissions matrix, so this
  // checks role directly rather than can(...).
  const canApprove = user?.role === 'admin' || user?.role === 'super_admin';

  useEffect(() => {
    if (!canApprove) return;

    let cancelled = false;
    const fetchCount = async () => {
      try {
        const res = await getPendingLandlordsCount();
        if (!cancelled) setCount(res.data.count);
      } catch {
        // Stay quiet — a failed poll shouldn't disrupt the dashboard.
      }
    };

    fetchCount();
    const interval = setInterval(fetchCount, 45000); // 45s poll
    return () => { cancelled = true; clearInterval(interval); };
  }, [canApprove]);

  if (!canApprove || count === 0) return null;

  if (variant === 'badge') {
    return (
      <span
        title={`${count} landlord(s) awaiting approval`}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          minWidth: 18, height: 18, padding: '0 5px', borderRadius: 99,
          background: 'var(--red, #dc2626)', color: '#fff',
          fontSize: 11, fontWeight: 700, marginLeft: 6,
        }}
      >
        {count}
      </span>
    );
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, padding: '12px 18px', marginBottom: 20,
      background: 'var(--amber-light, #fef3c7)', border: '1px solid var(--amber, #d97706)',
      borderRadius: 'var(--radius, 10px)', color: 'var(--amber, #d97706)',
      fontSize: 13, fontWeight: 600,
    }}>
      <span>
        ⏳ {count} landlord{count > 1 ? 's are' : ' is'} waiting for approval.
      </span>
      <button
        onClick={() => navigate('/users?filter=pending')}
        style={{
          padding: '6px 14px', borderRadius: 8, border: 'none',
          background: 'var(--amber, #d97706)', color: '#fff',
          fontWeight: 700, fontSize: 12, cursor: 'pointer', flexShrink: 0,
        }}
      >
        Review
      </button>
    </div>
  );
}

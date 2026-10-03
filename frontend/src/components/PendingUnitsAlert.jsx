// frontend/src/components/PendingUnitsAlert.jsx
//
// Same pattern as PendingLandlordsAlert.jsx — a dashboard banner that
// actually gets noticed, instead of a caretaker-submitted unit sitting
// quietly in the Notices tab with nothing but an unread badge. Shown only
// to whoever can actually approve a unit (can('houses.approve')) — which
// per the matrix is admin, agent, and self-managed landlords, never a
// view-only landlord_with_agent or the caretaker who submitted it.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import API from '../services/api';

export default function PendingUnitsAlert({ variant = 'banner' }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [count, setCount] = useState(0);
  const [plotIds, setPlotIds] = useState([]);

  const canApprove = can('houses.approve');

  useEffect(() => {
    if (!canApprove) return;

    let cancelled = false;
    const fetchCount = async () => {
      try {
        const res = await API.get('/houses/pending-approval-count');
        if (!cancelled) {
          setCount(res.data.count || 0);
          setPlotIds(res.data.plot_ids || []);
        }
      } catch {
        // stay quiet — a failed poll shouldn't disrupt the dashboard
      }
    };

    fetchCount();
    const interval = setInterval(fetchCount, 30000); // 30s poll
    window.addEventListener('pending-units-changed', fetchCount);
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('pending-units-changed', fetchCount); };
  }, [canApprove]);

  if (!canApprove || count === 0) return null;

  if (variant === 'badge') {
    return (
      <span
        title={`${count} unit(s) awaiting approval`}
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
        🏠 {count} unit{count > 1 ? 's are' : ' is'} waiting for approval.
      </span>
      <button
        onClick={() => navigate('/properties', { state: { highlightPlotId: plotIds[0] } })}
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

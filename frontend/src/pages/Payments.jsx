import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import API, { getUnmatchedPayments, matchPayment, deletePayment } from '../services/api';
import { useAuth } from '../context/AuthContext';
import Icon, { IconInline, Caret } from '../components/Icon';

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Same deterministic initials-avatar as Tenants.jsx — same tenant, same color.
const AVATAR_COLORS = ['#1b6b45', '#2563eb', '#16a34a', '#d97706', '#dc2626', '#0891b2', '#db2777'];
function initialsAvatar(name) {
  const clean = (name || '?').trim();
  const parts = clean.split(/\s+/);
  const initials = ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
  let hash = 0;
  for (let i = 0; i < clean.length; i++) hash = (hash * 31 + clean.charCodeAt(i)) % AVATAR_COLORS.length;
  return { initials, color: AVATAR_COLORS[hash] };
}

// Tracks the light/dark theme Layout.jsx sets via document.documentElement's
// data-theme attribute — same helper used on Dashboard.jsx, Properties.jsx and
// Tenants.jsx.
function useIsDarkMode() {
  const [isDark, setIsDark] = useState(document.documentElement.getAttribute('data-theme') === 'dark');
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setIsDark(el.getAttribute('data-theme') === 'dark'));
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

const BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

// Row "⋯" menu. Position is computed from the button and rendered fixed so
// the table's overflow never clips it. Items: { label, onClick, danger?, divider? }
function RowMenu({ id, openMenu, setOpenMenu, items }) {
  const btnRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const isOpen = openMenu === id;
  function toggle(e) {
    e.stopPropagation();
    if (!isOpen && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const menuH = items.length * 40 + 8;
      const top = r.bottom + 6 + menuH > window.innerHeight ? Math.max(8, r.top - 6 - menuH) : r.bottom + 6;
      setPos({ top, left: r.right });
    }
    setOpenMenu(isOpen ? null : id);
  }
  return (
    <div style={{ display: 'inline-block' }}>
      <button ref={btnRef} onClick={toggle} title="More actions" aria-label="More actions"
        style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: isOpen ? 'var(--surface2)' : 'var(--surface)', color: 'var(--text)', fontSize: 18, lineHeight: 1, cursor: 'pointer', fontWeight: 700 }}>⋯</button>
      {isOpen && (
        <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-100%)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-lg)', minWidth: 190, zIndex: 500, overflow: 'hidden', padding: '4px 0' }}>
          {items.map((it, i) => it.divider ? (
            <div key={i} style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          ) : (
            <button key={i} onClick={() => { setOpenMenu(null); it.onClick(); }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 14px', border: 'none', background: 'transparent', fontSize: 13, fontWeight: it.danger ? 700 : 500, color: it.danger ? 'var(--red, #dc2626)' : 'var(--text)', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ width: 18, display: 'flex', justifyContent: 'center' }}>{it.icon && <Icon name={it.icon} size={16} />}</span>{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Payments() {
  const { can } = useAuth();
  const [payments,       setPayments]       = useState([]);
  const [reconcileOpen,  setReconcileOpen]  = useState(false);
  const [unmatched,      setUnmatched]      = useState([]);
  const [unmatchedLoad,  setUnmatchedLoad]  = useState(false);
  const [matchPicks,     setMatchPicks]     = useState({}); // { [paymentId]: tenantId }
  const [matching,       setMatching]       = useState(null); // payment id currently being matched
  const [deleting,       setDeleting]       = useState(null); // payment id currently being deleted
  const [openMenu,       setOpenMenu]       = useState(null);
  const [toast,          setToast]          = useState('');
  const [receiptModal,   setReceiptModal]   = useState(null); // payment object, or null
  const [receiptData,    setReceiptData]    = useState(null); // full receipt (all months + utilities), loaded from the server
  const [allocateModal,  setAllocateModal]  = useState(null); // payment object, or null
  const [allocateYear,   setAllocateYear]   = useState(new Date().getFullYear());
  const [allocateMonth,  setAllocateMonth]  = useState(new Date().getMonth() + 1);
  const [allocateSaving, setAllocateSaving] = useState(false);
  const [allocateError,  setAllocateError]  = useState('');
  const [tenants,        setTenants]        = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [modal,          setModal]          = useState(false);
  const [stkModal,       setStkModal]       = useState(false);
  const [stkTenant,      setStkTenant]      = useState(null);   // tenant object for STK modal
  const [stkPhone,       setStkPhone]       = useState('');
  const [stkAmount,      setStkAmount]      = useState('');
  const [stkStatus,      setStkStatus]      = useState('idle'); // idle | pending | success | failed
  const [stkMsg,         setStkMsg]         = useState('');
  const [stkLoading,     setStkLoading]     = useState(false);
  const [arrears,        setArrears]        = useState(null);
  const [arrearsLoading, setArrearsLoading] = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState('');
  const [filter,         setFilter]         = useState('all');
  const location = useLocation();
  const [plotFilter,     setPlotFilter]     = useState('all'); // 'all' or a plot id — narrows the payments list to one property
  const [tenantFilter,   setTenantFilter]   = useState('all'); // 'all' or a tenant id — narrows the payments list to one tenant
  const [allocatedSort,  setAllocatedSort]  = useState(null); // null (table order) | 'asc' | 'desc' — sorts rows by the "Allocated To" month
  const [utilities,      setUtilities]      = useState([]); // optional utility lines: [{ type, amount }]
  const [form,           setForm]           = useState({
    tenant_id: '', amount: '', payment_date: '', payment_method: 'mpesa', reference_number: '', notes: '',
  });

  async function load() {
    setLoading(true);
    try {
      const [pr, tr] = await Promise.all([API.get('/payments'), API.get('/tenants')]);
      setPayments(Array.isArray(pr.data) ? pr.data : (pr.data.data || []));
      setTenants(Array.isArray(tr.data) ? tr.data : (tr.data.data || []));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    setReceiptData(null);
    if (!receiptModal) return;
    let cancelled = false;
    API.get(`/payments/receipt/${receiptModal.id}`)
      .then(res => { if (!cancelled) setReceiptData(res.data.data); })
      .catch(() => { /* falls back to the single payment row */ });
    return () => { cancelled = true; };
  }, [receiptModal]);

  useEffect(() => {
    const close = () => setOpenMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); };
  }, []);

  function flash(msg) { setToast(msg); setTimeout(() => setToast(''), 2200); }

  function copyRef(p) {
    const ref = p.receipt_no || p.transaction_id;
    if (!ref) return;
    (navigator.clipboard?.writeText(String(ref)) || Promise.reject()).then(() => flash('Reference copied'), () => flash('Could not copy'));
  }

  function whatsappReceipt(p) {
    const t = tenants.find(x => x.id === p.tenant_id);
    let phone = String(t?.phone || '').replace(/[^\d]/g, '');
    if (phone.startsWith('0')) phone = '254' + phone.slice(1);
    else if (phone.startsWith('7') || phone.startsWith('1')) phone = '254' + phone;
    if (!phone) { flash('No phone number on file'); return; }
    const forTxt = p.for_year && p.for_month ? ` for ${new Date(p.for_year, p.for_month - 1, 1).toLocaleString('en-KE', { month: 'long', year: 'numeric' })}` : '';
    const msg = `Hello ${p.tenant_name || ''}, we have received your payment of KES ${parseFloat(p.amount).toLocaleString()}${forTxt} on ${new Date(p.payment_date).toLocaleDateString('en-KE')}${p.receipt_no ? ` (Ref: ${p.receipt_no})` : ''}. Thank you!${p.plot_name ? ` — ${p.plot_name}` : ''}`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  }

  async function loadArrears(tenantId) {
    if (!tenantId) { setArrears(null); return; }
    setArrearsLoading(true);
    try {
      const res = await API.get(`/payments/arrears/${tenantId}`);
      setArrears(res.data.data);
    } catch (e) { setArrears(null); }
    finally { setArrearsLoading(false); }
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const tenant = tenants.find(t => String(t.id) === String(form.tenant_id));
      const utilItems = utilities
        .filter(u => parseFloat(u.amount) > 0)
        .map(u => ({ type: u.type, amount: parseFloat(u.amount) }));
      const hasRent = parseFloat(form.amount) > 0;
      if (!hasRent && utilItems.length === 0) { setError('Enter a rent amount or a utility amount.'); setSaving(false); return; }
      if (hasRent) await API.post('/payments', { ...form, unit_id: tenant?.house_id });
      if (utilItems.length) {
        await API.post('/utilities', {
          tenant_id: form.tenant_id, payment_date: form.payment_date, method: form.payment_method,
          reference: form.reference_number, notes: form.notes, items: utilItems,
        });
      }
      setUtilities([]);
      await load();
      setModal(false);
      setArrears(null);
    } catch (e) {
      setError(e.response?.data?.message || e.response?.data?.error || e.message || 'Failed to record payment');
    } finally { setSaving(false); }
  }

  // ── Reconciliation (unmatched M-Pesa payments) ──────────────────
  async function openReconcile() {
    setReconcileOpen(true);
    setUnmatchedLoad(true);
    try {
      const res = await getUnmatchedPayments();
      setUnmatched(res.data.data || []);
    } catch (e) {
      console.error(e);
      setUnmatched([]);
    } finally {
      setUnmatchedLoad(false);
    }
  }

  async function handleMatch(payment) {
    const tenantId = matchPicks[payment.id];
    if (!tenantId) return;
    const tenant = tenants.find(t => String(t.id) === String(tenantId));
    setMatching(payment.id);
    try {
      await matchPayment(payment.id, tenantId, tenant?.house_id);
      setUnmatched(list => list.filter(p => p.id !== payment.id));
      await load(); // refresh the main table so the now-matched row shows up
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to match payment.');
    } finally {
      setMatching(null);
    }
  }

  async function handleAllocate() {
    setAllocateSaving(true); setAllocateError('');
    try {
      const res = await API.patch(`/payments/${allocateModal.id}/allocate`, { for_year: allocateYear, for_month: allocateMonth });
      setPayments(list => list.map(p => p.id === allocateModal.id ? { ...p, ...res.data.data } : p));
      setAllocateModal(null);
    } catch (e) {
      setAllocateError(e.response?.data?.error || 'Failed to assign month.');
    } finally { setAllocateSaving(false); }
  }

  async function handleDelete(payment) {
    if (!window.confirm(`Delete this payment of KES ${parseFloat(payment.amount).toLocaleString()}? This cannot be undone.`)) return;
    setDeleting(payment.id);
    try {
      await deletePayment(payment.id);
      setPayments(list => list.filter(p => p.id !== payment.id));
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to delete payment.');
    } finally {
      setDeleting(null);
    }
  }

  // ── STK Push ─────────────────────────────────────────────────
  function openStkModal(tenant) {
    setStkTenant(tenant);
    setStkPhone(tenant.phone || '');
    setStkAmount('');
    setStkStatus('idle');
    setStkMsg('');
    setStkModal(true);
    loadArrears(tenant.id);
  }

  // Tracks the setInterval id from pollPaymentStatus so a poll can be
  // cancelled instead of left running. Previously there was no way to stop
  // it: closing the modal, navigating away, or starting a SECOND STK push
  // for a different tenant all left the original 60-second poll running in
  // the background. Worst case, two pushes in a row meant two intervals
  // ticking at once — the first one's "payment confirmed" (or "failed")
  // message could land AFTER the second push started, overwriting the
  // status/message the user was actually looking at with a stale result
  // from a completely different transaction.
  const pollRef = useRef(null);
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  async function triggerStkPush() {
    if (!stkTenant) { setStkMsg('Select a tenant first.'); return; }
    if (!stkPhone) { setStkMsg('Enter a phone number.'); return; }
    if (!stkAmount || parseFloat(stkAmount) <= 0) { setStkMsg('Enter a valid amount.'); return; }
    stopPolling(); // cancel any still-running poll from a previous push
    setStkLoading(true); setStkMsg(''); setStkStatus('idle');
    try {
      const token = localStorage.getItem('token');
      const res   = await fetch(`${BASE}/mpesa/stk-push`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ tenant_id: stkTenant?.id, phone: stkPhone, amount: stkAmount }),
      });
      const data = await res.json();
      if (data.success) {
        const checkoutId = data.data?.CheckoutRequestID;
        setStkStatus('pending');
        setStkMsg('STK push sent — tenant should enter M-Pesa PIN on their phone. Waiting for confirmation...');
        setStkAmount('');
        pollPaymentStatus(checkoutId);
      } else {
        setStkStatus('failed');
        setStkMsg(data.error || 'Failed to send STK push.');
      }
    } catch (e) {
      setStkStatus('failed');
      setStkMsg('Failed to connect. Please try again.');
    } finally { setStkLoading(false); }
  }

  async function pollPaymentStatus(checkoutId) {
    if (!checkoutId) return;
    const maxAttempts = 12; // 60 seconds
    let attempts = 0;
    const token = localStorage.getItem('token');
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const res  = await fetch(`${BASE}/mpesa/stk-status/${encodeURIComponent(checkoutId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.status === 'matched') {
          stopPolling();
          setStkStatus('success');
          setStkMsg('Payment confirmed! The account has been updated.');
          load(); // refresh payments table
        } else if (data.status === 'failed') {
          stopPolling();
          setStkStatus('failed');
          setStkMsg(`Payment failed — ${data.reason || 'insufficient funds or PIN cancelled'}.`);
        } else if (attempts >= maxAttempts) {
          stopPolling();
          setStkStatus('failed');
          setStkMsg('No confirmation after 60s. Check M-Pesa messages to confirm if payment went through.');
        }
      } catch { /* keep polling */ }
    }, 5000);
  }

  useEffect(() => { if (location.state?.tenantId) setTenantFilter(String(location.state.tenantId)); }, [location.state]); // from Ctrl+K quick search
  // From the dashboard briefing ("N payments received today"): highlight those rows and scroll to the first.
  const [highlightIds, setHighlightIds] = useState([]);
  useEffect(() => {
    const ids = location.state?.highlightIds;
    if (ids?.length) { setFilter('all'); setPlotFilter('all'); setTenantFilter('all'); setHighlightIds(ids.map(String)); }
  }, [location.state]);
  useEffect(() => {
    if (!highlightIds.length || loading) return;
    const t1 = setTimeout(() => document.getElementById(`payment-row-${highlightIds[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
    const t2 = setTimeout(() => setHighlightIds([]), 6000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [highlightIds, loading]);
  const filtered    = payments
    .filter(p => filter === 'all' || p.status === filter)
    .filter(p => plotFilter === 'all' || String(p.plot_id) === String(plotFilter))
    .filter(p => tenantFilter === 'all' || String(p.tenant_id) === String(tenantFilter));
  // Tenant options for the filter dropdown: every tenant who actually has a
  // payment record here, not every tenant in the system — a landlord/caretaker
  // with a long tenant roster but few payments shouldn't have to scroll past
  // names with nothing to show. Sorted alphabetically, de-duplicated by id
  // (a tenant can have several payment rows).
  const paymentPlotOptions = Array.from(
    new Map(payments.filter(p => p.plot_id).map(p => [String(p.plot_id), p.plot_name || `Property #${p.plot_id}`])).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));
  const paymentTenantOptions = Array.from(
    new Map(payments.filter(p => p.tenant_id && (plotFilter === 'all' || String(p.plot_id) === String(plotFilter))).map(p => [p.tenant_id, p.tenant_name])).entries()
  ).sort((a, b) => (a[1] || '').localeCompare(b[1] || ''));
  // Sortable "Allocated To" column: for_year/for_month combine into one
  // comparable number (year*12+month). A payment with neither (unallocated,
  // or auto-matched with nothing assigned yet) sorts to the end regardless
  // of direction — there's no month to rank it by, so it shouldn't jump to
  // the top under 'desc' just because missing data compares as small.
  const monthKey = p => (p.for_year && p.for_month) ? (p.for_year * 12 + p.for_month) : null;
  const displayed = allocatedSort
    ? [...filtered].sort((a, b) => {
        const ka = monthKey(a), kb = monthKey(b);
        if (ka === null && kb === null) return 0;
        if (ka === null) return 1;
        if (kb === null) return -1;
        return allocatedSort === 'asc' ? ka - kb : kb - ka;
      })
    : filtered;
  const total       = filtered.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
  const isDark      = useIsDarkMode();
  const statusColor = {
    matched:   isDark ? '#4ade80' : 'var(--green, #16a34a)',
    unmatched: isDark ? '#fbbf24' : 'var(--amber, #d97706)',
    review:    isDark ? '#60a5fa' : 'var(--blue, #2563eb)',
    pending:   'var(--muted)',
    failed:    isDark ? '#f87171' : 'var(--red, #dc2626)',
  };
  const statusBg    = {
    matched:   isDark ? hexToRgba('#16a34a', 0.2) : 'var(--green-light, #dcfce7)',
    unmatched: isDark ? hexToRgba('#d97706', 0.2) : 'var(--amber-light, #fef3c7)',
    review:    isDark ? hexToRgba('#2563eb', 0.2) : 'var(--blue-light, #dbeafe)',
    pending:   'var(--surface2)',
    failed:    isDark ? hexToRgba('#dc2626', 0.2) : 'var(--red-light, #fee2e2)',
  };
  const monthName   = (y, m) => new Date(y, m - 1, 1).toLocaleString('en-KE', { month: 'long', year: 'numeric' });

  const activeTenants = tenants.filter(t => t.is_active);

  return (
    <div>
      <style>{`
        .pm-row { transition: background 0.12s ease; }
        .pm-row:hover { background: var(--primary-light, #e6efe8) !important; }
        .pm-skel { background: var(--surface2); border-radius: 6px; animation: pm-pulse 1.3s ease-in-out infinite; }
        @keyframes pm-pulse { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .pm-row, .pm-skel { transition: none; animation: none; } }
        /* Printing a receipt: the modal is portaled to document.body (see
           below), a sibling of #root rather than nested inside it. Hiding
           #root with display:none removes its entire layout footprint —
           unlike visibility:hidden, which keeps hidden elements' height,
           causing a blank extra page when the app behind the modal is tall.
           Only the portaled receipt is left to print. */
        @media print {
          #root { display: none !important; }
          .pm-receipt { box-shadow: none !important; border: none !important; }
          .pm-no-print { display: none !important; }
        }
      `}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: 'Bricolage Grotesque', fontSize: 26, fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>Payments</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>{payments.length} transactions · KES {payments.reduce((s,p)=>s+parseFloat(p.amount||0),0).toLocaleString()} total</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {/* These three stay general (no plotId) — none of them has one
              specific property picked yet at this point: Reconcile spans
              every unmatched payment, and STK Push / Record Payment only
              pick a tenant (and therefore a property) INSIDE their own
              modal, after the button is already clicked. */}
          {can('payments.reconcile_mpesa') && (
            <button onClick={openReconcile} style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              <IconInline name="🔗" />Reconcile unmatched
            </button>
          )}
          {can('payments.record_manual') && (
            <button onClick={() => {
              const firstActive = activeTenants[0];
              setStkTenant(firstActive || null);
              setStkPhone(firstActive?.phone || '');
              setStkAmount('');
              setStkStatus('idle');
              setStkMsg('');
              setStkModal(true);
              setArrears(null);
              if (firstActive) loadArrears(firstActive.id);
            }} style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              <IconInline name="📱" />STK push
            </button>
          )}
          {can('payments.record_manual') && (
            <button onClick={() => {
              const firstActive = activeTenants[0];
              setForm({ tenant_id: firstActive?.id || '', amount: '', payment_date: new Date().toISOString().split('T')[0], payment_method: 'mpesa', reference_number: '', notes: '' });
              setArrears(null);
              if (firstActive) loadArrears(firstActive.id);
              setModal(true); setError('');
            }} style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--primary, #1b6b45)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              + Record Payment
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['all','matched','unmatched','review','pending','failed'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '7px 16px', borderRadius: 99, border: '1px solid var(--border)', background: filter === f ? 'var(--primary, #1b6b45)' : 'var(--surface)', color: filter === f ? '#fff' : 'var(--muted)', fontWeight: 600, fontSize: 13, textTransform: 'capitalize', cursor: 'pointer' }}>{f}</button>
        ))}
        {paymentPlotOptions.length > 1 && (
          <select
            value={plotFilter}
            onChange={e => { setPlotFilter(e.target.value); setTenantFilter('all'); }}
            title="Filter by property"
            style={{ padding: '7px 12px', borderRadius: 99, border: '1px solid var(--border)', background: plotFilter === 'all' ? 'var(--surface)' : 'var(--primary, #1b6b45)', color: plotFilter === 'all' ? 'var(--muted)' : '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
          >
            <option value="all">All properties</option>
            {paymentPlotOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
        <select
          value={tenantFilter}
          onChange={e => setTenantFilter(e.target.value)}
          title="Filter by tenant"
          style={{ padding: '7px 12px', borderRadius: 99, border: '1px solid var(--border)', background: tenantFilter === 'all' ? 'var(--surface)' : 'var(--primary, #1b6b45)', color: tenantFilter === 'all' ? 'var(--muted)' : '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
        >
          <option value="all">All tenants</option>
          {paymentTenantOptions.map(([id, name]) => <option key={id} value={id}>{name || `Tenant #${id}`}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--primary, #1b6b45)', fontSize: 15, display: 'flex', alignItems: 'center' }}>
          KES {total.toLocaleString()}
        </div>
      </div>

      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0' }}>
                <div className="pm-skel" style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} />
                <div className="pm-skel" style={{ height: 14, width: `${35 + (i * 9) % 35}%` }} />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>
            <div style={{ marginBottom: 10, color: 'var(--muted)', display: 'flex', justifyContent: 'center' }}><Icon name="💳" size={32} /></div>
            No payments found.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                {['Tenant', 'Receipt / Ref', 'Amount', 'Allocated To', 'Method', 'Status', 'Date', 'Actions'].map(h => (
                  <th
                    key={h}
                    onClick={h === 'Allocated To' ? () => setAllocatedSort(s => s === 'asc' ? 'desc' : s === 'desc' ? null : 'asc') : undefined}
                    title={h === 'Allocated To' ? 'Sort by month' : undefined}
                    style={{
                      padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: 'var(--muted)',
                      textTransform: 'uppercase', letterSpacing: '0.5px',
                      cursor: h === 'Allocated To' ? 'pointer' : 'default',
                      userSelect: h === 'Allocated To' ? 'none' : 'auto',
                    }}
                  >
                    {h}{h === 'Allocated To' && (allocatedSort === 'asc' ? ' ▲' : allocatedSort === 'desc' ? ' ▼' : ' ⇅')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.map((p, i) => (
                <tr key={p.id} id={`payment-row-${p.id}`} className="pm-row" style={{ borderTop: '1px solid var(--border)', background: highlightIds.includes(String(p.id)) ? 'rgba(250, 204, 21, 0.28)' : i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)', boxShadow: highlightIds.includes(String(p.id)) ? 'inset 4px 0 0 #f59e0b' : 'none', transition: 'background 0.6s, box-shadow 0.6s' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {(() => {
                        const { initials, color } = initialsAvatar(p.tenant_name);
                        return (
                          <div style={{
                            width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                            background: hexToRgba(color, isDark ? 0.3 : 0.15), color,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, fontWeight: 700,
                          }}>{initials}</div>
                        );
                      })()}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.tenant_name || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Unit {p.unit_number || '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)' }}>{p.receipt_no || p.transaction_id || '—'}</td>
                  <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--green, #16a34a)', fontSize: 15 }}>KES {parseFloat(p.amount).toLocaleString()}</td>
                  <td style={{ padding: '12px 16px' }}>
                    {p.for_year && p.for_month ? (
                      <span style={{ background: isDark ? hexToRgba('#1b6b45', 0.22) : 'var(--primary-light)', color: isDark ? '#8fd1ad' : 'var(--primary, #1b6b45)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{monthName(p.for_year, p.for_month)}</span>
                    ) : p.status === 'matched' && can('payments.record_manual', p.plot_id) ? (
                      <button
                        onClick={() => { setAllocateModal(p); setAllocateError(''); const d = new Date(); setAllocateYear(d.getFullYear()); setAllocateMonth(d.getMonth() + 1); }}
                        title="The system couldn't automatically assign this to a month — set one manually"
                        style={{ padding: '3px 10px', borderRadius: 99, border: '1px dashed var(--border)', background: 'transparent', fontSize: 12, fontWeight: 600, color: 'var(--muted)', cursor: 'pointer' }}>
                        + Assign month
                      </button>
                    ) : (
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ background: isDark ? hexToRgba('#2563eb', 0.22) : 'var(--blue-light)', color: isDark ? '#93c5fd' : 'var(--blue, #2563eb)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{p.method || 'mpesa'}</span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ background: statusBg[p.status] || 'var(--surface2)', color: statusColor[p.status] || 'var(--muted)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{p.status}</span>
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--muted)', fontSize: 13, fontWeight: 700 }}>{new Date(p.payment_date).toLocaleDateString('en-KE')}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {p.status === 'matched' && (
                        <button
                          onClick={() => setReceiptModal(p)}
                          title="View / print receipt"
                          style={{ padding: '6px 12px', height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <IconInline name="🧾" />Receipt
                        </button>
                      )}
                      {(() => {
                        const items = [];
                        if (p.status === 'matched' && p.tenant_id) items.push({ icon: '💬', label: 'Send via WhatsApp', onClick: () => whatsappReceipt(p) });
                        if (p.receipt_no || p.transaction_id) items.push({ icon: '📋', label: 'Copy reference', onClick: () => copyRef(p) });
                        if (can('payments.delete', p.plot_id)) {
                          if (items.length) items.push({ divider: true });
                          items.push({ icon: '🗑️', label: deleting === p.id ? 'Deleting…' : 'Delete payment', danger: true, onClick: () => handleDelete(p) });
                        }
                        return items.length ? <RowMenu id={p.id} openMenu={openMenu} setOpenMenu={setOpenMenu} items={items} /> : null;
                      })()}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── STK Push Modal ─────────────────────────────────────── */}
      {stkModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 480, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontFamily: 'Bricolage Grotesque', fontWeight: 700, fontSize: 18, color: 'var(--text)' }}><IconInline name="📱" size={20} />Send M-Pesa STK push</h2>
              <button onClick={() => { stopPolling(); setStkModal(false); setArrears(null); }} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'var(--surface2)', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}>×</button>
            </div>

            {/* Tenant selector */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Tenant</label>
              <select value={stkTenant?.id || ''} onChange={e => {
                const t = tenants.find(t => String(t.id) === e.target.value);
                setStkTenant(t || null);
                setStkPhone(t?.phone || '');
                setStkStatus('idle'); setStkMsg('');
                if (t) loadArrears(t.id);
              }} style={inputStyle}>
                <option value="">— Select tenant —</option>
                {activeTenants.map(t => (
                  <option key={t.id} value={t.id}>{t.full_name} — {t.phone} (Unit {t.unit_number || t.house_id})</option>
                ))}
              </select>
            </div>

            {/* Arrears summary */}
            {arrearsLoading && <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>Loading arrears...</div>}
            {arrears && !arrearsLoading && arrears.total_arrears > 0 && (
              <div style={{ background: isDark ? hexToRgba('#dc2626', 0.15) : 'var(--red-light)', border: '1px solid var(--red, #dc2626)', borderRadius: 10, padding: '12px 14px', marginBottom: 14, fontSize: 13 }}>
                <div style={{ fontWeight: 700, color: 'var(--red, #dc2626)', marginBottom: 6 }}><IconInline name="⚠️" />Outstanding: KES {arrears.total_arrears.toLocaleString()}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {arrears.deposit_owed > 0 && (
                    <span style={{ background: isDark ? 'var(--surface2)' : 'white', border: '1px solid var(--red, #dc2626)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, color: 'var(--red, #dc2626)' }}>
                      <IconInline name="🔒" size={13} />Deposit shortfall — KES {arrears.deposit_owed.toLocaleString()}
                    </span>
                  )}
                  {arrears.unpaid_months?.map(m => (
                    <span key={`${m.year}-${m.month}`} style={{ background: isDark ? 'var(--surface2)' : 'white', border: '1px solid var(--red, #dc2626)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, color: 'var(--red, #dc2626)' }}>
                      {monthName(m.year, m.month)} — KES {m.balance.toLocaleString()}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                  {arrears.deposit_owed > 0 ? 'Payment will clear the deposit shortfall first, then the oldest unpaid month.' : 'Payment will allocate to oldest month first.'}
                </div>
              </div>
            )}
            {arrears && !arrearsLoading && arrears.total_arrears === 0 && (
              <div style={{ background: isDark ? hexToRgba('#16a34a', 0.15) : 'var(--green-light)', border: '1px solid var(--green, #16a34a)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, fontWeight: 600, color: 'var(--green, #16a34a)' }}>
                <IconInline name="✅" />No arrears — tenant is up to date.
              </div>
            )}

            {/* Phone field */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>M-Pesa Phone Number</label>
              <input type="tel" value={stkPhone} onChange={e => setStkPhone(e.target.value)}
                placeholder="e.g. 0712345678" style={inputStyle} />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Pre-filled from tenant record. Change if paying from a different line.</div>
            </div>

            {/* Amount field */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Amount (KES)</label>
              <input type="number" value={stkAmount} onChange={e => setStkAmount(e.target.value)}
                placeholder="Enter amount" style={{ ...inputStyle, fontSize: 18, fontWeight: 600 }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {stkTenant && (
                  <button onClick={() => setStkAmount(String(stkTenant.rent_amount || ''))}
                    style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--muted)' }}>
                    One Month (KES {parseFloat(stkTenant.rent_amount || 0).toLocaleString()})
                  </button>
                )}
                {arrears && arrears.total_arrears > 0 && (
                  <button onClick={() => setStkAmount(String(arrears.total_arrears))}
                    style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--red, #dc2626)', background: isDark ? hexToRgba('#dc2626', 0.18) : 'var(--red-light)', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--red, #dc2626)' }}>
                    Clear All (KES {arrears.total_arrears.toLocaleString()})
                  </button>
                )}
              </div>
            </div>

            {/* Status message */}
            {stkMsg && (
              <div style={{
                background: stkStatus === 'success' ? (isDark ? hexToRgba('#16a34a', 0.18) : 'var(--green-light)') : stkStatus === 'pending' ? (isDark ? hexToRgba('#2563eb', 0.18) : 'var(--blue-light)') : (isDark ? hexToRgba('#dc2626', 0.18) : 'var(--red-light)'),
                color:      stkStatus === 'success' ? 'var(--green, #16a34a)' : stkStatus === 'pending' ? 'var(--blue, #2563eb)' : 'var(--red, #dc2626)',
                padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 500
              }}>
                {stkMsg}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => { stopPolling(); setStkModal(false); setArrears(null); }} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: 'var(--text)' }}>
                Close
              </button>
              <button onClick={triggerStkPush} disabled={stkLoading || stkStatus === 'pending'}
                style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: stkStatus === 'success' ? 'var(--green, #16a34a)' : 'var(--primary, #1b6b45)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                {stkLoading ? 'Sending...' : stkStatus === 'pending' ? 'Waiting...' : stkStatus === 'success' ? 'Confirmed' : 'Send STK push'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reconcile Unmatched Payments Modal ───────────────────── */}
      {reconcileOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 640, maxHeight: '85vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontFamily: 'Bricolage Grotesque', fontWeight: 700, fontSize: 18, color: 'var(--text)' }}><IconInline name="🔗" size={20} />Reconcile unmatched payments</h2>
              <button onClick={() => setReconcileOpen(false)} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'var(--surface2)', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}>×</button>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 18 }}>
              These M-Pesa payments came in but couldn't be matched to a tenant automatically — usually because the phone number on the transaction doesn't match anyone on file. Pick the right tenant for each one below.
            </p>

            {unmatchedLoad ? (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
            ) : unmatched.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>Nothing to reconcile — all payments are matched.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {unmatched.map(p => (
                  <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--green, #16a34a)' }}>KES {parseFloat(p.amount).toLocaleString()}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>From {p.phone || 'unknown number'} · {p.payment_date ? new Date(p.payment_date).toLocaleDateString('en-KE') : '—'}</div>
                        {(p.receipt_no || p.transaction_id) && <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--muted)' }}>{p.receipt_no || p.transaction_id}</div>}
                      </div>
                      <span style={{ background: statusBg[p.status] || 'var(--surface2)', color: statusColor[p.status] || 'var(--muted)', padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, height: 'fit-content' }}>{p.status}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select
                        value={matchPicks[p.id] || ''}
                        onChange={e => setMatchPicks(picks => ({ ...picks, [p.id]: e.target.value }))}
                        style={{ ...inputStyle, flex: 1 }}
                      >
                        <option value="">— Select tenant to match —</option>
                        {tenants.map(t => (
                          <option key={t.id} value={t.id}>{t.full_name} — {t.phone} (Unit {t.unit_number || t.house_id})</option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleMatch(p)}
                        disabled={!matchPicks[p.id] || matching === p.id}
                        style={{ padding: '0 18px', borderRadius: 8, border: 'none', background: 'var(--primary, #1b6b45)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: (!matchPicks[p.id] || matching === p.id) ? 'default' : 'pointer', opacity: (!matchPicks[p.id] || matching === p.id) ? 0.5 : 1 }}
                      >
                        {matching === p.id ? 'Matching…' : 'Match'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Record Payment Modal ───────────────────────────────── */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20, overflowY: 'auto' }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 520, boxShadow: 'var(--shadow-lg)', margin: 'auto' }}>
            <h2 style={{ fontFamily: 'Bricolage Grotesque', fontWeight: 700, fontSize: 18, marginBottom: 20, color: 'var(--text)' }}>Record Payment</h2>
            {error && <div style={{ background: isDark ? hexToRgba('#dc2626', 0.18) : 'var(--red-light)', color: 'var(--red, #dc2626)', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle}>Tenant</label>
                <select value={form.tenant_id} onChange={e => {
                  setForm(f => ({ ...f, tenant_id: e.target.value }));
                  loadArrears(e.target.value);
                }} style={inputStyle}>
                  {activeTenants.map(t => (
                    <option key={t.id} value={t.id}>{t.full_name} — {t.phone}</option>
                  ))}
                </select>
              </div>

              {(() => {
                const selectedTenant = tenants.find(t => String(t.id) === String(form.tenant_id));
                if (!selectedTenant) return null;
                return (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Monthly Rent</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary, #1b6b45)' }}>KES {parseFloat(selectedTenant.rent_amount || 0).toLocaleString()}</span>
                  </div>
                );
              })()}

              {arrearsLoading && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading arrears...</div>}
              {arrears && !arrearsLoading && (
                <div style={{ background: arrears.total_arrears > 0 ? (isDark ? hexToRgba('#dc2626', 0.15) : 'var(--red-light)') : (isDark ? hexToRgba('#16a34a', 0.15) : 'var(--green-light)'), border: `1px solid ${arrears.total_arrears > 0 ? 'var(--red, #dc2626)' : 'var(--green, #16a34a)'}`, borderRadius: 10, padding: 14 }}>
                  {arrears.total_arrears > 0 ? (
                    <>
                      <div style={{ fontWeight: 700, color: 'var(--red, #dc2626)', marginBottom: 8, fontSize: 14 }}>
                        <IconInline name="⚠️" />Total Arrears: KES {arrears.total_arrears.toLocaleString()}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {arrears.deposit_owed > 0 && (
                          <div style={{ background: isDark ? 'var(--surface2)' : 'white', border: '1px solid var(--red, #dc2626)', borderRadius: 8, padding: '4px 10px', fontSize: 12 }}>
                            <span style={{ fontWeight: 700, color: 'var(--red, #dc2626)' }}><IconInline name="🔒" size={13} />Deposit shortfall</span>
                            <span style={{ color: 'var(--muted)', marginLeft: 4 }}>· KES {arrears.deposit_owed.toLocaleString()} owed</span>
                          </div>
                        )}
                        {arrears.unpaid_months?.map(m => (
                          <div key={`${m.year}-${m.month}`} style={{ background: isDark ? 'var(--surface2)' : 'white', border: '1px solid var(--red, #dc2626)', borderRadius: 8, padding: '4px 10px', fontSize: 12 }}>
                            <span style={{ fontWeight: 600, color: 'var(--red, #dc2626)' }}>{monthName(m.year, m.month)}</span>
                            <span style={{ color: 'var(--muted)', marginLeft: 4 }}>· KES {m.balance.toLocaleString()} owed</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--red, #dc2626)', marginTop: 8 }}>
                        {arrears.deposit_owed > 0 ? 'Payment will clear the deposit shortfall first, then the oldest unpaid month.' : 'Payment will be applied to oldest unpaid month first.'}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontWeight: 600, color: 'var(--green, #16a34a)', fontSize: 14 }}><IconInline name="✅" />No arrears — tenant is up to date.</div>
                  )}
                </div>
              )}

              <div>
                <Field label="Amount (KES)" value={form.amount} onChange={v => setForm(f=>({...f,amount:v}))} placeholder="15000" type="number" />
                {(() => {
                  const selectedTenant = tenants.find(t => String(t.id) === String(form.tenant_id));
                  if (!selectedTenant?.rent_amount) return null;
                  return (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button type="button" onClick={() => setForm(f => ({ ...f, amount: String(selectedTenant.rent_amount) }))}
                        style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--muted)' }}>
                        One Month (KES {parseFloat(selectedTenant.rent_amount).toLocaleString()})
                      </button>
                      {arrears && arrears.total_arrears > 0 && (
                        <button type="button" onClick={() => setForm(f => ({ ...f, amount: String(arrears.total_arrears) }))}
                          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--red, #dc2626)', background: isDark ? hexToRgba('#dc2626', 0.18) : 'var(--red-light)', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--red, #dc2626)' }}>
                          Clear All (KES {arrears.total_arrears.toLocaleString()})
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
              <Field label="Payment Date"         value={form.payment_date}     onChange={v => setForm(f=>({...f,payment_date:v}))}     type="date" />
              <div>
                <label style={labelStyle}>Method</label>
                <select value={form.payment_method} onChange={e => setForm(f=>({...f,payment_method:e.target.value}))} style={inputStyle}>
                  {['mpesa','cash','bank_transfer','cheque'].map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <Field label="Reference / Receipt"  value={form.reference_number} onChange={v => setForm(f=>({...f,reference_number:v}))} placeholder="e.g. QHJ7K2X" />
              <Field label="Notes (optional)"     value={form.notes}            onChange={v => setForm(f=>({...f,notes:v}))}            placeholder="Optional" />
            </div>

            {/* Optional utilities — tracked separately, never reduce rent arrears */}
            <div style={{ marginTop: 16, padding: 14, borderRadius: 10, border: '1px dashed var(--border)', background: 'var(--surface2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>Utilities (optional)</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>Water, electricity, garbage… recorded separately from rent and shown on Expenses as recovered.</div>
                </div>
                <button type="button" onClick={() => setUtilities(u => [...u, { type: 'Water', amount: '' }])}
                  style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>+ Add</button>
              </div>
              {utilities.map((u, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <select value={u.type} onChange={e => setUtilities(list => list.map((x, j) => j === i ? { ...x, type: e.target.value } : x))} style={{ ...inputStyle, flex: 1 }}>
                    {['Water', 'Electricity', 'Garbage Collection', 'Other'].map(t => <option key={t}>{t}</option>)}
                  </select>
                  <input type="number" min="0" placeholder="Amount" value={u.amount}
                    onChange={e => setUtilities(list => list.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))}
                    style={{ ...inputStyle, flex: 1 }} />
                  <button type="button" onClick={() => setUtilities(list => list.filter((_, j) => j !== i))}
                    style={{ padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--red, #dc2626)', cursor: 'pointer', fontWeight: 700 }}>✕</button>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={() => { setModal(false); setArrears(null); setUtilities([]); }} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: 'var(--text)' }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--primary, #1b6b45)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                {saving ? 'Saving...' : 'Record'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Assign Month Modal ─────────────────────────────────── */}
      {allocateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 400, boxShadow: 'var(--shadow-lg)' }}>
            <h2 style={{ fontFamily: 'Bricolage Grotesque', fontWeight: 700, fontSize: 18, marginBottom: 6, color: 'var(--text)' }}>Assign Month</h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>
              KES {parseFloat(allocateModal.amount).toLocaleString()} from <strong>{allocateModal.tenant_name || 'this payment'}</strong> — which month should this count toward?
            </p>
            {allocateError && <div style={{ background: isDark ? hexToRgba('#dc2626', 0.18) : 'var(--red-light)', color: 'var(--red, #dc2626)', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{allocateError}</div>}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Month</label>
                <select value={allocateMonth} onChange={e => setAllocateMonth(parseInt(e.target.value))} style={inputStyle}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                    <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleString('en-KE', { month: 'long' })}</option>
                  ))}
                </select>
              </div>
              <div style={{ width: 110 }}>
                <label style={labelStyle}>Year</label>
                <input type="number" value={allocateYear} onChange={e => setAllocateYear(parseInt(e.target.value))} style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setAllocateModal(null)} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: 'var(--text)' }}>Cancel</button>
              <button onClick={handleAllocate} disabled={allocateSaving} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--primary, #1b6b45)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                {allocateSaving ? 'Saving...' : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: '#111827', color: '#fff', padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 600, boxShadow: 'var(--shadow-lg)' }}>{toast}</div>}

      {/* ── Receipt Modal ──────────────────────────────────────── */}
      {receiptModal && createPortal((() => {
        const r  = receiptData;
        const pm = r?.payment || receiptModal;
        const kes = (n) => `KES ${parseFloat(n || 0).toLocaleString()}`;
        const rentLines = r?.rent_lines?.length ? r.rent_lines : [{ id: receiptModal.id, amount: parseFloat(receiptModal.amount), for_year: receiptModal.for_year, for_month: receiptModal.for_month }];
        const utilLines = r?.utility_lines || [];
        const rentTotal = r ? r.rent_total : parseFloat(receiptModal.amount);
        const grand     = r ? r.grand_total : rentTotal;
        const receiptNo = r?.receipt_number || `RF-${String(receiptModal.id).padStart(6, '0')}`;
        const dateStr   = pm.payment_date ? new Date(pm.payment_date).toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
        const row = (label, value) => (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '4px 0' }}>
            <span style={{ color: '#6b7280' }}>{label}</span>
            <span style={{ fontWeight: 600, textAlign: 'right' }}>{value}</span>
          </div>
        );
        return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20, overflowY: 'auto' }}>
          <div className="pm-receipt" style={{ background: '#fff', color: '#1a1a1a', borderRadius: 16, width: '100%', maxWidth: 460, boxShadow: 'var(--shadow-lg)', overflow: 'hidden', position: 'relative' }}>
            <button className="pm-no-print" onClick={() => setReceiptModal(null)} style={{ position: 'absolute', top: 12, right: 12, width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.25)', cursor: 'pointer', fontSize: 16, color: '#fff' }}>×</button>

            {/* Header */}
            <div style={{ background: 'linear-gradient(135deg, #5b21b6, #1b6b45)', color: '#fff', padding: '22px 28px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="🏠" size={26} />
                <div>
                  <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 800, fontSize: 20, letterSpacing: 0.3 }}>RentFlow</div>
                  <div style={{ fontSize: 11, opacity: 0.85, textTransform: 'uppercase', letterSpacing: 1.2 }}>Official Payment Receipt</div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, fontSize: 12 }}>
                <div><div style={{ opacity: 0.75 }}>Receipt No.</div><div style={{ fontWeight: 700, fontSize: 14 }}>{receiptNo}</div></div>
                <div style={{ textAlign: 'right' }}><div style={{ opacity: 0.75 }}>Date</div><div style={{ fontWeight: 700, fontSize: 14 }}>{dateStr}</div></div>
              </div>
            </div>

            <div style={{ padding: '22px 28px 24px' }}>
              {/* Amount */}
              <div style={{ textAlign: 'center', marginBottom: 18 }}>
                <span style={{ display: 'inline-block', padding: '2px 12px', borderRadius: 99, background: '#dcfce7', color: '#15803d', fontSize: 11, fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>✓ PAID</span>
                <div style={{ fontSize: 30, fontWeight: 800, color: '#16a34a' }}>{kes(grand)}</div>
              </div>

              {/* Parties */}
              <div style={{ background: '#f9fafb', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
                {row('Received from', pm.tenant_name || '—')}
                {row('Unit', pm.unit_number ? `Unit ${pm.unit_number}` : '—')}
                {row('Property', pm.plot_name || '—')}
                {row('Method', (pm.method || 'mpesa').replace('_', ' ').toUpperCase())}
                {row('Reference', pm.reference || pm.receipt_no || receiptModal.transaction_id || '—')}
              </div>

              {/* Line items */}
              <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>Details</div>
              <div style={{ borderTop: '1px solid #e5e7eb' }}>
                {rentLines.map(l => (
                  <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '7px 0', borderBottom: '1px solid #f3f4f6' }}>
                    <span>Rent{l.for_year && l.for_month ? ` — ${monthName(l.for_year, l.for_month)}` : ''}</span>
                    <span style={{ fontWeight: 600 }}>{kes(l.amount)}</span>
                  </div>
                ))}
                {utilLines.map((u, i) => (
                  <div key={`u${i}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '7px 0', borderBottom: '1px solid #f3f4f6' }}>
                    <span>Utilities — {u.type}</span>
                    <span style={{ fontWeight: 600 }}>{kes(u.amount)}</span>
                  </div>
                ))}
                {utilLines.length > 0 && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', padding: '6px 0 0' }}><span>Rent subtotal</span><span>{kes(rentTotal)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', padding: '2px 0' }}><span>Utilities subtotal</span><span>{kes(r?.utility_total)}</span></div>
                  </>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 800, padding: '10px 0 2px' }}>
                  <span>Total paid</span><span style={{ color: '#16a34a' }}>{kes(grand)}</span>
                </div>
              </div>

              {r?.balance_after != null && (
                <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, fontSize: 12, background: r.balance_after > 0 ? '#fef2f2' : '#f0fdf4', color: r.balance_after > 0 ? '#b91c1c' : '#15803d', display: 'flex', justifyContent: 'space-between' }}>
                  <span>Rent balance after this payment</span><strong>{r.balance_after > 0 ? kes(r.balance_after) : 'Fully paid up'}</strong>
                </div>
              )}

              {/* Footer */}
              <div style={{ borderTop: '2px dashed #d1d5db', marginTop: 20, paddingTop: 14, textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Thank you for your payment!</div>
                <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 4, lineHeight: 1.5 }}>
                  This is a computer-generated receipt and is valid without a signature.<br />
                  {receiptNo} · Generated {new Date().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}
                </div>
              </div>

              <div className="pm-no-print" style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>
                <button onClick={() => setReceiptModal(null)} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: '#1a1a1a' }}>Close</button>
                <button onClick={() => window.print()} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: '#1b6b45', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                  <IconInline name="🖨️" />Print receipt
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })(),
        document.body
      )}
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' };
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 14, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' };

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

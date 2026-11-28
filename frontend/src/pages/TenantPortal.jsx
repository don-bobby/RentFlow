import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { applyBrandTheme } from '../utils/brandTheme';
import Icon, { IconInline } from '../components/Icon';

// ── Responsive hook (matches the one used in Layout.jsx) ──────────────────────
function useBreakpoint() {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const fn = () => setW(window.innerWidth);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);
  return { isMobile: w < 768 };
}

const BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

function tenantFetch(path, options = {}) {
  const token = localStorage.getItem('tenant_token');
  return fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  }).then(r => r.json());
}

const TABS = ['Overview', 'Pay Now', 'Payments', 'Arrears', 'Maintenance', 'My Unit', 'Notices', 'Messages'];
// Same body font as the public listings page (headings already use Bricolage Grotesque)
const BODY_FONT = "'DM Sans', Inter, system-ui, sans-serif";
// Used on the Overview "Need help?" card: who a tenant should contact first (same order as the public listings)
const CONTACT_RANK = { agent: 0, caretaker: 1, landlord: 2, admin: 3, super_admin: 3 };
const ROLE_WORD    = { agent: 'agent', caretaker: 'caretaker', landlord: 'property owner', admin: 'RentFlow admin', super_admin: 'RentFlow admin' };
// Tabs that live under "More" in the phone bottom menu
const MORE_TABS = ['Arrears', 'Maintenance', 'My Unit', 'Notices'];

export default function TenantPortal() {
  useEffect(() => { applyBrandTheme(); }, []);
  const { isMobile } = useBreakpoint();
  const [tab,         setTab]         = useState('Overview');
  const [me,          setMe]          = useState(null);
  const [payments,    setPayments]    = useState([]);
  const [arrears,     setArrears]     = useState([]);
  const [maintenance, setMaintenance] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [mForm,       setMForm]       = useState({ issue: '', priority: 'medium' });
  const [mSaving,     setMSaving]     = useState(false);
  const [mError,      setMError]      = useState('');
  const [mSuccess,    setMSuccess]    = useState('');
  const navigate = useNavigate();

  const [notices,       setNotices]       = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeConv,    setActiveConv]    = useState(null);
  const [convMessages,  setConvMessages]  = useState([]);
  const [msgInput,      setMsgInput]      = useState('');
  const [unreadNotices, setUnreadNotices] = useState(0);
  const [contacts,      setContacts]      = useState([]);
  const [newMsgOpen,    setNewMsgOpen]    = useState(false);
  const [unreadMsgs,    setUnreadMsgs]    = useState(0);
  const [stkLoading, setStkLoading] = useState(false);
  const [stkPhone,   setStkPhone]   = useState('');
  const [stkMsg,     setStkMsg]     = useState('');
  const [stkAmount,  setStkAmount]  = useState('');
  const [stkStatus,  setStkStatus]  = useState('idle'); // idle | pending | success | failed
  const [stkTxId,    setStkTxId]    = useState(null);
  const [moreOpen,   setMoreOpen]   = useState(false);   // phone bottom menu: "More" sheet
  const [receipt,    setReceipt]    = useState(null);    // payment shown in the receipt window
  const [copied,     setCopied]     = useState('');      // which Paybill value was just copied
  const [reloadKey,  setReloadKey]  = useState(0);       // bump to reload everything
  const [loadError,  setLoadError]  = useState(false);

  const tenant = JSON.parse(localStorage.getItem('tenant_info') || '{}');

  function logout() {
    localStorage.removeItem('tenant_token');
    localStorage.removeItem('tenant_info');
    // Web: back to the landing page. Android tenant app: stay on the tenant login
    // (the landing page would send the app to the staff login instead).
    const isNativeApp = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
    navigate(isNativeApp ? '/tenant/login' : '/');
  }

  async function triggerStkPush() {
    if (!stkAmount || parseFloat(stkAmount) <= 0) { setStkMsg('Enter a valid amount.'); return; }
    setStkLoading(true); setStkMsg(''); setStkStatus('idle'); setStkTxId(null);
    try {
      const token = localStorage.getItem('tenant_token');
      const res   = await fetch(`${BASE}/mpesa/stk-push`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ tenant_id: me?.id, phone: stkPhone || me?.phone, amount: stkAmount }),
      });
      const data = await res.json();
      if (data.success) {
        const checkoutId = data.data?.CheckoutRequestID;
        setStkTxId(checkoutId);
        setStkStatus('pending');
        setStkMsg('STK push sent — enter your M-Pesa PIN on your phone. Waiting for confirmation...');
        setStkAmount('');
        // Start polling for payment result
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
    const maxAttempts = 12; // 60 seconds total
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      try {
        const token = localStorage.getItem('tenant_token');
        const res   = await fetch(`${BASE}/mpesa/stk-status/${encodeURIComponent(checkoutId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.status === 'matched') {
          clearInterval(interval);
          setStkStatus('success');
          setStkMsg('Payment confirmed! Your account has been updated.');
          // Reload arrears and payments
          tenantFetch('/tenant-portal/payments').then(r => setPayments(r.data || []));
          tenantFetch('/tenant-portal/arrears').then(r => setArrears(r.data || []));
        } else if (data.status === 'failed') {
          clearInterval(interval);
          setStkStatus('failed');
          setStkMsg(`Payment failed — ${data.reason || 'insufficient funds or PIN cancelled'}. Please try again.`);
        } else if (attempts >= maxAttempts) {
          clearInterval(interval);
          setStkStatus('failed');
          setStkMsg('No confirmation received after 60 seconds. Check your M-Pesa messages to confirm if the payment went through.');
        }
      } catch { /* keep polling */ }
    }, 5000);
  }

  useEffect(() => {
    if (!newMsgOpen) return;
    const close = () => setNewMsgOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [newMsgOpen]);

  // ── Global poll for unread counts (runs on all tabs) ─────────────────────
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await tenantFetch('/notices/tenant-unread-count');
        if (r?.notices !== undefined) setUnreadNotices(r.notices);
        if (r?.messages !== undefined) setUnreadMsgs(r.messages);
      } catch {}
    }, 15000);
    return () => clearInterval(id);
  }, []);

  // ── Poll for new messages, conversations, and notices ──────────────────────
  useEffect(() => {
    if (tab !== 'Messages' && tab !== 'Notices') return;
    const id = setInterval(async () => {
      try {
        if (tab === 'Messages') {
          const cRes = await tenantFetch('/notices/conversations/tenant');
          if (cRes?.data) {
            setConversations(cRes.data);
            const total = cRes.data.reduce((s, c) => s + parseInt(c.unread_count || 0), 0);
            setUnreadMsgs(total);
          }
          if (activeConv) {
            const mRes = await tenantFetch(`/notices/conversations/${activeConv.id}/messages/tenant`);
            if (mRes?.data) setConvMessages(mRes.data);
          }
        }
        if (tab === 'Notices') {
          const nRes = await tenantFetch('/notices/tenant');
          if (nRes?.data) {
            setNotices(nRes.data);
            setUnreadNotices(nRes.data.filter(n => !n.is_read).length);
          }
        }
      } catch {}
    }, 8000);
    return () => clearInterval(id);
  }, [tab, activeConv]);

  // ── Refresh the notices list immediately when switching to that tab, same
  // as the existing Messages-tab-switch effect below does for conversations.
  useEffect(() => {
    if (tab !== 'Notices') return;
    tenantFetch('/notices/tenant').then(r => {
      if (r?.data) {
        setNotices(r.data);
        setUnreadNotices(r.data.filter(n => !n.is_read).length);
      }
    }).catch(() => {});
  }, [tab]);

  // ── Also refresh conversations list when switching to Messages tab ─────────
  useEffect(() => {
    if (tab !== 'Messages') return;
    tenantFetch('/notices/conversations/tenant').then(r => {
      if (r?.data) setConversations(r.data);
    }).catch(() => {});
    tenantFetch('/notices/contacts/tenant').then(r => {
      if (r?.data) setContacts(r.data);
    }).catch(() => {});
  }, [tab]);

  // Starts (or reopens, if one already exists) a conversation with a contact
  // — previously there was no way to begin a new conversation at all, only
  // to reply to an existing notice.
  async function startConversation(contact) {
    setNewMsgOpen(false);
    const res = await tenantFetch('/notices/conversations/new/tenant', {
      method: 'POST', body: JSON.stringify({ recipient_id: contact.id, recipient_type: 'user' }),
    });
    if (!res?.success) { alert(res?.error || 'Could not start conversation.'); return; }
    const msgsRes = await tenantFetch(`/notices/conversations/${res.conversation_id}/messages/tenant`);
    setConvMessages(msgsRes.data || []);
    setActiveConv({ id: res.conversation_id, other_name: contact.name });
    const cRes = await tenantFetch('/notices/conversations/tenant');
    setConversations(cRes.data || []);
  }

  useEffect(() => {
    const token = localStorage.getItem('tenant_token');
    if (!token) { navigate('/tenant/login'); return; }
    async function load() {
      setLoading(true); setLoadError(false);
      try {
        // Expire any stale pending STK rows before loading
        await tenantFetch('/mpesa/expire-pending', { method: 'POST' }).catch(() => {});

        const [meRes, paymentsRes, arrearsRes, maintRes, noticesRes, convsRes, contactsRes] = await Promise.all([
          tenantFetch('/tenant-portal/me'),
          tenantFetch('/tenant-portal/payments'),
          tenantFetch('/tenant-portal/arrears'),
          tenantFetch('/tenant-portal/maintenance'),
          tenantFetch('/notices/tenant'),
          tenantFetch('/notices/conversations/tenant'),
          tenantFetch('/notices/contacts/tenant').catch(() => ({})),
        ]);
        if (!meRes?.data) setLoadError(true);
        setContacts(contactsRes?.data || []);
        setMe(meRes.data);
        setStkPhone(meRes.data?.phone || '');
        setPayments(paymentsRes.data || []);
        setNotices(noticesRes.data || []);
        setConversations(convsRes.data || []);
        const unreadN = (noticesRes.data || []).filter(n => !n.is_read).length;
        const unreadM = (convsRes.data || []).reduce((s,c) => s + parseInt(c.unread_count||0), 0);
        setUnreadNotices(unreadN);
        setUnreadMsgs(unreadM);
        setArrears(arrearsRes.data || []);
        setMaintenance(maintRes.data || []);
      } catch (e) { console.error(e); setLoadError(true); }
      finally { setLoading(false); }
    }
    load();
  }, [navigate, reloadKey]);

  async function submitMaintenance() {
    if (!mForm.issue.trim()) { setMError('Please describe the issue.'); return; }
    setMSaving(true); setMError(''); setMSuccess('');
    try {
      const res = await tenantFetch('/tenant-portal/maintenance', {
        method: 'POST', body: JSON.stringify(mForm),
      });
      if (res.success) {
        setMaintenance(prev => [res.data, ...prev]);
        setMForm({ issue: '', priority: 'medium' });
        setMSuccess('Request submitted successfully!');
      } else { setMError(res.error || 'Failed to submit.'); }
    } catch { setMError('Failed to submit.'); }
    finally { setMSaving(false); }
  }

  const totalArrears   = arrears.reduce((s, m) => s + m.balance, 0);
  const totalPaid      = payments.filter(p => p.status !== 'pending' && p.status !== 'failed').reduce((s, p) => s + parseFloat(p.amount || 0), 0);
  const pendingMaint   = maintenance.filter(m => m.status === 'pending').length;
  const monthName      = (y, m) => new Date(y, m - 1, 1).toLocaleString('en-KE', { month: 'long', year: 'numeric' });

  // Idea 1 + 4: jump to Pay Now with an amount ready, and a "Rent" card from real data
  const goPay = (amount) => { if (amount) setStkAmount(String(amount)); setTab('Pay Now'); setMoreOpen(false); window.scrollTo({ top: 0 }); };
  const goTab = (t) => { setTab(t); setMoreOpen(false); window.scrollTo({ top: 0 }); };
  const oldestArrear = [...arrears].sort((a, b) => (a.year - b.year) || (a.month - b.month))[0];
  const lastPaidIdx  = payments
    .filter(p => p.status !== 'pending' && p.status !== 'failed' && p.for_year && p.for_month)
    .reduce((best, p) => Math.max(best, p.for_year * 12 + (p.for_month - 1)), -1);
  const nextRentLabel = lastPaidIdx >= 0 ? monthName(Math.floor((lastPaidIdx + 1) / 12), ((lastPaidIdx + 1) % 12) + 1) : '';
  const rentSub = totalArrears > 0 && oldestArrear ? `Oldest unpaid: ${oldestArrear.label}` : (nextRentLabel ? `Next rent: ${nextRentLabel}` : '');

  // Idea 2: Paybill details. These come from /tenant-portal/me (account_no + paybill_number); hidden until the backend sends them.
  const paybillNo  = me?.paybill_number || me?.paybill_shortcode;
  const paybillAcc = me?.account_no;
  function copyText(key, value) {
    try { navigator.clipboard.writeText(String(value)); setCopied(key); setTimeout(() => setCopied(''), 1800); } catch { /* copy not available */ }
  }
  const paybillBox = paybillNo && paybillAcc ? <PaybillBox number={paybillNo} account={paybillAcc} copied={copied} onCopy={copyText} /> : null;

  // Idea 7: one-tap message to whoever handles the property (agent, else caretaker, else owner, else admin)
  const helpContact = [...contacts].sort((a, b) => (CONTACT_RANK[a.role] ?? 9) - (CONTACT_RANK[b.role] ?? 9))[0];
  async function messageHelpContact() {
    if (!helpContact) { goTab('Messages'); return; }
    const isAdm = helpContact.role === 'admin' || helpContact.role === 'super_admin';
    setTab('Messages');
    await startConversation({ ...helpContact, name: isAdm ? 'Admin' : helpContact.name });
  }

  const statusColor = { pending: 'var(--amber)', in_progress: 'var(--blue)', completed: 'var(--green)' };
  const statusBg    = { pending: 'var(--amber-light)', in_progress: 'var(--blue-light)', completed: 'var(--green-light)' };
  const priorityColor = { low: 'var(--green)', medium: 'var(--amber)', high: 'var(--red)' };

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: isMobile ? '16px 12px' : '24px 16px' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <div className="tp-skel" style={{ height: 24, width: 180, marginBottom: 8 }} />
        <div className="tp-skel" style={{ height: 14, width: 240, marginBottom: 24 }} />
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: isMobile ? 8 : 12, marginBottom: 20 }}>
          {[0, 1, 2].map(i => <div key={i} className="tp-skel" style={{ height: 88, borderRadius: 16 }} />)}
        </div>
        <div className="tp-skel" style={{ height: 160, borderRadius: 16 }} />
      </div>
    </div>
  );

  if (loadError || !me) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: BODY_FONT }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, maxWidth: 380, textAlign: 'center' }}>
        <div style={{ fontFamily: 'Bricolage Grotesque', fontWeight: 700, fontSize: 18, marginBottom: 8 }}>We could not load your account</div>
        <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 18px' }}>Check your internet connection and try again. If it keeps happening, sign out and sign in again.</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={() => setReloadKey(k => k + 1)} style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Try again</button>
          <button onClick={logout} style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)', fontWeight: 600, cursor: 'pointer', color: 'var(--muted)' }}>Sign out</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="tp-page" style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: BODY_FONT }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;700;800&family=DM+Sans:wght@400;500;700&display=swap');
        /* Friendlier micro-interactions layered on top of the existing theme
           tokens — no new color system, just hover/press feedback, soft
           accent-bar KPI cards, and a skeleton loader instead of plain text. */
        .tp-card { transition: box-shadow .15s ease; }
        .tp-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
        .tp-row { transition: background .12s ease; }
        .tp-row:hover { background: var(--surface2); }
        .tp-tab-btn { transition: background .15s ease, color .15s ease, transform .08s ease; }
        .tp-tab-btn:active { transform: scale(0.96); }
        .tp-kpi { position: relative; overflow: hidden; padding-left: 20px !important; }
        .tp-kpi::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--tp-accent, var(--primary)); }
        .tp-skel { background: var(--surface2); border-radius: 8px; animation: tp-pulse 1.3s ease-in-out infinite; }
        @keyframes tp-pulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
        .tp-pay-btn { display: inline-block; margin-top: 14px; padding: 11px 20px; border-radius: 10px; border: none; background: var(--primary); color: #fff; font-weight: 700; font-size: 15px; cursor: pointer; font-family: inherit; }
        .tp-pay-btn:active { transform: scale(0.97); }
        .tp-mini { padding: 3px 10px; border-radius: 99px; border: 1px solid var(--border); background: transparent; color: var(--muted); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
        .tp-mini:hover { border-color: var(--primary); color: var(--primary); }
        .tp-copy { padding: 7px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface2); color: var(--text); font-weight: 600; font-size: 13px; cursor: pointer; font-family: inherit; }
        .tp-nav { position: fixed; left: 0; right: 0; bottom: 0; z-index: 55; display: flex; background: var(--surface); border-top: 1px solid var(--border); padding-bottom: env(safe-area-inset-bottom, 0px); box-shadow: 0 -2px 12px rgba(0,0,0,0.06); }
        .tp-nav button { flex: 1; position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; height: 62px; border: none; background: transparent; color: var(--muted); font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit; }
        .tp-nav button.on { color: var(--primary); }
        .tp-nav .tp-dot { position: absolute; top: 6px; left: calc(50% + 6px); min-width: 16px; padding: 0 4px; border-radius: 99px; background: var(--red); color: #fff; font-size: 10px; font-weight: 700; line-height: 16px; text-align: center; }
        .tp-more { position: fixed; left: 12px; right: 12px; z-index: 60; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; box-shadow: 0 8px 28px rgba(0,0,0,0.2); overflow: hidden; }
        .tp-more button { display: flex; width: 100%; justify-content: space-between; align-items: center; padding: 14px 18px; border: none; border-top: 1px solid var(--border); background: transparent; color: var(--text); font-size: 15px; font-weight: 600; cursor: pointer; font-family: inherit; text-align: left; }
        .tp-more button:first-child { border-top: none; }
        @media print {
          body * { visibility: hidden !important; }
          .tp-receipt-print, .tp-receipt-print * { visibility: visible !important; }
          .tp-receipt-print { position: fixed !important; left: 0; top: 0; width: 100%; box-shadow: none !important; border: none !important; }
          .tp-noprint { display: none !important; }
        }
        @media (prefers-reduced-motion: reduce) { .tp-card, .tp-row, .tp-tab-btn, .tp-skel { transition: none; animation: none; } }
      `}</style>

      {/* Topbar */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: isMobile ? '0 14px' : '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56, position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}><Icon name="🏠" size={20} /></span>
          {!isMobile && <span style={{ fontFamily: 'Bricolage Grotesque', fontWeight: 700, fontSize: 16 }}>Tenant Portal</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 14 }}>
          {!isMobile && <span style={{ fontSize: 14, color: 'var(--muted)' }}><IconInline name="👤" size={14} />{tenant.full_name}</span>}
          <button onClick={logout} style={{ padding: isMobile ? '6px 10px' : '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--muted)' }}>
            {isMobile ? <Icon name="⏻" size={18} /> : 'Sign out'}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: isMobile ? '16px 12px 96px' : '24px 16px' }}>

        {/* Greeting */}
        <div style={{ marginBottom: isMobile ? 16 : 24 }}>
          <h2 style={{ fontFamily: 'Bricolage Grotesque', fontSize: isMobile ? 18 : 22, fontWeight: 700, marginBottom: 4 }}>
            Hello, {me?.full_name?.split(' ')[0]}
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>
            Unit {me?.unit_number} · {me?.plot_name} · {me?.plot_location}
          </p>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: isMobile ? 8 : 12, marginBottom: isMobile ? 20 : 28 }}>
          <SummaryCard icon="🏠" label="Monthly Rent" value={`KES ${parseFloat(me?.rent_amount || 0).toLocaleString()}`} color="var(--primary)" light="var(--primary-light)" sub={rentSub} />
          <SummaryCard icon="⚠️" label="Total Arrears" value={`KES ${totalArrears.toLocaleString()}`} color={totalArrears > 0 ? 'var(--red)' : 'var(--green)'} light={totalArrears > 0 ? 'var(--red-light)' : 'var(--green-light)'} />
          <SummaryCard icon="✅" label="Total Paid"    value={`KES ${totalPaid.toLocaleString()}`}    color="var(--green)" light="var(--green-light)" />
          <SummaryCard icon="🔧" label="Maintenance"   value={`${pendingMaint} pending`}               color="var(--amber)" light="var(--amber-light)" />
        </div>

        {/* Tabs (desktop). On phones the bottom menu at the end of this file takes over. */}
        {!isMobile && <div style={{
          display: 'flex', gap: 4, marginBottom: isMobile ? 16 : 20, background: 'var(--surface2)', borderRadius: 10, padding: 4, border: '1px solid var(--border)',
          overflowX: isMobile ? 'auto' : 'visible', WebkitOverflowScrolling: 'touch',
        }}>
          {TABS.map(t => {
            const badgeCount = t === 'Notices' ? unreadNotices : t === 'Messages' ? unreadMsgs : 0;
            return (
              <button key={t} onClick={() => setTab(t)} className="tp-tab-btn" style={{
                flex: isMobile ? 'none' : 1, whiteSpace: 'nowrap',
                padding: isMobile ? '8px 14px' : '8px 4px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: tab === t ? 'var(--primary)' : 'transparent',
                color: tab === t ? '#fff' : 'var(--muted)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                {t}
                {badgeCount > 0 && (
                  <span style={{
                    background: tab === t ? 'rgba(255,255,255,0.3)' : 'var(--red)',
                    color: '#fff', borderRadius: 99, fontSize: 10, fontWeight: 700,
                    padding: '1px 6px', minWidth: 16, textAlign: 'center', lineHeight: 1.4,
                  }}>{badgeCount}</span>
                )}
              </button>
            );
          })}
        </div>}

        {/* Overview */}
        {tab === 'Overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {totalArrears > 0 ? (
              <div style={{ background: 'var(--red-light)', border: '1px solid var(--red)', borderRadius: 16, padding: 20 }}>
                <div style={{ fontWeight: 700, color: 'var(--red)', fontSize: 16, marginBottom: 12 }}><IconInline name="⚠️" size={14} />Outstanding Balance: KES {totalArrears.toLocaleString()}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {arrears.map(m => (
                    <div key={`${m.year}-${m.month}`} style={{ background: 'var(--surface)', border: `1px solid ${m.partial ? 'var(--amber)' : 'var(--red)'}`, borderRadius: 8, padding: '6px 12px', fontSize: 12 }}>
                      <div style={{ fontWeight: 700, color: m.partial ? 'var(--amber)' : 'var(--red)' }}>{m.label} {m.partial ? '(partial)' : ''}</div>
                      <div style={{ color: 'var(--muted)', marginTop: 2 }}>{m.partial ? `Paid KES ${m.paid.toLocaleString()} · ` : ''}Owed KES {m.balance.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
                <button className="tp-pay-btn" onClick={() => goPay(totalArrears)}>Pay KES {totalArrears.toLocaleString()} now</button>
              </div>
            ) : (
              <div style={{ background: 'var(--green-light)', border: '1px solid var(--green)', borderRadius: 16, padding: 20, fontWeight: 700, color: 'var(--green)', fontSize: 15 }}>
                <IconInline name="✅" size={14} />You're all up to date! No outstanding rent.
              </div>
            )}

            {paybillBox}

            {(unreadNotices > 0 || unreadMsgs > 0) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {unreadNotices > 0 && <button className="tp-mini" onClick={() => goTab('Notices')} style={{ padding: '8px 14px', fontSize: 13 }}>📢 {unreadNotices} new notice{unreadNotices === 1 ? '' : 's'}</button>}
                {unreadMsgs > 0 && <button className="tp-mini" onClick={() => goTab('Messages')} style={{ padding: '8px 14px', fontSize: 13 }}>💬 {unreadMsgs} unread message{unreadMsgs === 1 ? '' : 's'}</button>}
              </div>
            )}

            {helpContact && (
              <div className="tp-card" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Need help?</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Questions about rent, repairs or your unit.</div>
                </div>
                <button className="tp-pay-btn" style={{ marginTop: 0, padding: '9px 16px', fontSize: 14 }} onClick={messageHelpContact}>
                  Message your {ROLE_WORD[helpContact.role] || 'property manager'}
                </button>
              </div>
            )}

            {payments.length === 0 && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
                No payments yet. Once you pay, your payments and receipts will show here.
              </div>
            )}

            {/* Last 3 payments */}
            {payments.length > 0 && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>Recent Payments</div>
                {payments.slice(0, 5).map((p, i) => {
                  const isFailed  = p.status === 'failed';
                  const isPending = p.status === 'pending';
                  return (
                    <div key={p.id} className="tp-row" style={{ padding: '12px 18px', borderTop: i > 0 ? '1px solid var(--border)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: isFailed ? 0.6 : 1 }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, textDecoration: isFailed ? 'line-through' : 'none', color: isFailed ? 'var(--muted)' : 'var(--text)' }}>
                          KES {parseFloat(p.amount).toLocaleString()}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.for_year && p.for_month ? monthName(p.for_year, p.for_month) : new Date(p.payment_date).toLocaleDateString('en-KE')}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <span style={{ background: 'var(--surface2)', color: 'var(--muted)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{p.method}</span>
                        {isFailed  && <span style={{ background: 'var(--red-light)',    color: 'var(--red)',    padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>failed</span>}
                        {isPending && <span style={{ background: 'var(--amber-light)',  color: 'var(--amber)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>pending</span>}
                        {!isFailed && !isPending && <span style={{ background: 'var(--green-light)', color: 'var(--green)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>paid</span>}
                        {!isFailed && !isPending && <button className="tp-mini" onClick={() => setReceipt(p)}>Receipt</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Pay Now */}
        {tab === 'Pay Now' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24 }}>
              <div style={{ fontFamily: 'Bricolage Grotesque', fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Pay via M-Pesa</div>
              <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>
                An STK push will be sent to <strong>{me?.phone}</strong>. Enter your M-Pesa PIN when prompted.
              </p>
              {totalArrears > 0 && (
                <div style={{ background: 'var(--red-light)', border: '1px solid var(--red)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
                  <div style={{ fontWeight: 700, color: 'var(--red)', marginBottom: 4 }}>Outstanding: KES {totalArrears.toLocaleString()}</div>
                  <div style={{ color: 'var(--muted)' }}>Payment will be allocated to your oldest unpaid month first.</div>
                </div>
              )}
              {stkMsg && (
                <div style={{
                  background: stkStatus === 'success' ? 'var(--green-light)' : stkStatus === 'pending' ? 'var(--blue-light)' : 'var(--red-light)',
                  color:      stkStatus === 'success' ? 'var(--green)'       : stkStatus === 'pending' ? 'var(--blue)'       : 'var(--red)',
                  padding: '10px 14px', borderRadius: 8, marginBottom: stkTxId ? 6 : 16, fontSize: 13, fontWeight: 500
                }}>
                  {stkMsg}
                </div>
              )}
              {stkTxId && (
                <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace', marginBottom: 16 }}>
                  Reference: {stkTxId}
                </div>
              )}
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>M-Pesa Phone Number</label>
                <input type="tel" value={stkPhone} onChange={e => setStkPhone(e.target.value)}
                  placeholder="e.g. 0712345678"
                  style={inputStyle} />
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  Defaults to your registered number. Change if paying from a different line.
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Amount (KES)</label>
                <input type="number" value={stkAmount} onChange={e => setStkAmount(e.target.value)}
                  placeholder={totalArrears > 0 ? String(totalArrears) : String(me?.rent_amount || '15000')}
                  style={{ ...inputStyle, fontSize: 18, fontWeight: 600 }} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                <button onClick={() => setStkAmount(String(me?.rent_amount || ''))}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--muted)' }}>
                  One Month (KES {parseFloat(me?.rent_amount || 0).toLocaleString()})
                </button>
                {totalArrears > 0 && (
                  <button onClick={() => setStkAmount(String(totalArrears))}
                    style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--red)', background: 'var(--red-light)', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--red)' }}>
                    Clear All (KES {totalArrears.toLocaleString()})
                  </button>
                )}
              </div>
              <button onClick={triggerStkPush} disabled={stkLoading}
                style={{ width: '100%', padding: '14px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: 16, cursor: 'pointer' }}>
                {stkLoading ? 'Sending...' : 'Send M-Pesa STK Push'}
              </button>
            </div>
            {paybillBox}
          </div>
        )}

        {/* Payments */}
        {tab === 'Payments' && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
            {payments.length === 0
              ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>No payments recorded yet.</div>
              : payments.map((p, i) => {
                const isFailed  = p.status === 'failed';
                const isPending = p.status === 'pending';
                return (
                  <div key={p.id} className="tp-row" style={{ padding: '14px 18px', borderTop: i > 0 ? '1px solid var(--border)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: isFailed ? 0.55 : 1, background: isFailed ? 'var(--red-light)' : isPending ? 'var(--amber-light)' : 'transparent' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15, textDecoration: isFailed ? 'line-through' : 'none', color: isFailed ? 'var(--muted)' : 'var(--text)' }}>
                        KES {parseFloat(p.amount).toLocaleString()}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                        {p.for_year && p.for_month ? `For: ${monthName(p.for_year, p.for_month)} · ` : ''}
                        {new Date(p.payment_date).toLocaleDateString('en-KE')}
                        {p.receipt_no ? ` · ${p.receipt_no}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <span style={{ background: 'var(--surface2)', color: 'var(--muted)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{p.method}</span>
                      {isFailed  && <span style={{ background: 'var(--red-light)',    color: 'var(--red)',    padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>failed</span>}
                      {isPending && <span style={{ background: 'var(--amber-light)',  color: 'var(--amber)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>pending</span>}
                      {!isFailed && !isPending && <span style={{ background: 'var(--blue-light)', color: 'var(--blue)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>paid</span>}
                      {!isFailed && !isPending && <button className="tp-mini" onClick={() => setReceipt(p)}>Receipt</button>}
                    </div>
                  </div>
                );
              })
            }
          </div>
        )}

        {/* Arrears */}
        {tab === 'Arrears' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {arrears.length === 0
              ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--green)', fontWeight: 600, fontSize: 15 }}><IconInline name="✅" size={14} />No arrears — you're fully paid up!</div>
              : arrears.map(m => (
                <div key={`${m.year}-${m.month}`} style={{ background: 'var(--surface)', border: `1px solid ${m.partial ? 'var(--amber)' : 'var(--red)'}`, borderRadius: 16, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: m.partial ? 'var(--amber)' : 'var(--red)' }}>{m.label} {m.partial ? '— Partial' : '— Unpaid'}</div>
                    {m.partial && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Paid: KES {m.paid.toLocaleString()} of KES {m.rent.toLocaleString()}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 800, fontFamily: 'Bricolage Grotesque', fontSize: 18, color: m.partial ? 'var(--amber)' : 'var(--red)' }}>KES {m.balance.toLocaleString()}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>still owed</div>
                  </div>
                </div>
              ))
            }
            {arrears.length > 0 && (
              <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>Total Outstanding</span>
                <span style={{ fontWeight: 800, fontFamily: 'Bricolage Grotesque', fontSize: 20, color: 'var(--red)' }}>KES {totalArrears.toLocaleString()}</span>
              </div>
            )}
            {arrears.length > 0 && <button className="tp-pay-btn" style={{ marginTop: 0, width: '100%' }} onClick={() => goPay(totalArrears)}>Pay KES {totalArrears.toLocaleString()} now</button>}
          </div>
        )}

        {/* Maintenance */}
        {tab === 'Maintenance' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Submit form */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Submit New Request</div>
              {mError   && <div style={{ background: 'var(--red-light)', color: 'var(--red)', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{mError}</div>}
              {mSuccess && <div style={{ background: 'var(--green-light)', color: 'var(--green)', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{mSuccess}</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Describe the Issue</label>
                  <textarea value={mForm.issue} onChange={e => setMForm(f => ({ ...f, issue: e.target.value }))}
                    placeholder="e.g. Leaking tap in bathroom, broken window..." rows={3}
                    style={{ ...inputStyle, resize: 'vertical' }} />
                </div>
                <div>
                  <label style={labelStyle}>Priority</label>
                  <select value={mForm.priority} onChange={e => setMForm(f => ({ ...f, priority: e.target.value }))} style={inputStyle}>
                    <option value="low">Low — not urgent</option>
                    <option value="medium">Medium — needs attention soon</option>
                    <option value="high">High — urgent</option>
                  </select>
                </div>
                <button onClick={submitMaintenance} disabled={mSaving} style={{ padding: '10px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                  {mSaving ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </div>

            {/* Existing requests */}
            {maintenance.length > 0 && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>Your Requests</div>
                {maintenance.map((r, i) => (
                  <div key={r.id} style={{ padding: '14px 18px', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, flex: 1, marginRight: 12 }}>{r.issue}</div>
                      <span style={{ background: statusBg[r.status], color: statusColor[r.status], padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.status.replace('_', ' ')}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--muted)' }}>
                      <span style={{ color: priorityColor[r.priority], fontWeight: 600 }}>{r.priority} priority</span>
                      <span>{new Date(r.reported_at).toLocaleDateString('en-KE')}</span>
                      {r.resolved_at && <span>Resolved: {new Date(r.resolved_at).toLocaleDateString('en-KE')}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {maintenance.length === 0 && (
              <div style={{ padding: 28, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>No repair requests yet. If something needs fixing, describe it above and we will follow it up.</div>
            )}
          </div>
        )}

        {/* My Unit */}

        {/* Notices */}
        {tab === 'Notices' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {notices.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}><Icon name="📢" size={36} /></div>
                <p>No notices yet.</p>
              </div>
            ) : notices.map(n => {
              const pColors = {
                info:    { bg: 'var(--blue-light)',  color: 'var(--blue)',  border: 'var(--blue)'  },
                warning: { bg: 'var(--amber-light)', color: 'var(--amber)', border: 'var(--amber)' },
                urgent:  { bg: 'var(--red-light)',   color: 'var(--red)',   border: 'var(--red)'   },
              };
              const p = pColors[n.priority] || pColors.info;
              const icons = { info: 'ℹ️', warning: '⚠️', urgent: '🚨' };
              return (
                <div key={n.id} onClick={async () => {
                  if (!n.is_read) {
                    await tenantFetch(`/notices/${n.id}/read`, { method: 'POST' });
                    setNotices(ns => ns.map(x => x.id === n.id ? { ...x, is_read: true } : x));
                    setUnreadNotices(u => Math.max(0, u - 1));
                  }
                }} className="tp-card tp-row" style={{ background: 'var(--surface)', border: `1px solid ${p.border}`, borderLeft: `4px solid ${p.border}`, borderRadius: 16, padding: '14px 16px', cursor: 'pointer', opacity: n.is_read ? 0.75 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ background: p.bg, color: p.color, padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700 }}><IconInline name={icons[n.priority]} size={13} gap={4} />{n.priority}</span>
                    {!n.is_read && <span style={{ background: 'var(--red)', color: '#fff', borderRadius: 99, fontSize: 10, fontWeight: 700, padding: '2px 7px' }}>NEW</span>}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: 'var(--text)' }}>{n.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 8 }}>{n.body}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>From {n.author_name} · {new Date(n.created_at).toLocaleDateString('en-KE')}</span>
                    <button onClick={async (e) => {
                      e.stopPropagation();
                      const res = await tenantFetch(`/notices/${n.id}/reply`, { method: 'POST' });
                      if (res.conversation_id) {
                        setTab('Messages');
                        const msgsRes = await tenantFetch(`/notices/conversations/${res.conversation_id}/messages/tenant`);
                        setConvMessages(msgsRes.data || []);
                        setActiveConv({ id: res.conversation_id, other_name: n.author_name, notice_title: n.title });
                        const cRes = await tenantFetch('/notices/conversations/tenant');
                        setConversations(cRes.data || []);
                      }
                    }} style={{ padding: '4px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', fontSize: 12, fontWeight: 600, color: 'var(--muted)', cursor: 'pointer' }}>
                      Reply Privately →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'My Unit' && me && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <InfoCard title="Unit Details" rows={[
              ['Unit Number',  me.unit_number],
              ['Type',         me.house_type],
              ['Monthly Rent', `KES ${parseFloat(me.rent_amount || 0).toLocaleString()}`],
              ['Deposit',      `KES ${parseFloat(me.deposit || 0).toLocaleString()}`],
              ['Meter No.',    me.meter_no || '—'],
            ]} />
            <InfoCard title="Property" rows={[
              ['Building',  me.plot_name],
              ['Location',  me.plot_location || '—'],
            ]} />
            <InfoCard title="My Details" rows={[
              ['Full Name',   me.full_name],
              ['Phone',       me.phone],
              ['Email',       me.email || '—'],
              ['National ID', me.national_id || '—'],
              ['Move-in',     me.move_in_date ? new Date(me.move_in_date).toLocaleDateString('en-KE') : '—'],
              ['Deposit Paid',`KES ${parseFloat(me.deposit_paid || 0).toLocaleString()}`],
            ]} />
          </div>
        )}
        {/* Messages */}
        {tab === 'Messages' && (
          <div style={
            isMobile
              ? { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 262px)', minHeight: 360, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }
              : { display: 'grid', gridTemplateColumns: '260px 1fr', gap: 12, height: 480 }
          }>

            {/* Conversation list — hidden on mobile once a conversation is open */}
            {(!isMobile || !activeConv) && (
              <div style={{ background: 'var(--surface)', borderRadius: isMobile ? 0 : 12, border: isMobile ? 'none' : '1px solid var(--border)', overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: isMobile ? 1 : 'initial', minHeight: 0 }}>
                <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>Conversations</span>
                  <button onClick={e => { e.stopPropagation(); setNewMsgOpen(o => !o); }} style={{ border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 8, cursor: 'pointer' }}>+ New</button>
                  {newMsgOpen && (
                    <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: '100%', right: 14, zIndex: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.15))', minWidth: 200, overflow: 'hidden' }}>
                      {contacts.length === 0 ? (
                        <div style={{ padding: 14, fontSize: 12, color: 'var(--muted)' }}>No one to message yet.</div>
                      ) : contacts.map(c => {
                        const isAdmin = c.role === 'admin' || c.role === 'super_admin';
                        const displayName = isAdmin ? 'Admin' : c.name;
                        return (
                          <button key={`${c.role}-${c.id}`} onClick={() => startConversation({ ...c, name: displayName })} className="tp-row"
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer' }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{displayName}</div>
                            {!isAdmin && <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'capitalize' }}>{c.role}</div>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {conversations.length === 0 ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>No conversations yet.<br/>Reply to a notice to start one.</div>
                  ) : conversations.map(c => {
                    const unread = parseInt(c.unread_count || 0);
                    const isActive = activeConv?.id === c.id;
                    return (
                      <div key={c.id} onClick={async () => {
                        setActiveConv(c);
                        const res = await tenantFetch(`/notices/conversations/${c.id}/messages/tenant`);
                        setConvMessages(res.data || []);
                        setConversations(cs => cs.map(x => x.id === c.id ? { ...x, unread_count: 0 } : x));
                        setUnreadMsgs(u => Math.max(0, u - unread));
                      }} className="tp-row" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: isActive && !isMobile ? 'var(--primary-light)' : 'transparent' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontWeight: unread > 0 ? 700 : 500, fontSize: 13, color: 'var(--text)' }}>{c.other_name || 'Staff'}</span>
                          {unread > 0 && <span style={{ background: 'var(--red)', color: '#fff', borderRadius: 99, fontSize: 10, fontWeight: 700, padding: '1px 6px' }}>{unread}</span>}
                        </div>
                        {c.notice_title && <div style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600, marginBottom: 2 }}>Re: {c.notice_title}</div>}
                        <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.last_message || 'No messages yet'}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Thread — on mobile, only shown once a conversation is selected */}
            {(!isMobile || activeConv) && (
              <div style={{ background: 'var(--surface)', borderRadius: isMobile ? 0 : 12, border: isMobile ? 'none' : '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: isMobile ? 1 : 'initial', minHeight: 0 }}>
                {!activeConv ? (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', gap: 8 }}>
                    <span style={{ fontSize: 36 }}><Icon name="💬" size={36} /></span>
                    <p style={{ fontSize: 13 }}>Select a conversation</p>
                  </div>
                ) : (
                  <>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                      {isMobile && (
                        <button onClick={() => setActiveConv(null)} style={{ border: 'none', background: 'transparent', fontSize: 20, cursor: 'pointer', color: 'var(--text)', padding: 0, lineHeight: 1 }}>←</button>
                      )}
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{activeConv.other_name || 'Staff'}</div>
                        {activeConv.notice_title && <div style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600 }}>Re: {activeConv.notice_title}</div>}
                      </div>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {convMessages.map(m => {
                        const isMe = m.sender_type === 'tenant';
                        return (
                          <div key={m.id} style={{ display: 'flex', flexDirection: isMe ? 'row-reverse' : 'row', gap: 6 }}>
                            <div style={{ maxWidth: isMobile ? '85%' : '75%', padding: '8px 12px', borderRadius: isMe ? '12px 12px 4px 12px' : '12px 12px 12px 4px', background: isMe ? 'var(--primary)' : 'var(--surface2)', color: isMe ? '#fff' : 'var(--text)', fontSize: 13, lineHeight: 1.5 }}>
                              {!isMe && <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 3, color: 'var(--primary)' }}>{m.sender_name}</div>}
                              {m.body}
                              <div style={{ fontSize: 9, marginTop: 3, opacity: 0.6, textAlign: isMe ? 'right' : 'left' }}>
                                {new Date(m.created_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                      <input value={msgInput} onChange={e => setMsgInput(e.target.value)}
                        onKeyDown={async e => {
                          if (e.key === 'Enter' && msgInput.trim()) {
                            const res = await tenantFetch(`/notices/conversations/${activeConv.id}/messages/tenant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: msgInput.trim() }) });
                            setConvMessages(m => [...m, res.data]);
                            setMsgInput('');
                          }
                        }}
                        placeholder="Type a message... (Enter to send)"
                        style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, outline: 'none', background: 'var(--surface2)', color: 'var(--text)' }} />
                      <button onClick={async () => {
                        if (!msgInput.trim()) return;
                        const res = await tenantFetch(`/notices/conversations/${activeConv.id}/messages/tenant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: msgInput.trim() }) });
                        setConvMessages(m => [...m, res.data]);
                        setMsgInput('');
                      }} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Send</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Phone bottom menu (idea 3): five big buttons instead of eight tabs */}
      {isMobile && (
        <>
          {moreOpen && <div onClick={() => setMoreOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 58, background: 'rgba(0,0,0,0.35)' }} />}
          {moreOpen && (
            <div className="tp-more" style={{ bottom: 'calc(70px + env(safe-area-inset-bottom, 0px))' }}>
              {MORE_TABS.map(t => (
                <button key={t} onClick={() => goTab(t)}>
                  <span>{t}</span>
                  {t === 'Notices' && unreadNotices > 0 && <span style={{ background: 'var(--red)', color: '#fff', borderRadius: 99, fontSize: 11, fontWeight: 700, padding: '1px 8px' }}>{unreadNotices}</span>}
                </button>
              ))}
              <button onClick={logout} style={{ color: 'var(--red)' }}><span>Sign out</span></button>
            </div>
          )}
          <nav className="tp-nav" role="navigation" aria-label="Main">
            {[['Overview', 'Home', 'home'], ['Pay Now', 'Pay', 'pay'], ['Payments', 'History', 'list'], ['Messages', 'Chat', 'chat']].map(([t, label, icon]) => (
              <button key={t} className={tab === t ? 'on' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => goTab(t)}>
                <NavIcon name={icon} />
                <span>{label}</span>
                {t === 'Messages' && unreadMsgs > 0 && <span className="tp-dot">{unreadMsgs}</span>}
              </button>
            ))}
            <button className={MORE_TABS.includes(tab) || moreOpen ? 'on' : ''} aria-expanded={moreOpen} onClick={() => setMoreOpen(o => !o)}>
              <NavIcon name="more" />
              <span>More</span>
              {unreadNotices > 0 && <span className="tp-dot">{unreadNotices}</span>}
            </button>
          </nav>
        </>
      )}

      {receipt && <ReceiptModal p={receipt} me={me} monthName={monthName} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function NavIcon({ name }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  if (name === 'home') return <svg {...common}><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></svg>;
  if (name === 'pay')  return <svg {...common}><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10.5h18" /><path d="M7 15h3" /></svg>;
  if (name === 'list') return <svg {...common}><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>;
  if (name === 'chat') return <svg {...common}><path d="M4 5h16v11H9l-5 4z" /></svg>;
  return <svg {...common}><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></svg>;
}

function PaybillBox({ number, account, copied, onCopy }) {
  const row = (label, value, key) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--border)' }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</div>
        <div style={{ fontFamily: 'Bricolage Grotesque', fontWeight: 800, fontSize: 20, letterSpacing: '0.5px' }}>{value}</div>
      </div>
      <button className="tp-copy" onClick={() => onCopy(key, value)}>{copied === key ? 'Copied ✓' : 'Copy'}</button>
    </div>
  );
  return (
    <div className="tp-card" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '16px 18px' }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Pay with M-Pesa Paybill</div>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 8px' }}>On your phone: M-Pesa → Lipa na M-Pesa → Pay Bill, then enter:</p>
      {row('Business number', number, 'biz')}
      {row('Account number', account, 'acc')}
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0 0' }}>Use this exact account number so your payment is matched to your unit automatically.</p>
    </div>
  );
}

function ReceiptModal({ p, me, monthName, onClose }) {
  const no     = p.receipt_no || `RF-${p.id}`;
  const month  = p.for_year && p.for_month ? monthName(p.for_year, p.for_month) : '';
  const date   = new Date(p.payment_date).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' });
  const rows   = [
    ['Receipt no.', no], ['Date', date], ['Amount', `KES ${parseFloat(p.amount).toLocaleString()}`], month && ['Rent for', month],
    ['Method', p.method], p.reference && ['Reference', p.reference], ['Paid by', me.full_name], ['Unit', `${me.unit_number} · ${me.plot_name}`],
  ].filter(Boolean);
  const text   = ['RentFlow payment receipt', ...rows.map(([k, v]) => `${k}: ${v}`)].join('\n');
  const inApp  = /; wv\)/.test(navigator.userAgent);   // Android app: no print dialog there
  const [note, setNote] = useState('');

  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  async function share() {
    try {
      if (navigator.share) { await navigator.share({ title: `Receipt ${no}`, text }); return; }
      await navigator.clipboard.writeText(text); setNote('Receipt copied. You can paste it into WhatsApp or a message.');
    } catch { /* cancelled */ }
  }

  return (
    <div onClick={onClose} role="dialog" aria-modal="true" aria-label="Payment receipt" style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} className="tp-receipt-print" style={{ background: 'var(--surface)', borderRadius: 16, maxWidth: 380, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 22, boxShadow: '0 12px 40px rgba(0,0,0,0.3)' }}>
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div style={{ fontFamily: 'Bricolage Grotesque', fontWeight: 800, fontSize: 18 }}>Payment receipt</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>RentFlow</div>
        </div>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: 14 }}>
            <span style={{ color: 'var(--muted)' }}>{k}</span>
            <span style={{ fontWeight: 600, textAlign: 'right' }}>{v}</span>
          </div>
        ))}
        {note && <div className="tp-noprint" style={{ fontSize: 12, color: 'var(--green)', marginTop: 10 }}>{note}</div>}
        <div className="tp-noprint" style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={share} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{navigator.share ? 'Share' : 'Copy'}</button>
          {!inApp && <button onClick={() => window.print()} className="tp-copy" style={{ flex: 1 }}>Print / PDF</button>}
          <button onClick={onClose} autoFocus className="tp-copy" style={{ flex: 1 }}>Close</button>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, value, color, light, sub }) {
  return (
    <div className="tp-card tp-kpi" style={{ '--tp-accent': color, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '16px', boxShadow: 'var(--shadow)' }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, background: light, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, marginBottom: 10 }}><Icon name={icon} size={18} /></div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: 'Bricolage Grotesque', fontWeight: 800, fontSize: 18, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function InfoCard({ title, rows }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: '12px 18px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>{title}</div>
      {rows.map(([label, value]) => (
        <div key={label} style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
          <span style={{ color: 'var(--muted)' }}>{label}</span>
          <span style={{ fontWeight: 600 }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' };
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 14, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' };

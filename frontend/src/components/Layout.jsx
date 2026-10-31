import OfflineBar from './OfflineBar';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import API, { getPendingLandlordsCount } from '../services/api';
import { useAuth } from '../context/AuthContext';
import QuickSearch from './QuickSearch';

// ── Responsive hook ───────────────────────────────────────────────────────────
function useBreakpoint() {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const fn = () => setW(window.innerWidth);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);
  return { isMobile: w < 768 };
}

export default function Layout() {
  const [collapsed,    setCollapsed]    = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    return saved !== null ? saved === '1' : window.innerWidth < 1100;
  });
  const [sidebarOpen,  setSidebarOpen]  = useState(false); // mobile drawer
  const [theme,        setTheme]        = useState(localStorage.getItem('theme') || 'light');
  const [dropdown,     setDropdown]     = useState(false);
  const [modal,        setModal]        = useState(null);
  const [profileForm,  setProfileForm]  = useState({ name: '', phone: '', email: '' });
  const [passwordForm, setPasswordForm] = useState({ current: '', newPass: '', confirm: '' });
  const [saving,       setSaving]       = useState(false);
  const [msg,          setMsg]          = useState('');
  const [error,        setError]        = useState('');
  const [accountDetails, setAccountDetails] = useState(null);
  const fileInputRef = useRef(null);
  const dropdownRef  = useRef(null); // wraps the avatar BUTTON only (used to measure position + outside-click)
  const dropdownPanelRef = useRef(null); // the portaled panel itself (lives in document.body, not here)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });
  const { user, can, canAnywhere } = useAuth(); // live DB row (role, agent_id, profile, permissions) via /api/auth/me
  const [displayName, setDisplayName]  = useState(null);
  const role         = user?.role;
  const canApprove   = role === 'admin' || role === 'super_admin';
  const photoKey     = `userPhoto_${user?.id}`;
  const [photo,      setPhoto]         = useState(localStorage.getItem(`userPhoto_${user?.id}`) || null);
  const [clock,      setClock]         = useState('');
  const [unreadMsg,     setUnreadMsg]     = useState(0);
  const [unreadNotices, setUnreadNotices] = useState(0);
  const [pendingLandlords, setPendingLandlords] = useState(0);
  const [pendingUnits, setPendingUnits] = useState(0);
  // Dismissal is keyed to the COUNT at the moment of dismissal, not just a
  // boolean — so dismissing "3 units pending" hides the toast, but if a
  // 4th shows up later in the same session, it reappears (something new
  // actually needs attention), rather than being silenced forever.
  const [dismissedLandlordsAt, setDismissedLandlordsAt] = useState(() => {
    try { return parseInt(sessionStorage.getItem('dismissed_pending_landlords') || '0'); } catch { return 0; }
  });
  const [dismissedUnitsAt, setDismissedUnitsAt] = useState(() => {
    try { return parseInt(sessionStorage.getItem('dismissed_pending_units') || '0'); } catch { return 0; }
  });
  function dismissLandlordsToast() {
    setDismissedLandlordsAt(pendingLandlords);
    try { sessionStorage.setItem('dismissed_pending_landlords', String(pendingLandlords)); } catch {}
  }
  function dismissUnitsToast() {
    setDismissedUnitsAt(pendingUnits);
    try { sessionStorage.setItem('dismissed_pending_units', String(pendingUnits)); } catch {}
  }
  const [bellOpen,   setBellOpen]      = useState(false);
  const { isMobile }                   = useBreakpoint();
  const navigate = useNavigate();

  // Chats panel (Messenger-style dropdown preview of conversations)
  const chatsPanelRef = useRef(null);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [chatConversations, setChatConversations] = useState([]);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [chatSearch, setChatSearch] = useState('');
  const [chatFilter, setChatFilter] = useState('all'); // all | unread

  useEffect(() => {
    function tick() {
      const now = new Date();
      setClock(now.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Previously this called /notices/unread-count, which only ever
    // returns the MESSAGES count — notices were never fetched at all, so
    // the bell (meant for notices, per the comment on topbarNav below)
    // just silently mirrored the Messages badge and could never show a
    // real notices alert for anyone, on any role.
    async function fetchUnread() {
      try {
        const res = await API.get('/notices/unread-summary');
        setUnreadMsg(res.data.messages || 0);
        setUnreadNotices(res.data.notices || 0);
      } catch {}
    }
    fetchUnread();
    const id = setInterval(fetchUnread, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!canApprove) return;
    async function fetchPending() {
      try { const res = await getPendingLandlordsCount(); setPendingLandlords(res.data.count || 0); } catch {}
    }
    fetchPending();
    const id = setInterval(fetchPending, 30000);
    // Previously this only ever refreshed on the 30s poll — approving (or
    // suspending) a landlord in Users.jsx updated that page's own list
    // instantly, but this badge/toast (which lives in Layout, not Users,
    // so it follows you to any page) stayed stale for up to 30s. Users.jsx
    // now fires this event right after an approve/suspend so it updates
    // immediately — same pattern already used for pending units below.
    window.addEventListener('pending-landlords-changed', fetchPending);
    return () => { clearInterval(id); window.removeEventListener('pending-landlords-changed', fetchPending); };
  }, [canApprove]);

  useEffect(() => {
    if (!can('houses.approve')) return;
    async function fetchPendingUnits() {
      try { const hRes = await API.get('/houses/pending-approval-count'); setPendingUnits(hRes.data.count || 0); } catch {}
    }
    fetchPendingUnits();
    const id = setInterval(fetchPendingUnits, 30000);
    window.addEventListener('pending-units-changed', fetchPendingUnits);
    return () => { clearInterval(id); window.removeEventListener('pending-units-changed', fetchPendingUnits); };
  }, [can]);

  useEffect(() => {
    try { localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0'); } catch {}
  }, [collapsed]);

  // Fold state for sidebar groups (persisted); the group holding the current page auto-opens.
  const location = useLocation();
  const [folded, setFolded] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sidebarFolded') || 'null') || { insight: true, marketing: true, admin: true }; }
    catch { return { insight: true, marketing: true, admin: true }; }
  });
  useEffect(() => { try { localStorage.setItem('sidebarFolded', JSON.stringify(folded)); } catch {} }, [folded]);
  const [flyout, setFlyout] = useState(null); // { key, top }
  useEffect(() => { setFlyout(null); }, [location.pathname, collapsed]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      document.documentElement.style.setProperty('--bg',      '#0f1117');
      document.documentElement.style.setProperty('--surface', '#1a1d27');
      document.documentElement.style.setProperty('--surface2','#21253a');
      document.documentElement.style.setProperty('--border',  '#2a2f45');
      document.documentElement.style.setProperty('--text',    '#e8eaf6');
      document.documentElement.style.setProperty('--muted',   '#6b7194');
    } else {
      document.documentElement.style.setProperty('--bg',      '#f0f2f7');
      document.documentElement.style.setProperty('--surface', '#ffffff');
      document.documentElement.style.setProperty('--surface2','#f8f9fc');
      document.documentElement.style.setProperty('--border',  '#e4e8f0');
      document.documentElement.style.setProperty('--text',    '#0f1623');
      document.documentElement.style.setProperty('--muted',   '#6b7694');
    }
  }, [theme]);

  useEffect(() => {
    function handleClick(e) {
      const insideButton = dropdownRef.current && dropdownRef.current.contains(e.target);
      const insidePanel   = dropdownPanelRef.current && dropdownPanelRef.current.contains(e.target);
      if (!insideButton && !insidePanel) setDropdown(false);
      if (chatsPanelRef.current && !chatsPanelRef.current.contains(e.target)) setChatsOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Close mobile sidebar when navigating
  useEffect(() => { setSidebarOpen(false); }, [navigate]);

  async function openProfile() {
    setMsg(''); setError(''); setModal('profile'); setDropdown(false);
    try {
      const res = await API.get('/auth/users');
      const me = (res.data.data || []).find(u => u.id === user?.id);
      if (me) setProfileForm({ name: me.name || '', email: me.email || '', phone: me.phone || '' });
    } catch { setProfileForm({ name: user?.name || '', email: '', phone: '' }); }
  }

  function handlePhotoChange(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX = 150, ratio = Math.min(MAX / img.width, MAX / img.height);
        canvas.width = img.width * ratio; canvas.height = img.height * ratio;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const resized = canvas.toDataURL('image/jpeg', 0.7);
        setPhoto(resized);
        try { localStorage.setItem(photoKey, resized); } catch {}
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function openPassword() { setPasswordForm({ current: '', newPass: '', confirm: '' }); setMsg(''); setError(''); setModal('password'); setDropdown(false); }

  async function openAccount() {
    setMsg(''); setError(''); setModal('account'); setDropdown(false);
    try { const res = await API.get('/auth/users'); const me = (res.data.data || []).find(u => u.id === user?.id); if (me) setAccountDetails(me); } catch {}
  }

  async function handleSaveProfile() {
    setSaving(true); setMsg(''); setError('');
    try { await API.patch(`/auth/users/${user.id}/profile`, profileForm); setDisplayName(profileForm.name); setMsg('Profile updated successfully!'); }
    catch (e) { setError(e.response?.data?.error || e.message || 'Failed'); }
    finally { setSaving(false); }
  }

  async function handleChangePassword() {
    setMsg(''); setError('');
    if (passwordForm.newPass !== passwordForm.confirm) return setError('Passwords do not match.');
    if (passwordForm.newPass.length < 6) return setError('Password must be at least 6 characters.');
    setSaving(true);
    try { await API.patch(`/auth/users/${user.id}/password`, { current_password: passwordForm.current, new_password: passwordForm.newPass }); setMsg('Password changed!'); setPasswordForm({ current: '', newPass: '', confirm: '' }); }
    catch (e) { setError(e.response?.data?.error || e.message || 'Failed'); }
    finally { setSaving(false); }
  }

  async function openSettings() {
    setMsg(''); setError(''); setModal('settings');
    try {
      const res = await API.get('/auth/users');
      const me = (res.data.data || []).find(u => u.id === user?.id);
      if (me) setProfileForm({ name: me.name || '', email: me.email || '', phone: me.phone || '' });
    } catch { setProfileForm({ name: user?.name || '', email: '', phone: '' }); }
    setPasswordForm({ current: '', newPass: '', confirm: '' });
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d`;
    const weeks = Math.floor(days / 7);
    if (weeks < 52) return `${weeks}w`;
    return `${Math.floor(weeks / 52)}y`;
  }

  async function toggleChats() {
    const next = !chatsOpen;
    setChatsOpen(next);
    setDropdown(false);
    if (next) {
      setChatsLoading(true);
      try {
        const res = await API.get('/notices/conversations');
        setChatConversations(res.data.data || []);
      } catch {}
      finally { setChatsLoading(false); }
    }
  }

  function openConversation(conv) {
    setChatsOpen(false);
    navigate('/messages', { state: { conversationId: conv.id } });
  }

  function handleLogout() { localStorage.removeItem('token'); window.location.href = '/login'; }

  const nav = [
    { to: '/',            icon: '⊞', label: 'Dashboard',  roles: ['admin','super_admin','agent','landlord','caretaker'] },
    { to: '/properties',  icon: '🏢', label: 'Properties', roles: ['admin','super_admin','agent','landlord','caretaker'] },
    { to: '/building',    icon: '🧊', label: '3D View',    roles: ['admin','super_admin','agent','landlord','caretaker'] },
    { to: '/estate',      icon: '🗺️', label: 'Estate Map', roles: ['admin','super_admin'] },
    { to: '/specials',    icon: '⭐', label: 'Specials',   roles: ['admin','super_admin'] },
    /* These four pages (Tenants/Payments/Maintenance/Expenses) are the
       ones an admin can grant or revoke per-property, for agent, landlord
       or caretaker accounts (see Permission Overrides). A static `roles`
       list can only ever go stale here: it's what let a granted override
       show nothing new (the link was already visible to the whole role)
       and, just as broken the other way, let a REVOKED override leave the
       link sitting there with nothing behind it. `permission` + the
       canAnywhere() check below asks the real, current question instead:
       "does this specific user have this permission for at least one
       property they can see, right now" — which is exactly what changes
       the moment an admin grants or revokes an override. Admin/super_admin
       always pass (they carry the '*' wildcard), so they're unaffected. */
    { to: '/tenants',     icon: '👥', label: 'Tenants',    permission: 'tenants.view',     roles: ['admin','super_admin'] },
    { to: '/documents',   icon: '📄', label: 'Notices & leases', permission: 'tenants.view', roles: ['admin','super_admin'] },
    { to: '/passport',    icon: '🪪', label: 'Rent passport', permission: 'payments.view', roles: ['admin','super_admin'] },
    { to: '/payments',    icon: '💳', label: 'Payments',   permission: 'payments.view',    roles: ['admin','super_admin'] },
    { to: '/maintenance', icon: '🔧', label: 'Maintenance',permission: 'maintenance.view', roles: ['admin','super_admin'] },
    { to: '/vendors',     icon: '🧰', label: 'Vendors',    permission: 'maintenance.view', roles: ['admin','super_admin'] },
    { to: '/expenses',    icon: '🧾', label: 'Expenses',   permission: 'expenses.view',    roles: ['admin','super_admin'] },
    { to: '/meters',      icon: '💧', label: 'Meters',     permission: 'meters.view',      roles: ['admin','super_admin'] },
    { to: '/reminders',   icon: '🔔', label: 'Reminders',  permission: 'reminders.send',   roles: ['admin','super_admin'] },
    { to: '/paybill',      icon: '🏦', label: 'Paybill',    roles: ['admin','super_admin','agent','landlord'] },
    { to: '/tax',         icon: '🧮', label: 'Tax (MRI)', permission: 'tax.view', roles: ['admin','super_admin'] },
    { to: '/ask',         icon: '💬', label: 'Ask your data', permission: 'payments.view', roles: ['admin','super_admin'] },
    { to: '/reports',     icon: '📊', label: 'Reports',    roles: ['admin','super_admin','agent','landlord'] },
    { to: '/users',       icon: '👤', label: 'Users',      roles: ['admin','super_admin','agent','landlord'] },
    { to: '/roles',       icon: '🛡️', label: 'Roles & Permissions', roles: ['admin','super_admin'] },
    { to: '/permission-overrides', icon: '🔑', label: 'Permission Overrides', roles: ['admin','super_admin'] },
    { to: '/manage/listings', icon: '🏷️', label: 'Listings',  roles: ['admin','super_admin','agent','landlord'] },
    { to: '/notices',     icon: '📢', label: 'Notices',    roles: ['admin','super_admin','agent','landlord','caretaker'] },
    { to: '/messages',    icon: '💬', label: 'Messages',   roles: ['admin','super_admin','agent','landlord','caretaker'] },
    // Admin/agent only, same restriction as backend/routes/sms.js — SMS
    // (direct messages to tenants/landlords, plus the arrears-reminder
    // blast) is no longer something landlord or caretaker accounts see.
    { to: '/sms',         icon: '📱', label: 'SMS',        roles: ['admin','super_admin','agent'] },
  ].filter(i => i.permission ? (i.roles.includes(role) || canAnywhere(i.permission)) : i.roles.includes(role));

  // Messages lives in the topbar (next to the profile dropdown) instead of
  // the sidebar. Notices was removed from the topbar per feedback — it can
  // still be reached via the bell notification dropdown.
  // Landlords whose properties all have an agent see only the owner portal; a
  // landlord with a mix also gets an "Owner View" link for the agent-run ones.
  const ownerPortalOnly = role === 'landlord' && user?.portal?.mode === 'portal';
  if (ownerPortalOnly) {
    nav.length = 0;
    nav.push(
      { to: '/',         icon: '🏠', label: 'My Properties', roles: ['landlord'] },
      { to: '/notices',  icon: '📢', label: 'Notices',       roles: ['landlord'] },
      { to: '/messages', icon: '💬', label: 'Messages',      roles: ['landlord'] },
    );
  } else if (role === 'landlord' && (user?.portal?.managed_plot_ids || []).length > 0) {
    nav.splice(1, 0, { to: '/portal', icon: '📊', label: 'Owner View', roles: ['landlord'] });
  }

  const topbarNav  = nav.filter(i => i.to === '/messages');
  const sidebarNav = nav.filter(i => i.to !== '/notices' && i.to !== '/messages');

  // ── Sidebar grouping ──
  // Expanded: foldable headings. Collapsed: one icon per group (pop-out list).
  const NAV_GROUPS = [
    { key: 'daily',     label: 'Daily work',    icon: null, open: true,  paths: ['/', '/portal', '/properties', '/building', '/tenants', '/documents', '/passport', '/payments', '/maintenance', '/vendors', '/expenses'] },
    { key: 'billing',   label: 'Billing tools', icon: '💧', open: true,  paths: ['/meters', '/reminders', '/paybill', '/sms'] },
    { key: 'insight',   label: 'Insight',       icon: '📊', open: false, paths: ['/ask', '/reports', '/tax', '/estate'] },
    { key: 'marketing', label: 'Listings',      icon: '🏷️', open: false, paths: ['/manage/listings', '/specials'] },
    { key: 'admin',     label: 'Access',        icon: '🛡️', open: false, paths: ['/users', '/roles', '/permission-overrides'] },
  ];
  const groupedNav = NAV_GROUPS
    .map(g => ({ ...g, items: sidebarNav.filter(i => g.paths.includes(i.to) || (g.key === 'daily' && !NAV_GROUPS.some(x => x.paths.includes(i.to)))) }))
    .filter(g => g.items.length > 0);
  const unreadFor = (label) => label === 'Messages' ? unreadMsg : label === 'Users' ? pendingLandlords : label === 'Properties' ? pendingUnits : 0;
  const isRail = collapsed && !isMobile;

  // Bottom nav shows max 5 most-used items on mobile
  const bottomNav = sidebarNav.slice(0, 5);
  const roleColor = { admin: '#818cf8', super_admin: '#818cf8', agent: '#f472b6', landlord: '#34d399', caretaker: '#fbbf24' };

  const Avatar = ({ size = 30, fontSize = 13 }) => (
    <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'linear-gradient(135deg, #4f46e5, #818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize }}>
      {photo ? <img src={photo} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : ((displayName || user?.name)?.[0]?.toUpperCase() || 'U')}
    </div>
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>

      {/* ── Mobile overlay ── */}
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40 }} />
      )}

      {/* ── Sidebar (desktop always visible, mobile = drawer) ── */}
      {(!isMobile || sidebarOpen) && (
        <aside className="app-chrome" style={{
          width: isMobile ? 260 : collapsed ? 64 : 212,
          minHeight: '100vh',
          background: '#0f1117',
          display: 'flex', flexDirection: 'column',
          padding: '14px 0',
          transition: 'width 0.2s ease',
          flexShrink: 0,
          position: isMobile ? 'fixed' : 'sticky',
          top: 0, left: 0,
          height: isMobile ? '100vh' : '100vh',
          overflow: 'hidden',
          zIndex: isMobile ? 50 : 1,
          boxShadow: isMobile ? '0 0 40px rgba(0,0,0,0.45)' : '1px 0 0 rgba(255,255,255,0.04)',
        }}>
          <div style={{ padding: '0 14px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: 'linear-gradient(135deg, #4f46e5, #818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🏠</div>
            {(!collapsed || isMobile) && <span style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18, color: '#fff', whiteSpace: 'nowrap' }}>RentFlow</span>}
            {isMobile && <button onClick={() => setSidebarOpen(false)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 20, cursor: 'pointer' }}>×</button>}
          </div>

          {(!collapsed || isMobile) && (
            <div style={{ padding: '0 16px 16px' }}>
              <span style={{ background: 'rgba(255,255,255,0.08)', color: roleColor[role] || 'rgba(255,255,255,0.5)', padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{role}</span>
            </div>
          )}

          <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px', overflowY: 'auto' }}>
            {groupedNav.map(g => {
              const hasActive = g.items.some(i => i.to === '/' ? location.pathname === '/' : location.pathname.startsWith(i.to));
              const isOpen = g.open && g.key === 'daily' ? true : (!folded[g.key] || hasActive);
              const badge = g.items.reduce((n, i) => n + unreadFor(i.label), 0);
              if (isRail) {
                // Collapsed rail: single-item or daily groups show their own icons; others merge into one icon with a pop-out.
                if (g.key === 'daily' || g.items.length === 1) {
                  return g.items.map(({ to, icon, label }) => (
                    <NavItem key={to} to={to} icon={icon} label={label} collapsed unread={unreadFor(label)} />
                  ));
                }
                return (
                  <button key={g.key} title={g.label}
                    onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setFlyout(f => f && f.key === g.key ? null : { key: g.key, top: r.top }); }}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '9px 12px', borderRadius: 10, border: 'none', cursor: 'pointer', position: 'relative',
                      color: hasActive || flyout?.key === g.key ? '#fff' : 'rgba(255,255,255,0.5)',
                      background: hasActive || flyout?.key === g.key ? 'rgba(255,255,255,0.15)' : 'transparent',
                      borderLeft: hasActive ? '3px solid #818cf8' : '3px solid transparent' }}>
                    <span style={{ fontSize: 18 }}>{g.icon}</span>
                    <span style={{ position: 'absolute', right: 6, bottom: 6, fontSize: 8, opacity: 0.6 }}>▸</span>
                    {badge > 0 && <span style={{ position: 'absolute', top: 4, right: 6, background: '#ef4444', width: 8, height: 8, borderRadius: 99 }} />}
                  </button>
                );
              }
              return (
                <div key={g.key} style={{ marginBottom: 4 }}>
                  {g.key === 'daily' ? (
                    <div style={{ padding: '6px 12px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)' }}>{g.label}</div>
                  ) : (
                    <button onClick={() => setFolded(f => ({ ...f, [g.key]: isOpen }))}
                      style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '8px 12px 4px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
                        fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)' }}>
                      <span style={{ flex: 1, textAlign: 'left' }}>{g.label}</span>
                      {!isOpen && badge > 0 && <span style={{ background: '#ef4444', color: '#fff', borderRadius: 99, fontSize: 10, padding: '1px 6px', marginRight: 6 }}>{badge}</span>}
                      <span style={{ transition: 'transform 0.15s', transform: isOpen ? 'rotate(90deg)' : 'none' }}>▸</span>
                    </button>
                  )}
                  {isOpen && g.items.map(({ to, icon, label }) => (
                    <NavItem key={to} to={to} icon={icon} label={label} collapsed={false}
                      unread={unreadFor(label)} onClick={() => isMobile && setSidebarOpen(false)} />
                  ))}
                </div>
              );
            })}
            <NavAction icon="⚙️" label="Settings" collapsed={collapsed && !isMobile} active={modal === 'settings'}
              onClick={() => { openSettings(); isMobile && setSidebarOpen(false); }} />
          </nav>

          {!isMobile && (
            <div style={{ padding: '0 8px' }}>
              <button onClick={() => setCollapsed(c => !c)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 14, width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', cursor: 'pointer' }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{collapsed ? '→' : '←'}</span>
                {!collapsed && <span>Collapse</span>}
              </button>
            </div>
          )}
        </aside>
      )}

      {/* ── Collapsed-rail pop-out for merged groups ── */}
      {isRail && flyout && (() => {
        const g = groupedNav.find(x => x.key === flyout.key);
        if (!g) return null;
        return (
          <>
            <div onClick={() => setFlyout(null)} style={{ position: 'fixed', inset: 0, zIndex: 59 }} />
            <div style={{ position: 'fixed', left: 70, top: Math.min(flyout.top, window.innerHeight - (g.items.length * 40 + 50)), zIndex: 60, background: '#161a23', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 6, minWidth: 190, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
              <div style={{ padding: '6px 10px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)' }}>{g.label}</div>
              {g.items.map(({ to, icon, label }) => (
                <NavItem key={to} to={to} icon={icon} label={label} collapsed={false} unread={unreadFor(label)} onClick={() => setFlyout(null)} />
              ))}
            </div>
          </>
        );
      })()}

      {/* ── Main ── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, paddingBottom: 0 }}>

        {/* ── Topbar ── */}
        {/* zIndex here must stay above ordinary page content (cards, the
            Property Map widget, etc.) — dropdowns rendered inside this
            header (account menu, bell, chats) are trapped in this
            stacking context, so if THIS number is too low, no z-index on
            the dropdown itself can save it from being covered by
            something on the page with a higher effective z-index.
            Kept below 200, since this file's own modals/full panels
            (ModalWrapper, chats full panel, notifications panel) use
            zIndex: 200 and must stay above the header, not below it. */}
        <header className="app-chrome" style={{ padding: isMobile ? '0 14px' : '0 24px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
          <div aria-hidden="true" style={{
            position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none',
            background: theme === 'dark' ? 'rgba(26,29,39,0.62)' : 'rgba(255,255,255,0.62)',
            WebkitBackdropFilter: 'saturate(180%) blur(16px)', backdropFilter: 'saturate(180%) blur(16px)',
            borderBottom: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(15,22,35,0.07)'}`,
            boxShadow: theme === 'dark' ? '0 6px 24px rgba(0,0,0,0.25)' : '0 6px 24px rgba(15,23,42,0.06)',
          }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => (isMobile ? setSidebarOpen(true) : setCollapsed(c => !c))}
              aria-label={isMobile ? 'Open menu' : (collapsed ? 'Expand sidebar' : 'Collapse sidebar')}
              title={isMobile ? 'Menu' : (collapsed ? 'Expand sidebar' : 'Collapse sidebar')}
              style={{ width: 38, height: 38, borderRadius: 10, border: 'none', background: 'rgba(127,127,127,0.12)', color: 'var(--text)', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>☰</button>
            {!isMobile && (
              <>
                <div style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 15, color: theme === 'dark' ? 'var(--blue, #2563eb)' : 'var(--muted)' }}>Kenya Rental Management</div>
                <div style={{ fontSize: 12, color: theme === 'dark' ? 'var(--blue, #2563eb)' : 'var(--muted)', fontFamily: 'monospace', background: 'var(--surface2)', padding: '4px 10px', borderRadius: 8, border: '1px solid var(--border)' }}>{clock}</div>
                <button type="button" onClick={() => window.dispatchEvent(new Event('open-quick-search'))} title="Quick search (Ctrl+K)" style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--surface2)', padding: '4px 10px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer' }}>🔍 Search <span style={{ opacity: 0.6 }}>Ctrl K</span></button>
              </>
            )}
            {isMobile && <span style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>RentFlow</span>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Notices & Messages (moved here from the sidebar) */}
            {topbarNav.map(({ to, icon, label }) => (
              label === 'Messages' ? (
                <div key={to} ref={chatsPanelRef} style={{ position: 'relative' }}>
                  <button onClick={toggleChats} title={label} style={{
                    position: 'relative', width: 38, height: 38, borderRadius: '50%',
                    border: `1px solid ${chatsOpen ? 'var(--primary)' : 'var(--border)'}`,
                    background: chatsOpen ? 'var(--primary-light)' : 'var(--surface2)',
                    cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {icon}
                    {unreadMsg > 0 && (
                      <span style={{ position: 'absolute', top: -2, right: -2, background: 'var(--red)', color: '#fff', borderRadius: 99, fontSize: 10, fontWeight: 700, padding: '1px 5px', minWidth: 16, textAlign: 'center' }}>{unreadMsg}</span>
                    )}
                  </button>
                  {chatsOpen && (
                    <ChatsPanel
                      loading={chatsLoading}
                      conversations={chatConversations}
                      search={chatSearch}
                      setSearch={setChatSearch}
                      filter={chatFilter}
                      setFilter={setChatFilter}
                      onSelect={openConversation}
                      timeAgo={timeAgo}
                      isMobile={isMobile}
                      onClose={() => setChatsOpen(false)}
                      onOpenFull={() => { setChatsOpen(false); navigate('/messages'); }}
                    />
                  )}
                </div>
              ) : (
                <NavLink key={to} to={to} title={label}
                  style={({ isActive }) => ({
                    position: 'relative', width: 38, height: 38, borderRadius: '50%',
                    border: `1px solid ${isActive ? 'var(--primary)' : 'var(--border)'}`,
                    background: isActive ? 'var(--primary-light)' : 'var(--surface2)',
                    cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    textDecoration: 'none',
                  })}>
                  {icon}
                </NavLink>
              )
            ))}

            {/* Bell — this is the notices-specific alert (Messages already
                has its own icon + badge above), so it's driven by
                unreadNotices, not unreadMsg. */}
            <div style={{ position: 'relative' }}>
              <button onClick={() => setBellOpen(b => !b)} style={{ position: 'relative', width: 38, height: 38, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--surface2)', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                🔔
                {unreadNotices > 0 && <span style={{ position: 'absolute', top: -2, right: -2, background: 'var(--red)', color: '#fff', borderRadius: 99, fontSize: 10, fontWeight: 700, padding: '1px 5px', minWidth: 16, textAlign: 'center' }}>{unreadNotices}</span>}
              </button>
              {bellOpen && (
                <div style={{ position: 'absolute', right: 0, top: 46, width: 260, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', zIndex: 200 }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>Notifications</div>
                  <div style={{ padding: 16 }}>
                    {unreadNotices > 0
                      ? <div onClick={() => { setBellOpen(false); navigate('/notices'); }} style={{ cursor: 'pointer', padding: '10px 12px', borderRadius: 8, background: 'var(--primary-light)', color: 'var(--primary)', fontWeight: 600, fontSize: 13 }}>📢 {unreadNotices} unread notice{unreadNotices !== 1 ? 's' : ''}</div>
                      : <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>No new notifications</div>}
                  </div>
                </div>
              )}
            </div>

            {/* Avatar */}
            <div ref={dropdownRef} style={{ position: 'relative' }}>
              <button onClick={() => {
                if (!dropdown && dropdownRef.current) {
                  const r = dropdownRef.current.getBoundingClientRect();
                  setDropdownPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
                }
                setDropdown(d => !d);
              }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)', cursor: 'pointer' }}>
                <Avatar size={30} fontSize={13} />
                {!isMobile && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{displayName || user?.name}</span>}
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{dropdown ? '▲' : '▼'}</span>
              </button>
              {dropdown && createPortal(
                <div ref={dropdownPanelRef} style={{ position: 'fixed', top: dropdownPos.top, right: dropdownPos.right, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', width: 220, zIndex: 9999, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar size={36} fontSize={14} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{displayName || user?.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'capitalize' }}>{role}</div>
                    </div>
                  </div>
                  <div style={{ padding: '6px' }}>
                    <DropdownItem icon="👤" label="View Account"    onClick={openAccount} />
                    <DropdownItem icon="✏️" label="Edit Profile"    onClick={openProfile} />
                    <DropdownItem icon="🔒" label="Change Password" onClick={openPassword} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, cursor: 'pointer' }} onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}>
                      <span style={{ fontSize: 16 }}>{theme === 'light' ? '🌙' : '☀️'}</span>
                      <span style={{ fontSize: 14, color: 'var(--text)' }}>{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>
                      <div style={{ marginLeft: 'auto', width: 36, height: 20, borderRadius: 99, background: theme === 'dark' ? 'var(--primary)' : 'var(--border)', position: 'relative' }}>
                        <div style={{ position: 'absolute', top: 2, left: theme === 'dark' ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                      </div>
                    </div>
                    <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0' }} />
                    <DropdownItem icon="⏻" label="Logout" onClick={handleLogout} danger />
                  </div>
                </div>,
                document.body
              )}
            </div>
          </div>
        </header>

        {/* ── Page content ── */}
        <div style={{ flex: 1, padding: isMobile ? '16px 14px calc(84px + env(safe-area-inset-bottom, 0px))' : 28, overflow: 'auto' }}>
          <OfflineBar />
          <Outlet />
          <QuickSearch />
        </div>
      </main>

      {/* ── Bottom nav (mobile only) ── */}
      {isMobile && (
        <nav className="app-chrome" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 64, background: 'rgba(15,17,23,0.82)', WebkitBackdropFilter: 'blur(14px)', backdropFilter: 'blur(14px)', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-around', zIndex: 30, paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {bottomNav.map(({ to, icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'}
              style={({ isActive }) => ({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 12px', borderRadius: 10, color: isActive ? '#818cf8' : 'rgba(255,255,255,0.45)', textDecoration: 'none', minWidth: 56, position: 'relative' })}>
              <span style={{ fontSize: 22 }}>{icon}</span>
              <span style={{ fontSize: 10, fontWeight: 600 }}>{label}</span>
              {label === 'Messages' && unreadMsg > 0 && (
                <span style={{ position: 'absolute', top: 4, right: 8, background: '#ef4444', color: '#fff', borderRadius: 99, fontSize: 9, fontWeight: 700, padding: '1px 4px' }}>{unreadMsg}</span>
              )}
              {label === 'Users' && pendingLandlords > 0 && (
                <span style={{ position: 'absolute', top: 4, right: 8, background: '#ef4444', color: '#fff', borderRadius: 99, fontSize: 9, fontWeight: 700, padding: '1px 4px' }}>{pendingLandlords}</span>
              )}
              {label === 'Properties' && pendingUnits > 0 && (
                <span style={{ position: 'absolute', top: 4, right: 8, background: '#ef4444', color: '#fff', borderRadius: 99, fontSize: 9, fontWeight: 700, padding: '1px 4px' }}>{pendingUnits}</span>
              )}
            </NavLink>
          ))}
          {/* More button opens sidebar */}
          <button onClick={() => setSidebarOpen(true)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 12px', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.45)', cursor: 'pointer', minWidth: 56 }}>
            <span style={{ fontSize: 22 }}>⋯</span>
            <span style={{ fontSize: 10, fontWeight: 600 }}>More</span>
          </button>
        </nav>
      )}

      {/* ── Modals ── */}
      {modal === 'account' && (
        <ModalWrapper title="My Account" onClose={() => setModal(null)} isMobile={isMobile}>
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16, background: 'var(--surface2)', borderRadius: 12 }}>
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <Avatar size={60} fontSize={24} />
                <button onClick={() => fileInputRef.current?.click()} style={{ position: 'absolute', bottom: 0, right: 0, width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoChange} style={{ display: 'none' }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{displayName || user?.name}</div>
                <span style={{ background: 'var(--primary-light)', color: 'var(--primary)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, textTransform: 'capitalize' }}>{role}</span>
              </div>
            </div>
            {[
              { label: 'Full Name', value: accountDetails?.name  || user?.name || '—' },
              { label: 'Role',      value: accountDetails?.role  || role || '—' },
              { label: 'Email',     value: accountDetails?.email || '—' },
              { label: 'Phone',     value: accountDetails?.phone || '—' },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--muted)', fontSize: 14 }}>{label}</span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{value}</span>
              </div>
            ))}
          </div>
        </ModalWrapper>
      )}

      {modal === 'settings' && (
        <ModalWrapper title="Settings" onClose={() => setModal(null)} isMobile={isMobile}>
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 22 }}>
            {msg   && <div style={{ background: 'var(--green-light)', color: 'var(--green)', padding: '10px 14px', borderRadius: 8, fontSize: 13 }}>{msg}</div>}
            {error && <div style={{ background: 'var(--red-light)',   color: 'var(--red)',   padding: '10px 14px', borderRadius: 8, fontSize: 13 }}>{error}</div>}

            {/* Profile */}
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 12 }}>Profile</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Field label="Full Name" value={profileForm.name}  onChange={v => setProfileForm(f => ({ ...f, name: v }))}  placeholder="Your name" />
                <Field label="Email"     value={profileForm.email} onChange={v => setProfileForm(f => ({ ...f, email: v }))} placeholder="Your email" type="email" />
                <Field label="Phone"     value={profileForm.phone} onChange={v => setProfileForm(f => ({ ...f, phone: v }))} placeholder="Your phone" />
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={handleSaveProfile} disabled={saving} style={saveBtn}>{saving ? 'Saving...' : 'Save Profile'}</button>
                </div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border)' }} />

            {/* Password */}
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 12 }}>Change Password</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Field label="Current Password" value={passwordForm.current} onChange={v => setPasswordForm(f => ({ ...f, current: v }))} placeholder="••••••••" type="password" />
                <Field label="New Password"     value={passwordForm.newPass} onChange={v => setPasswordForm(f => ({ ...f, newPass: v }))} placeholder="••••••••" type="password" />
                <Field label="Confirm Password" value={passwordForm.confirm} onChange={v => setPasswordForm(f => ({ ...f, confirm: v }))} placeholder="••••••••" type="password" />
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={handleChangePassword} disabled={saving} style={saveBtn}>{saving ? 'Saving...' : 'Update Password'}</button>
                </div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border)' }} />

            {/* Appearance */}
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 12 }}>Appearance</h3>
              <div onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, background: 'var(--surface2)', cursor: 'pointer' }}>
                <span style={{ fontSize: 16 }}>{theme === 'light' ? '🌙' : '☀️'}</span>
                <span style={{ fontSize: 14, color: 'var(--text)' }}>{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>
                <div style={{ marginLeft: 'auto', width: 36, height: 20, borderRadius: 99, background: theme === 'dark' ? 'var(--primary)' : 'var(--border)', position: 'relative' }}>
                  <div style={{ position: 'absolute', top: 2, left: theme === 'dark' ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                </div>
              </div>
            </div>
          </div>
        </ModalWrapper>
      )}

      {modal === 'profile' && (
        <ModalWrapper title="Edit Profile" onClose={() => setModal(null)} isMobile={isMobile}>
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {msg   && <div style={{ background: 'var(--green-light)', color: 'var(--green)', padding: '10px 14px', borderRadius: 8, fontSize: 13 }}>{msg}</div>}
            {error && <div style={{ background: 'var(--red-light)',   color: 'var(--red)',   padding: '10px 14px', borderRadius: 8, fontSize: 13 }}>{error}</div>}
            <Field label="Full Name" value={profileForm.name}  onChange={v => setProfileForm(f => ({ ...f, name: v }))}  placeholder="Your name" />
            <Field label="Email"     value={profileForm.email} onChange={v => setProfileForm(f => ({ ...f, email: v }))} placeholder="Your email" type="email" />
            <Field label="Phone"     value={profileForm.phone} onChange={v => setProfileForm(f => ({ ...f, phone: v }))} placeholder="Your phone" />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
              <button onClick={() => setModal(null)} style={cancelBtn}>Cancel</button>
              <button onClick={handleSaveProfile} disabled={saving} style={saveBtn}>{saving ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </div>
        </ModalWrapper>
      )}

      {modal === 'password' && (
        <ModalWrapper title="Change Password" onClose={() => setModal(null)} isMobile={isMobile}>
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {msg   && <div style={{ background: 'var(--green-light)', color: 'var(--green)', padding: '10px 14px', borderRadius: 8, fontSize: 13 }}>{msg}</div>}
            {error && <div style={{ background: 'var(--red-light)',   color: 'var(--red)',   padding: '10px 14px', borderRadius: 8, fontSize: 13 }}>{error}</div>}
            <Field label="Current Password" value={passwordForm.current} onChange={v => setPasswordForm(f => ({ ...f, current: v }))} placeholder="••••••••" type="password" />
            <Field label="New Password"     value={passwordForm.newPass} onChange={v => setPasswordForm(f => ({ ...f, newPass: v }))} placeholder="••••••••" type="password" />
            <Field label="Confirm Password" value={passwordForm.confirm} onChange={v => setPasswordForm(f => ({ ...f, confirm: v }))} placeholder="••••••••" type="password" />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
              <button onClick={() => setModal(null)} style={cancelBtn}>Cancel</button>
              <button onClick={handleChangePassword} disabled={saving} style={saveBtn}>{saving ? 'Saving...' : 'Change Password'}</button>
            </div>
          </div>
        </ModalWrapper>
      )}

      {/* ── Floating approval toasts (bottom-right) ──────────────────────────
          Replaces the old full-width Dashboard banners. Global (lives in
          Layout, not Dashboard), so it follows you to whichever page you're
          on. Dismissal is per-session and keyed to the count at dismiss
          time — closing "3 pending" won't hide a later "4 pending". */}
      <div style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 200,
        display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 340,
      }}>
        {pendingLandlords > 0 && pendingLandlords !== dismissedLandlordsAt && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px',
            background: 'var(--surface)', border: '1px solid var(--amber, #d97706)',
            borderLeft: '4px solid var(--amber, #d97706)', borderRadius: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            animation: 'toast-in 0.25s ease',
          }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>⏳</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
                {pendingLandlords} landlord{pendingLandlords > 1 ? 's' : ''} waiting for approval
              </div>
              <button onClick={() => navigate('/users?filter=pending')} style={{
                padding: '5px 12px', borderRadius: 7, border: 'none',
                background: 'var(--amber, #d97706)', color: '#fff',
                fontWeight: 700, fontSize: 12, cursor: 'pointer',
              }}>Review</button>
            </div>
            <button onClick={dismissLandlordsToast} aria-label="Dismiss" style={{
              border: 'none', background: 'transparent', color: 'var(--muted)',
              fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: 2,
            }}>×</button>
          </div>
        )}
        {pendingUnits > 0 && pendingUnits !== dismissedUnitsAt && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px',
            background: 'var(--surface)', border: '1px solid var(--amber, #d97706)',
            borderLeft: '4px solid var(--amber, #d97706)', borderRadius: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            animation: 'toast-in 0.25s ease',
          }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>🏠</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
                {pendingUnits} unit{pendingUnits > 1 ? 's' : ''} waiting for approval
              </div>
              <button onClick={() => navigate('/properties')} style={{
                padding: '5px 12px', borderRadius: 7, border: 'none',
                background: 'var(--amber, #d97706)', color: '#fff',
                fontWeight: 700, fontSize: 12, cursor: 'pointer',
              }}>Review</button>
            </div>
            <button onClick={dismissUnitsToast} aria-label="Dismiss" style={{
              border: 'none', background: 'transparent', color: 'var(--muted)',
              fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: 2,
            }}>×</button>
          </div>
        )}
      </div>
      <style>{`@keyframes toast-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ChatsPanel({ loading, conversations, search, setSearch, filter, setFilter, onSelect, timeAgo, isMobile, onClose, onOpenFull }) {
  const filtered = conversations
    .filter(c => (c.other_name || 'Staff').toLowerCase().includes(search.toLowerCase()))
    .filter(c => filter === 'all' || parseInt(c.unread_count || 0) > 0);

  return (
    <div style={isMobile ? {
      position: 'fixed', inset: 0,
      background: '#242526', color: '#e4e6eb',
      zIndex: 200, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    } : {
      position: 'absolute', right: 0, top: 'calc(100% + 10px)',
      width: 340, maxHeight: 480,
      background: '#242526', color: '#e4e6eb',
      borderRadius: 14, boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
      zIndex: 60, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 20 }}>Chats</span>
        {isMobile && (
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: '#3a3b3c', color: '#e4e6eb', fontSize: 16, cursor: 'pointer' }}>×</button>
        )}
      </div>

      <div style={{ padding: '0 14px 10px' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search Messages"
          style={{
            width: '100%', padding: '8px 12px', borderRadius: 20, border: 'none',
            background: '#3a3b3c', color: '#e4e6eb', fontSize: 13, outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '0 14px 10px' }}>
        {[['all', 'All'], ['unread', 'Unread']].map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key)} style={{
            padding: '5px 14px', borderRadius: 16, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600,
            background: filter === key ? '#3a5a99' : '#3a3b3c',
            color: filter === key ? '#8ab4f8' : '#b0b3b8',
          }}>{label}</button>
        ))}
      </div>

      <div style={{ overflowY: 'auto', flex: 1, borderTop: '1px solid #3a3b3c' }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#8a8d91', fontSize: 13 }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#8a8d91', fontSize: 13 }}>
            {search ? 'No matching conversations.' : 'No conversations yet.'}
            {!search && (
              <div style={{ marginTop: 12 }}>
                <button onClick={onOpenFull} style={{ padding: '8px 16px', borderRadius: 20, border: 'none', background: '#3a5a99', color: '#8ab4f8', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  + New Message
                </button>
              </div>
            )}
          </div>
        ) : filtered.map(c => {
          const unread = parseInt(c.unread_count || 0);
          const name = c.other_name || 'Staff';
          return (
            <div key={c.id} onClick={() => onSelect(c)} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 14px', cursor: 'pointer',
            }}
              onMouseEnter={e => e.currentTarget.style.background = '#3a3b3c'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{
                width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, #4f46e5, #818cf8)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontWeight: 700, fontSize: 16,
              }}>
                {name[0]?.toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: unread > 0 ? 700 : 500, fontSize: 14, color: '#e4e6eb' }}>{name}</div>
                <div style={{
                  fontSize: 12.5, color: unread > 0 ? '#e4e6eb' : '#8a8d91', fontWeight: unread > 0 ? 600 : 400,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {c.last_message || 'No messages yet'} · {timeAgo(c.last_message_at || c.created_at)}
                </div>
              </div>
              {unread > 0 && (
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#1877f2', flexShrink: 0 }} />
              )}
            </div>
          );
        })}
      </div>

      <div onClick={onOpenFull} style={{
        padding: '10px 14px', textAlign: 'center', fontSize: 12.5, fontWeight: 700,
        color: '#8ab4f8', cursor: 'pointer', borderTop: '1px solid #3a3b3c',
      }}>
        Open Messages →
      </div>
    </div>
  );
}

function NavItem({ to, icon, label, collapsed, unread = 0, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <NavLink to={to} end={to === '/'} onClick={onClick} title={collapsed ? label : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '9px 12px', borderRadius: 10,
        color: isActive ? '#fff' : hover ? '#fff' : 'rgba(255,255,255,0.5)',
        background: isActive ? 'rgba(255,255,255,0.15)' : hover ? 'rgba(255,255,255,0.08)' : 'transparent',
        fontWeight: isActive ? 600 : 400, fontSize: 14,
        transition: 'all 0.15s', whiteSpace: 'nowrap', overflow: 'hidden',
        borderLeft: isActive ? '3px solid #818cf8' : '3px solid transparent',
        paddingLeft: isActive ? '9px' : '12px',
        textDecoration: 'none', position: 'relative',
      })}>
      <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
      {!collapsed && <span style={{ flex: 1 }}>{label}</span>}
      {!collapsed && unread > 0 && (
        <span style={{ background: '#ef4444', color: '#fff', borderRadius: 99, fontSize: 10, fontWeight: 700, padding: '1px 6px' }}>{unread}</span>
      )}
    </NavLink>
  );
}

function NavAction({ icon, label, collapsed, active, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick} title={collapsed ? label : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '9px 12px', borderRadius: 10,
        border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
        color: active ? '#fff' : hover ? '#fff' : 'rgba(255,255,255,0.5)',
        background: active ? 'rgba(255,255,255,0.15)' : hover ? 'rgba(255,255,255,0.08)' : 'transparent',
        fontWeight: active ? 600 : 400, fontSize: 14,
        transition: 'all 0.15s', whiteSpace: 'nowrap', overflow: 'hidden',
        borderLeft: active ? '3px solid #818cf8' : '3px solid transparent',
        paddingLeft: active ? '9px' : '12px',
      }}>
      <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
      {!collapsed && <span style={{ flex: 1 }}>{label}</span>}
    </button>
  );
}

function DropdownItem({ icon, label, onClick, danger }) {
  const [hover, setHover] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, cursor: 'pointer', background: hover ? 'var(--surface2)' : 'transparent', color: danger ? 'var(--red)' : 'var(--text)', transition: 'background 0.1s' }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ fontSize: 14 }}>{label}</span>
    </div>
  );
}

function ModalWrapper({ title, onClose, children, isMobile }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', zIndex: 200, padding: isMobile ? 0 : 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: isMobile ? '20px 20px 0 0' : 16, width: '100%', maxWidth: isMobile ? '100%' : 440, boxShadow: 'var(--shadow-lg)', maxHeight: isMobile ? '90vh' : '85vh', overflow: 'auto' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 17 }}>{title}</h2>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'var(--surface2)', cursor: 'pointer', fontSize: 16, color: 'var(--muted)' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' };
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 14, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' };
const cancelBtn  = { padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: 'var(--text)' };
const saveBtn    = { padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' };

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  const [show, setShow] = useState(false);
  const isPassword = type === 'password';
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          type={isPassword ? (show ? 'text' : 'password') : type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={isPassword ? { ...inputStyle, paddingRight: 40 } : inputStyle}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow(s => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            style={{
              position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
              width: 30, height: 30, borderRadius: 6, border: 'none', background: 'transparent',
              cursor: 'pointer', fontSize: 15, color: 'var(--muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
            {show ? '🙈' : '👁️'}
          </button>
        )}
      </div>
    </div>
  );
}

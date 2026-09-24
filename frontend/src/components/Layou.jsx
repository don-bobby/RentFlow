import { Outlet, NavLink } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import API from '../services/api';

function getUser() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try { return JSON.parse(atob(token.split('.')[1])); }
  catch { return null; }
}

export default function Layout() {
  const [collapsed,    setCollapsed]    = useState(false);
  const [theme,        setTheme]        = useState(localStorage.getItem('theme') || 'light');
  const [dropdown,     setDropdown]     = useState(false);
  const [modal,        setModal]        = useState(null); // 'profile' | 'password' | 'account'
  const [profileForm,  setProfileForm]  = useState({ name: '', phone: '', email: '' });
  const [passwordForm, setPasswordForm] = useState({ current: '', newPass: '', confirm: '' });
  const [saving,       setSaving]       = useState(false);
  const [msg,          setMsg]          = useState('');
  const [error,        setError]        = useState('');
  const [accountDetails, setAccountDetails] = useState(null);
  const fileInputRef = useRef(null);
  const dropdownRef = useRef(null);
  const user = getUser();
  const [displayName, setDisplayName] = useState(null); // overrides user.name after profile edit
  const role = user?.role;
  const photoKey = `userPhoto_${user?.id}`;
  const [photo,        setPhoto]        = useState(localStorage.getItem(`userPhoto_${user?.id}`) || null);
  const [clock,        setClock]        = useState('');
  const [unreadMsg,    setUnreadMsg]    = useState(0);
  const [bellOpen,     setBellOpen]     = useState(false);

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
    async function fetchUnread() {
      try {
        const res = await API.get('/notices/unread-count');
        setUnreadMsg(res.data.count || 0);
      } catch {}
    }
    fetchUnread();
    const id = setInterval(fetchUnread, 30000);
    return () => clearInterval(id);
  }, []);

  // Apply theme
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

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function openProfile() {
    setMsg(''); setError('');
    setModal('profile'); setDropdown(false);
    try {
      const res = await API.get('/auth/users');
      const users = res.data.data || [];
      const me = users.find(u => u.id === user?.id);
      if (me) setProfileForm({ name: me.name || '', email: me.email || '', phone: me.phone || '' });
    } catch (e) {
      setProfileForm({ name: user?.name || '', email: '', phone: '' });
    }
  }

  function handlePhotoChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX = 150;
        const ratio = Math.min(MAX / img.width, MAX / img.height);
        canvas.width  = img.width  * ratio;
        canvas.height = img.height * ratio;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const resized = canvas.toDataURL('image/jpeg', 0.7);
        setPhoto(resized);
        try {
          localStorage.setItem(photoKey, resized);
        } catch {
          console.warn('Storage full — photo saved in memory only');
        }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function openPassword() {
    setPasswordForm({ current: '', newPass: '', confirm: '' });
    setMsg(''); setError('');
    setModal('password'); setDropdown(false);
  }

  async function openAccount() {
    setMsg(''); setError('');
    setModal('account'); setDropdown(false);
    try {
      const res = await API.get(`/auth/users`);
      const users = res.data.data || [];
      const me = users.find(u => u.id === user?.id);
      if (me) setAccountDetails(me);
    } catch (e) { console.error(e); }
  }

  async function handleSaveProfile() {
    setSaving(true); setMsg(''); setError('');
    try {
      await API.patch(`/auth/users/${user.id}/profile`, profileForm);
      setDisplayName(profileForm.name); // update topbar immediately
      setMsg('Profile updated successfully!');
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to update profile');
    } finally { setSaving(false); }
  }

  async function handleChangePassword() {
    setMsg(''); setError('');
    if (passwordForm.newPass !== passwordForm.confirm) {
      return setError('New passwords do not match.');
    }
    if (passwordForm.newPass.length < 6) {
      return setError('Password must be at least 6 characters.');
    }
    setSaving(true);
    try {
      await API.patch(`/auth/users/${user.id}/password`, {
        current_password: passwordForm.current,
        new_password:     passwordForm.newPass,
      });
      setMsg('Password changed successfully!');
      setPasswordForm({ current: '', newPass: '', confirm: '' });
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to change password');
    } finally { setSaving(false); }
  }

  function handleLogout() {
    localStorage.removeItem('token');
    window.location.href = '/login';
  }

  const nav = [
    { to: '/',            icon: '⊞', label: 'Dashboard',   roles: ['admin', 'landlord', 'caretaker'] },
    { to: '/properties',  icon: '🏢', label: 'Properties',  roles: ['admin', 'landlord', 'caretaker'] },
    { to: '/tenants',     icon: '👥', label: 'Tenants',     roles: ['admin', 'landlord', 'caretaker'] },
    { to: '/payments',    icon: '💳', label: 'Payments',    roles: ['admin', 'landlord'] },
    { to: '/maintenance', icon: '🔧', label: 'Maintenance', roles: ['admin', 'landlord', 'caretaker'] },
    { to: '/reports',     icon: '📊', label: 'Reports',     roles: ['admin', 'landlord'] },
    { to: '/users',       icon: '👤', label: 'Users',       roles: ['admin', 'landlord'] },
    { to: '/manage/listings', icon: '🏷️', label: 'Listings',  roles: ['admin', 'landlord'] },
    { to: '/notices',         icon: '📢', label: 'Notices',   roles: ['admin', 'landlord'] },
    { to: '/messages',        icon: '💬', label: 'Messages',  roles: ['admin', 'landlord', 'caretaker'] },
  ].filter(item => item.roles.includes(role));

  const roleColor = { admin: '#818cf8', landlord: '#34d399', caretaker: '#fbbf24' };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>

      {/* ── Sidebar ── */}
      <aside style={{ width: collapsed ? 68 : 230, minHeight: '100vh', background: '#0f1117', display: 'flex', flexDirection: 'column', padding: '20px 0', transition: 'width 0.2s ease', flexShrink: 0, position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div style={{ padding: '0 16px 24px', display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: 'linear-gradient(135deg, #4f46e5, #818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🏠</div>
          {!collapsed && <span style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18, color: '#fff', whiteSpace: 'nowrap' }}>RentFlow</span>}
        </div>
        {!collapsed && (
          <div style={{ padding: '0 16px 16px' }}>
            <span style={{ background: 'rgba(255,255,255,0.08)', color: roleColor[role] || 'rgba(255,255,255,0.5)', padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{role}</span>
          </div>
        )}
        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px' }}>
          {nav.map(({ to, icon, label }) => (
            <NavItem key={to} to={to} icon={icon} label={label} collapsed={collapsed} />
          ))}
        </nav>
        <div style={{ padding: '0 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button onClick={() => setCollapsed(c => !c)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 14, width: '100%', whiteSpace: 'nowrap', overflow: 'hidden' }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>{collapsed ? '→' : '←'}</span>
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Topbar */}
        <header style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 28px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 15, color: 'var(--muted)' }}>Kenya Rental Management</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace', background: 'var(--surface2)', padding: '4px 10px', borderRadius: 8, border: '1px solid var(--border)' }}>{clock}</div>
          </div>

          {/* Avatar + Dropdown */}
          <div ref={dropdownRef} style={{ position: 'relative' }}>
            <button onClick={() => setDropdown(d => !d)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)', cursor: 'pointer' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'linear-gradient(135deg, #4f46e5, #818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13 }}>
                {photo ? <img src={photo} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (user?.name?.[0]?.toUpperCase() || 'U')}
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{displayName || user?.name}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{dropdown ? '▲' : '▼'}</span>
            </button>

            {/* Dropdown Menu */}
            {dropdown && (
              <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', width: 220, zIndex: 50, overflow: 'hidden' }}>
                {/* User info header */}
                <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', overflow: 'hidden', background: 'linear-gradient(135deg, #4f46e5, #818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                    {photo ? <img src={photo} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : user?.name?.[0]?.toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{displayName || user?.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'capitalize' }}>{role}</div>
                  </div>
                </div>

                {/* Menu items */}
                <div style={{ padding: '6px' }}>
                  <DropdownItem icon="👤" label="View Account" onClick={openAccount} />
                  <DropdownItem icon="✏️" label="Edit Profile" onClick={openProfile} />
                  <DropdownItem icon="🔒" label="Change Password" onClick={openPassword} />

                  {/* Theme Toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, cursor: 'pointer' }}
                    onClick={() => { setTheme(t => t === 'light' ? 'dark' : 'light'); }}>
                    <span style={{ fontSize: 16 }}>{theme === 'light' ? '🌙' : '☀️'}</span>
                    <span style={{ fontSize: 14, color: 'var(--text)' }}>{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>
                    <div style={{ marginLeft: 'auto', width: 36, height: 20, borderRadius: 99, background: theme === 'dark' ? 'var(--primary)' : 'var(--border)', position: 'relative', transition: 'background 0.2s' }}>
                      <div style={{ position: 'absolute', top: 2, left: theme === 'dark' ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0' }} />
                  <DropdownItem icon="⏻" label="Logout" onClick={handleLogout} danger />
                </div>
              </div>
            )}
          </div>
        </header>

        <div style={{ flex: 1, padding: 28, overflow: 'auto' }}>
          <Outlet />
        </div>
      </main>

      {/* ── Account Details Modal ── */}
      {modal === 'account' && (
        <ModalWrapper title="My Account" onClose={() => setModal(null)}>
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 20, background: 'var(--surface2)', borderRadius: 12 }}>
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <div style={{ width: 60, height: 60, borderRadius: '50%', overflow: 'hidden', background: 'linear-gradient(135deg, #4f46e5, #818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 24 }}>
                  {photo ? <img src={photo} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : user?.name?.[0]?.toUpperCase()}
                </div>
                <button onClick={() => fileInputRef.current?.click()} style={{ position: 'absolute', bottom: 0, right: 0, width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
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

      {/* ── Edit Profile Modal ── */}
      {modal === 'profile' && (
        <ModalWrapper title="Edit Profile" onClose={() => setModal(null)}>
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

      {/* ── Change Password Modal ── */}
      {modal === 'password' && (
        <ModalWrapper title="Change Password" onClose={() => setModal(null)}>
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
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function NavItem({ to, icon, label, collapsed }) {
  const [hover, setHover] = useState(false);
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 12px', borderRadius: 10,
        color: isActive ? '#fff' : hover ? '#fff' : 'rgba(255,255,255,0.5)',
        background: isActive
          ? 'rgba(255,255,255,0.15)'
          : hover
          ? 'rgba(255,255,255,0.08)'
          : 'transparent',
        fontWeight: isActive ? 600 : hover ? 500 : 400,
        fontSize: 14,
        transition: 'all 0.15s',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        transform: hover && !isActive ? 'translateX(3px)' : 'translateX(0)',
        borderLeft: isActive ? '3px solid #818cf8' : '3px solid transparent',
        paddingLeft: isActive ? '9px' : '12px',
      })}
    >
      <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
      {!collapsed && <span>{label}</span>}
    </NavLink>
  );
}
function DropdownItem({ icon, label, onClick, danger }) {
  const [hover, setHover] = useState(false);
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, cursor: 'pointer', background: hover ? 'var(--surface2)' : 'transparent', color: danger ? 'var(--red)' : 'var(--text)', transition: 'background 0.1s' }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ fontSize: 14 }}>{label}</span>
    </div>
  );
}

function ModalWrapper({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, width: '100%', maxWidth: 440, boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 17 }}>{title}</h2>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'var(--surface2)', cursor: 'pointer', fontSize: 16, color: 'var(--muted)' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' };
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 14, color: 'var(--text)', outline: 'none' };
const cancelBtn  = { padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: 'var(--text)' };
const saveBtn    = { padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' };

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { login } from '../services/api';
import API from '../services/api';

// ── Design tokens (match the RentFlow landing page) ──────────────────────────
const C = {
  ink:      '#0f1f17',
  forest:   '#123524',
  green:    '#1b6b45',
  mint:     '#8fd1ad',
  sage:     '#f1f4f1',
  field:    '#f7faf7',
  border:   '#cdd8d0',
  label:    '#2b3a31',
  muted:    '#55645b',
  errBg:    '#fdecec',
  errBd:    '#f5b5b5',
  errText:  '#9b1c1c',
};
const DISPLAY = "'Bricolage Grotesque', sans-serif";
const BODY    = "'DM Sans', sans-serif";

// Same skyline photo the landing page hero uses. Point this at that file/URL
// (search your landing page component for "Vacant homes from").
const HERO_IMAGE = '/lgn.jpg';

// Dark-green overlay, heaviest behind the text so it stays readable
const HERO_OVERLAY = 'linear-gradient(90deg, rgba(18,53,36,0.94) 0%, rgba(18,53,36,0.80) 45%, rgba(18,53,36,0.62) 100%)';

// Set this to wherever your tenant sign-in lives
const TENANT_LOGIN_PATH = '/tenant-login';

const inputStyle = {
  width: '100%', boxSizing: 'border-box', height: 48, padding: '0 14px',
  borderRadius: 10, border: `1px solid ${C.border}`, background: C.field,
  fontFamily: BODY, fontSize: 15, color: C.ink,
};
const labelStyle = { fontSize: 13, fontWeight: 600, color: C.label };
const primaryBtn = (disabled) => ({
  width: '100%', height: 50, border: 'none', borderRadius: 10,
  background: C.forest, opacity: disabled ? 0.65 : 1,
  color: '#fff', fontFamily: BODY, fontWeight: 700, fontSize: 15,
  cursor: disabled ? 'default' : 'pointer',
});
const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: C.green, fontFamily: BODY, fontSize: 13, fontWeight: 600,
};

// ── Small inline icons ───────────────────────────────────────────────────────
const Svg = ({ children, size = 20, stroke = C.muted }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke}
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const CheckIcon = () => <Svg stroke={C.mint}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>;
const EyeIcon   = () => <Svg><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Svg>;
const EyeOffIcon = () => <Svg><path d="M3 3l18 18" /><path d="M10.6 5.1A10.6 10.6 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.2 4M6.5 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.4 4.5-1" /><path d="M9.9 9.9a3 3 0 004.2 4.2" /></Svg>;
const UserIcon  = () => <Svg stroke={C.green}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></Svg>;
const MailIcon  = () => <Svg stroke={C.green}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></Svg>;
const PhoneIcon = () => <Svg stroke={C.green}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" /></Svg>;

export default function Login() {
  const [form,    setForm]    = useState({ email: '', password: '' });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw,  setShowPw]  = useState(false);
  const [view,    setView]    = useState('login'); // 'login' | 'forgot' | 'sent' | 'contact'
  const [fpEmail, setFpEmail] = useState('');
  const [contact, setContact] = useState(null);

  // Load brand fonts if the app doesn't already
  useEffect(() => {
    const id = 'rentflow-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=DM+Sans:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await login(form);
      localStorage.setItem('token', res.data.token);
      window.location.href = '/';
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    if (!fpEmail) { setError('Enter your email address.'); return; }
    setLoading(true); setError('');
    try {
      const res = await API.post('/auth/forgot-password', { email: fpEmail });
      if (res.data.role && res.data.role !== 'admin') {
        const cr = await API.get('/auth/admin-contact');
        setContact(cr.data.data);
        setView('contact');
      } else {
        setView('sent');
      }
    } catch (e) {
      setError(e.response?.data?.error || 'Something went wrong. Please try again.');
    } finally { setLoading(false); }
  }

  function backToLogin(clearEmail) {
    setView('login'); setError('');
    if (clearEmail) setFpEmail('');
  }

  const features = [
    'Rent payments matched to tenants automatically',
    'Vacant units listed with real photos and rent',
    'Tenant balances always up to date',
  ];

  const errorBox = error && (
    <div role="alert" style={{
      background: C.errBg, border: `1px solid ${C.errBd}`, borderRadius: 10,
      padding: '10px 14px', marginBottom: 20, color: C.errText, fontSize: 13,
    }}>{error}</div>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: C.sage, fontFamily: BODY, color: C.forest }}>
      <style>{`
        .rf-login input:focus, .rf-login button:focus-visible, .rf-login a:focus-visible {
          outline: 2px solid ${C.green}; outline-offset: 2px;
        }
        .rf-login a:hover { opacity: .85; }
      `}</style>

      {/* ── Top nav ── */}
      <header style={{
        height: 58, boxSizing: 'border-box', padding: '0 clamp(16px, 4vw, 40px)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: '#fff', borderBottom: '1px solid #e3e9e4',
      }}>
        <Link to="/" style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink, textDecoration: 'none' }}>RentFlow</Link>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link to={TENANT_LOGIN_PATH} style={{ fontSize: 13, color: C.label, textDecoration: 'none', minHeight: 44, display: 'flex', alignItems: 'center' }}>Tenant login</Link>
          <span aria-current="page" style={{
            fontSize: 13, fontWeight: 700, color: '#fff', background: C.forest,
            padding: '0 18px', minHeight: 44, borderRadius: 10, display: 'flex', alignItems: 'center',
          }}>Staff login</span>
        </nav>
      </header>

      {/* ── Hero + card ── */}
      <main className="rf-login" style={{
        flex: 1, backgroundColor: C.forest,
        backgroundImage: `${HERO_OVERLAY}, url(${HERO_IMAGE})`,
        backgroundSize: 'cover', backgroundPosition: 'center',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '56px clamp(16px, 4vw, 40px)', boxSizing: 'border-box',
      }}>
        <div style={{ width: '100%', maxWidth: 1120, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 56 }}>

          <section style={{ flex: '1 1 380px', maxWidth: 520, color: '#fff' }}>
            <h1 style={{ margin: '0 0 16px', fontFamily: DISPLAY, fontWeight: 700, fontSize: 'clamp(34px, 5vw, 52px)', lineHeight: 1.06, letterSpacing: -0.5 }}>
              Every unit, tenant and payment in one place
            </h1>
            <p style={{ margin: '0 0 36px', fontSize: 17, lineHeight: 1.5, color: '#d6e4da' }}>
              Sign in to manage rent collection, vacancies and balances for your properties.
            </p>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {features.map(f => (
                <li key={f} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 15 }}>
                  <CheckIcon />{f}
                </li>
              ))}
            </ul>
          </section>

          <section style={{
            flex: '0 1 440px', width: '100%', maxWidth: 440, boxSizing: 'border-box',
            background: '#fff', borderRadius: 20, padding: '40px 36px',
            boxShadow: '0 24px 60px rgba(0,0,0,0.28)',
          }}>
            <h2 style={{ margin: '0 0 6px', fontFamily: DISPLAY, fontWeight: 700, fontSize: 28, color: C.ink }}>Staff login</h2>
            <p style={{ margin: '0 0 28px', fontSize: 14, color: C.muted }}>Sign in to your dashboard</p>

            {error && view === 'login' && errorBox}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label htmlFor="email" style={labelStyle}>Email</label>
                <input
                  id="email" type="email" required autoComplete="email" value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="admin@rentflow.co.ke" style={inputStyle}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label htmlFor="password" style={labelStyle}>Password</label>
                  <button type="button" style={linkBtn}
                    onClick={() => { setView('forgot'); setError(''); setFpEmail(form.email); }}>
                    Forgot password?
                  </button>
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    id="password" type={showPw ? 'text' : 'password'} required autoComplete="current-password"
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="Enter your password" style={{ ...inputStyle, paddingRight: 48 }}
                  />
                  <button type="button" onClick={() => setShowPw(s => !s)}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    style={{ position: 'absolute', right: 2, top: 2, width: 44, height: 44, border: 'none', background: 'transparent', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    {showPw ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </div>

              <button type="submit" disabled={loading} style={{ ...primaryBtn(loading), marginTop: 6 }}>
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </form>

            <p style={{ margin: '24px 0 0', textAlign: 'center', fontSize: 14, color: C.muted }}>
              Own a property?{' '}
              <Link to="/register" style={{ color: C.green, fontWeight: 700, textDecoration: 'none' }}>Sign up as a landlord</Link>
            </p>
          </section>
        </div>

        {/* ── Forgot password overlay views ── */}
        {view !== 'login' && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,20,14,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
            <div role="dialog" aria-modal="true" style={{ background: '#fff', borderRadius: 20, padding: '40px 36px', width: '100%', maxWidth: 440, boxSizing: 'border-box', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}>

              {/* Forgot — enter email */}
              {view === 'forgot' && (
                <form onSubmit={handleForgotPassword}>
                  <h2 style={{ margin: '0 0 8px', fontFamily: DISPLAY, color: C.ink, fontWeight: 700, fontSize: 24 }}>Reset password</h2>
                  <p style={{ margin: '0 0 24px', color: C.muted, fontSize: 14, lineHeight: 1.6 }}>
                    Enter your email. Admins get a reset link. Other staff will see admin contact details.
                  </p>
                  {errorBox}
                  <label htmlFor="fp-email" style={{ ...labelStyle, display: 'block', marginBottom: 8 }}>Email</label>
                  <input id="fp-email" type="email" value={fpEmail} onChange={e => setFpEmail(e.target.value)}
                    placeholder="you@example.com" autoFocus style={{ ...inputStyle, marginBottom: 20 }} />
                  <button type="submit" disabled={loading} style={{ ...primaryBtn(loading), marginBottom: 14 }}>
                    {loading ? 'Sending...' : 'Continue'}
                  </button>
                  <div style={{ textAlign: 'center' }}>
                    <button type="button" onClick={() => backToLogin(false)} style={linkBtn}>← Back to sign in</button>
                  </div>
                </form>
              )}

              {/* Sent — confirmation */}
              {view === 'sent' && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ width: 56, height: 56, borderRadius: 16, background: C.sage, margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <MailIcon />
                  </div>
                  <h2 style={{ margin: '0 0 10px', fontFamily: DISPLAY, color: C.ink, fontWeight: 700, fontSize: 24 }}>Check your email</h2>
                  <p style={{ margin: '0 0 8px', color: C.muted, fontSize: 14, lineHeight: 1.6 }}>
                    We sent a reset link to <span style={{ color: C.green, fontWeight: 700 }}>{fpEmail}</span>.
                  </p>
                  <p style={{ margin: '0 0 28px', color: C.muted, fontSize: 13 }}>The link expires in 1 hour. Check your spam folder if you don't see it.</p>
                  <button onClick={() => backToLogin(true)} style={primaryBtn(false)}>Back to sign in</button>
                </div>
              )}

              {/* Contact — non-admin staff */}
              {view === 'contact' && (
                <div>
                  <h2 style={{ margin: '0 0 8px', fontFamily: DISPLAY, color: C.ink, fontWeight: 700, fontSize: 24 }}>Contact admin</h2>
                  <p style={{ margin: '0 0 24px', color: C.muted, fontSize: 14, lineHeight: 1.6 }}>
                    Staff password resets are handled by your administrator. Contact them directly:
                  </p>
                  {contact && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                      <ContactRow icon={<UserIcon />} label="Administrator" value={contact.name} />
                      {contact.email && <ContactRow icon={<MailIcon />} label="Email" value={contact.email} href={`mailto:${contact.email}`} />}
                      {contact.phone && <ContactRow icon={<PhoneIcon />} label="Phone" value={contact.phone} href={`tel:${contact.phone}`} />}
                    </div>
                  )}
                  <button onClick={() => backToLogin(false)} style={primaryBtn(false)}>Back to sign in</button>
                </div>
              )}

            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function ContactRow({ icon, label, value, href }) {
  const Tag = href ? 'a' : 'div';
  return (
    <Tag href={href} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
      background: C.field, borderRadius: 10, border: `1px solid ${C.border}`, textDecoration: 'none',
    }}>
      {icon}
      <div>
        <div style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>{label}</div>
        <div style={{ fontWeight: 700, fontSize: 15, color: href ? C.green : C.ink }}>{value}</div>
      </div>
    </Tag>
  );
}

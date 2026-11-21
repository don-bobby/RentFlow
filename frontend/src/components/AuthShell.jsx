import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { applyBrandTheme } from '../utils/brandTheme';

// Shared shell for the public auth pages (tenant login, landlord registration):
// same nav, forest-green hero photo and white card as the staff Login page.
const HERO_IMAGE = '/lgn.jpg';                       // same photo as Login.jsx
const HERO_OVERLAY = 'linear-gradient(90deg, rgba(18,53,36,0.94) 0%, rgba(18,53,36,0.80) 45%, rgba(18,53,36,0.62) 100%)';
const STAFF_LOGIN_PATH = '/login';
const TENANT_LOGIN_PATH = '/tenant/login';

const DISPLAY = "'Bricolage Grotesque', sans-serif";
const BODY = "'DM Sans', sans-serif";

export const authStyles = {
  label: { fontSize: 13, fontWeight: 600, color: '#2b3a31', display: 'block', marginBottom: 8 },
  input: { width: '100%', boxSizing: 'border-box', height: 48, padding: '0 14px', borderRadius: 10, border: '1px solid #cdd8d0', background: '#f7faf7', fontFamily: BODY, fontSize: 15, color: '#0f1f17' },
  primaryBtn: (disabled) => ({ width: '100%', height: 50, border: 'none', borderRadius: 10, background: '#123524', opacity: disabled ? 0.65 : 1, color: '#fff', fontFamily: BODY, fontWeight: 700, fontSize: 15, cursor: disabled ? 'default' : 'pointer', marginTop: 6 }),
  linkBtn: { background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#1b6b45', fontFamily: BODY, fontSize: 13, fontWeight: 600 },
  error: { background: '#fdecec', border: '1px solid #f5b5b5', borderRadius: 10, padding: '10px 14px', marginBottom: 20, color: '#9b1c1c', fontSize: 13 },
  success: { background: '#e6efe8', border: '1px solid #b9d6c4', borderRadius: 10, padding: '10px 14px', marginBottom: 20, color: '#14532d', fontSize: 13 },
  note: { fontSize: 14, color: '#55645b' },
};

export default function AuthShell({ active = 'staff', headline, sub, points = [], cardTitle, cardSub, children, footer }) {
  useEffect(() => { applyBrandTheme(); }, []);
  const on = { fontSize: 13, fontWeight: 700, color: '#fff', background: '#123524', padding: '0 18px', minHeight: 44, borderRadius: 10, display: 'flex', alignItems: 'center', textDecoration: 'none' };
  const off = { fontSize: 13, color: '#2b3a31', textDecoration: 'none', minHeight: 44, display: 'flex', alignItems: 'center' };
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f1f4f1', fontFamily: BODY, color: '#123524' }}>
      <style>{`.rf-auth input:focus, .rf-auth button:focus-visible, .rf-auth a:focus-visible { outline: 2px solid #1b6b45; outline-offset: 2px; }`}</style>
      <header style={{ height: 58, boxSizing: 'border-box', padding: '0 clamp(16px, 4vw, 40px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', borderBottom: '1px solid #e3e9e4' }}>
        <Link to="/" style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 18, color: '#0f1f17', textDecoration: 'none' }}>RentFlow</Link>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link to={TENANT_LOGIN_PATH} style={active === 'tenant' ? on : off}>Tenant login</Link>
          <Link to={STAFF_LOGIN_PATH} style={active === 'staff' ? on : off}>Staff login</Link>
        </nav>
      </header>
      <main className="rf-auth" style={{ flex: 1, backgroundColor: '#123524', backgroundImage: `${HERO_OVERLAY}, url(${HERO_IMAGE})`, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '56px clamp(16px, 4vw, 40px)', boxSizing: 'border-box' }}>
        <div style={{ width: '100%', maxWidth: 1120, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 56 }}>
          <section style={{ flex: '1 1 380px', maxWidth: 520, color: '#fff' }}>
            <h1 style={{ margin: '0 0 16px', fontFamily: DISPLAY, fontWeight: 700, fontSize: 'clamp(34px, 5vw, 52px)', lineHeight: 1.06, letterSpacing: -0.5 }}>{headline}</h1>
            <p style={{ margin: '0 0 36px', fontSize: 17, lineHeight: 1.5, color: '#d6e4da' }}>{sub}</p>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {points.map(p => (
                <li key={p} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 15 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8fd1ad" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{p}
                </li>
              ))}
            </ul>
          </section>
          <section style={{ flex: '0 1 440px', width: '100%', maxWidth: 440, boxSizing: 'border-box', background: '#fff', borderRadius: 20, padding: '40px 36px', boxShadow: '0 24px 60px rgba(0,0,0,0.28)' }}>
            <h2 style={{ margin: '0 0 6px', fontFamily: DISPLAY, fontWeight: 700, fontSize: 28, color: '#0f1f17' }}>{cardTitle}</h2>
            <p style={{ margin: '0 0 28px', fontSize: 14, color: '#55645b' }}>{cardSub}</p>
            {children}
            {footer && <div style={{ marginTop: 24, textAlign: 'center', fontSize: 14, color: '#55645b' }}>{footer}</div>}
          </section>
        </div>
      </main>
    </div>
  );
}

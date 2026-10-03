import { useState } from 'react';
import { Link } from 'react-router-dom';
import { login } from '../services/api';
import API from '../services/api';

export default function Login() {
  const [form,    setForm]    = useState({ email: '', password: '' });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const [view,    setView]    = useState('login'); // 'login' | 'forgot' | 'sent' | 'contact'
  const [fpEmail, setFpEmail] = useState('');
  const [contact, setContact] = useState(null);

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

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f1623 0%, #1e1b4b 50%, #0f1623 100%)',
      padding: 20,
    }}>
      {/* Background orbs */}
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '15%', left: '10%', width: 400, height: 400, borderRadius: '50%', background: 'rgba(79,70,229,0.15)', filter: 'blur(80px)' }} />
        <div style={{ position: 'absolute', bottom: '15%', right: '10%', width: 300, height: 300, borderRadius: '50%', background: 'rgba(16,185,129,0.1)', filter: 'blur(80px)' }} />
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20,
        padding: '48px 40px', width: '100%', maxWidth: 420, position: 'relative',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, margin: '0 auto 16px',
            background: 'linear-gradient(135deg, #4f46e5, #818cf8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
          }}>🏠</div>
          <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 700, color: '#fff', marginBottom: 6 }}>RentFlow</h1>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>Sign in to your dashboard</p>
        </div>

        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 10, padding: '10px 14px', marginBottom: 20,
            color: '#fca5a5', fontSize: 13,
          }}>{error}</div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600, marginBottom: 8, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Email</label>
            <input
              type="email" required value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="admin@rentflow.co.ke"
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 10,
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#fff', fontSize: 14, outline: 'none',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600, marginBottom: 8, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Password</label>
            <input
              type="password" required value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder="••••••••"
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 10,
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#fff', fontSize: 14, outline: 'none',
              }}
            />
          </div>
          {/* Forgot password link */}
          <div style={{ textAlign: 'right', marginTop: -4 }}>
            <button type="button" onClick={() => { setView('forgot'); setError(''); setFpEmail(form.email); }}
              style={{ background: 'none', border: 'none', color: 'rgba(129,140,248,0.9)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
              Forgot password?
            </button>
          </div>

          <button type="submit" disabled={loading} style={{
            marginTop: 8, padding: '13px', borderRadius: 10, border: 'none',
            background: loading ? 'rgba(79,70,229,0.5)' : 'linear-gradient(135deg, #4f46e5, #6366f1)',
            color: '#fff', fontWeight: 700, fontSize: 15,
            fontFamily: 'Space Grotesk', letterSpacing: '0.3px',
            transition: 'opacity 0.15s',
          }}>
            {loading ? 'Signing in...' : 'Sign In →'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
          Own a property? <Link to="/register" style={{ color: 'rgba(129,140,248,0.9)', fontWeight: 600, textDecoration: 'none' }}>Sign up as a landlord</Link>
        </p>
      </div>

      {/* ── Forgot password overlay views ── */}
      {view !== 'login' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '40px 36px', width: '100%', maxWidth: 420 }}>

            {/* Forgot — enter email */}
            {view === 'forgot' && (
              <form onSubmit={handleForgotPassword}>
                <h2 style={{ fontFamily: 'Space Grotesk', color: '#fff', fontWeight: 700, fontSize: 20, marginBottom: 8 }}>Reset Password</h2>
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
                  Enter your email. Admins get a reset link. Other staff will see admin contact details.
                </p>
                {error && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '9px 14px', marginBottom: 16, color: '#fca5a5', fontSize: 13 }}>{error}</div>}
                <label style={{ display: 'block', color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Email</label>
                <input type="email" value={fpEmail} onChange={e => setFpEmail(e.target.value)} placeholder="you@example.com" autoFocus
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 20 }} />
                <button type="submit" disabled={loading}
                  style={{ width: '100%', padding: 13, borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #4f46e5, #6366f1)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer', marginBottom: 14 }}>
                  {loading ? 'Sending...' : 'Continue'}
                </button>
                <div style={{ textAlign: 'center' }}>
                  <button type="button" onClick={() => { setView('login'); setError(''); }}
                    style={{ background: 'none', border: 'none', color: 'rgba(129,140,248,0.8)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>← Back to Sign In</button>
                </div>
              </form>
            )}

            {/* Sent — confirmation */}
            {view === 'sent' && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
                <h2 style={{ fontFamily: 'Space Grotesk', color: '#fff', fontWeight: 700, fontSize: 20, marginBottom: 10 }}>Check your email</h2>
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, lineHeight: 1.6, marginBottom: 8 }}>
                  We sent a reset link to <span style={{ color: '#818cf8', fontWeight: 600 }}>{fpEmail}</span>.
                </p>
                <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, marginBottom: 28 }}>The link expires in 1 hour. Check your spam folder if you don't see it.</p>
                <button onClick={() => { setView('login'); setError(''); setFpEmail(''); }}
                  style={{ width: '100%', padding: 13, borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #4f46e5, #6366f1)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                  Back to Sign In
                </button>
              </div>
            )}

            {/* Contact — non-admin staff */}
            {view === 'contact' && (
              <div>
                <h2 style={{ fontFamily: 'Space Grotesk', color: '#fff', fontWeight: 700, fontSize: 20, marginBottom: 8 }}>Contact Admin</h2>
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
                  Staff password resets are handled by your administrator. Contact them directly:
                </p>
                {contact && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'rgba(255,255,255,0.05)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
                      <span style={{ fontSize: 20 }}>👤</span>
                      <div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Administrator</div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>{contact.name}</div>
                      </div>
                    </div>
                    {contact.email && (
                      <a href={`mailto:${contact.email}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'rgba(255,255,255,0.05)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', textDecoration: 'none' }}>
                        <span style={{ fontSize: 20 }}>📧</span>
                        <div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Email</div>
                          <div style={{ fontWeight: 600, fontSize: 14, color: '#818cf8' }}>{contact.email}</div>
                        </div>
                      </a>
                    )}
                    {contact.phone && (
                      <a href={`tel:${contact.phone}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'rgba(255,255,255,0.05)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', textDecoration: 'none' }}>
                        <span style={{ fontSize: 20 }}>📞</span>
                        <div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Phone</div>
                          <div style={{ fontWeight: 600, fontSize: 14, color: '#818cf8' }}>{contact.phone}</div>
                        </div>
                      </a>
                    )}
                  </div>
                )}
                <button onClick={() => { setView('login'); setError(''); }}
                  style={{ width: '100%', padding: 13, borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #4f46e5, #6366f1)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                  Back to Sign In
                </button>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}

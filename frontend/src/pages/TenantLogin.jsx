import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import API from '../services/api';

// view: 'login' | 'request_otp' | 'verify_otp'
export default function TenantLogin() {
  const [view,      setView]      = useState('login');
  const [form,      setForm]      = useState({ national_id: '', pin: '' });
  const [otpPhone,  setOtpPhone]  = useState('');
  const [otp,       setOtp]       = useState('');
  const [newPin,    setNewPin]    = useState('');
  const [newPin2,   setNewPin2]   = useState('');
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');
  const [loading,   setLoading]   = useState(false);
  const navigate = useNavigate();

  // ── Login ──────────────────────────────────────────────────────────────────
  async function handleLogin() {
    if (!form.national_id || !form.pin) { setError('Please enter your National ID and PIN.'); return; }
    setLoading(true); setError('');
    try {
      const res = await API.post('/auth/tenant-login', form);
      localStorage.setItem('tenant_token', res.data.token);
      localStorage.setItem('tenant_info', JSON.stringify(res.data.tenant));
      navigate('/tenant/dashboard');
    } catch (e) {
      setError(e.response?.data?.error || 'Login failed. Please try again.');
    } finally { setLoading(false); }
  }

  // ── Request OTP ────────────────────────────────────────────────────────────
  async function handleRequestOtp() {
    if (!otpPhone) { setError('Enter your registered phone number.'); return; }
    setLoading(true); setError(''); setSuccess('');
    try {
      await API.post('/auth/tenant-request-otp', { phone: otpPhone });
      setSuccess('An OTP has been sent to your phone. It expires in 10 minutes.');
      setView('verify_otp');
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to send OTP. Please try again.');
    } finally { setLoading(false); }
  }

  // ── Verify OTP & Set New PIN ───────────────────────────────────────────────
  async function handleResetPin() {
    if (!otp)    { setError('Enter the OTP from your SMS.'); return; }
    if (!newPin) { setError('Enter a new PIN.'); return; }
    if (newPin.length < 4) { setError('PIN must be at least 4 digits.'); return; }
    if (newPin !== newPin2) { setError('PINs do not match.'); return; }
    setLoading(true); setError('');
    try {
      const res = await API.post('/auth/tenant-reset-pin', { phone: otpPhone, otp, new_pin: newPin });
      localStorage.setItem('tenant_token', res.data.token);
      localStorage.setItem('tenant_info', JSON.stringify(res.data.tenant));
      navigate('/tenant/dashboard');
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to reset PIN. Please try again.');
    } finally { setLoading(false); }
  }

  function goToLogin() {
    setView('login'); setError(''); setSuccess('');
    setOtp(''); setNewPin(''); setNewPin2('');
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 16px' }}>🏠</div>
          <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 800, marginBottom: 6 }}>Tenant Portal</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>
            {view === 'login'       && 'Sign in to view your account'}
            {view === 'request_otp' && 'Reset your PIN via SMS'}
            {view === 'verify_otp'  && 'Enter your OTP and new PIN'}
          </p>
        </div>

        <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border)' }}>

          {error   && <div style={{ background: 'var(--red-light)',   color: 'var(--red)',   padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}
          {success && <div style={{ background: 'var(--green-light)', color: 'var(--green)', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{success}</div>}

          {/* ── Login view ── */}
          {view === 'login' && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Field label="National ID" value={form.national_id} onChange={v => setForm(f => ({ ...f, national_id: v }))}
                  type="text" placeholder="e.g. 12345678" onEnter={handleLogin} />
                <Field label="PIN" value={form.pin} onChange={v => setForm(f => ({ ...f, pin: v }))}
                  type="password" placeholder="Enter your PIN" onEnter={handleLogin} />
              </div>

              <button onClick={handleLogin} disabled={loading} style={primaryBtn}>
                {loading ? 'Signing in...' : 'Sign In'}
              </button>

              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <button onClick={() => { setView('request_otp'); setError(''); setSuccess(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--primary)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                  Forgot PIN?
                </button>
              </div>

              <p style={{ textAlign: 'center', marginTop: 10, fontSize: 13, color: 'var(--muted)' }}>
                Don't have a PIN? Contact your landlord or caretaker.
              </p>
            </>
          )}

          {/* ── Request OTP view ── */}
          {view === 'request_otp' && (
            <>
              <div style={{ marginBottom: 20 }}>
                <Field label="Your Registered Phone Number" value={otpPhone} onChange={setOtpPhone}
                  type="tel" placeholder="e.g. 0712345678" onEnter={handleRequestOtp} />
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                  We'll send a 6-digit OTP to this number via SMS.
                </p>
              </div>

              <button onClick={handleRequestOtp} disabled={loading} style={primaryBtn}>
                {loading ? 'Sending...' : 'Send OTP'}
              </button>

              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <button onClick={goToLogin} style={linkBtn}>Back to Sign In</button>
              </div>
            </>
          )}

          {/* ── Verify OTP + new PIN view ── */}
          {view === 'verify_otp' && (
            <>
              <div style={{ background: 'var(--blue-light)', border: '1px solid var(--blue)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--blue)' }}>
                OTP sent to <strong>{otpPhone}</strong>. Check your SMS.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
                <div>
                  <label style={labelStyle}>OTP Code</label>
                  <input type="text" inputMode="numeric" value={otp} onChange={e => setOtp(e.target.value)}
                    placeholder="6-digit code" maxLength={6}
                    style={{ ...inputStyle, fontSize: 22, letterSpacing: 8, textAlign: 'center', fontWeight: 700 }} />
                </div>
                <Field label="New PIN (min 4 digits)" value={newPin} onChange={setNewPin}
                  type="password" placeholder="Enter new PIN" onEnter={handleResetPin} />
                <Field label="Confirm New PIN" value={newPin2} onChange={setNewPin2}
                  type="password" placeholder="Repeat new PIN" onEnter={handleResetPin} />
              </div>

              <button onClick={handleResetPin} disabled={loading} style={primaryBtn}>
                {loading ? 'Saving...' : 'Set New PIN & Sign In'}
              </button>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 13 }}>
                <button onClick={() => { setView('request_otp'); setError(''); setSuccess(''); setOtp(''); }}
                  style={linkBtn}>
                  Resend OTP
                </button>
                <button onClick={goToLogin} style={linkBtn}>Back to Sign In</button>
              </div>
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--muted)' }}>
          Staff? <Link to="/login" style={{ color: 'var(--primary)', fontWeight: 600 }}>Sign in here</Link>
        </p>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder, onEnter }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && onEnter?.()}
        style={inputStyle} />
    </div>
  );
}

const labelStyle  = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' };
const inputStyle  = { width: '100%', padding: '11px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 14, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' };
const primaryBtn  = { width: '100%', marginTop: 8, padding: '12px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' };
const linkBtn     = { background: 'none', border: 'none', color: 'var(--primary)', fontWeight: 600, fontSize: 13, cursor: 'pointer', padding: 0 };

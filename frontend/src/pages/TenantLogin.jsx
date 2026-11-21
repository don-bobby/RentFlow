import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import API from '../services/api';
import AuthShell, { authStyles as S } from '../components/AuthShell';

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

  const cardSub = view === 'login' ? 'Sign in to view your account'
    : view === 'request_otp' ? 'Reset your PIN via SMS' : 'Enter your OTP and new PIN';

  return (
    <AuthShell
      active="tenant"
      headline="Your home, your rent, all in plain view"
      sub="See your balance, receipts and repair requests whenever you need them, the same records your landlord sees."
      points={[
        'Every payment and receipt on record',
        'Report a repair and follow its progress',
        'Pay your rent securely with M-Pesa',
      ]}
      cardTitle="Tenant portal"
      cardSub={cardSub}
      footer={<>Staff? <Link to="/login" style={{ color: '#1b6b45', fontWeight: 700, textDecoration: 'none' }}>Sign in here</Link></>}
    >
      {error   && <div role="alert" style={S.error}>{error}</div>}
      {success && <div role="status" style={S.success}>{success}</div>}

      {/* ── Login view ── */}
      {view === 'login' && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field id="tl-id" label="National ID" value={form.national_id} onChange={v => setForm(f => ({ ...f, national_id: v }))}
              type="text" placeholder="e.g. 12345678" onEnter={handleLogin} />
            <Field id="tl-pin" label="PIN" value={form.pin} onChange={v => setForm(f => ({ ...f, pin: v }))}
              type="password" placeholder="Enter your PIN" onEnter={handleLogin} />
          </div>

          <button onClick={handleLogin} disabled={loading} style={{ ...S.primaryBtn(loading), marginTop: 22 }}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>

          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button onClick={() => { setView('request_otp'); setError(''); setSuccess(''); }} style={S.linkBtn}>Forgot PIN?</button>
          </div>

          <p style={{ textAlign: 'center', margin: '10px 0 0', fontSize: 13, color: '#55645b' }}>
            Don't have a PIN? Contact your landlord or caretaker.
          </p>
        </>
      )}

      {/* ── Request OTP view ── */}
      {view === 'request_otp' && (
        <>
          <div style={{ marginBottom: 20 }}>
            <Field id="tl-phone" label="Your registered phone number" value={otpPhone} onChange={setOtpPhone}
              type="tel" placeholder="e.g. 0712345678" onEnter={handleRequestOtp} />
            <p style={{ fontSize: 12, color: '#55645b', marginTop: 8 }}>We'll send a 6-digit OTP to this number via SMS.</p>
          </div>

          <button onClick={handleRequestOtp} disabled={loading} style={S.primaryBtn(loading)}>
            {loading ? 'Sending...' : 'Send OTP'}
          </button>

          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <button onClick={goToLogin} style={S.linkBtn}>Back to sign in</button>
          </div>
        </>
      )}

      {/* ── Verify OTP + new PIN view ── */}
      {view === 'verify_otp' && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20 }}>
            <div>
              <label htmlFor="tl-otp" style={S.label}>OTP code</label>
              <input id="tl-otp" type="text" inputMode="numeric" value={otp} onChange={e => setOtp(e.target.value)}
                placeholder="6-digit code" maxLength={6}
                style={{ ...S.input, height: 56, fontSize: 22, letterSpacing: 8, textAlign: 'center', fontWeight: 700 }} />
            </div>
            <Field id="tl-new" label="New PIN (min 4 digits)" value={newPin} onChange={setNewPin}
              type="password" placeholder="Enter new PIN" onEnter={handleResetPin} />
            <Field id="tl-new2" label="Confirm new PIN" value={newPin2} onChange={setNewPin2}
              type="password" placeholder="Repeat new PIN" onEnter={handleResetPin} />
          </div>

          <button onClick={handleResetPin} disabled={loading} style={S.primaryBtn(loading)}>
            {loading ? 'Saving...' : 'Set new PIN & sign in'}
          </button>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
            <button onClick={() => { setView('request_otp'); setError(''); setSuccess(''); setOtp(''); }} style={S.linkBtn}>Resend OTP</button>
            <button onClick={goToLogin} style={S.linkBtn}>Back to sign in</button>
          </div>
        </>
      )}
    </AuthShell>
  );
}

function Field({ id, label, value, onChange, type = 'text', placeholder, onEnter }) {
  return (
    <div>
      <label htmlFor={id} style={S.label}>{label}</label>
      <input id={id} type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && onEnter?.()}
        style={S.input} />
    </div>
  );
}

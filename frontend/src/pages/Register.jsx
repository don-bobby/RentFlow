import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import API from '../services/api';

export default function Register() {
  const [form,    setForm]    = useState({ name: '', email: '', password: '', confirmPassword: '', phone: '' });
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirmPassword) {
      return setError('Passwords do not match.');
    }
    if (form.password.length < 6) {
      return setError('Password must be at least 6 characters.');
    }

    setLoading(true);
    try {
      await API.post('/auth/register', {
        name:     form.name,
        email:    form.email,
        password: form.password,
        phone:    form.phone,
      });
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  if (success) return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f1623 0%, #1e1b4b 50%, #0f1623 100%)', padding: 20,
    }}>
      <div style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: '48px 40px', width: '100%', maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <h2 style={{ fontFamily: 'Space Grotesk', fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Registration Submitted!</h2>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, marginBottom: 28, lineHeight: 1.6 }}>
          Your landlord account is pending admin approval. You'll be able to log in once your account has been approved.
        </p>
        <button onClick={() => navigate('/login')} style={{ padding: '12px 28px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #4f46e5, #6366f1)', color: '#fff', fontWeight: 700, fontSize: 15, fontFamily: 'Space Grotesk' }}>
          Back to Login
        </button>
      </div>
    </div>
  );

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f1623 0%, #1e1b4b 50%, #0f1623 100%)', padding: 20,
    }}>
      {/* Background orbs */}
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '15%', left: '10%', width: 400, height: 400, borderRadius: '50%', background: 'rgba(79,70,229,0.15)', filter: 'blur(80px)' }} />
        <div style={{ position: 'absolute', bottom: '15%', right: '10%', width: 300, height: 300, borderRadius: '50%', background: 'rgba(16,185,129,0.1)', filter: 'blur(80px)' }} />
      </div>

      <div style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: '48px 40px', width: '100%', maxWidth: 420, position: 'relative' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, margin: '0 auto 16px', background: 'linear-gradient(135deg, #4f46e5, #818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>🏠</div>
          <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 24, fontWeight: 700, color: '#fff', marginBottom: 6 }}>Register as Landlord</h1>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>Your account will require admin approval</p>
        </div>

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '10px 14px', marginBottom: 20, color: '#fca5a5', fontSize: 13 }}>{error}</div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            { label: 'Full Name',        key: 'name',            type: 'text',     placeholder: 'John Doe' },
            { label: 'Email',            key: 'email',           type: 'email',    placeholder: 'john@email.com' },
            { label: 'Phone',            key: 'phone',           type: 'tel',      placeholder: '0712345678' },
            { label: 'Password',         key: 'password',        type: 'password', placeholder: '••••••••' },
            { label: 'Confirm Password', key: 'confirmPassword', type: 'password', placeholder: '••••••••' },
          ].map(({ label, key, type, placeholder }) => (
            <div key={key}>
              <label style={{ display: 'block', color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600, marginBottom: 6, letterSpacing: '0.5px', textTransform: 'uppercase' }}>{label}</label>
              <input type={type} required value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder}
                style={{ width: '100%', padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 14, outline: 'none' }} />
            </div>
          ))}

          <button type="submit" disabled={loading} style={{ marginTop: 8, padding: '13px', borderRadius: 10, border: 'none', background: loading ? 'rgba(79,70,229,0.5)' : 'linear-gradient(135deg, #4f46e5, #6366f1)', color: '#fff', fontWeight: 700, fontSize: 15, fontFamily: 'Space Grotesk' }}>
            {loading ? 'Submitting...' : 'Register →'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: '#818cf8', fontWeight: 600 }}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}

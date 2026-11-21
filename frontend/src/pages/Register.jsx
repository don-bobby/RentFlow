import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import API from '../services/api';
import AuthShell, { authStyles as S } from '../components/AuthShell';

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

  const shell = {
    active: 'staff',
    headline: 'Manage your rentals with full transparency',
    sub: 'Register as a landlord to list vacant homes, track rent and keep your tenants informed. An administrator reviews every new account.',
    points: [
      'Your own dashboard for properties, tenants and payments',
      'Vacant units listed with real photos and real rent',
      'Every account approved before it goes live',
    ],
  };

  if (success) return (
    <AuthShell {...shell} cardTitle="Registration submitted" cardSub="Thank you for signing up">
      <p style={{ ...S.note, lineHeight: 1.6, margin: '0 0 24px' }}>
        Your landlord account is pending admin approval. You'll be able to sign in once it has been approved.
      </p>
      <button onClick={() => navigate('/login')} style={S.primaryBtn(false)}>Back to sign in</button>
    </AuthShell>
  );

  const fields = [
    { label: 'Full name',        key: 'name',            type: 'text',     placeholder: 'John Doe', auto: 'name' },
    { label: 'Email',            key: 'email',           type: 'email',    placeholder: 'john@email.com', auto: 'email' },
    { label: 'Phone',            key: 'phone',           type: 'tel',      placeholder: '0712345678', auto: 'tel' },
    { label: 'Password',         key: 'password',        type: 'password', placeholder: 'At least 6 characters', auto: 'new-password' },
    { label: 'Confirm password', key: 'confirmPassword', type: 'password', placeholder: 'Repeat your password', auto: 'new-password' },
  ];

  return (
    <AuthShell {...shell} cardTitle="Register as landlord" cardSub="Your account will need admin approval"
      footer={<>Already have an account? <Link to="/login" style={{ color: '#1b6b45', fontWeight: 700, textDecoration: 'none' }}>Sign in</Link></>}>
      {error && <div role="alert" style={S.error}>{error}</div>}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {fields.map(({ label, key, type, placeholder, auto }) => (
          <div key={key}>
            <label htmlFor={`reg-${key}`} style={S.label}>{label}</label>
            <input id={`reg-${key}`} type={type} required autoComplete={auto} value={form[key]} placeholder={placeholder}
              onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} style={S.input} />
          </div>
        ))}
        <button type="submit" disabled={loading} style={S.primaryBtn(loading)}>
          {loading ? 'Submitting...' : 'Register'}
        </button>
      </form>
    </AuthShell>
  );
}

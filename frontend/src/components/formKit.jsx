import { useState, useEffect } from 'react';

// Small shared bits used by the quick-action modals (Record Payment, Add/Edit
// Tenant) and the tenant picker, so the same modal can open from the
// Dashboard, Payments and Tenants pages without copy-pasted helpers.

export function hexToRgba(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Deterministic initials avatar — same tenant, same colour everywhere.
const AVATAR_COLORS = ['#1b6b45', '#2563eb', '#16a34a', '#d97706', '#dc2626', '#0891b2', '#db2777'];
export function initialsAvatar(name) {
  const clean = (name || '?').trim();
  const parts = clean.split(/\s+/);
  const initials = ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
  let hash = 0;
  for (let i = 0; i < clean.length; i++) hash = (hash * 31 + clean.charCodeAt(i)) % AVATAR_COLORS.length;
  return { initials, color: AVATAR_COLORS[hash] };
}

// Tracks the light/dark theme Layout.jsx sets via data-theme on <html>.
export function useIsDarkMode() {
  const [isDark, setIsDark] = useState(document.documentElement.getAttribute('data-theme') === 'dark');
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setIsDark(el.getAttribute('data-theme') === 'dark'));
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

export const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' };
export const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 14, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' };

export function Field({ label, value, onChange, placeholder, type = 'text', required = false, hint = null, hintWarn = false, span = false, autoFocus = false }) {
  return (
    <div style={span ? { gridColumn: '1/-1' } : undefined}>
      <label style={labelStyle}>{label}{required && <span style={{ color: 'var(--red, #dc2626)' }}> *</span>}</label>
      <input type={type} value={value} autoFocus={autoFocus} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
      {hint && <div style={{ fontSize: 11, marginTop: 4, color: hintWarn ? 'var(--amber, #d97706)' : 'var(--muted)' }}>{hint}</div>}
    </div>
  );
}

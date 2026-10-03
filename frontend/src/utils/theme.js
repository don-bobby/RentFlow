// frontend/src/utils/theme.js
//
// Extracted from Layout.jsx's theme useEffect, which only ever ran for
// pages wrapped in <Layout> — meaning any standalone page (TenantLogin,
// Login, Register, PublicListings) never got --bg, --surface, --surface2,
// --border, --text, or --muted defined at all. These were never CSS
// variables with a stylesheet fallback; they only ever existed because this
// JS set them imperatively on document.documentElement. A var(--primary)
// with no fallback value (as in TenantLogin's Sign In button) resolves to
// nothing at all when this hasn't run, making the element invisible.
//
// This file is the single source of truth now. App.jsx calls applyTheme()
// once on load so every route gets real values immediately, regardless of
// which page is showing. Layout.jsx's own effect still calls this too, so
// the in-app dark/light toggle keeps working exactly as before.

// Accent/semantic colors — these were NEVER set anywhere, not even inside
// Layout.jsx's own effect. They only ever worked where a component happened
// to write var(--primary, #7c3aed) with its own inline fallback. Values here
// match that existing fallback convention exactly (Properties.jsx, Users.jsx,
// Reports.jsx), so nothing visually changes for pages that already had
// fallbacks — this just makes the bare var(--primary)-style usages (as in
// Layout.jsx itself, and TenantLogin.jsx) work everywhere too. Constant
// across both themes — nothing in the codebase showed evidence these should
// differ between light and dark.
const ACCENT_COLORS = {
  '--primary':       '#7c3aed',
  '--primary-light': '#ede9fe',
  '--green':         '#16a34a',
  '--green-light':   '#dcfce7',
  '--red':           '#dc2626',
  '--red-light':     '#fee2e2',
  '--blue':          '#2563eb',
  '--blue-light':    '#dbeafe',
  '--amber':         '#d97706',
  '--amber-light':   '#fef3c7',
  '--shadow':        '0 2px 8px rgba(0,0,0,0.10)',
  '--shadow-lg':     '0 8px 30px rgba(0,0,0,0.18)',
};

export function applyTheme(theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);

  for (const [name, value] of Object.entries(ACCENT_COLORS)) {
    root.style.setProperty(name, value);
  }

  if (theme === 'dark') {
    root.style.setProperty('--bg',       '#0f1117');
    root.style.setProperty('--surface',  '#1a1d27');
    root.style.setProperty('--surface2', '#21253a');
    root.style.setProperty('--border',   '#2a2f45');
    root.style.setProperty('--text',     '#e8eaf6');
    root.style.setProperty('--muted',    '#6b7194');
  } else {
    root.style.setProperty('--bg',       '#f0f2f7');
    root.style.setProperty('--surface',  '#ffffff');
    root.style.setProperty('--surface2', '#f8f9fc');
    root.style.setProperty('--border',   '#e4e8f0');
    root.style.setProperty('--text',     '#0f1623');
    root.style.setProperty('--muted',    '#6b7694');
  }
}

// Reads the saved preference (same localStorage key Layout.jsx already
// uses) and applies it immediately. Call this once, as early as possible.
export function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  applyTheme(saved);
  return saved;
}

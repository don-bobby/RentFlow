// Applies the RentFlow brand tokens for pages that render OUTSIDE <Layout>
// (tenant login, tenant portal, landlord registration). Layout already does this
// for the staff app. Safe to call more than once.
export function applyBrandTheme() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!document.getElementById('rentflow-fonts')) {
    const link = document.createElement('link');
    link.id = 'rentflow-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=DM+Sans:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }
  document.body.style.fontFamily = "'DM Sans', sans-serif";
  const dark = root.getAttribute('data-theme') === 'dark';
  const set = (k, v) => root.style.setProperty(k, v);
  if (!dark) {
    set('--bg', '#f1f4f1'); set('--surface', '#ffffff'); set('--surface2', '#f7faf7');
    set('--border', '#e3e9e4'); set('--text', '#0f1f17'); set('--muted', '#55645b');
    set('--primary', '#1b6b45'); set('--primary-light', '#e6efe8');
  } else {
    set('--primary', '#8fd1ad'); set('--primary-light', 'rgba(143,209,173,0.14)');
  }
  set('--radius', '14px');
}

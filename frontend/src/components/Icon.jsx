// Shared line icons (inline SVG, no extra dependency). Keyed by the emoji glyph the
// app's nav/config already uses, so `<Icon name="💳" />` renders a clean line icon;
// unknown glyphs fall back to rendering the original character.
export const ICONS = {
  '⊞': <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  '🏠': <><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></>,
  '🏢': <><rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4"/></>,
  '🧊': <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></>,
  '🗺': <><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></>,
  '⭐': <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>,
  '👥': <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6M16 4.8a3.5 3.5 0 010 6.4M18 14.3c2 .8 3.5 2.7 3.5 5.7"/></>,
  '📄': <><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></>,
  '🪪': <><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.5-1.5 1.7-2 3-2s2.5.5 3 2M14 10h4M14 14h4"/></>,
  '💳': <><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19"/></>,
  '🔧': <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94z"/>,
  '🧰': <><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M3 13h18"/></>,
  '🧾': <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></>,
  '💧': <path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z"/>,
  '🔔': <path d="M6 16v-5a6 6 0 0112 0v5l2 2H4zM10 21h4"/>,
  '🏦': <path d="M3 10l9-6 9 6zM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/>,
  '🧮': <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M12 12h2M8 16h2M12 16h2"/></>,
  '💬': <path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z"/>,
  '📊': <path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>,
  '👤': <><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></>,
  '🛡': <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>,
  '🔑': <><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/></>,
  '🏷': <><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1"/></>,
  '📢': <path d="M3 11v3a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1zM15 9a4 4 0 010 6M18 6.5a8 8 0 010 11"/>,
  '📱': <><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/></>,
  '⚙': <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></>,
  '✏': <><path d="M4 20l4-1 11-11a2.1 2.1 0 00-3-3L5 16z"/><path d="M14 7l3 3"/></>,
  '🔒': <><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></>,
  '⏻': <path d="M12 3v8M6.3 6.3a8 8 0 1011.4 0"/>,
  '☰': <path d="M4 7h16M4 12h16M4 17h16"/>,
  '⋯': <><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></>,
  '🌙': <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>,
  '☀': <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  '⏳': <path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/>,
  '👁': <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
  '🙈': <><path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.2 4M6.5 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.4 4.5-1"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/></>,
  '→': <path d="M13 17l5-5-5-5M6 17l5-5-5-5"/>,
  '←': <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/>,
  '💰': <><circle cx="12" cy="12" r="9"/><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.5.8-2.5 1.9 0 2.7 5 1.4 5 4.2 0 1.1-1.1 1.9-2.5 1.9-1.2 0-2.1-.5-2.6-1.3M12 6.5V8M12 16v1.5"/></>,
  '⚠': <><path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/></>,
  '🔀': <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>,
  '📅': <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></>,
  '📈': <path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>,
  '📉': <path d="M3 7l6 6 4-4 8 8M15 17h6v-6"/>,
  '⏰': <><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M5 3.5L2.5 6M19 3.5L21.5 6"/></>,
  '🧑‍🔧': <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-6 6.5-6 1.2 0 2.3.3 3.2.8M17.5 14.5l1.5-1.5 2 2-1.5 1.5zM18 17l-3.5 3.5"/></>,
  '🔍': <><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></>,
  '⛶': <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>,
  '✉': <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></>,
  '✅': <><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></>,
  '✓': <path d="M5 12.5l4.5 4.5L19 7.5"/>,
};
export function Icon({ name, size = 20 }) {
  const key = typeof name === 'string' ? name.replace(/\uFE0F/g, '') : name;
  const paths = ICONS[key];
  if (!paths) return <span style={{ fontSize: size }}>{name}</span>;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ flexShrink: 0, display: 'block' }}>{paths}</svg>
  );
}


export default Icon;

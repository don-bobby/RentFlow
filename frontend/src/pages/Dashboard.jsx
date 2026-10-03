import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from 'recharts';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import API from '../services/api';
// PendingLandlordsAlert / PendingUnitsAlert banners moved to Layout.jsx as
// floating, dismissible toasts (bottom-right, global across every page)
// instead of two permanent full-width rows at the top of just this page.

// Leaflet's default marker icon path breaks under most bundlers (webpack
// strips the relative image URLs it expects) — point it at the CDN version
// once, at module load, instead of per-render.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Central palette: every semantic color used across the dashboard, each with
// a CSS-variable reference (so it stays in sync with the rest of the app if
// index.css defines it) plus a guaranteed hex fallback (so it never renders
// invisible/flat if the variable is missing).
const PALETTE = {
  primary: { c: 'var(--primary, #7c3aed)', l: 'var(--primary-light, #ede9fe)', hex: '#7c3aed' },
  green:   { c: 'var(--green, #16a34a)',   l: 'var(--green-light, #dcfce7)',   hex: '#16a34a' },
  amber:   { c: 'var(--amber, #d97706)',   l: 'var(--amber-light, #fef3c7)',   hex: '#d97706' },
  blue:    { c: 'var(--blue, #2563eb)',    l: 'var(--blue-light, #dbeafe)',    hex: '#2563eb' },
  red:     { c: 'var(--red, #dc2626)',     l: 'var(--red-light, #fee2e2)',     hex: '#dc2626' },
};

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Tracks the light/dark theme Layout.jsx sets via document.documentElement's
// data-theme attribute, so cards can render an appropriate tint in each mode
// without touching Layout.jsx.
function useIsDarkMode() {
  const [isDark, setIsDark] = useState(document.documentElement.getAttribute('data-theme') === 'dark');
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setIsDark(el.getAttribute('data-theme') === 'dark'));
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

function StatCard({ label, value, icon, colorKey, onClick, sub }) {
  const { c: color, l: light, hex } = PALETTE[colorKey];
  const isDark = useIsDarkMode();
  // Light mode: soft pastel tint (unchanged). Dark mode: a translucent wash
  // of the accent color instead — the pastel swatch read as a washed-out
  // bright smudge against a dark surface, so this keeps the same "colorful
  // corner" effect without looking muddy.
  const tint = isDark ? hexToRgba(hex, 0.22) : light;
  const labelColor = isDark ? 'rgba(255,255,255,0.62)' : 'var(--muted)';
  return (
    <div onClick={onClick} style={{
      background: `linear-gradient(135deg, ${tint} 0%, var(--surface) 65%)`, borderRadius: 'var(--radius)',
      padding: '20px 22px', boxShadow: 'var(--shadow)',
      border: '1px solid var(--border)', borderLeft: `4px solid ${color}`,
      display: 'flex', alignItems: 'center', gap: 14,
      cursor: 'pointer', transition: 'all 0.18s',
    }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-lg)'; e.currentTarget.style.transform = 'translateY(-3px)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--shadow)'; e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      <div style={{ width: 48, height: 48, borderRadius: 12, flexShrink: 0, background: color, boxShadow: `0 4px 10px ${hex}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: labelColor, fontWeight: 600, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'Space Grotesk', color, lineHeight: 1.2 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: labelColor, marginTop: 2 }}>{sub}</div>}
      </div>
      <span style={{ color, fontSize: 18, fontWeight: 700, flexShrink: 0 }}>›</span>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  const isDark = useIsDarkMode();
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
      <div style={{ background: isDark ? '#242a3d' : 'var(--surface)', borderRadius: 16, width: '100%', maxWidth: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)', border: isDark ? '1px solid #383f57' : 'none' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>{title}</h2>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: isDark ? '#383f57' : 'var(--surface2)', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

function SeeMoreFooter({ onClick, label = 'See More →' }) {
  return (
    <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'center', borderTop: '1px solid var(--border)' }}>
      <button onClick={onClick} style={{
        padding: '9px 20px', borderRadius: 8, border: 'none', background: 'var(--primary, #7c3aed)',
        color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
      }}>
        {label}
      </button>
    </div>
  );
}

// ── Shared building blocks for the "Caretaker Workload"-style modal layout ──
// (summary bar + avatar/icon list cards + metrics grid), reused across every
// modal so they all share one consistent look.

function SummaryBar({ isDark, stats }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', borderBottom: isDark ? '1px solid rgba(255,255,255,0.07)' : '1px solid #e2e8f0', background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc' }}>
      {stats.map((s, i) => (
        <div key={s.label} style={{ flex: '1 1 120px', padding: '13px 16px', borderRight: i < stats.length - 1 ? (isDark ? '1px solid rgba(255,255,255,0.07)' : '1px solid #e2e8f0') : 'none' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: isDark ? 'rgba(255,255,255,0.38)' : '#94a3b8', marginBottom: 3 }}>{s.label}</div>
          <div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 17, color: s.color }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

function MetricsGrid({ isDark, metrics }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${metrics.length}, 1fr)`, gap: 8 }}>
      {metrics.map(m => (
        <div key={m.label} style={{ background: isDark ? 'rgba(255,255,255,0.07)' : '#f8fafc', borderRadius: 9, padding: '10px 12px', border: isDark ? '1px solid rgba(255,255,255,0.09)' : '1px solid #e2e8f0', textAlign: 'center' }}>
          <div style={{ fontSize: 14, marginBottom: 4 }}>{m.icon}</div>
          <div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: m.small ? 12 : 15, color: m.color, lineHeight: 1.2, wordBreak: 'break-word' }}>{m.value}</div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: isDark ? 'rgba(255,255,255,0.35)' : '#94a3b8', marginTop: 3 }}>{m.label}</div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon, title, sub }) {
  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', marginBottom: 6 }}>{title}</div>
      {sub && <div style={{ fontSize: 13, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}

// A single card in a "list of items" modal — avatar/icon + title + subtitle +
// a badge on the right, with an optional metrics grid and alert box below,
// and a subtle hover tint. Matches the Caretaker Workload card exactly.
function ListCard({ i, isDark, avatarIcon, avatarBg, avatarBorder, avatarColor, title, subtitle, badge, hoverTint, children }) {
  const rowBg = isDark ? (i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)') : (i % 2 === 0 ? '#fff' : '#f8fafc');
  return (
    <div style={{ padding: '16px 20px', borderBottom: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid #f1f5f9', background: rowBg, transition: 'background 0.15s' }}
      onMouseEnter={e => { e.currentTarget.style.background = hoverTint || (isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc'); }}
      onMouseLeave={e => { e.currentTarget.style.background = rowBg; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: children ? 14 : 0, gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
          {avatarIcon && (
            <div style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, background: avatarBg, border: avatarBorder, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, color: avatarColor }}>
              {avatarIcon}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: isDark ? '#f1f5f9' : '#0f172a' }}>{title}</div>
            {subtitle && <div style={{ fontSize: 11, fontWeight: 600, color: isDark ? '#60a5fa' : '#2563eb', marginTop: 1 }}>{subtitle}</div>}
          </div>
        </div>
        {badge && <div style={{ flexShrink: 0 }}>{badge}</div>}
      </div>
      {children}
    </div>
  );
}

function Badge({ isDark, label, tone }) {
  // tone: 'green' | 'red' | 'amber' | 'blue'
  const tones = {
    green: { d: ['rgba(52,211,153,0.15)', '#34d399', 'rgba(52,211,153,0.3)'],  l: ['#dcfce7', '#16a34a', '#86efac'] },
    red:   { d: ['rgba(248,113,113,0.15)', '#f87171', 'rgba(248,113,113,0.3)'], l: ['#fee2e2', '#dc2626', '#fca5a5'] },
    amber: { d: ['rgba(251,191,36,0.15)', '#fbbf24', 'rgba(251,191,36,0.3)'],   l: ['#fef3c7', '#d97706', '#fcd34d'] },
    blue:  { d: ['rgba(96,165,250,0.15)', '#60a5fa', 'rgba(96,165,250,0.3)'],   l: ['#dbeafe', '#2563eb', '#93c5fd'] },
  };
  const [bg, color, border] = isDark ? tones[tone].d : tones[tone].l;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: bg, color, border: `1px solid ${border}`, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

function initialsOf(name) {
  return name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';
}

// Compact property map for the Dashboard — plots each property that has
// gps_lat/gps_lng (geocoded server-side from its location text) with a popup
// showing occupancy and unpaid rent, reusing whatever's passed in as `properties`.
// Nudges properties that geocoded to (near-)identical coordinates — common
// when several locations fall back to the same town-level match — into a
// small ring around that shared point, so every property gets its own
// visible, clickable pin instead of stacking invisibly on top of one another.
function spreadOverlappingCoords(withCoords) {
  const groups = {};
  withCoords.forEach(p => {
    const key = `${parseFloat(p.gps_lat).toFixed(5)},${parseFloat(p.gps_lng).toFixed(5)}`;
    (groups[key] = groups[key] || []).push(p);
  });
  const OFFSET = 0.0025; // roughly ~250m — enough to visually separate pins at this zoom level
  const result = [];
  Object.values(groups).forEach(group => {
    if (group.length === 1) { result.push({ ...group[0], mapLat: parseFloat(group[0].gps_lat), mapLng: parseFloat(group[0].gps_lng) }); return; }
    group.forEach((p, i) => {
      const angle = (2 * Math.PI * i) / group.length;
      result.push({
        ...p,
        mapLat: parseFloat(p.gps_lat) + OFFSET * Math.cos(angle),
        mapLng: parseFloat(p.gps_lng) + OFFSET * Math.sin(angle),
      });
    });
  });
  return result;
}

// A single marker that opens its popup on hover instead of click.
function HoverMarker({ p, isDark }) {
  const markerRef = useRef(null);
  return (
    <Marker
      position={[p.mapLat, p.mapLng]}
      ref={markerRef}
      eventHandlers={{
        mouseover: () => markerRef.current?.openPopup(),
        mouseout: () => markerRef.current?.closePopup(),
      }}
    >
      <Popup>
        <div style={{ minWidth: 150 }}>
          <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>{p.name}</div>
          <div style={{ fontSize: 12, marginBottom: 2 }}>Occupancy: <b>{p.rate}%</b> ({p.occ}/{p.unitCount})</div>
          <div style={{ fontSize: 12, marginBottom: 2 }}>Vacant Units: <b>{p.unitCount - p.occ}</b></div>
          <div style={{ fontSize: 12, marginBottom: 2 }}>Unpaid Rent: <b>KES {(p.unpaid || 0).toLocaleString()}</b></div>
          {p.caretakerName && <div style={{ fontSize: 12 }}>Caretaker: {p.caretakerName}</div>}
        </div>
      </Popup>
    </Marker>
  );
}

function PropertyMap({ properties, isDark }) {
  const [expanded, setExpanded] = useState(false);
  const withCoords = spreadOverlappingCoords(properties.filter(p => p.gps_lat != null && p.gps_lng != null));

  const shellStyle = { background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
  const headerStyle = { padding: '14px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
  const titleStyle = { fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 14, color: isDark ? 'var(--blue, #2563eb)' : 'var(--text)' };
  const expandBtnStyle = {
    border: '1px solid var(--border)', background: 'var(--surface2)', borderRadius: 7, padding: '4px 9px',
    fontSize: 12, fontWeight: 600, color: 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
  };

  // Esc closes the fullscreen map, same as clicking its close button
  useEffect(() => {
    if (!expanded) return;
    function handleKeyDown(e) { if (e.key === 'Escape') setExpanded(false); }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expanded]);

  if (withCoords.length === 0) {
    return (
      <div style={shellStyle}>
        <div style={headerStyle}><h2 style={titleStyle}>Property Map</h2></div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 12, lineHeight: 1.5 }}>
          No property coordinates yet.<br />Run the geocode backfill, or add a location the next time you create/edit a plot.
        </div>
      </div>
    );
  }

  const center = [
    withCoords.reduce((s, p) => s + p.mapLat, 0) / withCoords.length,
    withCoords.reduce((s, p) => s + p.mapLng, 0) / withCoords.length,
  ];

  // CARTO's free basemap URL now requires an API key (tiles come back
  // watermarked "API KEY REQUIRED"), so both themes use OpenStreetMap tiles.
  // Dark mode darkens them with a CSS filter on the tile layer only, so
  // markers and popups keep their normal colours.
  const tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileClass = isDark ? 'rf-tiles-dark' : '';
  const tileAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  return (
    <>
      <style>{`.rf-tiles-dark { filter: invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.9); }`}</style>
      <div style={shellStyle}>
        <div style={headerStyle}>
          <h2 style={titleStyle}>Property Map</h2>
          <button onClick={() => setExpanded(true)} style={expandBtnStyle} title="Enlarge map">⛶ Enlarge</button>
        </div>
        {!expanded && (
          <div style={{ flex: 1, minHeight: 260 }}>
            <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
              <TileLayer key={tileClass || 'light'} url={tileUrl} className={tileClass} attribution={tileAttribution} />
              {withCoords.map(p => <HoverMarker key={p.id} p={p} isDark={isDark} />)}
            </MapContainer>
          </div>
        )}
      </div>

      {expanded && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, width: '100%', height: '100%', maxWidth: 1400, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <h2 style={{ ...titleStyle, fontSize: 17 }}>Property Map</h2>
              <button onClick={() => setExpanded(false)} style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'var(--surface2)', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}>×</button>
            </div>
            <div style={{ flex: 1 }}>
              {/* Fresh MapContainer instance rather than resizing the small one —
                  Leaflet caches tile-grid size at mount and doesn't reliably
                  pick up a container resize without an explicit invalidateSize()
                  call, so a new instance avoids that entirely. */}
              <MapContainer center={center} zoom={14} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true}>
                <TileLayer key={tileClass || 'light'} url={tileUrl} className={tileClass} attribution={tileAttribution} />
                {withCoords.map(p => <HoverMarker key={p.id} p={p} isDark={isDark} />)}
              </MapContainer>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Table({ headers, rows }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: 'var(--surface2)' }}>
          {headers.map(h => <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>)}
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

function TR({ cells, i, failed, pending }) {
  const rowBg = i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)';
  return (
    <tr style={{
      borderTop: '1px solid var(--border)',
      background: rowBg,
      opacity: failed ? 0.75 : 1,
    }}>
      {cells.map((c, j) => <td key={j} style={{ padding: '12px 20px', fontSize: 14, ...c.style }}>{c.value}</td>)}
    </tr>
  );
}

export default function Dashboard() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(null);
  const [unpaidMonths,  setUnpaidMonths]  = useState([]);
  const [unpaidLoading, setUnpaidLoading] = useState(false);
  const [rejectTarget,  setRejectTarget]  = useState(null); // house being rejected
  const [rejectReason,  setRejectReason]  = useState('');
  const isDark = useIsDarkMode();
  const navigate = useNavigate();

  useEffect(() => {
    async function load() {
      try {
        // Expire any stale pending STK rows before loading
        await API.post('/mpesa/expire-pending').catch(() => {});

        // Promise.allSettled, not Promise.all — a role that's blocked from
        // one endpoint (e.g. payments.view not granted to a profile) should
        // still see everything else on the dashboard, not a total failure.
        // Same fix already applied to Notices.jsx for the same reason.
        const [tr, pr, hr, mr, plr, ur] = await Promise.allSettled([
          API.get('/tenants'),
          API.get('/payments'),
          API.get('/houses'),
          API.get('/maintenance'),
          API.get('/plots'),
          API.get('/auth/users'),
        ]);
        const unwrap = (settled) => settled.status === 'fulfilled' ? settled.value : { data: { data: [] } };
        const [trv, prv, hrv, mrv, plrv, urv] = [tr, pr, hr, mr, plr, ur].map(unwrap);

        const tenants  = Array.isArray(trv.data)  ? trv.data  : (trv.data.data  || []);
        const payments = Array.isArray(prv.data)  ? prv.data  : (prv.data.data  || []);
        const houses   = Array.isArray(hrv.data)  ? hrv.data  : (hrv.data.data  || []);
        const requests = Array.isArray(mrv.data)  ? mrv.data  : (mrv.data.data  || []);
        const plots    = Array.isArray(plrv.data) ? plrv.data : (plrv.data.data || []);
        const users    = Array.isArray(urv.data)  ? urv.data  : (urv.data.data  || []);

        const now       = new Date();
        const thisMonth = payments.filter(p => {
          const d = new Date(p.payment_date);
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        });

        const elevenMonthsAgo = new Date();
        elevenMonthsAgo.setMonth(elevenMonthsAgo.getMonth() - 11);

        // Exclude failed/pending from revenue totals
        const validPayments = payments.filter(p => p.status !== 'failed' && p.status !== 'pending');
        const validThisMonth = thisMonth.filter(p => p.status !== 'failed' && p.status !== 'pending');

        const caretakers = users.filter(u => u.role === 'caretaker');

        setData({
          tenants, payments, houses, requests, plots, users, caretakers,
          activeTenants:   tenants.filter(t => t.is_active),
          unpaidTenants:   tenants.filter(t => t.is_active && parseFloat(t.balance || 0) > 0),
          occupiedHouses:  houses.filter(h => h.status === 'occupied'),
          vacantHouses:    houses.filter(h => h.status === 'vacant'),
          pendingRequests: requests.filter(r => r.status === 'pending'),
          pendingUnits:    houses.filter(h => h.is_approved !== true),
          expiringLeases:  tenants.filter(t => t.is_active && t.move_in_date && new Date(t.move_in_date) <= elevenMonthsAgo),
          monthRevenue:    validThisMonth.reduce((s, p) => s + parseFloat(p.amount || 0), 0),
          totalRevenue:    validPayments.reduce((s, p) => s + parseFloat(p.amount || 0), 0),
          thisMonth,
        });
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'var(--muted)' }}>
      Loading dashboard...
    </div>
  );

  if (!data) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'var(--red)' }}>
      Failed to load dashboard data. Please refresh the page.
    </div>
  );

  const { payments, houses, plots, caretakers,
    activeTenants, unpaidTenants, occupiedHouses, vacantHouses,
    pendingRequests, pendingUnits, expiringLeases, monthRevenue, totalRevenue, thisMonth } = data;

  const occupancyRate = houses.length > 0 ? Math.round((occupiedHouses.length / houses.length) * 100) : 0;
  const totalUnpaid   = unpaidTenants.reduce((s, t) => s + parseFloat(t.balance || 0), 0);

  // ── Derived data for the charts/widgets below (all computed from data
  // already loaded — no extra API calls) ──

  // Monthly revenue trend, last 6 months. Excludes failed/pending payments,
  // same rule used everywhere else for revenue totals.
  const validPayments = payments.filter(p => p.status !== 'failed' && p.status !== 'pending');
  const revenueTrend = Array.from({ length: 6 }).map((_, idx) => {
    const d = new Date();
    d.setDate(1); // avoid month-length rollover bugs
    d.setMonth(d.getMonth() - (5 - idx));
    const total = validPayments
      .filter(p => { const pd = new Date(p.payment_date); return pd.getMonth() === d.getMonth() && pd.getFullYear() === d.getFullYear(); })
      .reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    return { month: d.toLocaleString('en-KE', { month: 'short' }), revenue: total };
  });
  const revenueThisMonth = revenueTrend[revenueTrend.length - 1]?.revenue || 0;
  const revenueLastMonth = revenueTrend[revenueTrend.length - 2]?.revenue || 0;
  const revenueChangePct = revenueLastMonth > 0 ? Math.round(((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100) : null;

  // Unpaid rent grouped by property (top 5 by amount owed)
  const unpaidByPlot = {};
  unpaidTenants.forEach(t => {
    const house = houses.find(h => h.id === t.house_id);
    const plot  = plots.find(p => p.id === house?.plot_id);
    const name  = plot?.name || 'Unassigned';
    unpaidByPlot[name] = (unpaidByPlot[name] || 0) + parseFloat(t.balance || 0);
  });
  const unpaidByPlotData = Object.entries(unpaidByPlot)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  // Pending dues — tenants owing rent, with an approximate "months behind"
  // (balance ÷ their unit's rent). Approximate, not a precise day count.
  const pendingDues = unpaidTenants.map(t => {
    const house = houses.find(h => h.id === t.house_id);
    const rent  = parseFloat(house?.rent_amount || 0) || 1;
    return { ...t, monthsBehind: Math.max(1, Math.round(parseFloat(t.balance || 0) / rent)) };
  }).sort((a, b) => parseFloat(b.balance || 0) - parseFloat(a.balance || 0)).slice(0, 6);

  // Properties overview (stands in for the map — real per-property stats
  // without needing lat/lng data or a mapping library)
  const propertiesOverview = plots.map(p => {
    const plotHouses  = houses.filter(h => h.plot_id === p.id);
    const occ         = plotHouses.filter(h => h.status === 'occupied').length;
    const rate        = plotHouses.length > 0 ? Math.round((occ / plotHouses.length) * 100) : 0;
    const plotUnpaid  = unpaidByPlot[p.name] || 0;
    const caretaker   = caretakers.find(c => c.plot_id === p.id);
    return { ...p, unitCount: plotHouses.length, occ, rate, unpaid: plotUnpaid, caretakerName: caretaker?.name };
  });

  const OCC_COLORS = isDark ? ['#34d399', '#fbbf24'] : ['#16a34a', '#d97706'];

  // Helper to render a payment row with failed/pending styling
  function PaymentRow(p, i) {
    const isFailed  = p.status === 'failed';
    const isPending = p.status === 'pending';
    // Explicit hex fallbacks baked in via CSS var(--x, fallback) syntax, so the
    // colors show correctly even if --red/--green/--amber aren't defined (or are
    // misdefined) in index.css.
    const RED = 'var(--red, #dc2626)', RED_L = 'var(--red-light, #fee2e2)';
    const GREEN = 'var(--green, #16a34a)', GREEN_L = 'var(--green-light, #dcfce7)';
    const AMBER = 'var(--amber, #d97706)', AMBER_L = 'var(--amber-light, #fef3c7)';
    const BLUE = 'var(--blue, #2563eb)', BLUE_L = 'var(--blue-light, #dbeafe)';
    const PRIMARY = 'var(--primary, #7c3aed)', PRIMARY_L = 'var(--primary-light, #ede9fe)';
    const GREY = 'var(--muted, #6b7280)', GREY_L = 'var(--surface2, #f3f4f6)';

    const statusColor = isFailed ? RED : isPending ? AMBER : GREEN;
    const statusLight = isFailed ? RED_L : isPending ? AMBER_L : GREEN_L;
    const method = (p.method || 'mpesa').toLowerCase();
    const methodColor = method === 'mpesa' ? GREEN : method === 'bank' ? BLUE : method === 'cash' ? PRIMARY : GREY;
    const methodLight  = method === 'mpesa' ? GREEN_L : method === 'bank_transfer' ? BLUE_L : method === 'cash' ? PRIMARY_L : GREY_L;
    return (
      <TR key={p.id} i={i} failed={isFailed} pending={isPending} cells={[
        { value: p.tenant_name || '—', style: { fontWeight: 600, color: isDark ? 'var(--blue, #2563eb)' : 'var(--text)' } },
        { value: `KES ${parseFloat(p.amount).toLocaleString()}`, style: { fontWeight: 700, color: isFailed ? RED : isPending ? AMBER : GREEN, textDecoration: isFailed ? 'line-through' : 'none' } },
        { value: <span style={{ background: methodLight, color: methodColor, padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{p.method || 'mpesa'}</span> },
        { value: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: statusLight, color: statusColor, padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700, textTransform: 'capitalize' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
            {p.status}
          </span>
        ) },
        { value: new Date(p.payment_date).toLocaleDateString('en-KE'), style: { color: isDark ? '#2dd4bf' : 'var(--muted)', fontWeight: 700 } },
      ]} />
    );
  }

  return (
    <div style={{ marginTop: -24 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{
          fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 800, marginBottom: 6,
          color: 'var(--primary, #7c3aed)', display: 'inline-flex', alignItems: 'center', gap: 10,
        }}>
          Dashboard
          <span style={{ display: 'inline-block', width: 34, height: 5, borderRadius: 99, background: 'linear-gradient(90deg, var(--primary, #7c3aed), var(--blue, #2563eb))' }} />
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>Welcome back. Here's what's happening today.</p>
      </div>



      {/* Stats Grid + Property Map */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 28, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 600px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
          <StatCard label="Active Tenants"    value={activeTenants.length}   icon="👥" colorKey="primary" onClick={() => setModal('tenants')} />
          <StatCard label="Occupied Units"    value={occupiedHouses.length}  icon="🏠" colorKey="green"   onClick={() => setModal('occupied')} />
          <StatCard label="Vacant Units"      value={vacantHouses.length}    icon="🔑" colorKey="amber"   onClick={() => setModal('vacant')} />
          <StatCard label="Revenue (Month)"   value={`KES ${monthRevenue.toLocaleString()}`}  icon="💰" colorKey="blue"    onClick={() => setModal('revenue')} />
          <StatCard label="Unpaid Rent"       value={`KES ${totalUnpaid.toLocaleString()}`}   icon="⚠️" colorKey="red"     onClick={() => setModal('unpaid')}  sub={`${unpaidTenants.length} tenant${unpaidTenants.length !== 1 ? 's' : ''}`} />
          <StatCard label="Total Revenue"     value={`KES ${totalRevenue.toLocaleString()}`}  icon="📈" colorKey="blue"    onClick={() => setModal('allrevenue')} />
          <StatCard label="Maintenance"       value={pendingRequests.length} icon="🔧" colorKey="primary" onClick={() => setModal('maintenance')} sub="pending requests" />
          {pendingUnits?.filter(h => !h.rejection_reason).length > 0 && (
            <StatCard label="Pending Units" value={pendingUnits.filter(h => !h.rejection_reason).length} icon="⏳" colorKey="red" onClick={() => setModal('pending_units')} sub="awaiting approval" />
          )}
          <StatCard label="Total Properties"  value={plots.length}           icon="🏢" colorKey="primary" onClick={() => setModal('plots')} sub={`${houses.length} total units`} />
          <StatCard label="Expiring Leases"   value={expiringLeases.length}  icon="📅" colorKey="amber"   onClick={() => setModal('expiring')} sub="11+ months tenancy" />
          {caretakers.length > 0 && (
            <StatCard label="Caretaker Workload" value={caretakers.length} icon="🧑‍🔧" colorKey="green" onClick={() => setModal('caretakers')} sub={`across ${plots.length} plot${plots.length !== 1 ? 's' : ''}`} />
          )}
        </div>
        <div style={{ flex: '0 0 300px', minHeight: 300 }}>
          <PropertyMap properties={propertiesOverview} isDark={isDark} />
        </div>
      </div>

      {/* Analytics row: Monthly Revenue + Occupancy Rate */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginBottom: 16 }}>
        <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: '20px 24px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 16, color: isDark ? 'var(--blue, #2563eb)' : 'var(--text)' }}>Monthly Revenue</h2>
            {revenueChangePct !== null && (
              <span style={{ fontSize: 12, fontWeight: 700, color: revenueChangePct >= 0 ? (isDark ? '#34d399' : '#16a34a') : (isDark ? '#f87171' : '#dc2626') }}>
                {revenueChangePct >= 0 ? '▲' : '▼'} {Math.abs(revenueChangePct)}% vs last month
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={revenueTrend} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? 'rgba(255,255,255,0.08)' : '#e2e8f0'} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: isDark ? 'rgba(255,255,255,0.5)' : '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: isDark ? 'rgba(255,255,255,0.4)' : '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} width={40} />
              <Tooltip formatter={v => [`KES ${Number(v).toLocaleString()}`, 'Revenue']} contentStyle={{ background: isDark ? '#242a3d' : '#fff', border: isDark ? '1px solid #383f57' : '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }} labelStyle={{ color: isDark ? '#f1f5f9' : '#0f172a' }} />
              <Line type="monotone" dataKey="revenue" stroke={isDark ? '#60a5fa' : '#2563eb'} strokeWidth={2.5} dot={{ r: 4, fill: isDark ? '#60a5fa' : '#2563eb' }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div onClick={() => setModal('occupancy')} style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: '20px 24px', display: 'flex', flexDirection: 'column', cursor: 'pointer', minWidth: 0 }}>
          <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 16, color: isDark ? 'var(--blue, #2563eb)' : 'var(--text)', marginBottom: 8 }}>Occupancy Rate <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>(click for details)</span></h2>
          <div style={{ position: 'relative', flex: 1, minHeight: 180 }}>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={[{ name: 'Occupied', value: occupiedHouses.length }, { name: 'Vacant', value: vacantHouses.length }]}
                  dataKey="value" innerRadius={55} outerRadius={78} paddingAngle={3} stroke="none">
                  <Cell fill={OCC_COLORS[0]} />
                  <Cell fill={OCC_COLORS[1]} />
                </Pie>
                <Tooltip formatter={(v, n) => [v, n]} contentStyle={{ background: isDark ? '#242a3d' : '#fff', border: isDark ? '1px solid #383f57' : '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
              <div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 24, color: isDark ? '#f1f5f9' : '#0f172a' }}>{occupancyRate}%</div>
              <div style={{ fontSize: 11, color: isDark ? 'rgba(255,255,255,0.45)' : '#94a3b8' }}>{occupiedHouses.length} / {houses.length} units</div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: isDark ? '#f1f5f9' : '#0f172a' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: OCC_COLORS[0] }} /> Occupied ({occupiedHouses.length})
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: isDark ? '#f1f5f9' : '#0f172a' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: OCC_COLORS[1] }} /> Vacant ({vacantHouses.length})
            </div>
          </div>
        </div>
      </div>

      {/* Unpaid Rent by Property */}
      {unpaidByPlotData.length > 0 && (
        <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: '20px 24px', marginBottom: 16, minWidth: 0 }}>
          <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 16, color: isDark ? 'var(--blue, #2563eb)' : 'var(--text)', marginBottom: 16 }}>Unpaid Rent by Property</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={unpaidByPlotData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? 'rgba(255,255,255,0.08)' : '#e2e8f0'} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: isDark ? 'rgba(255,255,255,0.5)' : '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: isDark ? 'rgba(255,255,255,0.4)' : '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} width={40} />
              <Tooltip formatter={v => [`KES ${Number(v).toLocaleString()}`, 'Unpaid']} contentStyle={{ background: isDark ? '#242a3d' : '#fff', border: isDark ? '1px solid #383f57' : '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }} labelStyle={{ color: isDark ? '#f1f5f9' : '#0f172a' }} />
              <Bar dataKey="amount" fill={isDark ? '#f87171' : '#dc2626'} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Properties Overview — stands in for a map (no lat/lng data or mapping
          library set up yet); shows the same at-a-glance info per property */}
      {propertiesOverview.length > 0 && (
        <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
            <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 16, color: isDark ? 'var(--blue, #2563eb)' : 'var(--text)' }}>Properties Overview</h2>
          </div>
          <div style={{ display: 'flex', gap: 14, overflowX: 'auto', padding: 20 }}>
            {propertiesOverview.map(p => (
              <div key={p.id} onClick={() => setModal('plots')} style={{
                minWidth: 220, flexShrink: 0, borderRadius: 12, padding: 16, cursor: 'pointer',
                background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc', border: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid #e2e8f0',
              }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: isDark ? '#f1f5f9' : '#0f172a', marginBottom: 4 }}>{p.name}</div>
                <div style={{ fontSize: 11, color: isDark ? 'rgba(255,255,255,0.45)' : '#94a3b8', marginBottom: 12 }}>
                  {p.caretakerName ? `Caretaker: ${p.caretakerName}` : 'No caretaker assigned'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <div>
                    <div style={{ color: isDark ? 'rgba(255,255,255,0.4)' : '#94a3b8', fontSize: 10, textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>Occupancy</div>
                    <div style={{ fontWeight: 800, color: isDark ? '#34d399' : '#16a34a' }}>{p.rate}%</div>
                  </div>
                  <div>
                    <div style={{ color: isDark ? 'rgba(255,255,255,0.4)' : '#94a3b8', fontSize: 10, textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>Units</div>
                    <div style={{ fontWeight: 800, color: isDark ? '#f1f5f9' : '#0f172a' }}>{p.unitCount}</div>
                  </div>
                  <div>
                    <div style={{ color: isDark ? 'rgba(255,255,255,0.4)' : '#94a3b8', fontSize: 10, textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>Unpaid</div>
                    <div style={{ fontWeight: 800, color: p.unpaid > 0 ? (isDark ? '#f87171' : '#dc2626') : (isDark ? '#34d399' : '#16a34a') }}>
                      {p.unpaid > 0 ? `KES ${p.unpaid.toLocaleString()}` : 'KES 0'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Payments + Pending Dues */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16, marginBottom: 16 }}>
        <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', borderTop: '3px solid var(--primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 16, color: isDark ? 'var(--blue, #2563eb)' : 'var(--text)' }}>Recent Payments</h2>
            {payments.length > 0 && (
              <span style={{ background: isDark ? 'rgba(37,99,235,0.18)' : 'var(--primary-light)', color: isDark ? 'var(--blue, #2563eb)' : 'var(--primary)', fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 99 }}>{payments.length}</span>
            )}
          </div>
          {payments.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>No payments recorded yet.</div>
          ) : (
            <Table
              headers={['Tenant', 'Amount', 'Method', 'Status', 'Date']}
              rows={payments.slice(0, 6).map((p, i) => PaymentRow(p, i))}
            />
          )}
        </div>

        <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', borderTop: '3px solid var(--red, #dc2626)' }}>
            <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 16, color: isDark ? 'var(--blue, #2563eb)' : 'var(--text)' }}>Pending Dues</h2>
          </div>
          {pendingDues.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Everyone's paid up. 🎉</div>
          ) : (
            <div>
              {pendingDues.map((t, i) => (
                <div key={t.id} onClick={() => setModal('unpaid')} style={{
                  padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
                  borderBottom: i < pendingDues.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: isDark ? '#f1f5f9' : '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.full_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>KES {parseFloat(t.balance).toLocaleString()} owed</div>
                  </div>
                  <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: isDark ? 'rgba(248,113,113,0.15)' : '#fee2e2', color: isDark ? '#f87171' : '#dc2626' }}>
                    {t.monthsBehind} mo{t.monthsBehind !== 1 ? 's' : ''} behind
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/tenants')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 10, border: 'none', background: 'var(--primary, #7c3aed)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          + Add Tenant
        </button>
        <button onClick={() => navigate('/payments')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          💳 Record Payment
        </button>
        <button onClick={() => navigate('/users')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          🧑‍🔧 Assign Caretaker
        </button>
        <button onClick={() => navigate('/reports')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          📄 Export Report
        </button>
      </div>

      {/* ── Modals ── */}

      {modal === 'tenants' && (
        <Modal title={`Active Tenants (${activeTenants.length})`} onClose={() => setModal(null)}>
          {activeTenants.length === 0 ? (
            <EmptyState icon="👥" title="No Active Tenants" sub="Tenants will show up here once added." />
          ) : (
            <>
              <SummaryBar isDark={isDark} stats={[
                { label: 'Active Tenants', value: activeTenants.length, color: '#34d399' },
                { label: 'Owing Rent',     value: activeTenants.filter(t => parseFloat(t.balance || 0) > 0).length, color: '#f87171' },
                { label: 'Paid Up',        value: activeTenants.filter(t => parseFloat(t.balance || 0) <= 0).length, color: '#60a5fa' },
                { label: 'Total Owed',     value: `KES ${activeTenants.reduce((s, t) => s + parseFloat(t.balance || 0), 0).toLocaleString()}`, color: '#fbbf24' },
              ]} />
              <div>
                {activeTenants.map((t, i) => {
                  const owing = parseFloat(t.balance || 0) > 0;
                  return (
                    <ListCard key={t.id} i={i} isDark={isDark}
                      avatarIcon={initialsOf(t.full_name)}
                      avatarBg={isDark ? 'rgba(124,58,237,0.2)' : '#ede9fe'} avatarBorder={isDark ? '1.5px solid rgba(124,58,237,0.4)' : '1.5px solid #c4b5fd'} avatarColor={isDark ? '#c4b5fd' : '#7c3aed'}
                      title={t.full_name} subtitle={t.phone || t.email || `Unit ${t.unit_number || t.house_id}`}
                      badge={<Badge isDark={isDark} tone={owing ? 'red' : 'green'} label={owing ? `KES ${parseFloat(t.balance).toLocaleString()} owed` : 'Paid Up'} />}
                    >
                      <MetricsGrid isDark={isDark} metrics={[
                        { label: 'Unit', value: t.unit_number || `#${t.house_id}`, icon: '🏠', color: isDark ? '#f1f5f9' : '#0f172a' },
                        { label: 'Email', value: t.email || '—', icon: '✉️', color: isDark ? '#f1f5f9' : '#0f172a', small: true },
                        { label: 'Move-in', value: t.move_in_date ? new Date(t.move_in_date).toLocaleDateString('en-KE') : '—', icon: '📅', color: isDark ? '#f1f5f9' : '#0f172a' },
                      ]} />
                    </ListCard>
                  );
                })}
              </div>
            </>
          )}
          <SeeMoreFooter onClick={() => navigate('/tenants')} />
        </Modal>
      )}

      {modal === 'pending_units' && (
        <Modal title="Units Pending Approval" onClose={() => { setModal(null); setRejectTarget(null); setRejectReason(''); }}>
          {houses.filter(h => h.is_approved !== true && !h.rejection_reason).length === 0 ? (
            <EmptyState icon="✅" title="Nothing Pending" sub="All units have been reviewed." />
          ) : (
            <>
              <SummaryBar isDark={isDark} stats={[
                { label: 'Pending Units', value: houses.filter(h => h.is_approved !== true && !h.rejection_reason).length, color: '#fbbf24' },
              ]} />
              <div>
                {houses.filter(h => h.is_approved !== true && !h.rejection_reason).map((h, i) => (
                  <ListCard key={h.id} i={i} isDark={isDark}
                    avatarIcon="🏠"
                    avatarBg={isDark ? 'rgba(251,191,36,0.15)' : '#fef3c7'} avatarBorder={isDark ? '1.5px solid rgba(251,191,36,0.35)' : '1.5px solid #fcd34d'} avatarColor={isDark ? '#fbbf24' : '#d97706'}
                    title={`Unit ${h.unit_number} — ${h.house_type}`}
                    subtitle={`${h.plot_name} · KES ${parseFloat(h.rent_amount).toLocaleString()}/mo`}
                    badge={
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={async () => {
                          await API.patch(`/houses/${h.id}/approve`);
                          setData(d => ({ ...d, houses: d.houses.map(x => x.id === h.id ? { ...x, is_approved: true } : x) }));
                        }} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: 'var(--green)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          ✓ Approve
                        </button>
                        <button onClick={() => { setRejectTarget(h); setRejectReason(''); }}
                          style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: 'var(--red-light)', color: 'var(--red)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          ✗ Reject
                        </button>
                      </div>
                    }
                  >
                    {/* Inline reject reason input */}
                    {rejectTarget?.id === h.id && (
                      <div style={{ marginTop: 4, display: 'flex', gap: 8 }}>
                        <input
                          value={rejectReason}
                          onChange={e => setRejectReason(e.target.value)}
                          placeholder="Reason for rejection (optional)..."
                          style={{ flex: 1, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13, color: 'var(--text)', outline: 'none' }}
                        />
                        <button onClick={async () => {
                          await API.patch(`/houses/${h.id}/reject`, { reason: rejectReason });
                          setData(d => ({ ...d, houses: d.houses.map(x => x.id === h.id ? { ...x, is_approved: false, rejection_reason: rejectReason || 'Rejected' } : x) }));
                          setRejectTarget(null); setRejectReason('');
                        }} style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: 'var(--red)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          Confirm
                        </button>
                        <button onClick={() => setRejectTarget(null)}
                          style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, cursor: 'pointer', color: 'var(--muted)' }}>
                          Cancel
                        </button>
                      </div>
                    )}
                  </ListCard>
                ))}
              </div>
            </>
          )}
          <SeeMoreFooter onClick={() => navigate('/properties')} />
        </Modal>
      )}

      {modal === 'unpaid' && (() => {
        // Fetch breakdown on first open
        if (unpaidMonths.length === 0 && !unpaidLoading) {
          setUnpaidLoading(true);
          API.get('/tenants/unpaid-months')
            .then(r => setUnpaidMonths(r.data.data || []))
            .catch(() => {})
            .finally(() => setUnpaidLoading(false));
        }
        return null;
      })()}

      {modal === 'unpaid' && (
        <Modal title={`Unpaid Rent — KES ${totalUnpaid.toLocaleString()}`} onClose={() => { setModal(null); setUnpaidMonths([]); }}>
          {unpaidLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading breakdown...</div>
          ) : unpaidMonths.length === 0 ? (
            <EmptyState icon="🎉" title="All Tenants Are Up To Date" />
          ) : (
            <>
              <SummaryBar isDark={isDark} stats={[
                { label: 'Tenants Owing', value: unpaidMonths.length, color: '#f87171' },
                { label: 'Total Owed', value: `KES ${totalUnpaid.toLocaleString()}`, color: '#fbbf24' },
              ]} />
              <div>
                {unpaidMonths.map((t, i) => {
                  const owed = t.unpaid_months?.reduce((s, m) => s + (m.balance ?? m.rent ?? 0), 0) || 0;
                  return (
                    <ListCard key={t.tenant_id} i={i} isDark={isDark}
                      avatarIcon={initialsOf(t.full_name)}
                      avatarBg={isDark ? 'rgba(248,113,113,0.15)' : '#fee2e2'} avatarBorder={isDark ? '1.5px solid rgba(248,113,113,0.3)' : '1.5px solid #fca5a5'} avatarColor={isDark ? '#f87171' : '#dc2626'}
                      title={t.full_name} subtitle={`Unit ${t.unit_number || t.house_id} · ${t.phone || '—'}`}
                      badge={<Badge isDark={isDark} tone="red" label={`KES ${owed.toLocaleString()} owed`} />}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {(t.unpaid_months || []).map(m => {
                          const isPartial = m.partial;
                          const monthLabel = new Date(m.year, m.month - 1, 1).toLocaleString('en-KE', { month: 'short', year: 'numeric' });
                          return (
                            <Badge key={`${m.year}-${m.month}`} isDark={isDark} tone={isPartial ? 'amber' : 'red'}
                              label={`${monthLabel}${isPartial ? ` · partial · KES ${(m.balance ?? 0).toLocaleString()} left` : ` · KES ${(m.balance ?? m.rent ?? 0).toLocaleString()}`}`} />
                          );
                        })}
                      </div>
                    </ListCard>
                  );
                })}
              </div>
            </>
          )}
          <SeeMoreFooter onClick={() => navigate('/tenants')} />
        </Modal>
      )}

      {modal === 'occupied' && (
        <Modal title={`Occupied Units (${occupiedHouses.length})`} onClose={() => setModal(null)}>
          {occupiedHouses.length === 0 ? (
            <EmptyState icon="🏠" title="No Occupied Units" />
          ) : (
            <>
              <SummaryBar isDark={isDark} stats={[
                { label: 'Occupied Units', value: occupiedHouses.length, color: '#34d399' },
                { label: 'Rent/mo Collected', value: `KES ${occupiedHouses.reduce((s, h) => s + parseFloat(h.rent_amount || 0), 0).toLocaleString()}`, color: '#60a5fa' },
                { label: 'Plots Covered', value: new Set(occupiedHouses.map(h => h.plot_id)).size, color: '#fbbf24' },
              ]} />
              <div>
                {occupiedHouses.map((h, i) => (
                  <ListCard key={h.id} i={i} isDark={isDark}
                    avatarIcon="🏠"
                    avatarBg={isDark ? 'rgba(52,211,153,0.15)' : '#dcfce7'} avatarBorder={isDark ? '1.5px solid rgba(52,211,153,0.35)' : '1.5px solid #86efac'} avatarColor={isDark ? '#34d399' : '#16a34a'}
                    title={`Unit ${h.unit_number}`} subtitle={h.plot_name || '—'}
                    badge={<Badge isDark={isDark} tone="blue" label={h.house_type} />}
                  >
                    <MetricsGrid isDark={isDark} metrics={[
                      { label: 'Rent/mo', value: `KES ${parseFloat(h.rent_amount).toLocaleString()}`, icon: '💰', color: isDark ? '#34d399' : '#16a34a' },
                    ]} />
                  </ListCard>
                ))}
              </div>
            </>
          )}
          <SeeMoreFooter onClick={() => navigate('/properties')} />
        </Modal>
      )}

      {modal === 'vacant' && (
        <Modal title={`Vacant Units (${vacantHouses.length})`} onClose={() => setModal(null)}>
          {vacantHouses.length === 0 ? (
            <EmptyState icon="🔑" title="No Vacant Units" />
          ) : (
            <>
              <SummaryBar isDark={isDark} stats={[
                { label: 'Vacant Units', value: vacantHouses.length, color: '#fbbf24' },
                { label: 'Potential Rent/mo', value: `KES ${vacantHouses.reduce((s, h) => s + parseFloat(h.rent_amount || 0), 0).toLocaleString()}`, color: '#60a5fa' },
                { label: 'Total Deposits', value: `KES ${vacantHouses.reduce((s, h) => s + parseFloat(h.deposit || 0), 0).toLocaleString()}`, color: '#34d399' },
              ]} />
              <div>
                {vacantHouses.map((h, i) => (
                  <ListCard key={h.id} i={i} isDark={isDark}
                    avatarIcon="🔑"
                    avatarBg={isDark ? 'rgba(251,191,36,0.15)' : '#fef3c7'} avatarBorder={isDark ? '1.5px solid rgba(251,191,36,0.35)' : '1.5px solid #fcd34d'} avatarColor={isDark ? '#fbbf24' : '#d97706'}
                    title={`Unit ${h.unit_number}`} subtitle={h.plot_name || '—'}
                    badge={<Badge isDark={isDark} tone="blue" label={h.house_type} />}
                  >
                    <MetricsGrid isDark={isDark} metrics={[
                      { label: 'Rent/mo', value: `KES ${parseFloat(h.rent_amount).toLocaleString()}`, icon: '💰', color: isDark ? '#34d399' : '#16a34a' },
                      { label: 'Deposit', value: `KES ${parseFloat(h.deposit || 0).toLocaleString()}`, icon: '🔒', color: isDark ? '#f1f5f9' : '#0f172a' },
                    ]} />
                  </ListCard>
                ))}
              </div>
            </>
          )}
          <SeeMoreFooter onClick={() => navigate('/properties')} />
        </Modal>
      )}

      {modal === 'revenue' && (
        <Modal title={`This Month's Payments (${thisMonth.length})`} onClose={() => setModal(null)}>
          <div style={{ padding: '14px 24px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 32 }}>
            <div><div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>TOTAL</div><div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 20, color: 'var(--green)' }}>KES {monthRevenue.toLocaleString()}</div></div>
            <div><div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>TRANSACTIONS</div><div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 20, color: 'var(--blue)' }}>{thisMonth.length}</div></div>
          </div>
          <Table headers={['Tenant', 'Amount', 'Method', 'Status', 'Date']} rows={thisMonth.map((p, i) => PaymentRow(p, i))} />
          <SeeMoreFooter onClick={() => navigate('/payments')} />
        </Modal>
      )}

      {modal === 'allrevenue' && (
        <Modal title={`All Time Revenue — KES ${totalRevenue.toLocaleString()}`} onClose={() => setModal(null)}>
          <div style={{ padding: '14px 24px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 32 }}>
            <div><div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>TOTAL COLLECTED</div><div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 20, color: 'var(--red, #dc2626)' }}>KES {totalRevenue.toLocaleString()}</div></div>
            <div><div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>TOTAL TRANSACTIONS</div><div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 20, color: 'var(--red, #dc2626)' }}>{payments.length}</div></div>
          </div>
          <Table headers={['Tenant', 'Amount', 'Method', 'Status', 'Date']} rows={payments.map((p, i) => PaymentRow(p, i))} />
          <SeeMoreFooter onClick={() => navigate('/payments')} />
        </Modal>
      )}

      {modal === 'maintenance' && (
        <Modal title={`Pending Maintenance (${pendingRequests.length})`} onClose={() => setModal(null)}>
          <Table headers={['#', 'Issue', 'Priority', 'Reported']} rows={pendingRequests.map((r, i) => (
            <TR key={r.id} i={i} cells={[
              { value: `#${r.id}`, style: { color: 'var(--muted)', fontSize: 12 } },
              { value: r.issue, style: { fontWeight: 600, color: 'var(--text)' } },
              { value: <span style={{ background: r.priority === 'high' ? 'var(--red-light)' : r.priority === 'medium' ? 'var(--amber-light)' : 'var(--blue-light)', color: r.priority === 'high' ? 'var(--red)' : r.priority === 'medium' ? 'var(--amber)' : 'var(--blue)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>{r.priority}</span> },
              { value: new Date(r.reported_at).toLocaleDateString('en-KE'), style: { color: 'var(--muted)' } },
            ]} />
          ))} />
          <SeeMoreFooter onClick={() => navigate('/maintenance')} />
        </Modal>
      )}

      {modal === 'occupancy' && (
        <Modal title={`Occupancy Rate — ${occupancyRate}%`} onClose={() => setModal(null)}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
            <div style={{ display: 'flex', gap: 32, marginBottom: 16 }}>
              <div><div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>OCCUPIED</div><div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 20, color: 'var(--green)' }}>{occupiedHouses.length}</div></div>
              <div><div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>VACANT</div><div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 20, color: 'var(--amber)' }}>{vacantHouses.length}</div></div>
              <div><div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>TOTAL</div><div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 20, color: 'var(--blue)' }}>{houses.length}</div></div>
            </div>
            <div style={{ height: 12, borderRadius: 99, background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${occupancyRate}%`, background: 'linear-gradient(90deg, var(--green), #34d399)', borderRadius: 99, transition: 'width 0.5s' }} />
            </div>
          </div>
          <Table headers={['Unit', 'Type', 'Rent/mo', 'Plot', 'Status']} rows={houses.map((h, i) => (
            <TR key={h.id} i={i} cells={[
              { value: `Unit ${h.unit_number}`, style: { fontWeight: 700, color: 'var(--text)' } },
              { value: h.house_type, style: { fontWeight: 600, color: 'var(--blue, #2563eb)' } },
              { value: `KES ${parseFloat(h.rent_amount).toLocaleString()}`, style: { fontWeight: 700, color: 'var(--red, #dc2626)' } },
              { value: h.plot_name || '—', style: { fontWeight: 600, color: 'var(--blue, #2563eb)' } },
              { value: <span style={{ background: h.status === 'vacant' ? 'var(--green-light)' : 'var(--amber-light)', color: h.status === 'vacant' ? 'var(--green)' : 'var(--amber)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{h.status}</span> },
            ]} />
          ))} />
          <SeeMoreFooter onClick={() => navigate('/properties')} />
        </Modal>
      )}

      {modal === 'plots' && (
        <Modal title={`Properties (${plots.length} plots · ${houses.length} units)`} onClose={() => setModal(null)}>
          <Table headers={['Plot Name', 'Location', 'Units']} rows={plots.map((p, i) => (
            <TR key={p.id} i={i} cells={[
              { value: p.name, style: { fontWeight: 700, color: 'var(--text)' } },
              { value: p.location || '—', style: { color: 'var(--muted)' } },
              { value: houses.filter(h => h.plot_id === p.id).length, style: { fontWeight: 600, color: 'var(--primary)' } },
            ]} />
          ))} />
          <SeeMoreFooter onClick={() => navigate('/properties')} />
        </Modal>
      )}

      {modal === 'caretakers' && (
        <Modal title={`Caretaker Workload (${caretakers.length})`} onClose={() => setModal(null)}>
          {caretakers.length === 0 ? (
            <div style={{ padding:48, textAlign:'center' }}>
              <div style={{ fontSize:36, marginBottom:12 }}>🧑‍🔧</div>
              <div style={{ fontWeight:700, fontSize:15, color: isDark?'#f1f5f9':'#0f172a', marginBottom:6 }}>No Caretakers Yet</div>
              <div style={{ fontSize:13, color: isDark?'rgba(255,255,255,0.4)':'#94a3b8' }}>Add caretakers from the Users page.</div>
            </div>
          ) : (
            <>
              {/* Summary bar */}
              <div style={{ display:'flex', borderBottom: isDark?'1px solid rgba(255,255,255,0.07)':'1px solid #e2e8f0', background: isDark?'rgba(255,255,255,0.06)':'#f8fafc' }}>
                {[
                  { label:'Caretakers',       value: caretakers.length,                                                                         color:'#34d399' },
                  { label:'Plots Covered',    value: new Set(caretakers.filter(c => c.plot_id).map(c => c.plot_id)).size,                       color:'#60a5fa' },
                  { label:'Unassigned',       value: caretakers.filter(c => !c.plot_id).length,                                                 color:'#f87171' },
                  { label:'Total Pending MR', value: pendingRequests.length,                                                                    color:'#fbbf24' },
                ].map((s,i) => (
                  <div key={s.label} style={{ flex:1, padding:'13px 16px', borderRight: i<3?(isDark?'1px solid rgba(255,255,255,0.07)':'1px solid #e2e8f0'):'none' }}>
                    <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', color: isDark?'rgba(255,255,255,0.38)':'#94a3b8', marginBottom:3 }}>{s.label}</div>
                    <div style={{ fontFamily:'Space Grotesk', fontWeight:800, fontSize:17, color:s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* One card per caretaker */}
              <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
                {caretakers.map((c, i) => {
                  // All data scoped to this caretaker's assigned plot
                  const plotHouses  = houses.filter(h => h.plot_id === c.plot_id);
                  const plotTenants = activeTenants.filter(t => plotHouses.some(h => h.id === t.house_id));
                  const plotOccupied = plotHouses.filter(h => h.status === 'occupied').length;
                  const plotVacant   = plotHouses.filter(h => h.status === 'vacant').length;
                  const plotMR       = pendingRequests.filter(r => plotHouses.some(h => h.id === r.house_id));
                  const plotArrears  = plotTenants.reduce((s,t) => s + parseFloat(t.balance||0), 0);
                  const plotMRHigh   = plotMR.filter(r => r.priority === 'high').length;
                  const initials     = c.name?.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase() || '?';
                  const hasPlot      = !!c.plot_id;
                  const rowBg        = isDark ? (i%2===0 ? 'transparent' : 'rgba(255,255,255,0.02)') : (i%2===0 ? '#fff' : '#f8fafc');

                  return (
                    <div key={c.id} style={{ padding:'16px 20px', borderBottom: isDark?'1px solid rgba(255,255,255,0.06)':'1px solid #f1f5f9', background: rowBg, transition:'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = isDark?'rgba(52,211,153,0.07)':'#f0fdf4'}
                      onMouseLeave={e => e.currentTarget.style.background = rowBg}
                    >
                      {/* Header row: avatar + name + plot badge */}
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: hasPlot ? 14 : 0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:11 }}>
                          <div style={{ width:40, height:40, borderRadius:'50%', flexShrink:0, background: isDark?'rgba(52,211,153,0.2)':'#dcfce7', border: isDark?'1.5px solid rgba(52,211,153,0.4)':'1.5px solid #86efac', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:800, color: isDark?'#34d399':'#16a34a' }}>
                            {initials}
                          </div>
                          <div>
                            <div style={{ fontWeight:800, fontSize:14, color: isDark?'#f1f5f9':'#0f172a' }}>{c.name}</div>
                            <div style={{ fontSize:11, fontWeight:600, color: isDark?'#60a5fa':'#2563eb', marginTop:1 }}>{c.phone || c.email}</div>
                          </div>
                        </div>
                        {/* Plot assignment badge */}
                        {hasPlot ? (
                          <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 12px', borderRadius:99, fontSize:11, fontWeight:700, background: isDark?'rgba(52,211,153,0.15)':'#dcfce7', color: isDark?'#34d399':'#16a34a', border: isDark?'1px solid rgba(52,211,153,0.3)':'1px solid #86efac' }}>
                            🏢 {c.plot_name || `Plot #${c.plot_id}`}
                          </span>
                        ) : (
                          <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 12px', borderRadius:99, fontSize:11, fontWeight:700, background: isDark?'rgba(248,113,113,0.15)':'#fee2e2', color: isDark?'#f87171':'#dc2626', border: isDark?'1px solid rgba(248,113,113,0.3)':'1px solid #fca5a5' }}>
                            ⚠️ Unassigned
                          </span>
                        )}
                      </div>

                      {/* Workload metrics grid — only shown when assigned to a plot */}
                      {hasPlot && (
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:8 }}>
                          {[
                            { label:'Tenants',    value: plotTenants.length,          color:'#a78bfa', icon:'👥' },
                            { label:'Occupied',   value: plotOccupied,                color:'#34d399', icon:'🏠' },
                            { label:'Vacant',     value: plotVacant,                  color: plotVacant>0?'#fb923c':'rgba(255,255,255,0.3)', icon:'🔑' },
                            { label:'Pending MR', value: plotMR.length,               color: plotMR.length>0?(plotMRHigh>0?'#f87171':'#fbbf24'):'#34d399', icon:'🔧' },
                            { label:'Arrears',    value: `KES ${plotArrears > 0 ? (plotArrears/1000).toFixed(0)+'K' : '0'}`, color: plotArrears>0?'#f87171':'#34d399', icon:'💰' },
                          ].map(m => (
                            <div key={m.label} style={{ background: isDark?'rgba(255,255,255,0.07)':'#f8fafc', borderRadius:9, padding:'10px 12px', border: isDark?'1px solid rgba(255,255,255,0.09)':'1px solid #e2e8f0', textAlign:'center' }}>
                              <div style={{ fontSize:14, marginBottom:4 }}>{m.icon}</div>
                              <div style={{ fontFamily:'Space Grotesk', fontWeight:800, fontSize:15, color:m.color, lineHeight:1 }}>{m.value}</div>
                              <div style={{ fontSize:9, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase', color: isDark?'rgba(255,255,255,0.35)':'#94a3b8', marginTop:3 }}>{m.label}</div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* High priority maintenance alert */}
                      {plotMRHigh > 0 && (
                        <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:10, padding:'7px 12px', borderRadius:8, background: isDark?'rgba(248,113,113,0.1)':'#fff1f2', border: isDark?'1px solid rgba(248,113,113,0.25)':'1px solid #fecdd3' }}>
                          <span style={{ fontSize:12 }}>🔴</span>
                          <span style={{ fontSize:11, fontWeight:700, color: isDark?'#f87171':'#dc2626' }}>
                            {plotMRHigh} high-priority maintenance request{plotMRHigh !== 1 ? 's' : ''} pending on this plot
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <SeeMoreFooter onClick={() => navigate('/users')} />
        </Modal>
      )}

      {modal === 'expiring' && (
        <Modal title={`Expiring Leases (${expiringLeases.length})`} onClose={() => setModal(null)}>
          <div style={{ padding: '12px 24px', background: 'var(--amber-light)', borderBottom: '1px solid var(--border)' }}>
            <p style={{ fontSize: 13, color: 'var(--amber)', fontWeight: 600 }}>⚠️ These tenants have been here 11+ months. Consider renewing their lease agreements.</p>
          </div>
          {expiringLeases.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>No expiring leases at this time.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  {['Tenant', 'Phone', 'Unit', 'Property', 'Move-in Date', 'Tenancy', 'Action'].map(h => (
                    <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {expiringLeases.map((t, i) => {
                  const months = Math.floor((new Date() - new Date(t.move_in_date)) / (1000 * 60 * 60 * 24 * 30));
                  return (
                    <RenewRow key={t.id} t={t} i={i} months={months} onRenewed={() => {
                      setModal(null);
                      setData(null);
                      setLoading(true);
                    }} />
                  );
                })}
              </tbody>
            </table>
          )}
          <SeeMoreFooter onClick={() => navigate('/tenants')} />
        </Modal>
      )}
    </div>
  );
}

function RenewRow({ t, i, months, onRenewed }) {
  const [renewing, setRenewing] = useState(false);
  const [renewed,  setRenewed]  = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newDate,  setNewDate]  = useState(new Date().toISOString().split('T')[0]);
  const [error,    setError]    = useState('');

  async function handleRenew() {
    setRenewing(true); setError('');
    try {
      await API.put(`/tenants/${t.id}`, { ...t, move_in_date: newDate });
      setRenewed(true);
      setShowForm(false);
      setTimeout(() => onRenewed(), 1200);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to renew lease');
    } finally { setRenewing(false); }
  }

  return (
    <>
      <tr style={{ borderTop: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
        <td style={{ padding: '12px 20px', fontWeight: 600 }}>{t.full_name}</td>
        <td style={{ padding: '12px 20px', color: 'var(--muted)' }}>{t.phone || '—'}</td>
        <td style={{ padding: '12px 20px', fontWeight: 600 }}>{t.unit_number || `#${t.house_id}`}</td>
        <td style={{ padding: '12px 20px', color: 'var(--muted)' }}>{t.plot_name || '—'}</td>
        <td style={{ padding: '12px 20px', color: 'var(--muted)' }}>{new Date(t.move_in_date).toLocaleDateString('en-KE')}</td>
        <td style={{ padding: '12px 20px' }}>
          <span style={{ background: months >= 12 ? 'var(--red-light)' : 'var(--amber-light)', color: months >= 12 ? 'var(--red)' : 'var(--amber)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700 }}>{months}m</span>
        </td>
        <td style={{ padding: '12px 20px' }}>
          {renewed ? (
            <span style={{ color: 'var(--green)', fontWeight: 600, fontSize: 13 }}>✓ Renewed</span>
          ) : (
            <button onClick={() => setShowForm(f => !f)} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: showForm ? 'var(--border)' : 'var(--primary)', color: showForm ? 'var(--text)' : '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
              {showForm ? 'Cancel' : 'Renew Lease'}
            </button>
          )}
        </td>
      </tr>
      {showForm && (
        <tr style={{ background: 'var(--primary-light)' }}>
          <td colSpan={7} style={{ padding: '12px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>New lease start date:</span>
              <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
                style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, outline: 'none', background: 'var(--surface)' }} />
              <button onClick={handleRenew} disabled={renewing} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: 'var(--green)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                {renewing ? 'Saving...' : 'Confirm Renewal'}
              </button>
              {error && <span style={{ color: 'var(--red)', fontSize: 12 }}>{error}</span>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
